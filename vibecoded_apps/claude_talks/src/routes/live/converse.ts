/**
 * SSE stream consumer for the Claude Code /api/converse endpoint.
 * Pure async I/O — no reactive state, no Gemini dependency.
 */

import type { ConverseApi } from './types';

const ORANGE = 'background:#d97706;color:white;font-weight:bold;padding:1px 6px;border-radius:3px';
const DIM = 'color:#9ca3af';

interface ConverseConfig {
  model: string;
  systemPrompt: string;
  permissionMode: string;
}

export function createConverseApi(
  endpoint = '/api/converse',
  getConfig?: () => ConverseConfig,
): ConverseApi {
  let sessionId: string | null = null;
  let controller: AbortController | null = null;

  return {
    get sessionId() { return sessionId; },
    set sessionId(id: string | null) { sessionId = id; },

    abort() { controller?.abort(); controller = null; },

    async stream(instruction, { onChunk, onBlock, onDone, onError }) {
      const t0 = performance.now();
      const ts = () => {
        const elapsed = (performance.now() - t0) / 1000;
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        return `${String(mins).padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`;
      };
      console.log(`%c CLAUDE %c ${ts()} starting: ${instruction.slice(0, 80)}`, ORANGE, DIM);
      controller = new AbortController();
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instruction,
            session_id: sessionId,
            ...getConfig && {
              model: getConfig().model,
              system_prompt: getConfig().systemPrompt,
              permission_mode: getConfig().permissionMode,
            },
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          console.error(`%c CLAUDE %c ${ts()} fetch failed: ${res.status}`, ORANGE, DIM);
          onError(`Claude Code request failed (${res.status}).`);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let nChunks = 0;
        let fullText = '';
        let ttft = 0;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          const parts = buf.split('\n\n');
          buf = parts.pop()!;

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data: ')) continue;
            const data = JSON.parse(line.slice(6));
            if (data.text) {
              nChunks++;
              fullText += data.text;
              if (nChunks === 1) {
                ttft = Math.round(performance.now() - t0);
                console.log(`%c CLAUDE %c ${ts()} TTFT: ${ttft}ms`, ORANGE, DIM);
              }
              onChunk(data.text);
            }
            if (data.block) {
              onBlock?.(data.block);
            }
            if (data.done) {
              if (data.session_id) sessionId = data.session_id;
              console.log(
                `%c CLAUDE %c ${ts()} done: ${nChunks} chunks, cost=$${data.cost_usd}`,
                ORANGE, DIM,
              );
              if (data.error) {
                onError(`Claude Code error: ${data.error}`);
              } else {
                onDone?.(data.cost_usd, data.duration_ms);
              }
            }
          }
        }
      } catch (e) {
        console.error(`%c CLAUDE %c ${ts()} error`, ORANGE, DIM, e);
        onError('Claude Code request failed.');
      } finally {
        controller = null;
      }
    },
  };
}
