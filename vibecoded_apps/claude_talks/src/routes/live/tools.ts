import { Type, Behavior } from '@google/genai';
import type { Tool } from '@google/genai';
import type { SessionInfo } from './models';

// ── Gemini function declarations ──

export const TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'list_sessions',
        description: 'List available Claude Code sessions',
      },
      {
        name: 'send_message',
        description: 'Send a message to a Claude Code session',
        parameters: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING, description: 'Session ID' },
            message: { type: Type.STRING, description: 'Message to send' },
          },
          required: ['id', 'message'],
        },
      },
      {
        name: 'converse',
        description: 'Forward a user instruction to Claude Code for execution. Use this when the user wants Claude Code to do something.',
        behavior: Behavior.NON_BLOCKING,
        parameters: {
          type: Type.OBJECT,
          properties: {
            instruction: { type: Type.STRING, description: 'The instruction to send to Claude Code' },
          },
          required: ['instruction'],
        },
      },
    ],
  },
];

// ── Handlers (pure async, just fetch) ──

async function listSessions(): Promise<{ sessions: SessionInfo[] }> {
  const res = await fetch('/api/sessions');
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return { sessions: await res.json() };
}

async function sendMessage(args: Record<string, unknown>): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/sessions/${args.id}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: args.message }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return { ok: true };
}

// ── Dispatch (single entry point for store) ──

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (name) {
    case 'list_sessions': return listSessions();
    case 'send_message': return sendMessage(args);
    default: return { error: `Unknown tool: ${name}` };
  }
}
