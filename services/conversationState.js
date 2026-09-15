// In-memory store of AI/human mode + message history per customer phone.
const state = {}; // { [phone]: { mode: 'ai'|'human', messages: [] } }

function getOrCreate(phone) {
  if (!state[phone]) state[phone] = { mode: 'ai', messages: [] };
  return state[phone];
}

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

function getAll() {
  return Object.entries(state).map(([phone, c]) => ({
    phone, mode: c.mode, lastMessage: c.messages[c.messages.length - 1] || null,
  }));
}

function getConversation(phone) { return getOrCreate(phone); }

module.exports = { addMessage, getMode, setMode, getAll, getConversation };
