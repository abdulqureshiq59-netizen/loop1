// services/settingsDb.js
// Tiny generic key/value store for app-wide settings the client should be
// able to change from the dashboard without a redeploy — starting with the
// admin's own WhatsApp number for HOT-lead/visit-scheduled alerts. Kept as
// its own table (not hardcoded in .env) specifically so it's editable from
// the UI.
const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

let initPromise = null;

async function ensureTable() {
  if (!initPromise) {
    initPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT DEFAULT '',
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);
  }
  return initPromise;
}

async function getSetting(key, fallback = '') {
  await ensureTable();
  const res = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return res.rows[0]?.value ?? fallback;
}

async function setSetting(key, value) {
  await ensureTable();
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [key, value]
  );
  logger.info(`Setting updated: ${key} = ${value}`);
}

module.exports = { getSetting, setSetting };
