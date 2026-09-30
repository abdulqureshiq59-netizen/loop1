// services/propertyLookup.js
// Property AND project data from the NAI API (Sodio) — the client's own
// email listed two separate GET endpoints: /propiedades and /proyectos.
// Previously only /propiedades was fetched, so a "proyecto/NN" link from a
// customer never matched anything and fell through to the generic fallback.
const axios = require('axios');
const logger = require('../utils/logger');

const NAI_API_BASE = process.env.NAI_API_BASE || 'https://app.nai.com.uy/api';
const NAI_API_KEY = process.env.NAI_API_KEY;
const PAGE_LIMIT = 100;

// Separate timestamps (2026-09-30): both lists used to share one fetchedAt,
// so refreshing properties silently reset the projects' expiry too and the
// projects list could stay stale indefinitely.
let cache = { properties: null, projects: null, propertiesAt: 0, projectsAt: 0 };
const CACHE_MS = 5 * 60 * 1000;

// Field names below were verified against a real /propiedades response
// (property #511) on 2026-09-19 — the earlier guessed names (raw.precio,
// raw.baños/banos, raw.m2, raw.link, raw.agente) never matched anything,
// which is why price/bathrooms/area/link/agent always came back empty.
// NAI keeps sale and rental price as two entirely separate pairs of fields
// (precio_venta/moneda_venta vs precio_alquiler/moneda_alquiler) instead of
// one flat precio/moneda — a listing can have either or both set.
function pickPrice(raw) {
  const hasVenta = raw.en_venta === 'Si' && raw.precio_venta;
  const hasAlquiler = raw.en_alquiler === 'Si' && raw.precio_alquiler;
  if (hasVenta) return { price: raw.precio_venta, currency: raw.moneda_venta || '' };
  if (hasAlquiler) return { price: raw.precio_alquiler, currency: raw.moneda_alquiler || '' };
  // Fallback for any endpoint (e.g. proyectos) that might still use a flat
  // precio/moneda pair instead of the venta/alquiler split.
  if (raw.precio) return { price: raw.precio, currency: raw.moneda || '' };
  return { price: null, currency: '' };
}

// Same split as pickPrice: NAI sometimes leaves the flat `titulo` field empty
// (verified on property #57, which has "zona":"Pocitos" and a real title but
// "titulo":"") with the actual text living in titulo_venta/titulo_alquiler
// instead. Without this fallback, a matched property gets sent to the
// customer with a blank title (e.g. "1. — UYU 475,000 (link)").
function pickTitle(raw) {
  return raw.titulo_venta || raw.titulo_alquiler || raw.titulo || '';
}

function pickOperation(raw) {
  const venta = raw.en_venta === 'Si';
  const alquiler = raw.en_alquiler === 'Si';
  if (venta && alquiler) return 'Venta y Alquiler';
  if (venta) return 'Venta';
  if (alquiler) return 'Alquiler';
  return raw.operacion || '';
}

function formatPrice(price, currency) {
  if (!price) return null;
  const num = Number(price);
  const formatted = Number.isFinite(num) ? num.toLocaleString('es-UY') : price;
  return currency ? `${currency} ${formatted}` : String(formatted);
}

// Spec #4: "Una propiedad que deje de estar activa no debe continuar siendo
// ofrecida por la IA." NAI doesn't have one single "active" flag we've
// verified, so this checks every signal we've seen or that NAI commonly
// uses: a status text like Vendida/Alquilada/Reservada/Suspendida/Baja, an
// explicit publicada/activa = "No", or a listing that is rented AND no
// longer for sale. Anything we can't read is treated as active (better to
// show a listing than hide the whole catalog on an unknown field).
const INACTIVE_WORDS = ['vendid', 'alquilad', 'reservad', 'suspendid', 'inactiv', 'baja', 'retirad', 'pausad', 'no disponible'];

function isActive(raw) {
  const status = String(raw.estado || raw.status || '').toLowerCase();
  if (status && INACTIVE_WORDS.some(w => status.includes(w))) return false;
  if (raw.publicada === 'No' || raw.activa === 'No' || raw.activo === 'No' || raw.publicado === 'No') return false;
  if (raw.vendida === 'Si' || raw.reservada === 'Si') return false;
  // Rented out and not also on sale -> nothing left to offer.
  if (raw.alquilada === 'Si' && raw.en_venta !== 'Si') return false;
  // Neither on sale nor for rent -> not offerable (only when NAI actually
  // sends those fields; projects may not have them at all).
  if (raw.en_venta === 'No' && raw.en_alquiler === 'No') return false;
  return true;
}

