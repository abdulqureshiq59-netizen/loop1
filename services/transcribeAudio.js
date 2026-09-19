// services/transcribeAudio.js
// Turns an incoming WhatsApp voice note into text using OpenAI's Whisper
// model, so it can be fed through the exact same flow as a normal text
// message (qualification, property matching, handoff detection, etc.)
// instead of the bot just saying "got your message" without understanding
// it, which was the previous behavior for every non-text message type.
const { toFile } = require('openai');
const openai = require('../config/openai');
const { downloadMedia } = require('../utils/whatsappAPI');
const logger = require('../utils/logger');

// mime_type from WhatsApp is usually "audio/ogg; codecs=opus" — Whisper
// only cares about the file extension to guess format, so this just picks
// a reasonable one; ogg covers WhatsApp's actual voice-note format.
function guessExtension(mimeType) {
  if (!mimeType) return 'ogg';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  return 'ogg';
}

async function transcribeAudio(mediaId) {
  if (!mediaId) return null;
  try {
    const { buffer, mimeType } = await downloadMedia(mediaId);
    const ext = guessExtension(mimeType);
    const file = await toFile(buffer, `voice-note.${ext}`);

    const response = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
    });

    const text = (response.text || '').trim();
    return text || null;
  } catch (err) {
    logger.error('Error transcribing voice note:', err.response?.data || err.message);
    return null;
  }
}

module.exports = { transcribeAudio };
