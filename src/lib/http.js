import { AppError } from './errors.js';

export const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  if (error instanceof AppError) {
    return res.status(error.status).json({ error: error.code, details: error.details });
  }

  console.error(`${req.method} ${req.originalUrl} failed`, error);
  return res.status(500).json({ error: 'internal_error' });
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
