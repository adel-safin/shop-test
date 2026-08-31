import pg from 'pg';
import { config } from '../config.js';

// Пул больше, чем 50 параллельных вебхуков в тестах: иначе воркеры встанут
// в очередь за соединением и гонка не воспроизведётся честно.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 60,
  idleTimeoutMillis: 10_000,
});

export const query = (text, params) => pool.query(text, params);

export const UNIQUE_VIOLATION = '23505';

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch((rollbackError) => {
      console.error('rollback failed', rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}

export const closePool = () => pool.end();
