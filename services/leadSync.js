const leadsDb = require('./leadsDb');

async function upsertLead(phone, leadData) {
  // Thin wrapper kept so messageHandler.js doesn't need to change — all the
  // actual storage logic now lives in leadsDb.js (Postgres, no more Google).
  await leadsDb.upsertLead(phone, leadData);
}

module.exports = { upsertLead };
