// services/leadsDb.js
// Leads storage using Render's PostgreSQL instead of Google Sheets — avoids
// both the Apps Script anti-bot challenge (Google blocking Render's server
// IP) and the service-account-key organization policy block. This talks
// directly to Postgres, no Google involved at all.
const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Render's internal Postgres needs this
});

const STAGE_ORDER = ["NUEVO", "CALIFICANDO", "CALIENTE", "CONTACTADO", "VISITA", "NEGOCIACION", "CERRADO"];
const HUMAN_MANAGED_FROM_INDEX = 3; // CONTACTADO onward — auto-stage stops touching it

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
        last_message TEXT DEFAULT '',
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);
  }
  return initPromise;
}

function computeAutoStage(existingStage, data) {
  const existingIndex = STAGE_ORDER.indexOf(existingStage);
  if (existingIndex >= HUMAN_MANAGED_FROM_INDEX) return existingStage || 'NUEVO';

  let candidateIndex = 0; // NUEVO
  const hasSomeInfo = data.operation || data.zone || data.budget || data.type;
  if (data.temperature === 'Caliente') candidateIndex = 2; // CALIENTE
  else if (hasSomeInfo) candidateIndex = 1; // CALIFICANDO

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

async function updateStage(phone, stage) {
  await ensureTable();
  const res = await pool.query(
    'UPDATE leads SET stage = $1, updated_at = now() WHERE phone = $2 RETURNING phone',
    [stage, phone]
  );
  if (res.rowCount === 0) throw new Error('Lead not found');
}

module.exports = { upsertLead, getAllLeads, updateStage };
