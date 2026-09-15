// services/leadService.js
// Manage leads - save, read, update from Google Sheets

const { GoogleSpreadsheet } = require('google-spreadsheet');
const logger = require('../utils/logger');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');

let doc = null;
let sheetsInitialized = false;

async function initializeSheets() {
  if (sheetsInitialized) return;

  try {
    doc = new GoogleSpreadsheet(SPREADSHEET_ID);
    await doc.useServiceAccountAuth(GOOGLE_SERVICE_ACCOUNT);
    await doc.loadInfo();
    sheetsInitialized = true;
    logger.info('Google Sheets initialized');
  } catch (err) {
    logger.error('Error initializing Google Sheets:', err);
  }
}

async function getLeadsSheet() {
  await initializeSheets();
  return doc.sheetsByTitle['Leads'] || doc.sheetsByIndex[1];
}

async function getLeads() {
  try {
    const sheet = await getLeadsSheet();
    const rows = await sheet.getRows();
    return rows.map(row => ({
      lead_id: row.lead_id,
      customer_name: row.customer_name,
      phone: row.phone,
      channel: row.channel,
      type: row.type,
      zone: row.zone,
      budget: row.budget,
      bedrooms: row.bedrooms,
      status: row.status,
      assigned_agent: row.assigned_agent,
      created_at: row.created_at,
      last_message: row.last_message,
    }));
  } catch (err) {
    logger.error('Error getting leads:', err);
    return [];
  }
}

async function createLead(leadData) {
  try {
    const sheet = await getLeadsSheet();
    const newRow = await sheet.addRow({
      lead_id: `LEAD_${Date.now()}`,
      customer_name: leadData.customer_name || 'Unknown',
      phone: leadData.phone || '',
      channel: leadData.channel || 'WhatsApp',
      type: leadData.type || '',
      zone: leadData.zone || '',
      budget: leadData.budget || '',
      bedrooms: leadData.bedrooms || '',
      status: 'Nuevo',
      assigned_agent: leadData.assigned_agent || 'Unassigned',
      created_at: new Date().toISOString(),
      last_message: leadData.last_message || '',
    });
    logger.info(`Lead created: ${newRow.lead_id}`);
    return newRow;
  } catch (err) {
    logger.error('Error creating lead:', err);
    return null;
  }
}

async function updateLead(phone, updates) {
  try {
    const sheet = await getLeadsSheet();
    const rows = await sheet.getRows();
    const row = rows.find(r => r.phone === phone);
    
    if (row) {
      Object.keys(updates).forEach(key => {
        if (row[key] !== undefined) {
          row[key] = updates[key];
        }
      });
      await row.save();
      logger.info(`Lead updated: ${phone}`);
      return row;
    }
  } catch (err) {
    logger.error('Error updating lead:', err);
  }
  return null;
}

async function getLeadByPhone(phone) {
  try {
    const sheet = await getLeadsSheet();
    const rows = await sheet.getRows();
    return rows.find(r => r.phone === phone);
  } catch (err) {
    logger.error('Error getting lead by phone:', err);
    return null;
  }
}

module.exports = {
  getLeads,
  createLead,
  updateLead,
  getLeadByPhone,
};
