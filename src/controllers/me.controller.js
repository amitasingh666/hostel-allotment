const bookingsService = require('../services/bookings.service');

async function getBooking(req, res) {
  const booking = await bookingsService.getActiveBooking(req.studentId);
  res.json({ booking });
}

module.exports = { getBooking };
