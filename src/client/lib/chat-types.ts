/**
 * Render-relevant domain types shared across routes.
 * No runtime code — everything here is a type or interface.
 *
 * ContentBlock is the single source of truth from src/shared/types.ts.
 * UI-only types (PendingTool, Status, etc.) stay local.
 */

// --- CC message types (re-exported from shared) ---

export type { ContentBlock } from '../../shared/types';

import type { ContentBlock } from '../../shared/types';

export interface Message {
  uuid?: string;
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

// --- UI state types ---

export interface PendingTool {
  name: string;
  args: Record<string, unknown>;
  text: string;
  blocks: ContentBlock[];
  streaming: boolean;
}

export type Status = 'idle' | 'connecting' | 'connected';

export interface PendingApproval {
  instruction: string;
}

export type InteractionMode = 'direct' | 'review';

// --- Supporting types ---

export interface VoiceEvent {
  role: 'user' | 'gemini';
  text: string;
  ts: number;
}

export interface Correction {
  id: string;
  original: string;
  corrected: string;
}
