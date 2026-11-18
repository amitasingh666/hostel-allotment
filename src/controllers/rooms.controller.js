const roomsService = require('../services/rooms.service');

async function list(req, res) {
  const rooms = await roomsService.listEligibleRooms(req.studentId);
  res.json({ rooms });
}

module.exports = { list };
