const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const { pool } = require('../config/db');
const { AppError } = require('../errors');

// Compared against when the registration number does not exist, so that an
// unknown number costs the same bcrypt work as a wrong password and the two
// cases cannot be told apart by response time. Same cost factor as real hashes.
const DUMMY_HASH = bcrypt.hashSync('no-student-has-this-password', 10);

// One error object shape for every login failure.
function invalidCredentials() {
  return new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
}

/**
 * Verifies the credentials and returns a signed token.
 * Throws the same INVALID_CREDENTIALS error whether the registration number
 * is unknown, the password is wrong, or a field is missing.
 */
async function login(registrationNo, password) {
  if (typeof registrationNo !== 'string' || typeof password !== 'string') {
    throw invalidCredentials();
  }

  const { rows } = await pool.query(
    'SELECT student_id, password_hash FROM students WHERE registration_no = $1',
    [registrationNo]
  );
  const student = rows[0];

  const passwordMatches = await bcrypt.compare(
    password,
    student ? student.password_hash : DUMMY_HASH
  );

  if (!student || !passwordMatches) {
    throw invalidCredentials();
  }

  // The token carries only the student's id. Year, gender and fee status are
  // read from the database on every request, never from the token.
  return jwt.sign({ sub: String(student.student_id) }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
  });
}

module.exports = { login };
