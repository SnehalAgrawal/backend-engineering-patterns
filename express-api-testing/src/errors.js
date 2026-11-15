import mongoose from 'mongoose';

/** An error with an HTTP status, thrown by route handlers. */
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (req, _res, next) =>
  next(new HttpError(404, 'not_found', `No route for ${req.method} ${req.path}`));

/**
 * One place that turns errors into responses, so every endpoint answers the same way:
 * { "error": { "code", "message", "details"? } }. Database internals never reach the client.
 */
// Express recognises an error handler by its four arguments, so _next stays even though it is unused
export function errorHandler(err, _req, res, _next) {
  let status = 500;
  let body = { code: 'internal_error', message: 'Something went wrong' };

  if (err instanceof HttpError) {
    status = err.status;
    body = { code: err.code, message: err.message, details: err.details };
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    const details = Object.fromEntries(
      Object.entries(err.errors).map(([field, e]) => [field, e.message]),
    );
    body = { code: 'validation_failed', message: 'Some fields are invalid', details };
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    body = { code: 'invalid_id', message: `"${err.value}" is not a valid id` };
  } else if (err?.code === 11000) {
    status = 409;
    body = {
      code: 'duplicate',
      message: `A record with this ${Object.keys(err.keyValue ?? {}).join(', ')} already exists`,
    };
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    body = { code: 'invalid_json', message: 'The request body is not valid JSON' };
  }

  if (status === 500) console.error(err);
  res.status(status).json({ error: body });
}
