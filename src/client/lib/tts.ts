/**
 * TTS utility for test automation (Chrome MCP).
 * Text → Gemini TTS → base64 PCM at 24kHz.
 *
 * Not imported by production code. Dynamically imported via:
 *   const { speak } = await import('/src/lib/tts.ts');
 */

import { GoogleGenAI } from '@google/genai';

export interface TTSOptions {
  voice?: string;   // default: 'Kore'
  model?: string;   // default: 'gemini-2.5-flash-preview-tts'
}

export async function speak(
  apiKey: string,
  text: string,
  options?: TTSOptions,
): Promise<{ data: string; sampleRate: number }> {
  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.generateContent({
    model: options?.model ?? 'gemini-2.5-flash-preview-tts',
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: options?.voice ?? 'Kore' },
        },
      },
    },
  });
  const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!data) throw new Error('TTS: no audio in response');
  return { data, sampleRate: 24000 };
}
