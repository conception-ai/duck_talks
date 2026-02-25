/**
 * Streaming interface to Claude Code via the TS Agent SDK.
 * Port of Python claude_client.py.
 */

import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  Options,
  PermissionMode,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { pathToSlug } from '../shared/models.js';

// Prevent nested session error when running inside Claude Code
delete process.env['CLAUDECODE'];

// --- Config ---

export interface ClaudeConfig {
  configDir: string;     // e.g. "~/.claude"
  cliPath?: string;      // None = `claude` on PATH
}

export function subprocessEnv(config: ClaudeConfig): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== 'CLAUDECODE' && v !== undefined) {
      env[k] = v;
    }
  }
  const expanded = config.configDir.replace(/^~/, process.env['HOME'] || '');
  if (config.configDir !== '~/.claude') {
    env['CLAUDE_CONFIG_DIR'] = expanded;
  }
  return env;
}

export function projectDir(config: ClaudeConfig, cwd: string): string {
  const expanded = config.configDir.replace(/^~/, process.env['HOME'] || '');
  return join(expanded, 'projects', pathToSlug(cwd));
}

// --- Chunk types ---

export interface TextDelta {
  kind: 'text';
  text: string;
}

export interface ContentBlockChunk {
  kind: 'block';
  block: Record<string, unknown>;
}

export interface Result {
  kind: 'result';
  sessionId: string;
  costUsd: number | null;
  durationMs: number;
  error: string | null;
}

export type Chunk = TextDelta | ContentBlockChunk | Result;

// --- Client ---

export class Claude {
  private readonly config: ClaudeConfig;

  constructor(config: ClaudeConfig) {
    this.config = config;
  }

  async *converse(
    message: string,
    opts: {
      model: string;
      systemPrompt: string;
      cwd: string;
      sessionId?: string;
      permissionMode?: PermissionMode;
      fork?: boolean;
    },
  ): AsyncGenerator<Chunk> {
    const options: Options = {
      model: opts.model,
      cwd: opts.cwd,
      systemPrompt: opts.systemPrompt,
      includePartialMessages: true,
      permissionMode: opts.permissionMode ?? 'plan',
      allowedTools: ['Read', 'WebSearch'],
      disallowedTools: ['AskUserQuestion', 'Skill'],
      env: subprocessEnv(this.config),
      stderr: (line: string) => console.debug('sdk:', line.trimEnd()),
    };

    if (this.config.cliPath) {
      options.pathToClaudeCodeExecutable = this.config.cliPath.replace(
        /^~/,
        process.env['HOME'] || '',
      );
    }

    if (opts.sessionId) {
      options.resume = opts.sessionId;
      options.forkSession = opts.fork ?? false;
      console.info(`resuming session ${opts.sessionId} (fork=${opts.fork ?? false})`);
    }

    console.info(`query: ${message.slice(0, 120)}`);
    const stream = query({ prompt: message, options });

    for await (const msg of stream as AsyncIterable<SDKMessage>) {
      if (msg.type === 'stream_event') {
        const partial = msg as SDKPartialAssistantMessage;
        const event = partial.event as unknown as Record<string, unknown>;
        const delta = event['delta'] as Record<string, unknown> | undefined;
        if (delta) {
          const text = delta['text'];
          if (typeof text === 'string' && text) {
            yield { kind: 'text', text };
          }
        }
      } else if (msg.type === 'assistant') {
        const asst = msg as SDKAssistantMessage;
        const content = asst.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as unknown as Record<string, unknown>;
            if (b['type'] === 'tool_use') {
              yield {
                kind: 'block',
                block: {
                  type: 'tool_use',
                  id: b['id'],
                  name: b['name'],
                  input: b['input'],
                },
              };
            }
          }
        }
      } else if (msg.type === 'user') {
        const user = msg as SDKUserMessage;
        const content = user.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as unknown as Record<string, unknown>;
            if (b['type'] === 'tool_result') {
              const raw = b['content'];
              yield {
                kind: 'block',
                block: {
                  type: 'tool_result',
                  tool_use_id: b['tool_use_id'],
                  content: typeof raw === 'string' ? raw : raw ? String(raw) : '',
                },
              };
            }
          }
        }
      } else if (msg.type === 'result') {
        const result = msg as SDKResultMessage;
        // Error handling: success has `result`, error subtypes have `errors[]`
        let error: string | null = null;
        if (result.is_error) {
          if ('errors' in result && Array.isArray(result.errors)) {
            error = result.errors.join('; ');
          } else if ('result' in result) {
            error = String(result.result);
          }
        }
        console.info(
          `result: session=${result.session_id}, cost=$${result.total_cost_usd}, ${result.duration_ms}ms, error=${error}`,
        );
        yield {
          kind: 'result',
          sessionId: result.session_id,
          costUsd: result.total_cost_usd,
          durationMs: result.duration_ms,
          error,
        };
      }
      // Ignore other message types (system init, tool_progress, etc.)
    }
  }
}
