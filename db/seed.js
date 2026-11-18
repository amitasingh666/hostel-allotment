// Seeds the database with test data. Empties every table first, so it can be
// re-run at any time to get back to a known state.
//
//   npm run db:seed
//
// Every seeded student has the same password (SEED_PASSWORD), hashed
// separately per student with bcrypt. No plain-text password is stored.

const bcrypt = require('bcrypt');

const { pool, withTransaction } = require('../src/config/db');

const SEED_PASSWORD = 'Password@123';
const BCRYPT_ROUNDS = 10;

const HOSTELS = [
  { name: 'Aravali', year: 1, gender: 'BOYS' },
  { name: 'Ganga', year: 1, gender: 'GIRLS' },
  { name: 'Nilgiri', year: 2, gender: 'BOYS' },
  { name: 'Yamuna', year: 2, gender: 'GIRLS' },
  { name: 'Shivalik', year: 3, gender: 'BOYS' },
];

// `occupants` are registration numbers of students who already hold a seat.
const ROOMS = [
  { hostel: 'Aravali', room_number: '101', capacity: 2, occupants: [] }, // empty
  { hostel: 'Aravali', room_number: '102', capacity: 3, occupants: ['2026CS901', '2026CS902'] }, // 1 seat left
  { hostel: 'Aravali', room_number: '103', capacity: 2, occupants: ['2026CS903', '2026CS904'] }, // full
  { hostel: 'Aravali', room_number: '104', capacity: 3, occupants: [] },
  { hostel: 'Ganga', room_number: '101', capacity: 2, occupants: [] },
  { hostel: 'Ganga', room_number: '102', capacity: 3, occupants: [] },
  { hostel: 'Nilgiri', room_number: '101', capacity: 2, occupants: [] },
  { hostel: 'Nilgiri', room_number: '102', capacity: 3, occupants: [] },
  { hostel: 'Yamuna', room_number: '101', capacity: 2, occupants: [] },
  { hostel: 'Shivalik', room_number: '101', capacity: 2, occupants: [] },
];

const STUDENTS = [
  // Two students of the same year and gender, to race for the same seat.
  { registration_no: '2026CS001', current_year: 1, gender: 'BOYS', fees_paid: true, note: 'racer A' },
  { registration_no: '2026CS002', current_year: 1, gender: 'BOYS', fees_paid: true, note: 'racer B' },

  // More year-1 boys, so a test can send more requests than a room has seats.
  { registration_no: '2026CS003', current_year: 1, gender: 'BOYS', fees_paid: true, note: 'extra year-1 boy' },
  { registration_no: '2026CS004', current_year: 1, gender: 'BOYS', fees_paid: true, note: 'extra year-1 boy' },
  { registration_no: '2026CS005', current_year: 1, gender: 'BOYS', fees_paid: true, note: 'extra year-1 boy' },
  { registration_no: '2026CS006', current_year: 1, gender: 'BOYS', fees_paid: true, note: 'extra year-1 boy' },
  { registration_no: '2026CS007', current_year: 1, gender: 'BOYS', fees_paid: true, note: 'extra year-1 boy' },
  { registration_no: '2026CS008', current_year: 1, gender: 'BOYS', fees_paid: true, note: 'extra year-1 boy' },

  // Old registration numbers whose digits would suggest a higher year.
  { registration_no: '2025CS010', current_year: 1, gender: 'BOYS', fees_paid: true, note: 'repeater: admitted 2025, still year 1' },
  { registration_no: '2023CS020', current_year: 1, gender: 'BOYS', fees_paid: true, note: 'repeated several times: admitted 2023, still year 1' },
  { registration_no: '2025CS030', current_year: 2, gender: 'BOYS', fees_paid: true, note: 'backlog but promoted: year 2' },

  { registration_no: '2026CS040', current_year: 1, gender: 'BOYS', fees_paid: false, note: 'fees NOT paid' },
  { registration_no: '2026CS050', current_year: 1, gender: 'GIRLS', fees_paid: true, note: 'year-1 girl (wrong gender for Aravali)' },
  { registration_no: '2025CS060', current_year: 2, gender: 'BOYS', fees_paid: true, note: 'year-2 boy (wrong year for Aravali)' },

  // Students who already hold the seats in the partly-full and full rooms.
  { registration_no: '2026CS901', current_year: 1, gender: 'BOYS', fees_paid: true, note: 'occupant of Aravali 102' },
  { registration_no: '2026CS902', current_year: 1, gender: 'BOYS', fees_paid: true, note: 'occupant of Aravali 102' },
  { registration_no: '2026CS903', current_year: 1, gender: 'BOYS', fees_paid: true, note: 'occupant of Aravali 103' },
  { registration_no: '2026CS904', current_year: 1, gender: 'BOYS', fees_paid: true, note: 'occupant of Aravali 103' },
];

