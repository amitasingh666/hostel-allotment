const { pool } = require('../config/db');

/**
 * Rooms of every hostel the student is eligible for.
 *
 * Eligibility is decided inside the query from the student's stored
 * current_year and gender; nothing from the request takes part in it.
 * The counts are read straight from the rooms table on every call (no cache),
 * and occupied_count only ever changes in the same transaction as its booking,
 * so the result is correct as of the moment the query runs.
 */
async function listEligibleRooms(studentId) {
  const { rows } = await pool.query(
    `SELECT r.room_id,
            h.name AS hostel_name,
            r.room_number,
            r.capacity,
            r.occupied_count,
            r.capacity - r.occupied_count AS remaining,
            r.occupied_count >= r.capacity AS is_full
     FROM students s
     JOIN hostels h ON h.year = s.current_year AND h.gender = s.gender
     JOIN rooms r ON r.hostel_id = h.hostel_id
     WHERE s.student_id = $1
     ORDER BY h.name, r.room_number`,
    [studentId]
  );
  return rows;
}

module.exports = { listEligibleRooms };
