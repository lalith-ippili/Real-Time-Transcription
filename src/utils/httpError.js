export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    if (details !== undefined) this.details = details;
  }

  static badRequest(message = 'Bad request', details) {
    return new HttpError(400, message, details);
  }

  static notFound(message = 'Resource not found') {
    return new HttpError(404, message);
  }

  static unavailable(message = 'Service unavailable') {
    return new HttpError(503, message);
  }
}

export default HttpError;
