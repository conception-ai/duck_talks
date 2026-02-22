/**
 * Ephemeral Gemini Live session that acts as a streaming TTS pipe.
 * Fully self-contained: owns its own Gemini connection, sentence buffer,
 * and audio player.
 *
 * One instance per `converse` call. Opened when Claude starts streaming,
 * closed on done/error/interrupt.
 *
 * Each sentence-buffer flush is sent directly to Gemini.
 */

import {
  GoogleGenAI,
  Modality,
  type Session,
} from '@google/genai';
import { createSentenceBuffer } from './buffer';
import { createPlayer } from './audio';
import type { StreamingTTS } from './types';

const TTS_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
const TTS_PROMPT = 'Read aloud exactly what is sent to you. Do not add any commentary.';

// Log styles
const GREEN_BADGE = 'background:#059669;color:white;font-weight:bold;padding:1px 6px;border-radius:3px';
const DIM = 'color:#9ca3af';

export function openTTSSession(apiKey: string): StreamingTTS {
  const player = createPlayer();
  let session: Session | null = null;
  let closed = false;
  let finishing = false;
  let speaking = false;
  let firstSendT0 = 0;
  let ttftLogged = false;
  const preConnectQueue: string[] = [];

  function sendText(text: string) {
    if (!session || closed) return;
    if (!firstSendT0) firstSendT0 = performance.now();
    speaking = true;
    console.log(`%c TTS %c ← ${text}`, GREEN_BADGE, DIM);
    session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text }] }],
      turnComplete: true,
    });
  }

  const sentenceBuf = createSentenceBuffer(sendText);

  // Connect async — buffer text until ready
  const ai = new GoogleGenAI({ apiKey });
  ai.live.connect({
    model: TTS_MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: TTS_PROMPT,
      outputAudioTranscription: {},
    },
    callbacks: {
      onopen: () => {
        console.log(`%c TTS %c connected`, GREEN_BADGE, DIM);
      },
      onmessage: (msg) => {
        if (msg.serverContent?.modelTurn?.parts) {
          for (const p of msg.serverContent.modelTurn.parts) {
            if (p.inlineData?.data && !closed) {
              if (!ttftLogged && firstSendT0) {
                ttftLogged = true;
                console.log(`%c TTS %c TTFT: ${Math.round(performance.now() - firstSendT0)}ms`, GREEN_BADGE, DIM);
              }
              player.play(p.inlineData.data);
            }
          }
        }
        if (msg.serverContent?.outputTranscription?.text) {
          console.log(`%c TTS %c → ${msg.serverContent.outputTranscription.text}`, GREEN_BADGE, DIM);
        }
        if (msg.serverContent?.turnComplete) {
          speaking = false;
          if (finishing) {
            console.log(`%c TTS %c done — closing`, GREEN_BADGE, DIM);
            session?.close();
            player.stop();
          }
        }
      },
      onerror: (e) => {
        console.error(`%c TTS %c error`, GREEN_BADGE, DIM, e);
      },
      onclose: () => {
        console.log(`%c TTS %c closed`, GREEN_BADGE, DIM);
      },
    },
  }).then((s) => {
    if (closed) { s.close(); return; }
    session = s;
    for (const text of preConnectQueue) sentenceBuf.push(text);
    preConnectQueue.length = 0;
  });

  return {
    send(text: string) {
      if (closed) return;
      if (!session) {
        preConnectQueue.push(text);
      } else {
        sentenceBuf.push(text);
      }
    },
    finish() {
      if (closed) return;
      sentenceBuf.flush();
      finishing = true;
      if (!speaking) {
        console.log(`%c TTS %c finish (not speaking) — closing`, GREEN_BADGE, DIM);
        closed = true;
        session?.close();
        player.stop();
      }
    },
    close() {
      closed = true;
      finishing = false;
      sentenceBuf.clear();
      player.flush();
      player.stop();
      session?.close();
    },
  };
}
