# Claude Code Conversation Structure

## Storage

Each conversation lives in a single **JSONL file** (one JSON object per line), identified by a session UUID:
```
projects/<project-slug>/<session-uuid>.jsonl
```

A single file can contain **thousands of entries** (e.g. 4,347 in the sample) all belonging to one `sessionId`.

## Entry Types

| Type | Has UUID | Has parentUuid | Description |
|---|---|---|---|
| `user` | yes | yes (or null for roots) | User message or tool result |
| `assistant` | yes | yes | Model response (thinking, text, or tool_use) |
| `progress` | yes | yes | Streaming progress updates (hook execution) |
| `system` | yes | yes (or null) | System events (stop hooks, turn duration, compaction boundaries) |
| `file-history-snapshot` | no | no | File backup snapshots (standalone, not part of the tree) |
| `summary` | no | no | Conversation compression markers with `leafUuid` pointer |
| `custom-title` | no | no | User-set conversation title |
| `queue-operation` | no | no | Background task enqueue/dequeue events |
| `pr-link` | no | no | Links a session to a GitHub PR |

## The Tree: UUID Linked List

The core data structure is a **tree of entries** built from two fields:

- **`uuid`**: unique identifier for each entry
- **`parentUuid`**: pointer to the parent entry (null for roots)

```
root (user, parentUuid=null)
 └─ user (slash command expansion)
     └─ assistant (thinking block)
         └─ assistant (text block)
             └─ assistant (tool_use block)
                 └─ user (tool_result block)
                     └─ assistant (thinking block)
                         └─ assistant (text block)
                             └─ ...
```

### Key insight: a "turn" is not one entry

A single assistant turn is a **chain of entries**, each linked by `parentUuid`:

1. `assistant` with `thinking` block
2. `assistant` with `text` block
3. `assistant` with `tool_use` block
4. `user` with `tool_result` block (the tool output, typed as "user" in the API)
5. `assistant` with `thinking` block (continuing after tool result)
6. `assistant` with `text` block
7. ... repeat

Each content block (thinking, text, tool_use, tool_result) is its own entry in the JSONL, chained together.

## Branching

Branching happens when **multiple entries share the same `parentUuid`**. This creates a tree rather than a linear list.

### How branches arise

| Sibling pattern | Count | Cause |
|---|---|---|
| `(user, user)` | 100 | User edited their message or retried |
| `(assistant, assistant)` | 196 | Retried generation (often duplicate UUIDs) |
| `(assistant, user)` | 124 | User interrupted mid-generation, then sent new message |
| `(user, user, user, ...)` | 20+ | User tried many edits of the same prompt |

Example of a user editing their message 10 times:
```
parent (user: "I have added this...")
 ├─ child 0: "I don't get it. Tell me exactly..."
 ├─ child 1: "I have added this. Digest then update test"
 ├─ child 2: "I have added this. Digest then update plan"
 ├─ child 3: "Read updated plan. Digest, ask questions..."
 ├─ child 4: "Read updated plan. Digest, ask questions..."
 ...
 └─ child 9: "Read updated plan. Digest, ask questions..."
```

### Duplicate UUIDs

When an assistant response is retried, the new entries can reuse the **same UUID** as the original. In the sample, 395 UUIDs appeared more than once. This means `uuid` alone is not a unique key across the full file — it's unique within a branch path.

### Multiple roots

A single conversation file can have **multiple root entries** (entries with `parentUuid=null`). This typically happens when the conversation is resumed via `/resume` with a new slash command that creates a fresh root. The sample had 7 roots.

## The Summary / leafUuid Mechanism

**Summary entries** are the mechanism that tells Claude Code which branch to follow when resuming a conversation.

```json
{"type": "summary", "summary": "...", "leafUuid": "<uuid>"}
```

- `leafUuid` points to the **tip of the active conversation branch**
- When Claude Code loads a session, it reads the **last summary entry** to find the leaf
- It then walks **up the parentUuid chain** from the leaf to reconstruct the active conversation path
- All other branches (edits, retries, abandoned paths) remain in the file but are invisible

### How `branch_finder.py` works

The tool manipulates conversations by changing `leafUuid`:

1. **`find`**: Search entries for anchor text, show context (ancestry + children)
2. **`goto`**: Find anchor text, pick a match interactively, then rewrite the summary's `leafUuid` to point to that entry
3. **`branch`**: Directly set `leafUuid` to a given UUID
4. **`tree`**: Visualize the tree structure around any UUID
5. **`restore`**: Revert from a `.jsonl.backup` file

By changing `leafUuid` in the last summary, you effectively "time travel" — Claude Code will resume from that point, and the subsequent conversation will fork from there.

## Visual model

```
                    ┌─ [abandoned retry]
         ┌─ msg2a ─┤
         │          └─ msg3 ── msg4 ── msg5 ◄── leafUuid (active branch)
root ────┤
         └─ msg2b ── msg6 ── msg7      (abandoned edit, still in file)

summary: { leafUuid: msg5.uuid }
```

Walking up from `msg5`: msg5 → msg4 → msg3 → msg2a → root = the active path.

## Data Model (models.py)

The Pydantic models map directly to this structure. Validated against 415 conversation files (88k+ records).

### Tree entries (have `uuid` + `parentUuid`)

- **`UserRecord`**: user messages and tool results. Notable optional fields: `toolUseResult` (tool output metadata), `sourceToolAssistantUUID` (links tool results back to the assistant entry that invoked them), `permissionMode`, `todos`, `thinkingMetadata`.
- **`AssistantRecord`**: model responses. Each entry contains a single content block type within `message.content`. Optional: `requestId`, `isApiErrorMessage`.
- **`ProgressRecord`**: hook execution progress. Has `data` (hook event details), `toolUseID`, `parentToolUseID`.
- **`SystemRecord`**: system events. `subtype` discriminates between `stop_hook_summary` (hook results after a turn), `turn_duration` (timing), `local_command` (slash commands), and `compact_boundary` (conversation compaction). `parentUuid` is null for compaction boundaries. Has `logicalParentUuid`, `compactMetadata`, `microcompactMetadata` for compaction.

### Standalone entries (no `uuid`)

- **`SummaryRecord`**: `{type: "summary", summary: str, leafUuid: str}` — the branch pointer.
- **`FileHistorySnapshotRecord`**: file backup snapshots keyed by `messageId`.
- **`CustomTitleRecord`**: user-set conversation title.
- **`QueueOperationRecord`**: background task lifecycle (`enqueue`/`dequeue`).
- **`PrLinkRecord`**: links a session to a GitHub PR (`prNumber`, `prUrl`, `prRepository`).

### Content blocks

Content blocks inside messages use a union type: `TextBlock`, `ThinkingBlock`, `ToolUseBlock`, `ToolResultBlock`, `ImageBlock`.

### Conversation container

`Conversation.from_jsonl(path)` loads all records, skipping malformed JSON lines. Provides filtered accessors: `.user_records`, `.assistant_records`, `.progress_records`, `.system_records`, `.summaries`, `.snapshots`.
