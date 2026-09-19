// services/visitExtractor.js
// Detects when a customer has confirmed an in-person/on-site property visit
// WITH a specific day/time, so the lead can move to the VISITA pipeline
// stage automatically and the admin can be alerted — instead of relying on
// an agent to notice and drag the card manually. Modeled on
// handoffDetector.js / leadExtractor.js's "read the whole conversation,
// return structured JSON" pattern.
const openai = require('../config/openai');
const logger = require('../utils/logger');

const VISIT_PROMPT = `You are analyzing a WhatsApp conversation between a real estate agency's AI assistant and a customer (the conversation may be in Spanish, English, or another language).

Decide if the customer has clearly confirmed they want an IN-PERSON / ON-SITE visit to a property, AND a specific day/time for that visit has already been mentioned (by the customer, or proposed by the assistant and accepted by the customer).

Reply with ONLY valid JSON in exactly this shape:
{"visitConfirmed": true|false, "visitWhen": string|null}

Rules:
- Set visitConfirmed:true ONLY if there is a real intent to visit in person AND a day/time — even an approximate one like "tomorrow morning", "this Saturday", "manana a las 3" — has actually been given.
- If the customer only said something like "I'd like to see it in person" but no day/time has come up yet, set visitConfirmed:false (wait for the next message).
- visitWhen should be a short natural-language phrase capturing that day/time as discussed (e.g. "tomorrow morning", "Saturday 3pm"), or null when visitConfirmed is false.
- Do not confuse a virtual tour, sending photos/video, or just asking about a property with an in-person visit.`;

async function extractVisitInfo(messages) {
  try {
    const conversationText = messages.map(m => `${m.sender}: ${m.text}`).join('\n');
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: VISIT_PROMPT },
        { role: 'user', content: conversationText },
      ],
      temperature: 0,
      max_tokens: 80,
      response_format: { type: 'json_object' },
    });
    return JSON.parse(response.choices[0].message.content);
  } catch (err) {
    logger.error('Error extracting visit info:', err.message);
    return { visitConfirmed: false, visitWhen: null };
  }
}

module.exports = { extractVisitInfo };
