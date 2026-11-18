const { withTransaction } = require('../config/db');
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

module.exports = { createBooking };