function normalizeProperty(raw, isProject) {
  const { price, currency } = pickPrice(raw);
  return {
    prop_id: isProject ? raw.id_proyecto : raw.id_propiedad,
    title: pickTitle(raw),
    zone: raw.zona || raw.ciudad || raw.departamento || '',
    price: price || null,
    price_display: formatPrice(price, currency),
    currency,
    type: raw.tipo || '',
    bedrooms: raw.dormitorios ?? null,
    bathrooms: raw.banios ?? raw.baños ?? raw.banos ?? null,
    area_m2: raw.superficie_total || raw.m2 || null,
    features: raw.caracteristicas || '',
    description: raw.descripcion || '',
    link: raw.url || raw.link || '',
    reference: raw.referencia || String(raw.id_propiedad || raw.id_proyecto || ''),
    status: raw.estado || (raw.alquilada === 'Si' ? 'Alquilada' : ''),
    operation: pickOperation(raw),
    agent_name: (raw.vendedor && raw.vendedor.contact) || raw.agente || raw.responsable || '',
    is_project: !!isProject,
    is_active: isActive(raw),
    _raw: raw,
  };
}

async function fetchAll(endpoint, isProject) {
  if (!NAI_API_KEY) {
    logger.error('NAI_API_KEY is not set — cannot fetch from NAI API');
    return null;
  }
  let all = [];
  let offset = 0;
  let hasMore = true;
  try {
    while (hasMore) {
      const res = await axios.get(`${NAI_API_BASE}/${endpoint}`, {
        params: { key: NAI_API_KEY, limit: PAGE_LIMIT, offset },
      });
      const body = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      const items = body.items || [];
      all = all.concat(items.map(item => normalizeProperty(item, isProject)));
      const pag = body.pagination;
      if (!pag) break;
      hasMore = !!pag.has_more;
      offset += PAGE_LIMIT;
    }
    logger.info(`Fetched ${all.length} ${endpoint} from NAI API (${all.filter(p => p.is_active).length} active)`);
    return all;
  } catch (err) {
    logger.error(`Error fetching ${endpoint} from NAI API:`, err.response?.data || err.message);
    return null;
  }
}

async function getAllProperties() {
  const now = Date.now();
  if (cache.properties && (now - cache.propertiesAt) < CACHE_MS) return cache.properties;
  const fresh = await fetchAll('propiedades', false);
  if (fresh) {
    cache.properties = fresh;
    cache.propertiesAt = now;
    return fresh;
  }
  return cache.properties || [];
}

async function getAllProjects() {
  const now = Date.now();
  if (cache.projects && (now - cache.projectsAt) < CACHE_MS) return cache.projects;
  const fresh = await fetchAll('proyectos', true);
  if (fresh) {
    cache.projects = fresh;
    cache.projectsAt = now;
    return fresh;
  }
  return cache.projects || [];
}

// Recognizes both /propiedad/NN and /proyecto/NN links (and bare
// "propiedad #NN" / "proyecto #NN" mentions), returning which collection to
// search so the right NAI endpoint gets used.
function extractPropertyId(text) {
  const propMatch = text.match(/loopinmobiliaria\.uy\/propiedad\/(\d+)/i) || text.match(/propiedad\s*#?\s*(\d+)/i);
  if (propMatch) return propMatch[1];
  const projMatch = text.match(/loopinmobiliaria\.uy\/proyecto\/(\d+)/i) || text.match(/proyecto\s*#?\s*(\d+)/i);
  if (projMatch) return projMatch[1];
  return null;
}

function isProjectLink(text) {
  return /proyecto/i.test(text) && !/propiedad/i.test(text);
}

async function findPropertyById(id, text = '') {
  // Search whichever collection the link pointed at first, then fall back
  // to the other — covers a bare "#27" mention with no explicit word.
  const preferProject = isProjectLink(text);
  const [properties, projects] = await Promise.all([getAllProperties(), getAllProjects()]);
  const first = preferProject ? projects : properties;
  const second = preferProject ? properties : projects;
  return first.find(p => String(p.prop_id) === String(id))
      || second.find(p => String(p.prop_id) === String(id))
      || null;
}

// Unique list of responsible-agent names across the live catalog — used by
// logging / future use: the exact agent names to copy into
// AGENT_PHONES in services/aiConfig.js.
async function getAgentNames() {
  const [properties, projects] = await Promise.all([getAllProperties(), getAllProjects()]);
  const names = new Set();
  [...properties, ...projects].forEach(p => { if (p.agent_name) names.add(String(p.agent_name).trim()); });
  return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

module.exports = { getAllProperties, getAllProjects, extractPropertyId, findPropertyById, getAgentNames, isActive };
