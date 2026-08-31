export class AppError extends Error {
  constructor(code, { status = 400, details } = {}) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const notFound = (code) => new AppError(code, { status: 404 });
