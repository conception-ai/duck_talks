/**
 * SSE stream consumer for the Claude Code /api/converse endpoint.
 * Pure async I/O — no reactive state, no Gemini dependency.
 */

import type { ConverseApi } from './types';

export function createConverseApi(endpoint = '/api/converse'): ConverseApi {
  return {
    async stream(instruction, { onChunk, onDone, onError }) {
      console.log('[converse] starting:', instruction.slice(0, 120));
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instruction }),
        });
        if (!res.ok || !res.body) {
          console.error('[converse] fetch failed:', res.status);
          onError(`Claude Code request failed (${res.status}).`);
          return;
        }
        console.log('[converse] SSE stream opened');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let nChunks = 0;

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
              console.log(`[converse] chunk ${nChunks}:`, data.text.slice(0, 80));
              onChunk(data.text);
            }
            if (data.done) {
              console.log(
                `[converse] done: ${nChunks} chunks, cost=$${data.cost_usd}, ${data.duration_ms}ms`,
              );
              onDone?.(data.cost_usd, data.duration_ms);
            }
          }
        }
        console.log('[converse] stream closed');
      } catch (e) {
        console.error('[converse] SSE error:', e);
        onError('Claude Code request failed.');
      }
    },
  };
}
