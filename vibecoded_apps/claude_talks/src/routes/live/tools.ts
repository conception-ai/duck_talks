import { Type } from '@google/genai';
import type { Tool } from '@google/genai';

// ── Gemini function declarations ──

export const TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'converse',
        description: 'Forward a user instruction to Claude Code for execution. Use this when the user wants Claude Code to do something.',
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

// ── Dispatch (single entry point for store) ──

export async function handleToolCall(
  name: string,
  _args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return { error: `Unknown tool: ${name}` };
}
