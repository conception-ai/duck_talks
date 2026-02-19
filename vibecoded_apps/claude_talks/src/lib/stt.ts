/**
 * Speech-to-text via Gemini audio understanding.
 * Accepts base64 PCM chunks (same shape as RecordedChunk.data).
 *
 * Usage:
 *   const stt = createSTT({ apiKey });
 *   const text = await stt(recording.chunks, recording.sampleRate);
 */

import { GoogleGenAI } from '@google/genai';

const DEFAULT_MODEL = 'gemini-2.5-flash';

const clients = new Map<string, GoogleGenAI>();

function getClient(apiKey: string): GoogleGenAI {
  let client = clients.get(apiKey);
  if (!client) {
    client = new GoogleGenAI({ apiKey });
    clients.set(apiKey, client);
  }
  return client;
}

/** Combine sequential base64 PCM chunks into a single base64 string. */
export function combineChunks(chunks: { data: string }[]): string {
  const parts: Uint8Array[] = [];
  for (const chunk of chunks) {
    const raw = atob(chunk.data);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    parts.push(bytes);
  }
  const totalLen = parts.reduce((sum, b) => sum + b.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) { combined.set(part, offset); offset += part.length; }
  return btoa(String.fromCharCode(...combined));
}

export interface STT {
  (chunks: { data: string }[], sampleRate?: number): Promise<string>;
}

export interface STTConfig {
  apiKey: string;
  model?: string;
}

export function createSTT(cfg: STTConfig): STT {
  const client = getClient(cfg.apiKey);
  const model = cfg.model ?? DEFAULT_MODEL;

  return async (chunks, sampleRate = 16000) => {
    const combined = combineChunks(chunks);
    const response = await client.models.generateContent({
      model,
      contents: [{
        role: 'user',
        parts: [
          { text: 'Transcribe this audio exactly as spoken. Return only the transcription, no commentary.' },
          { inlineData: { data: combined, mimeType: `audio/pcm;rate=${sampleRate}` } },
        ],
      }],
    });
    return response.text ?? '';
  };
}
