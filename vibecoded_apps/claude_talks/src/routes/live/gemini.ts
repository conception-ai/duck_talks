/**
 * Gemini Live API connection and message handling.
 * Plain .ts — no runes, no reactive state.
 * Receives DataStoreMethods via dependency injection.
 *
 * ## Message flow
 *
 * Gemini Live is a bidirectional WebSocket. We send mic audio via
 * `sendRealtimeInput` and receive two kinds of messages:
 *
 * 1. **serverContent** — STT transcriptions, turn boundaries
 * 2. **toolCall** — Gemini wants to invoke a declared function
 *
 * ## The converse tool (BLOCKING)
 *
 * The `converse` tool is declared as BLOCKING so Gemini is frozen by the
 * API while Claude streams. The tool response is sent immediately as
 * `{ result: "done" }` to unfreeze Gemini. A persistent TTS session
 * (one per voice session) handles audio output — no relay through the
 * main session.
 */

import {
  GoogleGenAI,
  Modality,
  type LiveSendToolResponseParameters,
  type Session,
  type LiveServerMessage,
} from '@google/genai';
import { TOOLS, handleToolCall } from './tools';
import { openTTSSession } from './tts-session';
import { startVoiceApproval } from './voice-approval';
import type { ConverseApi, DataStoreMethods, InteractionMode, LiveBackend } from './types';

// --- Log styles ---
const BLUE_BADGE = 'background:#2563eb;color:white;font-weight:bold;padding:1px 6px;border-radius:3px';
const DIM = 'color:#9ca3af';

const BASE_PROMPT = `
You are a voice relay between a user and Claude Code (a powerful coding agent).

<RULES>
1. When the user asks a question or gives an instruction, ALWAYS call the converse tool, and NEVER answer yourself.
2. Do not speak or add commentary. Just call the converse tool.
3. When user says "STOP" you just stop and not answer anything.
</RULES>

You are a transparent bridge. The user is talking TO Claude Code THROUGH you.
`;

const MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

interface ConnectDeps {
  data: DataStoreMethods;
  converseApi: ConverseApi;
  tag: string;
  apiKey: string;
  getMode: () => InteractionMode;
  readbackInstruction: (text: string) => () => void;
}

/**
 * Connect to Gemini Live and return a LiveBackend handle.
 * Returns null on failure (error is pushed to data store).
 */
