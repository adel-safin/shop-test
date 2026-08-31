import { config } from './config.js';
import { createApiApp } from './api/app.js';
import { createProviderApp } from './providers/server.js';
import { startReconciler, stopReconciler } from './services/reconciler.js';
import { closePool } from './db/pool.js';

const api = createApiApp().listen(config.apiPort, () => {
  console.log(`витрина и API: http://localhost:${config.apiPort}`);
});

const providers = createProviderApp().listen(config.providerPort, () => {
  console.log(`поставщики A и B: http://localhost:${config.providerPort}`);
});

startReconciler();

const shutdown = () => {
  stopReconciler();
  api.close();
  providers.close();
  closePool().finally(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
