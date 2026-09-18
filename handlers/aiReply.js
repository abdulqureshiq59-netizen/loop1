const openai = require('../config/openai');
const logger = require('../utils/logger');

const EXTRACTION_PROMPT = `Extract real estate lead info from this conversation. Reply with ONLY valid JSON, no other text, in exactly this shape:
{
  "name": string or null,
  "operation": "compra" | "alquiler" | "inversion" | "venta" | null,
  "type": string or null,
  "zone": string or null,
  "bedrooms": number or null,
  "budget": number or null,
  "financing": string or null,
  "timeline": string or null,
  "temperature": "Caliente" | "Tibio" | "Frio"
}
If operation is "venta" (the customer wants to sell their own property, not buy/rent/invest), still use the "budget" field for the expected sale price they mention, and "zone" for the property's location.
Temperature rules: "Caliente" if budget AND zone AND operation are all known. "Tibio" if at least one concrete detail is known. "Frio" if it's just a greeting with no real info.
Only fill fields you're confident about from what was actually said — never guess, use null instead.`;

async function extractLeadInfo(messages) {
  try {
    const transcript = messages.map(m => `${m.sender}: ${m.text}`).join('\n');
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: transcript },
      ],
      temperature: 0,
      max_tokens: 200,
      response_format: { type: 'json_object' },
    });
    return JSON.parse(response.choices[0].message.content);
  } catch (err) {
    logger.error('Error extracting lead info:', err.message);
    return null;
  }
}

module.exports = { extractLeadInfo };