export async function connectGemini(deps: ConnectDeps): Promise<LiveBackend | null> {
  const { data, converseApi, apiKey } = deps;

  const ai = new GoogleGenAI({ apiKey });
  data.setStatus('connecting');

  // Mutable ref — handleMessage closes over this, assigned after connect().
  let sessionRef: Session | null = null;
  let closed = false; // hoisted so onclose callback can reach it
  let approvalPending = false; // true during BLOCKING approval hold — gates sendRealtimeInput
  let activeConverse: { abort: () => void } | null = null; // Claude SSE abort handle
  const tts = openTTSSession(apiKey); // Persistent TTS — one WebSocket per voice session
  let userSpokeInTurn = false;
  const t0 = Date.now();
  const ts = () => {
    const elapsed = (Date.now() - t0) / 1000;
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    return `${String(mins).padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`;
  };

  async function handleMessage(message: LiveServerMessage) {
    // --- Tool calls ---
    if (message.toolCall?.functionCalls) {
      userSpokeInTurn = false; // Tool was called, don't nudge
      const mode = deps.getMode();
      data.commitTurn();
      for (const fc of message.toolCall.functionCalls) {
        console.log(`%c GEMINI %c ${ts()} tool: ${fc.name}`, BLUE_BADGE, DIM, fc.args);

        data.startTool(fc.name!, fc.args ?? {});

        if (fc.name === 'converse') {
          const instruction = String(
            (fc.args as Record<string, unknown>)?.instruction ?? '',
          );

          // Shared rejection handler — unfreezes Gemini without executing
          const rejectAndUnfreeze = () => {
            sessionRef?.sendToolResponse({
              functionResponses: [{
                id: fc.id, name: 'converse',
                response: { status: 'rejected' },
              }],
            });
          };

          // Streams Claude's response via SSE. Inner Gemini TTS handles audio.
          // Both lifecycles are bundled into activeConverse so any user speech
          // can tear down both at once via abort().
          const executeConverse = (approvedInstruction: string) => {
            activeConverse?.abort(); // safety: close any previous
            data.commitUserMessage(approvedInstruction);

            // Unfreeze Outer Gemini immediately — Inner Gemini handles audio separately
            sessionRef?.sendToolResponse({
              functionResponses: [{ id: fc.id, name: 'converse', response: { result: 'done' } }],
            });

            let aborted = false;
            let claudeDone = false;

            const abort = () => {
              if (aborted) return;
              aborted = true;
              converseApi.abort();
              tts.interrupt();
              if (!claudeDone) data.finishTool();
              activeConverse = null;
            };
            activeConverse = { abort };

            converseApi.stream(approvedInstruction, {
              onChunk(text) {
                if (aborted) return;
                data.appendTool(text);
                tts.send(text);
              },
              onBlock(block) {
                if (aborted) return;
                data.appendBlock(block);
              },
              onDone() {
                if (aborted) return;
                claudeDone = true;
                tts.finish();
                data.finishTool();
                // activeConverse stays alive — Inner Gemini may still be draining audio
              },
              onError(msg) {
                if (aborted) return;
                abort();
                data.pushError(msg);
              },
            });
          };

          // Hold for approval with voice + UI. Starts voice listener,
          // gates mic audio away from frozen Gemini, cleans up on resolve.
          const holdWithVoice = (
            approvalPayload: Parameters<typeof data.holdForApproval>[0],
            stopReadback: () => void,
          ) => {
            approvalPending = true;
            let resolved = false;
            let stopVoice: (() => void) | null = null;

            const onAccept = (approved: string) => {
              if (resolved) return;
              resolved = true;
              stopVoice?.();
              stopReadback();
              approvalPending = false;
              executeConverse(approved);
            };
            const onCancel = () => {
              if (resolved) return;
              resolved = true;
              stopVoice?.();
              stopReadback();
              approvalPending = false;
              rejectAndUnfreeze();
            };

            // Voice triggers same store methods the UI buttons use.
            stopVoice = startVoiceApproval(
              () => data.approve(),
              () => data.reject(),
            );

            data.holdForApproval(approvalPayload, onAccept, onCancel);
          };

          if (mode === 'direct') {
            executeConverse(instruction);
          } else {
            console.log(`${ts()} review mode: holding for approval`);
            const stopReadback = deps.readbackInstruction(instruction);
            holdWithVoice({ instruction }, stopReadback);
          }
          continue;
        }

        const result = await handleToolCall(fc.name!, fc.args ?? {});
        console.log(`${ts()} tool result:`, result);
        data.appendTool(JSON.stringify(result));
        data.finishTool();
        sessionRef?.sendToolResponse({
          functionResponses: [{ id: fc.id, name: fc.name, response: result }],
        });
      }
      return;
    }

    // --- Server content (STT, turn boundaries) ---
    const sc = message.serverContent;
    if (!sc) return;

    if (sc.interrupted) {
      console.log(`%c GEMINI %c ${ts()} interrupted (sc.interrupted)${activeConverse ? ' — aborting active converse' : ''}`, BLUE_BADGE, DIM);
      userSpokeInTurn = false;
      activeConverse?.abort();
      data.commitTurn();
      return;
    }

    // User speech — always pass through, and abort any active converse
    if (sc.inputTranscription?.text) {
      if (activeConverse) {
        console.log(`%c GEMINI %c ${ts()} user speech interrupted active converse (inputTranscription): "${sc.inputTranscription.text}"`, BLUE_BADGE, DIM);
      } else {
        console.log(`${ts()} [user] ${sc.inputTranscription.text}`);
      }
      activeConverse?.abort();
      data.appendInput(sc.inputTranscription.text);
      userSpokeInTurn = true;
    }

    // Main session audio output is ignored (TTS session handles audio)

    if (sc.turnComplete) {
      console.log(`%c GEMINI %c ${ts()} done`, BLUE_BADGE, DIM);
      data.commitTurn();

      // Nudge: Gemini completed without calling converse after user spoke
      if (userSpokeInTurn) {
        console.log(`${ts()} [nudge] no tool call after user speech`);
        sessionRef?.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: 'You did not call the converse tool. Please call it now.' }] }],
          turnComplete: true,
        });
      }
      userSpokeInTurn = false;
    }
  }

  try {
    const session = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        tools: TOOLS,
        systemInstruction: BASE_PROMPT,
        inputAudioTranscription: {},
      },
      callbacks: {
        onopen: () => {
          console.log(`${ts()} connected`);
          data.setStatus('connected');
        },
        onmessage: (msg: LiveServerMessage) => handleMessage(msg),
        onerror: (e: ErrorEvent) => {
          console.error(`${ts()} error:`, e);
          data.pushError(`Error: ${e.message}`);
        },
        onclose: (e: CloseEvent) => {
          const wasExpected = closed; // user-initiated stop() already set this
          closed = true;
          sessionRef = null;
          activeConverse?.abort();
          tts.close();
          console.log(`${ts()} closed: ${e.reason}`);
          data.setStatus('idle');
          if (!wasExpected && e.reason) {
            data.pushError(`Gemini disconnected: ${e.reason}`);
          }
        },
      },
    });
    sessionRef = session;
    converseApi.sessionStart = t0;
    console.log(
      `%c SYSTEM %c\n${BASE_PROMPT.trim()}`,
      'background:#6b7280;color:white;font-weight:bold;padding:1px 6px;border-radius:3px',
      'color:#9ca3af;white-space:pre-wrap',
    );

    return {
      sendRealtimeInput: (input) => { if (!closed && !approvalPending) session.sendRealtimeInput(input); },
      sendClientContent: (content) => { if (!closed) session.sendClientContent(content); },
      sendToolResponse: (response) => { if (!closed) session.sendToolResponse(response as LiveSendToolResponseParameters); },
      close: () => { activeConverse?.abort(); tts.close(); closed = true; sessionRef = null; session.close(); },
    };
  } catch (e: unknown) {
    console.error(`${ts()} connect failed:`, e);
    data.pushError(
      `Failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    data.setStatus('idle');
    return null;
  }
}