async function seed() {
  // Hash outside the transaction: bcrypt is deliberately slow.
  const hashes = await Promise.all(
    STUDENTS.map(() => bcrypt.hash(SEED_PASSWORD, BCRYPT_ROUNDS))
  );

  await withTransaction(async (client) => {
    await client.query(
      'TRUNCATE bookings, rooms, hostels, students RESTART IDENTITY CASCADE'
    );

    const studentIds = {};
    for (let i = 0; i < STUDENTS.length; i += 1) {
      const s = STUDENTS[i];
      const { rows } = await client.query(
        `INSERT INTO students (registration_no, password_hash, current_year, gender, fees_paid)
         VALUES ($1, $2, $3, $4, $5) RETURNING student_id`,
        [s.registration_no, hashes[i], s.current_year, s.gender, s.fees_paid]
      );
      studentIds[s.registration_no] = rows[0].student_id;
    }

    const hostelIds = {};
    for (const h of HOSTELS) {
      const { rows } = await client.query(
        'INSERT INTO hostels (name, year, gender) VALUES ($1, $2, $3) RETURNING hostel_id',
        [h.name, h.year, h.gender]
      );
      hostelIds[h.name] = rows[0].hostel_id;
    }

    for (const r of ROOMS) {
      const { rows } = await client.query(
        `INSERT INTO rooms (hostel_id, room_number, capacity)
         VALUES ($1, $2, $3) RETURNING room_id`,
        [hostelIds[r.hostel], r.room_number, r.capacity]
      );
      for (const registrationNo of r.occupants) {
        await client.query(
          'INSERT INTO bookings (student_id, room_id) VALUES ($1, $2)',
          [studentIds[registrationNo], rows[0].room_id]
        );
      }
    }

    // Derive every count from the bookings just inserted, so a room's
    // occupied_count always equals its number of active bookings.
    await client.query(
      `UPDATE rooms r SET occupied_count = (
         SELECT count(*) FROM bookings b
         WHERE b.room_id = r.room_id AND b.status = 'ACTIVE'
       )`
    );
  });
}

async function printSummary() {
  const rooms = await pool.query(
    `SELECT h.name AS hostel, h.year, h.gender, r.room_id, r.room_number,
            r.capacity, r.occupied_count,
            r.capacity - r.occupied_count AS remaining
     FROM rooms r JOIN hostels h USING (hostel_id)
     ORDER BY h.hostel_id, r.room_number`
  );
  console.log('\nRooms');
  console.table(rooms.rows);

  console.log('Students');
  console.table(
    STUDENTS.map(({ registration_no, current_year, gender, fees_paid, note }) => ({
      registration_no, current_year, gender, fees_paid, note,
    }))
  );
  console.log(`Password for every seeded student: ${SEED_PASSWORD}\n`);
}

module.exports = { seed, SEED_PASSWORD, STUDENTS, HOSTELS, ROOMS };

if (require.main === module) {
  seed()
    .then(printSummary)
    .catch((err) => {
      console.error('Seeding failed:', err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
