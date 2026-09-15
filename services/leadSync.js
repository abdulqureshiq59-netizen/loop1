const axios = require('axios');
const logger = require('../utils/logger');

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

async function upsertLead(phone, leadData) {
  try {
    await axios.post(`${APPS_SCRIPT_URL}?action=upsertLead`, { phone, ...leadData });
  } catch (err) {
    logger.error('Error syncing lead to sheet:', err.message);
  }
}

module.exports = { upsertLead };
