// services/messagesDb.js
// Persists the actual WhatsApp conversation transcript to Postgres. Previously
// this only lived in server RAM (conversationState.js) — every crash or
// redeploy wiped it, which is exactly the "history disappears" gap the spec
// requires ("Conservar conversaciones completas", "Historial completo").
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
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        phone TEXT NOT NULL,
        sender TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages (phone, created_at);
    `);
  }
  return initPromise;
}

async function addMessage(phone, sender, text) {
  try {
    await ensureTable();
    await pool.query(
      'INSERT INTO messages (phone, sender, text) VALUES ($1, $2, $3)',
      [phone, sender, text]
    );
  } catch (err) {
    // Never let a logging failure take down message handling — this is a
    // secondary write, not the primary path (the reply already went out).
    logger.error(`Error saving message to history for ${phone}:`, err.message);
  }
}

async function getMessages(phone, limit = 200) {
  await ensureTable();
  const res = await pool.query(
    'SELECT sender, text, created_at AS timestamp FROM messages WHERE phone = $1 ORDER BY created_at ASC LIMIT $2',
    [phone, limit]
  );
  return res.rows;
}

// One row per phone: the most recent message, for the dashboard's
// conversation list sidebar.
async function getConversationsSummary() {
  await ensureTable();
  const res = await pool.query(`
    SELECT DISTINCT ON (phone) phone, sender, text, created_at AS timestamp
    FROM messages
    ORDER BY phone, created_at DESC
  `);
  return res.rows.map(r => ({
    phone: r.phone,
    lastMessage: { sender: r.sender, text: r.text, timestamp: r.timestamp },
  })).sort((a, b) => new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp));
}

module.exports = { addMessage, getMessages, getConversationsSummary };
