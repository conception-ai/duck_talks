/**
 * Session file operations — load JSONL, walk tree, fork sessions.
 * Port of Python models.py (Conversation, fork_session, preview, slug helpers)
 * plus _read_tail / _session_preview from server.py.
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openSync, readSync, closeSync } from 'node:fs';
import type {
  SessionEntry,
  TreeEntry,
  UserEntry,
  AssistantEntry,
  QueueOperation,
  JsonDict,
  ContentBlock,
} from './types.js';
import {
  isTreeEntry,
  isUserEntry,
  isAssistantEntry,
  isCustomTitleEntry,
} from './types.js';

// --- Slug helpers ---

export function pathToSlug(absPath: string): string {
  return absPath.replace(/[^a-zA-Z0-9-]/g, '-');
}

export function slugToPath(slug: string): string {
  const trimmed = slug.replace(/^-+/, '');
  const result = '/' + trimmed.replace(/--/g, '/.').replace(/-/g, '/');
  return result;
}

// --- Tree Index ---

interface TreeIndex {
  byUuid: Map<string, TreeEntry[]>;
  parentRefs: Set<string>;
}

function buildTreeIndex(records: SessionEntry[]): TreeIndex {
  const byUuid = new Map<string, TreeEntry[]>();
  const parentRefs = new Set<string>();

  for (const r of records) {
    if (!isTreeEntry(r)) continue;
    const list = byUuid.get(r.uuid);
    if (list) {
      list.push(r);
    } else {
      byUuid.set(r.uuid, [r]);
    }
    if (r.parentUuid) {
      parentRefs.add(r.parentUuid);
    }
  }

  return { byUuid, parentRefs };
}

// --- Preview ---

export function preview(entry: TreeEntry, limit = 100): string {
  const uid = entry.uuid.slice(0, 8);
  const etype = entry.type;

  if (!isUserEntry(entry) && !isAssistantEntry(entry)) {
    let extra = '';
    if (entry.type === 'system' && entry.subtype) {
      extra = entry.subtype;
    }
    return `${etype.padEnd(10)} ${uid}  ${extra}`;
  }

  const content = entry.message.content;
  if (typeof content === 'string') {
    const text = content.trim().replace(/\n/g, ' ').slice(0, limit);
    return `${etype.padEnd(10)} ${uid}  ${text}`;
  }

  const parts: string[] = [];
  for (const b of content) {
    if (isAssistantEntry(entry)) {
      const block = b as ContentBlock;
      switch (block.type) {
        case 'text':
          parts.push(block.text.replace(/\n/g, ' ').slice(0, 60));
          break;
        case 'thinking':
          parts.push('[think]');
          break;
        case 'tool_use':
          parts.push(`[tool:${block.name}]`);
          break;
        case 'tool_result':
          parts.push('[result]');
          break;
        default:
          parts.push(`[${block.type}]`);
      }
    } else {
      // UserEntry: content blocks are raw dicts
      const block = b as JsonDict;
      const btype = (block['type'] as string) || '';
      if (btype === 'tool_result') {
        parts.push('[result]');
      } else if (btype === 'text') {
        const text = ((block['text'] as string) || '').replace(/\n/g, ' ').slice(0, 60);
        parts.push(text);
      } else {
        parts.push(`[${btype || 'dict'}]`);
      }
    }
  }
  const text = parts.join(' | ').slice(0, limit);
  return `${etype.padEnd(10)} ${uid}  ${text}`;
}

// --- Conversation ---

export class Conversation {
  readonly records: SessionEntry[];
  private _treeCache: TreeIndex | null = null;

  constructor(records: SessionEntry[]) {
    this.records = records;
  }

  static fromJsonl(path: string): Conversation {
    const content = readFileSync(path, 'utf-8');
    const records: SessionEntry[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as SessionEntry);
      } catch {
        // skip malformed lines
      }
    }
    return new Conversation(records);
  }

  private get tree(): TreeIndex {
    if (!this._treeCache) {
      this._treeCache = buildTreeIndex(this.records);
    }
    return this._treeCache;
  }

  get userEntries(): UserEntry[] {
    return this.records.filter(isUserEntry);
  }

  get assistantEntries(): AssistantEntry[] {
    return this.records.filter(isAssistantEntry);
  }

  get title(): string {
    for (const r of this.records) {
      if (isCustomTitleEntry(r) && r.customTitle) {
        return r.customTitle;
      }
    }
    const text = firstUserText(this.userEntries);
    return text ? text.slice(0, 120) : '';
  }

  get description(): string {
    return firstAssistantText(this.assistantEntries);
  }

  get updatedAt(): string {
    if (this.records.length === 0) return '';
    return (this.records[this.records.length - 1] as { timestamp?: string }).timestamp || '';
  }

  get messageCount(): number {
    return this.userEntries.length + this.assistantEntries.length;
  }

  get leaves(): TreeEntry[] {
    const t = this.tree;
    const result: TreeEntry[] = [];
    for (const [uid, elist] of t.byUuid) {
      if (!t.parentRefs.has(uid)) {
        result.push(elist[elist.length - 1]);
      }
    }
    return result;
  }

  get activeLeaf(): TreeEntry | null {
    const allLeaves = this.leaves;
    if (allLeaves.length === 0) return null;
    let best: TreeEntry | null = null;
    let bestDepth = -1;
    for (const leaf of allLeaves) {
      const depth = this.walkPath(leaf.uuid).length;
      if (depth > bestDepth) {
        bestDepth = depth;
        best = leaf;
      }
    }
    return best;
  }

  walkPath(leafUuid: string): TreeEntry[] {
    const t = this.tree;
    const path: TreeEntry[] = [];
    const seen = new Set<string>();
    let uid: string | null = leafUuid;

    while (uid && !seen.has(uid)) {
      seen.add(uid);
      const elist = t.byUuid.get(uid);
      if (!elist) break;
      const entry = elist[elist.length - 1]; // last occurrence
      path.push(entry);
      uid = entry.parentUuid;
    }
    return path;
  }
}

// --- Helpers ---

function firstUserText(entries: UserEntry[]): string {
  for (const entry of entries) {
    if (typeof entry.message.content === 'string') {
      const text = entry.message.content.trim();
      if (text) return text.slice(0, 200);
    }
  }
  return '';
}

function firstAssistantText(entries: AssistantEntry[]): string {
  for (const entry of entries) {
    for (const block of entry.message.content) {
      if (block.type === 'text') {
        const text = block.text.trim();
        if (text) return text.slice(0, 300);
      }
    }
  }
  return '';
}

// --- Fork ---

export function forkSession(originalPath: string, leafUuid: string): string {
  const conv = Conversation.fromJsonl(originalPath);
  const pathEntries = conv.walkPath(leafUuid);
  if (pathEntries.length === 0) {
    throw new Error(`UUID not found in tree: ${leafUuid}`);
  }
  pathEntries.reverse(); // walk_path returns leaf→root; we need root→leaf

  const newSid = randomUUID();
  const newPath = join(dirname(originalPath), `${newSid}.jsonl`);

  const qop: QueueOperation = {
    type: 'queue-operation',
    operation: 'dequeue',
    sessionId: newSid,
    timestamp: new Date().toISOString(),
  };

  const lines: string[] = [JSON.stringify(qop)];
  for (const entry of pathEntries) {
    const raw = JSON.parse(JSON.stringify(entry)) as Record<string, unknown>;
    raw['sessionId'] = newSid;
    lines.push(JSON.stringify(raw));
  }

  writeFileSync(newPath, lines.join('\n') + '\n');
  return newSid;
}

// --- Tail read (fast preview without loading full JSONL) ---

export function readTail(path: string, nbytes = 32768): JsonDict[] {
  const fd = openSync(path, 'r');
  try {
    const stat = statSync(path);
    const size = stat.size;
    const chunk = Math.min(nbytes, size);
    const buf = Buffer.alloc(chunk);
    readSync(fd, buf, 0, chunk, size - chunk);
    const tail = buf.toString('utf-8');

    const result: JsonDict[] = [];
    const lines = tail.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        result.push(JSON.parse(lines[i]) as JsonDict);
      } catch {
        // skip
      }
    }
    return result;
  } finally {
    closeSync(fd);
  }
}

export function extractPreview(
  entries: JsonDict[],
): { name: string; summary: string; timestamp: string } {
  let timestamp = '';
  let name = '';
  let summary = '';

  for (const entry of entries) {
    const entryType = entry['type'] as string | undefined;

    if (!timestamp) {
      const t = entry['timestamp'];
      if (typeof t === 'string' && t) timestamp = t;
    }

    if (!name && entryType === 'user') {
      const msg = entry['message'] as JsonDict | undefined;
      if (msg) {
        const rawContent = msg['content'];
        if (typeof rawContent === 'string' && rawContent.trim()) {
          name = rawContent.trim().slice(0, 200);
        }
      }
    }

    if (!summary && entryType === 'assistant') {
      const msg = entry['message'] as JsonDict | undefined;
      if (msg) {
        const blocks = msg['content'] as unknown[] | undefined;
        if (Array.isArray(blocks)) {
          for (const blockObj of blocks) {
            if (typeof blockObj !== 'object' || blockObj === null) continue;
            const block = blockObj as JsonDict;
            if (block['type'] === 'text') {
              const textVal = block['text'];
              if (typeof textVal === 'string' && textVal.trim()) {
                summary = textVal.trim().slice(0, 300);
                break;
              }
            }
          }
        }
      }
    }

    if (timestamp && name && summary) break;
  }

  return { name, summary, timestamp };
}

const TAIL_START = 32768;
const TAIL_MAX = 262144;

export function sessionPreview(path: string): { name: string; summary: string; timestamp: string } {
  let nbytes = TAIL_START;
  let timestamp = '';
  while (nbytes <= TAIL_MAX) {
    const entries = readTail(path, nbytes);
    const result = extractPreview(entries);
    timestamp = result.timestamp || timestamp;
    if (result.name) return result;
    nbytes *= 2;
  }
  return { name: '', summary: '', timestamp };
}
