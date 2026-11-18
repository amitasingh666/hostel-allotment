const jwt = require('jsonwebtoken');

const { pool } = require('../config/db');
const { AppError } = require('../errors');

// One response for every way of not being logged in, so the reply does not
// reveal whether a token was missing, expired, forged or for a removed student.
function notLoggedIn() {
  return new AppError(401, 'NOT_LOGGED_IN', 'You must be logged in');
}

/**
 * Requires a valid `Authorization: Bearer <token>` header and sets
 * `req.studentId` from the token.
 *
 * This is the only source of the student's identity. Route handlers must use
 * `req.studentId` and never read a student id from the body, query or URL.
 */
async function requireAuth(req, res, next) {
  const header = req.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    throw notLoggedIn();
  }

  let payload;
  try {
    // Pinning the algorithm rejects tokens forged with `alg: none` or any
    // algorithm other than the one this server signs with.
    payload = jwt.verify(match[1], process.env.JWT_SECRET, {
      algorithms: ['HS256'],
    });
  } catch (err) {
    throw notLoggedIn();
  }

  const studentId = Number(payload.sub);
  if (!Number.isInteger(studentId) || studentId <= 0) {
    throw notLoggedIn();
  }

  // A token stays valid until it expires, so confirm the student still exists.
  // A database failure here is not caught: it surfaces as a 500, not a 401.
  const { rowCount } = await pool.query(
    'SELECT 1 FROM students WHERE student_id = $1',
    [studentId]
  );
  if (rowCount === 0) {
    throw notLoggedIn();
  }

  req.studentId = studentId;
  next();
}

module.exports = { requireAuth };
