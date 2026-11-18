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

module.exports = { AppError };
