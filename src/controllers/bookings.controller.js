const bookingsService = require('../services/bookings.service');
const { AppError } = require('../errors');

const MAX_INTEGER_ID = 2147483647; // largest value of a PostgreSQL INTEGER

/** Returns `value` if it is a usable id, otherwise throws a 400 with `code`. */
function parseId(value, code, message) {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_INTEGER_ID) {
    throw new AppError(400, code, message);
  }
  return value;
}

async function create(req, res) {
  const body = req.body || {};
  const roomId = parseId(body.room_id, 'INVALID_ROOM_ID', 'room_id must be a positive integer');

  // The student is always req.studentId (from the token). Identity fields in
  // the body are passed along only so that a mismatch can be rejected.
  const result = await bookingsService.createBooking(req.studentId, roomId, {
    studentId: body.student_id,
    registrationNo: body.registration_no,
  });

  res.status(201).json({ success: true, ...result });
}

/** Reads the :booking_id URL parameter, which arrives as text. */
function parseBookingIdParam(req) {
  const raw = req.params.booking_id;
  return parseId(
    /^\d+$/.test(raw) ? Number(raw) : NaN,
    'INVALID_BOOKING_ID',
    'booking_id must be a positive integer'
  );
}

async function cancel(req, res) {
  const bookingId = parseBookingIdParam(req);
  const result = await bookingsService.cancelBooking(req.studentId, bookingId);
  res.json({ success: true, ...result });
}

async function change(req, res) {
  const body = req.body || {};
  const bookingId = parseBookingIdParam(req);
  const newRoomId = parseId(
    body.new_room_id,
    'INVALID_ROOM_ID',
    'new_room_id must be a positive integer'
  );

  const result = await bookingsService.changeRoom(req.studentId, bookingId, newRoomId, {
    studentId: body.student_id,
    registrationNo: body.registration_no,
  });

  res.json({ success: true, ...result });
}

module.exports = { create, cancel, change };
