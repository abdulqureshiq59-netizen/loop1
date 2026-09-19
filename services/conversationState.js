const messagesDb = require('./messagesDb');
const leadsDb = require('./leadsDb');
const logger = require('../utils/logger');

const state = {}; // { [phone]: { mode: 'ai'|'human', messages: [], property: null, lead: null } }

function getOrCreate(phone) {
  if (!state[phone]) state[phone] = { mode: 'ai', messages: [], property: null, lead: null, propertiesSuggested: false, visitScheduled: false, hotAlerted: false };
  return state[phone];
}
function setLead(phone, lead) { getOrCreate(phone).lead = lead; }
function getLead(phone) { return getOrCreate(phone).lead; }

// Tracks whether we've already sent this conversation a batch of matched
// property suggestions, so qualifyLeadInBackground (which re-runs on every
// message) doesn't spam the same suggestions repeatedly. In-memory only —
// same limitation as `property` below (a redeploy mid-conversation could
// send it once more), acceptable for this volume.
function getPropertiesSuggested(phone) { return getOrCreate(phone).propertiesSuggested; }
function setPropertiesSuggested(phone, value) { getOrCreate(phone).propertiesSuggested = value; }

// Same idea, for visit detection (visitExtractor.js): once we've moved a
// lead to VISITA and alerted the admin, don't keep re-detecting/re-alerting
// on every later message in the same conversation.
function getVisitScheduled(phone) { return getOrCreate(phone).visitScheduled; }
function setVisitScheduled(phone, value) { getOrCreate(phone).visitScheduled = value; }

// Same idea again, for the HOT-lead admin alert (2026-09-20). The DB `stage`
// column only ever moves forward (computeAutoStage takes a max()), so once a
// phone number has reached CALIENTE even once, it can never produce another
// oldStage!==newStage transition into CALIENTE again — meaning the client's
// requirement ("admin gets alerted whenever a lead comes in hot, regardless
// of buy/rent/sell") would silently stop firing for any phone number that
// re-engages after going cold, or that gets reused for a second, distinct
// inquiry. This flag decouples the alert from the frozen stage column: it
// fires once per conversation cycle and resets exactly when
// propertiesSuggested/visitScheduled do — when the chat is handed back to AI.
function getHotAlerted(phone) { return getOrCreate(phone).hotAlerted; }
function setHotAlerted(phone, value) { getOrCreate(phone).hotAlerted = value; }

function addMessage(phone, sender, text) {
  const c = getOrCreate(phone);
  c.messages.push({ sender, text, timestamp: new Date().toISOString() });
  if (c.messages.length > 100) c.messages = c.messages.slice(-100);

  // Persist to Postgres in the background — this is what makes conversation
  // history survive a restart/redeploy/crash instead of living only in RAM.
  // Fire-and-forget with its own .catch(): a DB hiccup here must never
  // break message handling (which already sent the reply by this point).
  messagesDb.addMessage(phone, sender, text).catch(err => {
    logger.error(`Failed to persist message for ${phone}:`, err.message);
  });
}

function getMode(phone) { return getOrCreate(phone).mode; }
function setMode(phone, mode) {
  if (mode !== 'ai' && mode !== 'human') throw new Error('mode must be ai or human');
  getOrCreate(phone).mode = mode;

  // Same reasoning as addMessage: persist so a restart mid-conversation
  // doesn't silently flip a human-controlled conversation back to AI.
  leadsDb.setMode(phone, mode).catch(err => {
    logger.error(`Failed to persist mode for ${phone}:`, err.message);
  });
}

function setProperty(phone, property) { getOrCreate(phone).property = property; }
function getProperty(phone) { return getOrCreate(phone).property; }

function getAll() {
  return Object.entries(state).map(([phone, c]) => ({
    phone, mode: c.mode, lastMessage: c.messages[c.messages.length - 1] || null,
  }));
}
function getConversation(phone) { return getOrCreate(phone); }

// On boot, restore mode ('ai'/'human') for every known phone from Postgres,
// so a redeploy doesn't lose track of conversations a human agent already
// took control of. Message history itself is read fresh from messagesDb by
// routes/dashboard.js (not cached here), so it survives restarts too.
(async function hydrateModesFromDb() {
  try {
    const rows = await leadsDb.getAllModes();
    rows.forEach(r => {
      if (r.mode === 'ai' || r.mode === 'human') {
        getOrCreate(r.phone).mode = r.mode;
      }
    });
    logger.info(`Restored mode for ${rows.length} conversation(s) from database`);
  } catch (err) {
    logger.error('Failed to restore conversation modes from database:', err.message);
  }
})();

module.exports = { addMessage, getMode, setMode, setProperty, getProperty, setLead, getLead, getAll, getConversation, getPropertiesSuggested, setPropertiesSuggested, getVisitScheduled, setVisitScheduled, getHotAlerted, setHotAlerted };
