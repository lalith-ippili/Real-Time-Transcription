import { ZodError } from 'zod';
import config from '../config/env.js';
import HttpError from '../utils/httpError.js';

export const notFound = (req, res) => {
  res.status(404).json({
    error: { message: `Route not found: ${req.method} ${req.originalUrl}` },
  });
};

// Map common PostgreSQL error codes to HTTP responses.
const PG_ERRORS = {
  '22P02': [400, 'Invalid input syntax'],
  '23502': [400, 'A required field is missing'],
  '23505': [409, 'Duplicate value'],
  '23514': [400, 'Value violates a database constraint'],
  '42P01': [500, 'Database table is missing – run the migration'],
  '53300': [503, 'Database has too many connections, try again'],
  '57P01': [503, 'Database connection was terminated, try again'],
};

const CONNECTION_ERRORS = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN']);

export const errorHandler = (err, req, res, _next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let details = err.details;

  if (err instanceof ZodError) {
    status = 400;
    message = 'Validation failed';
    details = err.issues.map((issue) => ({
      field: issue.path.join('.') || null,
      message: issue.message,
    }));
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON body';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body is too large';
  } else if (err.code && PG_ERRORS[err.code]) {
    [status, message] = PG_ERRORS[err.code];
  } else if (err.code && CONNECTION_ERRORS.has(err.code)) {
    status = 503;
    message = 'Database is unreachable';
  }

  if (status >= 500) {
    if (err instanceof HttpError) {
      console.warn(`[warn] ${req.method} ${req.originalUrl} → ${status}: ${message}`);
    } else {
      console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
    }
    if (config.isProduction && !err.expose && status === 500) {
      message = 'Internal server error';
    }
  }

  const body = { error: { message } };
  if (details) body.error.details = details;
  if (!config.isProduction && status >= 500 && err.stack) body.error.stack = err.stack;

  res.status(status).json(body);
};
