const { pool, withTransaction } = require('../config/db');
const { AppError } = require('../errors');

const UNIQUE_VIOLATION = '23505';

/**
 * Loads the student's row and locks it until the transaction ends.
 *
 * Every booking action of one student starts here, so that student's own
 * simultaneous requests (double-click, two tabs, a client retry) run one after
 * another instead of side by side. The lock lives in PostgreSQL, so it works
 * the same across any number of app processes.
 *
 * Year, gender and fee status are read here, at booking time, from the stored
 * record: never from the token or the request.
 */
async function lockStudent(client, studentId) {
  const { rows } = await client.query(
    `SELECT registration_no, current_year, gender, fees_paid
     FROM students WHERE student_id = $1 FOR UPDATE`,
    [studentId]
  );
  if (rows.length === 0) {
    throw new AppError(401, 'NOT_LOGGED_IN', 'You must be logged in');
  }
  return rows[0];
}

/**
 * Rejects a request that names a different student than the logged-in one.
 * The identity always comes from the token; a body that points at someone
 * else is an attempt to act on their behalf.
 */
function assertActingForSelf(studentId, student, claimed) {
  const namesOtherId =
    claimed.studentId !== undefined && String(claimed.studentId) !== String(studentId);
  const namesOtherRegNo =
    claimed.registrationNo !== undefined &&
    String(claimed.registrationNo) !== student.registration_no;

  if (namesOtherId || namesOtherRegNo) {
    throw new AppError(
      403,
      'CANNOT_ACT_FOR_ANOTHER_STUDENT',
      'You can only book a seat for yourself'
    );
  }
}

function assertFeesPaid(student) {
  if (!student.fees_paid) {
    throw new AppError(403, 'FEES_NOT_PAID', 'Submit your fees first');
  }
}

/**
 * Checks that the room exists and that the hostel it actually belongs to
 * serves this student's year and gender. A hostel_id sent by the client is
 * never consulted.
 */
async function assertRoomAllowed(client, student, roomId) {
  const { rows } = await client.query(
    `SELECT h.year, h.gender
     FROM rooms r JOIN hostels h ON h.hostel_id = r.hostel_id
     WHERE r.room_id = $1`,
    [roomId]
  );
  if (rows.length === 0) {
    throw new AppError(404, 'ROOM_NOT_FOUND', 'Room not found');
  }
  const hostel = rows[0];
  if (hostel.year !== student.current_year || hostel.gender !== student.gender) {
    throw new AppError(
      403,
      'ROOM_NOT_ALLOWED',
      'This room is not in a hostel for your year and gender'
    );
  }
}

/**
 * Takes one seat, or throws ROOM_FULL.
 *
 * The check and the increment are a single statement, so two transactions can
 * never both pass the check: the second one waits for the first to finish and
 * then re-evaluates `occupied_count < capacity` against the new value.
 * Returns the seats remaining after this one was taken.
 */
async function takeSeat(client, roomId) {
  const { rows } = await client.query(
    `UPDATE rooms SET occupied_count = occupied_count + 1
     WHERE room_id = $1 AND occupied_count < capacity
     RETURNING capacity - occupied_count AS remaining`,
    [roomId]
  );
  if (rows.length === 0) {
    throw new AppError(409, 'ROOM_FULL', 'Room is full');
  }
  return rows[0].remaining;
}

/**
 * Gives one seat back and returns the seats remaining afterwards.
 *
 * Callers must only call this after they have actually turned one ACTIVE
 * booking of this room into a CANCELLED one, in the same transaction. That is
 * what keeps a seat from being freed twice for the same booking.
 */
async function releaseSeat(client, roomId) {
  const { rows } = await client.query(
    `UPDATE rooms SET occupied_count = occupied_count - 1
     WHERE room_id = $1 AND occupied_count > 0
     RETURNING capacity - occupied_count AS remaining`,
    [roomId]
  );
  if (rows.length === 0) {
    // An active booking existed but its room had no occupied seat: the data is
    // inconsistent. Fail the whole transaction rather than paper over it.
    throw new Error(`Room ${roomId} has an active booking but occupied_count is 0`);
  }
  return rows[0].remaining;
}

function alreadyBooked() {
  return new AppError(409, 'ALREADY_BOOKED', 'You already have an active booking');
}

/**
 * Books a seat in `roomId` for the logged-in student.
 *
 * Runs as one transaction: if any step fails, everything is rolled back and
 * no count changes.
 */
async function createBooking(studentId, roomId, claimed = {}) {
  try {
    return await withTransaction(async (client) => {
      const student = await lockStudent(client, studentId);

      assertActingForSelf(studentId, student, claimed);
      assertFeesPaid(student);
      await assertRoomAllowed(client, student, roomId);

      const existing = await client.query(
        `SELECT 1 FROM bookings WHERE student_id = $1 AND status = 'ACTIVE'`,
        [studentId]
      );
      if (existing.rowCount > 0) {
        throw alreadyBooked();
      }

      const remaining = await takeSeat(client, roomId);

      const { rows } = await client.query(
        `INSERT INTO bookings (student_id, room_id) VALUES ($1, $2)
         RETURNING booking_id`,
        [studentId, roomId]
      );

      return { booking_id: rows[0].booking_id, remaining };
    });
  } catch (err) {
    // Second line of defence: the unique index on active bookings. The student
    // lock should make this unreachable, but if it is ever hit the transaction
    // has already rolled back (returning the seat) and the answer is the same.
    if (err.code === UNIQUE_VIOLATION && err.constraint === 'bookings_one_active_per_student') {
      throw alreadyBooked();
    }
    throw err;
  }
}

