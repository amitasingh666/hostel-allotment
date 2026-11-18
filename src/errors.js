/**
 * An error that is safe to show to the client.
 * `code` is a stable machine-readable name, one per failure mode.
 */
class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Answers any request that matched no route. */
function notFoundHandler(req, res) {
  res.status(404).json({ error: 'NOT_FOUND', message: 'Route not found' });
}

/**
 * Turns every error thrown during a request into a JSON response.
 * Express recognises an error handler by its four arguments.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }

  // Thrown by express.json() when the request body is not valid JSON.
  if (err.type === 'entity.parse.failed') {
    return res
      .status(400)
      .json({ error: 'INVALID_JSON', message: 'Request body is not valid JSON' });
  }

  // Anything else is a bug or an outage: log it, tell the client nothing specific.
  console.error(err);
  return res
    .status(500)
    .json({ error: 'INTERNAL_ERROR', message: 'Something went wrong' });
}

module.exports = { AppError, notFoundHandler, errorHandler };
