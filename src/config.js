const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  apiPort: num(process.env.API_PORT, 3000),
  providerPort: num(process.env.PROVIDER_PORT, 3001),

  databaseUrl: process.env.DATABASE_URL ?? 'postgres://shop:shop@localhost:5433/shop',

  adminToken: process.env.ADMIN_TOKEN ?? 'dev-admin-token',

  // Заказ, зависший в delivering дольше этого срока, считается брошенным воркером.
  staleDeliveringMs: num(process.env.STALE_DELIVERING_MS, 4000),
  reconcilerIntervalMs: num(process.env.RECONCILER_INTERVAL_MS, 3000),
  reconcilerEnabled: process.env.RECONCILER_ENABLED !== 'false',

  providerTimeoutMs: num(process.env.PROVIDER_TIMEOUT_MS, 2000),
  providerRetries: num(process.env.PROVIDER_RETRIES, 2),

  providers: {
    A: {
      errorRate: num(process.env.PROVIDER_A_ERROR_RATE, 0),
      timeoutRate: num(process.env.PROVIDER_A_TIMEOUT_RATE, 0),
      // lostRate: ключ выдан, но ответ не дошёл. Проверка «таймаут это не отказ».
      lostRate: num(process.env.PROVIDER_A_LOST_RATE, 0),
      hangMs: num(process.env.PROVIDER_A_HANG_MS, 30000),
    },
    B: {
      errorRate: num(process.env.PROVIDER_B_ERROR_RATE, 0),
      timeoutRate: num(process.env.PROVIDER_B_TIMEOUT_RATE, 0),
      lostRate: num(process.env.PROVIDER_B_LOST_RATE, 0),
      hangMs: num(process.env.PROVIDER_B_HANG_MS, 30000),
    },
  },
};

export const providerUrl = (name) =>
  `http://127.0.0.1:${config.providerPort}/provider/${name.toLowerCase()}/issue`;

export const apiUrl = (path) => `http://127.0.0.1:${config.apiPort}${path}`;
