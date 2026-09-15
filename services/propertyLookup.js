const axios = require('axios');
const logger = require('../utils/logger');

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

let cache = { data: null, fetchedAt: 0 };
const CACHE_MS = 5 * 60 * 1000; // 5 min — avoids hitting Apps Script on every message

async function getAllProperties() {
  const now = Date.now();
  if (cache.data && (now - cache.fetchedAt) < CACHE_MS) return cache.data;
  try {
    const res = await axios.get(`${APPS_SCRIPT_URL}?action=getProperties`);
    const result = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    if (result.success) {
      cache = { data: result.data, fetchedAt: now };
      return result.data;
    }
    return cache.data || [];
  } catch (err) {
    logger.error('Error fetching properties:', err.message);
    return cache.data || [];
  }
}

function extractPropertyId(text) {
  const m = text.match(/loopinmobiliaria\.uy\/propiedad\/(\d+)/i) || text.match(/propiedad\s*#?\s*(\d+)/i);
  return m ? m[1] : null;
}

async function findPropertyById(id) {
  const all = await getAllProperties();
  return all.find(p => String(p.prop_id) === String(id)) || null;
}

module.exports = { getAllProperties, extractPropertyId, findPropertyById };
