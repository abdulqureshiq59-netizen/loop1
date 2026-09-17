// services/handoffDetector.js
// Spec requirement #8/#11: detect when a conversation should be handed off
// to a human agent automatically — requests to speak with a person,
// complaints, price negotiation, or high buying intent (ready to close
// now) — instead of relying only on a human manually clicking "TAKE
// CONTROL" on the dashboard.
const openai = require('../config/openai');
const logger = require('../utils/logger');

const HANDOFF_PROMPT = `You are a classifier for a real estate WhatsApp bot (Loop Inmobiliaria, Uruguay). Given the customer's latest message (it may be in Spanish, English, or another language), decide if this conversation should be handed off to a human agent right now.

Reply with ONLY valid JSON: {"handoff": true|false, "reason": string|null}

Set handoff:true if the message:
- explicitly asks to talk to a person/human/agent
- is a complaint or expresses frustration/anger
- involves negotiating price, asking for a discount, or making an offer
- shows high buying intent — ready to close, sign, pay, or visit right now/today

Otherwise handoff:false, reason:null. Do not flag ordinary questions about zone, budget, property type, or availability — those are normal for the AI to keep handling.`;

async function checkHandoff(text) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: HANDOFF_PROMPT },
        { role: 'user', content: text },
      ],
      temperature: 0,
      max_tokens: 60,
      response_format: { type: 'json_object' },
    });
    return JSON.parse(response.choices[0].message.content);
  } catch (err) {
    logger.error('Error checking handoff:', err.message);
    // Fail safe: if the classifier itself errors, don't block the normal
    // AI reply flow — just don't hand off automatically for this message.
    return { handoff: false, reason: null };
  }
}

module.exports = { checkHandoff };
