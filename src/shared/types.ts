/**
 * Unified types for Claude Code sessions.
 * Replaces both Python models.py and frontend chat-types.ts.
 *
 * These types mirror Claude Code's JSONL session format.
 * No validation library — we parse lenient (extra fields ignored).
 */

// --- JSON helpers ---

export type JsonDict = Record<string, unknown>;

export interface MessageDict {
  role?: string;
  content?: string | JsonDict[];
}

// --- Content Blocks (render-relevant subset) ---

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | JsonDict[] }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

// --- Usage stats ---

export interface CacheCreation {
  ephemeral_5m_input_tokens?: number;
  ephemeral_1h_input_tokens?: number;
}

export interface ServerToolUse {
  web_search_requests?: number;
  web_fetch_requests?: number;
}

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: CacheCreation;
  server_tool_use?: ServerToolUse;
  service_tier?: string;
}

// --- Message payloads (inside session entries) ---

export interface UserMessagePayload {
  role: 'user';
  content: string | JsonDict[];
}

export interface AssistantMessagePayload {
  id?: string;
  model?: string;
  role: 'assistant';
  type?: 'message';
  content: ContentBlock[];
  stop_reason?: string | null;
  stop_sequence?: string | null;
  usage?: Usage;
}

// --- Session entry types ---

export interface QueueOperation {
  type: 'queue-operation';
  timestamp?: string;
  operation?: string;
  sessionId: string;
  content?: string;
}

export interface UserEntry {
  type: 'user';
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  message: UserMessagePayload;
  timestamp?: string;
  cwd?: string;
  isSidechain?: boolean;
  userType?: string;
  version?: string;
  gitBranch?: string | null;
  slug?: string;
  isMeta?: boolean;
  permissionMode?: string;
  toolUseResult?: unknown;
  sourceToolAssistantUUID?: string;
  [key: string]: unknown; // extra="allow"
}

export interface AssistantEntry {
  type: 'assistant';
  uuid: string;
  parentUuid: string;
  sessionId: string;
  message: AssistantMessagePayload;
  timestamp?: string;
  cwd?: string;
  isSidechain?: boolean;
  userType?: string;
  version?: string;
  gitBranch?: string | null;
  requestId?: string;
  slug?: string;
  isApiErrorMessage?: boolean;
  [key: string]: unknown; // extra="allow"
}

export interface ProgressEntry {
  type: 'progress';
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp?: string;
  data?: JsonDict;
  toolUseID?: string;
  parentToolUseID?: string;
  cwd?: string;
  gitBranch?: string | null;
  version?: string;
  userType?: string;
  isSidechain?: boolean;
  slug?: string;
  [key: string]: unknown;
}

export interface SystemEntry {
  type: 'system';
  uuid: string;
  parentUuid: string | null;
  sessionId?: string;
  timestamp?: string;
  subtype?: string;
  level?: string;
  cwd?: string;
  gitBranch?: string | null;
  version?: string;
  userType?: string;
  isSidechain?: boolean;
  slug?: string;
  stopReason?: string;
  toolUseID?: string;
  hasOutput?: boolean;
  hookCount?: number;
  hookErrors?: unknown[];
  hookInfos?: unknown[];
  preventedContinuation?: boolean;
  content?: string;
  durationMs?: number;
  isMeta?: boolean;
  logicalParentUuid?: string;
  compactMetadata?: JsonDict;
  microcompactMetadata?: JsonDict;
  [key: string]: unknown;
}

export interface FileHistorySnapshot {
  type: 'file-history-snapshot';
  timestamp?: string;
  messageId: string;
  snapshot?: JsonDict;
  isSnapshotUpdate?: boolean;
}

export interface SummaryEntry {
  type: 'summary';
  uuid?: string;
  timestamp?: string;
  summary?: string;
  leafUuid?: string;
  leafUuids?: string[];
}

export interface CustomTitleEntry {
  type: 'custom-title';
  timestamp?: string;
  customTitle: string;
  sessionId?: string;
}

export interface PrLinkEntry {
  type: 'pr-link';
  timestamp?: string;
  sessionId: string;
  prNumber: number;
  prUrl: string;
  prRepository: string;
}

// --- Union types ---

export type SessionEntry =
  | QueueOperation
  | UserEntry
  | AssistantEntry
  | ProgressEntry
  | SystemEntry
  | FileHistorySnapshot
  | SummaryEntry
  | CustomTitleEntry
  | PrLinkEntry;

/** Entries that participate in the UUID tree (have uuid + parentUuid). */
export type TreeEntry = UserEntry | AssistantEntry | ProgressEntry | SystemEntry;

// --- API response types ---

export interface SessionInfo {
  id: string;
  name: string;
  summary: string;
  updated_at: string;
}

export interface LeafInfo {
  uuid: string;
  type: string;
  depth: number;
  preview: string;
  is_active: boolean;
}

export interface PathEntry {
  uuid: string;
  type: string;
  role: string | null;
  preview: string;
}

export interface MessageResponse {
  uuid: string;
  role: string;
  content: string | ContentBlock[];
}

// --- Type guards ---

export function isTreeEntry(entry: SessionEntry): entry is TreeEntry {
  return (
    entry.type === 'user' ||
    entry.type === 'assistant' ||
    entry.type === 'progress' ||
    entry.type === 'system'
  );
}

export function isUserEntry(entry: SessionEntry): entry is UserEntry {
  return entry.type === 'user';
}

export function isAssistantEntry(entry: SessionEntry): entry is AssistantEntry {
  return entry.type === 'assistant';
}

export function isCustomTitleEntry(entry: SessionEntry): entry is CustomTitleEntry {
  return entry.type === 'custom-title';
}
