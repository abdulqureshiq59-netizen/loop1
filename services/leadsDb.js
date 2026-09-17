// services/leadsDb.js
// Leads storage using Render's PostgreSQL. Now also tracks AI/Human `mode`
// per phone (previously only in server RAM via conversationState.js — lost
// on every restart/crash, which is risky: an agent could take manual
// control, the server restarts for any reason, and the bot silently
// resumes auto-replying mid-negotiation without anyone noticing).
const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const STAGE_ORDER = ["NUEVO", "CALIFICANDO", "CALIENTE", "CONTACTADO", "VISITA", "NEGOCIACION", "CERRADO"];
const HUMAN_MANAGED_FROM_INDEX = 3;

let initPromise = null;

async function ensureTable() {
  if (!initPromise) {
    initPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS leads (
        phone TEXT PRIMARY KEY,
        name TEXT DEFAULT '',
        channel TEXT DEFAULT '',
        operation TEXT DEFAULT '',
        type TEXT DEFAULT '',
        zone TEXT DEFAULT '',
        bedrooms TEXT DEFAULT '',
        budget TEXT DEFAULT '',
        financing TEXT DEFAULT '',
        timeline TEXT DEFAULT '',
        temperature TEXT DEFAULT '',
        property_id TEXT DEFAULT '',
        agent_name TEXT DEFAULT '',
        stage TEXT DEFAULT 'NUEVO',
        mode TEXT DEFAULT 'ai',
        last_message TEXT DEFAULT '',
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    // In case this table already existed from before the mode column existed.
    await initPromise;
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'ai';`);
  }
  return initPromise;
}

function computeAutoStage(existingStage, data) {
  const existingIndex = STAGE_ORDER.indexOf(existingStage);
  if (existingIndex >= HUMAN_MANAGED_FROM_INDEX) return existingStage || 'NUEVO';

  let candidateIndex = 0;
  const hasSomeInfo = data.operation || data.zone || data.budget || data.type;
  if (data.temperature === 'Caliente') candidateIndex = 2;
  else if (hasSomeInfo) candidateIndex = 1;

  const newIndex = Math.max(existingIndex === -1 ? 0 : existingIndex, candidateIndex);
  return STAGE_ORDER[newIndex];
}

async function upsertLead(phone, leadData) {
  try {
    await ensureTable();
    const existing = await pool.query('SELECT stage FROM leads WHERE phone = $1', [phone]);
    const currentStage = existing.rows[0]?.stage || 'NUEVO';
    const nextStage = computeAutoStage(currentStage, leadData);

    await pool.query(
      `INSERT INTO leads (phone, name, channel, operation, type, zone, bedrooms, budget, financing, timeline, temperature, property_id, agent_name, stage, last_message, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
       ON CONFLICT (phone) DO UPDATE SET
         name = COALESCE(NULLIF(EXCLUDED.name, ''), leads.name),
         channel = COALESCE(NULLIF(EXCLUDED.channel, ''), leads.channel),
         operation = COALESCE(NULLIF(EXCLUDED.operation, ''), leads.operation),
         type = COALESCE(NULLIF(EXCLUDED.type, ''), leads.type),
         zone = COALESCE(NULLIF(EXCLUDED.zone, ''), leads.zone),
         bedrooms = COALESCE(NULLIF(EXCLUDED.bedrooms, ''), leads.bedrooms),
         budget = COALESCE(NULLIF(EXCLUDED.budget, ''), leads.budget),
         financing = COALESCE(NULLIF(EXCLUDED.financing, ''), leads.financing),
         timeline = COALESCE(NULLIF(EXCLUDED.timeline, ''), leads.timeline),
         temperature = COALESCE(NULLIF(EXCLUDED.temperature, ''), leads.temperature),
         property_id = COALESCE(NULLIF(EXCLUDED.property_id, ''), leads.property_id),
         agent_name = COALESCE(NULLIF(EXCLUDED.agent_name, ''), leads.agent_name),
         stage = EXCLUDED.stage,
         last_message = COALESCE(NULLIF(EXCLUDED.last_message, ''), leads.last_message),
         updated_at = now()`,
      [
        phone,
        leadData.name || '', leadData.channel || '', leadData.operation || '',
        leadData.type || '', leadData.zone || '', String(leadData.bedrooms || ''),
        String(leadData.budget || ''), leadData.financing || '', leadData.timeline || '',
        leadData.temperature || '', leadData.property_id || '', leadData.agent_name || '',
        nextStage, leadData.last_message || '',
      ]
    );
    logger.info(`Lead upserted for ${phone} (stage: ${nextStage})`);
  } catch (err) {
    logger.error('Error syncing lead to database:', err.message);
  }
}

async function getAllLeads() {
  await ensureTable();
  const res = await pool.query('SELECT * FROM leads ORDER BY updated_at DESC');
  return res.rows;
}

async function getLeadByPhone(phone) {
  await ensureTable();
  const res = await pool.query('SELECT * FROM leads WHERE phone = $1', [phone]);
  return res.rows[0] || null;
}

async function updateStage(phone, stage) {
  await ensureTable();
  const res = await pool.query(
    'UPDATE leads SET stage = $1, updated_at = now() WHERE phone = $2 RETURNING phone',
    [stage, phone]
  );
  if (res.rowCount === 0) throw new Error('Lead not found');
}

// --- mode (AI/Human) persistence ---

async function setMode(phone, mode) {
  await ensureTable();
  // Upsert so setting mode works even before any lead data exists yet
  // (e.g. mode gets set on the very first message of a conversation).
  await pool.query(
    `INSERT INTO leads (phone, mode, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (phone) DO UPDATE SET mode = $2, updated_at = now()`,
    [phone, mode]
  );
}

async function getAllModes() {
  await ensureTable();
  const res = await pool.query('SELECT phone, mode FROM leads');
  return res.rows;
}

module.exports = { upsertLead, getAllLeads, getLeadByPhone, updateStage, setMode, getAllModes };