/**
 * Loads one of the student's own bookings and locks it for this transaction.
 *
 * The lookup is by booking id AND owner together, so a booking that belongs
 * to someone else is indistinguishable from one that does not exist: both are
 * BOOKING_NOT_FOUND. Answering "forbidden" would confirm the id is real.
 */
async function lockOwnBooking(client, studentId, bookingId) {
  const { rows } = await client.query(
    `SELECT booking_id, room_id, status FROM bookings
     WHERE booking_id = $1 AND student_id = $2 FOR UPDATE`,
    [bookingId, studentId]
  );
  if (rows.length === 0) {
    throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  }
  return rows[0];
}

/**
 * Marks an ACTIVE booking as CANCELLED. Throws ALREADY_CANCELLED if it is not
 * active. The `status = 'ACTIVE'` condition in the UPDATE is the guard: only a
 * transaction that really changed the row may go on to free the seat.
 */
async function markCancelled(client, booking) {
  const { rowCount } = await client.query(
    `UPDATE bookings SET status = 'CANCELLED', cancelled_at = now()
     WHERE booking_id = $1 AND status = 'ACTIVE'`,
    [booking.booking_id]
  );
  if (rowCount === 0) {
    throw new AppError(409, 'ALREADY_CANCELLED', 'Booking is already cancelled');
  }
}

/**
 * Cancels the logged-in student's booking and frees its seat.
 *
 * The booking row is kept (status CANCELLED) for history. Calling this twice,
 * even at the same instant, frees the seat once: the second call finds the
 * booking no longer active and is rejected with nothing changed.
 */
async function cancelBooking(studentId, bookingId) {
  return withTransaction(async (client) => {
    await lockStudent(client, studentId);

    const booking = await lockOwnBooking(client, studentId, bookingId);
    await markCancelled(client, booking);
    const remaining = await releaseSeat(client, booking.room_id);

    return { booking_id: booking.booking_id, remaining };
  });
}

/**
 * Locks both room rows, lower room_id first.
 *
 * A change touches two rooms. If two students swap at the same instant
 * (A -> B and B -> A) and each locked "its" rooms in its own order, each would
 * hold one room and wait forever for the other. Taking the locks in one fixed
 * order for everybody makes that impossible.
 */
async function lockRoomsInOrder(client, roomIdA, roomIdB) {
  await client.query(
    `SELECT room_id FROM rooms WHERE room_id IN ($1, $2)
     ORDER BY room_id FOR UPDATE`,
    [roomIdA, roomIdB]
  );
}

/**
 * Moves the logged-in student from their current booking to `newRoomId`.
 *
 * The old booking is cancelled (kept as history) and a new booking is created,
 * all in one transaction. Every check, including "is the new room full",
 * passes before the old booking is touched, and any failure rolls everything
 * back: the student keeps the original seat and both room counts are as they
 * were. The student can never end up with no seat or with two.
 */
async function changeRoom(studentId, bookingId, newRoomId, claimed = {}) {
  return withTransaction(async (client) => {
    const student = await lockStudent(client, studentId);

    assertActingForSelf(studentId, student, claimed);
    assertFeesPaid(student);

    const booking = await lockOwnBooking(client, studentId, bookingId);
    if (booking.status !== 'ACTIVE') {
      throw new AppError(409, 'ALREADY_CANCELLED', 'Booking is already cancelled');
    }
    if (booking.room_id === newRoomId) {
      throw new AppError(409, 'SAME_ROOM', 'You are already in this room');
    }

    await assertRoomAllowed(client, student, newRoomId);
    await lockRoomsInOrder(client, booking.room_id, newRoomId);

    // New seat first: if the new room is full this throws before anything
    // about the old booking has changed.
    const remaining = await takeSeat(client, newRoomId);

    // The old booking must stop being ACTIVE before the new one is inserted,
    // or the one-active-booking-per-student index would reject the insert.
    await markCancelled(client, booking);
    await releaseSeat(client, booking.room_id);

    const { rows } = await client.query(
      `INSERT INTO bookings (student_id, room_id) VALUES ($1, $2)
       RETURNING booking_id`,
      [studentId, newRoomId]
    );

    return {
      booking_id: rows[0].booking_id,
      old_booking_id: booking.booking_id,
      remaining,
    };
  });
}

/**
 * The student's current active booking, or null if they have none.
 * Returns only the student's own booking and the room it is in: nothing about
 * who else is in that room.
 */
async function getActiveBooking(studentId) {
  const { rows } = await pool.query(
    `SELECT b.booking_id, b.room_id, r.room_number, h.name AS hostel_name,
            b.status, b.created_at
     FROM bookings b
     JOIN rooms r ON r.room_id = b.room_id
     JOIN hostels h ON h.hostel_id = r.hostel_id
     WHERE b.student_id = $1 AND b.status = 'ACTIVE'`,
    [studentId]
  );
  return rows[0] || null;
}

module.exports = { createBooking, cancelBooking, changeRoom, getActiveBooking };
