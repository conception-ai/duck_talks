/**
 * Standalone SDK test — verifies the claude-client wrapper works.
 * Run: npx tsx src/server/test-sdk.ts
 */

import { writeFileSync } from 'node:fs';
import { Claude, type ClaudeConfig } from './claude-client.js';

const OUT = '/tmp/sdk-test-result.txt';
const log: string[] = [];
function emit(s: string) { log.push(s); }

async function main() {
  const config: ClaudeConfig = {
    configDir: process.env['CLAUDE_CONFIG_DIR'] || '~/.claude',
    cliPath: process.env['CLAUDE_CLI_PATH'],
  };

  const claude = new Claude(config);
  const cwd = process.cwd();

  emit('--- SDK test: sending "Say hello in exactly 5 words" ---');
  emit(`cwd: ${cwd}`);

  let nText = 0;
  let nBlocks = 0;
  let fullText = '';

  try {
    for await (const chunk of claude.converse('Say hello in exactly 5 words', {
      model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a helpful assistant. Respond concisely.',
      cwd,
      permissionMode: 'plan',
    })) {
      switch (chunk.kind) {
        case 'text':
          nText++;
          fullText += chunk.text;
          break;
        case 'block':
          nBlocks++;
          emit(`[block] ${JSON.stringify(chunk.block).slice(0, 100)}`);
          break;
        case 'result':
          emit('--- Result ---');
          emit(`session_id: ${chunk.sessionId}`);
          emit(`cost: $${chunk.costUsd}`);
          emit(`duration: ${chunk.durationMs}ms`);
          emit(`error: ${chunk.error}`);
          break;
      }
    }

    emit(`\nFull text: "${fullText}"`);
    emit(`Summary: ${nText} text chunks, ${nBlocks} blocks`);
    emit(nText > 0 ? 'PASS' : 'FAIL: No text chunks received');
  } catch (e) {
    emit(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
    emit(`Stack: ${e instanceof Error ? e.stack : ''}`);
  }

  writeFileSync(OUT, log.join('\n') + '\n');
}

main().catch((e) => {
  writeFileSync(OUT, `FATAL: ${e instanceof Error ? e.message : String(e)}\n${e instanceof Error ? e.stack : ''}\n`);
  process.exit(1);
});
