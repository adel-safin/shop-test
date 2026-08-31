import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import { createRouter } from './routes.js';
import { errorHandler } from '../lib/http.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

export function createApiApp() {
  const app = express();
  app.use(express.json());
  app.use(express.static(publicDir));
  app.use(createRouter());
  app.use(errorHandler);
  return app;
}
