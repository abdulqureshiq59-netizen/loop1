const state = {}; // { [phone]: { mode: 'ai'|'human', messages: [], property: null, lead: null } }

function getOrCreate(phone) {
  if (!state[phone]) state[phone] = { mode: 'ai', messages: [], property: null, lead: null };
  return state[phone];
}
function setLead(phone, lead) { getOrCreate(phone).lead = lead; }
function getLead(phone) { return getOrCreate(phone).lead; }
function addMessage(phone, sender, text) {
  const c = getOrCreate(phone);
  c.messages.push({ sender, text, timestamp: new Date().toISOString() });
  if (c.messages.length > 100) c.messages = c.messages.slice(-100);
}

function getMode(phone) { return getOrCreate(phone).mode; }
function setMode(phone, mode) {
  if (mode !== 'ai' && mode !== 'human') throw new Error('mode must be ai or human');
  getOrCreate(phone).mode = mode;
}

function setProperty(phone, property) { getOrCreate(phone).property = property; }
function getProperty(phone) { return getOrCreate(phone).property; }

function getAll() {
  return Object.entries(state).map(([phone, c]) => ({
    phone, mode: c.mode, lastMessage: c.messages[c.messages.length - 1] || null,
  }));
}
function getConversation(phone) { return getOrCreate(phone); }

// IMPORTANT: setLead/getLead were previously missing from this export list.
// messageHandler.js calls conversationState.setLead(...) after every message
// (to store the AI's lead-qualification result) — without this export, that
// call threw a TypeError that was NOT caught anywhere (it happens inside a
// .then() with no .catch()), which crashed the entire Node process on
// almost every incoming message. Render then auto-restarted the server,
// wiping all in-memory conversations/leads each time — this was the actual
// cause of the dashboard/pipeline looking broken and flaky.
module.exports = { addMessage, getMode, setMode, setProperty, getProperty, setLead, getLead, getAll, getConversation };
