// services/propertyLookup.js
// Property data now comes from the NAI API (Sodio) instead of scraping or
// Google Sheets — see api docs from Facundo (app.nai.com.uy).
const axios = require('axios');
const logger = require('../utils/logger');

const NAI_API_BASE = process.env.NAI_API_BASE || 'https://app.nai.com.uy/api';
const NAI_API_KEY = process.env.NAI_API_KEY;
const PAGE_LIMIT = 100; // NAI's stated max_limit per page

let cache = { data: null, fetchedAt: 0 };
const CACHE_MS = 5 * 60 * 1000; // 5 min — avoid hitting NAI on every message

// NOTE: only "id_propiedad" and "titulo" were confirmed in Facundo's example
// response. The other field names below (precio/zona/dormitorios/etc.) are
// my best guess based on section 4 of the spec ("precio, tipo, zona,
// dormitorios, baños, m², características, descripción, link, referencia y
// estado"). Log a real /propiedades response once you have the key working
// and adjust the keys on the left of each line below if they don't match.
function normalizeProperty(raw) {
  return {
    prop_id: raw.id_propiedad,
    title: raw.titulo,
    zone: raw.zona || '',
    price: raw.precio ?? null,
    type: raw.tipo || '',
    bedrooms: raw.dormitorios ?? null,
    bathrooms: raw.baños ?? raw.banos ?? null,
    area_m2: raw.m2 ?? null,
    features: raw.caracteristicas || '',
    description: raw.descripcion || '',
    link: raw.link || '',
    reference: raw.referencia || '',
    status: raw.estado || '',
    operation: raw.operacion || '',
    // NAI's docs don't mention an assigned-agent field — spec section 6 needs
    // "cada propiedad debe tener un agente/responsable asociado", so confirm
    // with the client whether that lives in this API or has to be mapped
    // separately (e.g. a lookup table you maintain).
    agent_name: raw.agente || raw.responsable || '',
    _raw: raw, // keep the untouched original in case other fields are needed later
  };
}

async function fetchAllProperties() {
  if (!NAI_API_KEY) {
    logger.error('NAI_API_KEY is not set — cannot fetch properties from NAI API');
    return null;
  }

  let all = [];
  let offset = 0;
  let hasMore = true;

  try {
    while (hasMore) {
      const res = await axios.get(`${NAI_API_BASE}/propiedades`, {
        params: { key: NAI_API_KEY, limit: PAGE_LIMIT, offset },
      });

      const body = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      const items = body.items || [];
      all = all.concat(items.map(normalizeProperty));

      const pag = body.pagination;
      if (!pag) break; // response without pagination info -> treat as single page
      hasMore = !!pag.has_more;
      offset += PAGE_LIMIT;
    }
    logger.info(`Fetched ${all.length} properties from NAI API`);
    return all;
  } catch (err) {
    logger.error('Error fetching properties from NAI API:', err.response?.data || err.message);
    return null;
  }
}

async function getAllProperties() {
  const now = Date.now();
  if (cache.data && (now - cache.fetchedAt) < CACHE_MS) return cache.data;

  const fresh = await fetchAllProperties();
  if (fresh) {
    cache = { data: fresh, fetchedAt: now };
    return fresh;
  }
  // NAI request failed — serve the last good cache rather than an empty list
  return cache.data || [];
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
