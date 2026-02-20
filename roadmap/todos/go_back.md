# "Go Back" — Rewind Conversation One Round

Status: ready to implement
Created: 2026-02-20
Related: `.claude/plans/starry-dancing-charm.md` (Phase 2)

## Problem

No way to undo a bad Claude Code exchange. The user says something,
Claude misinterprets it and makes unwanted changes. The only option is
to start over or manually fix things. "Go back" should feel like undo
in an editor — instant, one action, resumable from the rewound point.

## How conversations work (the key insight)

Claude Code stores conversations as **JSONL trees**, not flat lists.
Each message (`UserEntry`, `AssistantEntry`) has a `uuid` and a
`parentUuid` that points to the previous message, forming a chain:

```
root → user1 → asst1 → user2 → asst2
```

The **active branch** is determined by `SummaryEntry.leafUuid` — a
special entry that tells Claude Code where to resume. `active_leaf`
reads the last `SummaryEntry` in the file.

**Branching is free**: append a new `SummaryEntry` pointing to a
different node, and the conversation effectively rewinds. The old
messages stay in the file (nothing is deleted), but Claude Code will
resume from the new leaf. When the user sends a new message, it forks:

```
root → user1 → asst1 → user2 → asst2          (orphaned branch)
                    └→ user3 → asst3            (new branch after back)
```

This is the core mechanism. **"Go back" = append one `SummaryEntry`.**

## Two-array frontend model (Phase 1 context)

The frontend holds two separate arrays:
- `messages[]` — the CC conversation path. Mutable. Loaded from backend,
  appended during converse, **truncated on back**.
- `voiceLog[]` — user speech + Gemini speech. Append-only. **Never
  affected by back.**

This split exists precisely so "go back" can pop CC messages without
disturbing the voice transcript. One interleaved array would break.

## What needs to happen

### Backend: persist the rewind

A `POST /back` endpoint that:
1. Loads the conversation, finds `active_leaf`
2. Walks the tree path backward (leaf → root), filtering to user+assistant
3. Skips the last 2 entries (the round to undo) — targets the assistant
   before that
4. Appends a `SummaryEntry(leafUuid=target.uuid)` to the JSONL file

The primitive (`set_leaf`) is a 3-line function: open file in append
mode, write one `SummaryEntry` line. The endpoint is a thin wrapper
with a guard for "already at start" (< 3 entries in path → 400).

`walk_path()` returns **leaf-to-root** order. So `path[0]` = last
assistant, `path[1]` = last user, `path[2]` = the previous assistant
(our target).

### Frontend: abort + clear + pop

`back()` in `data.svelte.ts` (already implemented in Phase 1) does:
1. **Abort** the in-flight converse SSE stream
2. **Clear pending state** (tool, output, approval) — must happen
   *before* the async await, not after
3. **POST** to the backend endpoint
4. **Pop** from `messages[]` — remove trailing assistant(s) then
   trailing user(s)

### The abort race condition

`api.abort()` is synchronous (sends the signal), but the `AbortError`
fires on the **next microtask**. The error cascade goes:
converse.ts `catch` → `onError()` → gemini.ts `finishTool()` →
potentially `doCommitAssistant()` → appends to `messages[]`.

If `pendingTool` is still set when the error fires, `finishTool()`
commits partial results to `messages[]` — which we're about to pop.
**Fix**: clear `pendingTool = null` *before* the await. Then
`finishTool()` short-circuits (no-op if pendingTool is null).

### Gemini voice trigger

Declare a `go_back` tool (no parameters) in the Gemini function
declarations. Handle it in the tool call loop: call `data.back()`,
send a tool response, continue. Keep it before `startTool()` so it
doesn't create a pending tool card in the UI.

`commitTurn()` fires before the tool loop (flushing user speech to
`voiceLog[]`), so there's no conflict — voice events are preserved,
`back()` only pops from `messages[]`.

### UI: Back button

A small header button, visible when `claudeSessionId` exists and
status is connected. Calls `live.back()` on click.

## What's already done (Phase 1)

- `back()` in `data.svelte.ts` — full implementation
- `abort()` on `ConverseApi` — AbortController wired into fetch
- `back()` on `DataStoreMethods` interface — typed
- Two-array model (`messages[]` / `voiceLog[]`) — the foundation

## What remains

- `set_leaf()` function in `models.py`
- `POST /api/sessions/{id}/back` endpoint in `server.py`
- `go_back` tool declaration in `tools.ts`
- `go_back` handler in `gemini.ts`
- Back button in `+page.svelte`

## Verification

**Backend**: curl `POST /back` on a real session, then `GET /messages`
— count should decrease by 2. Call again — decreases by 2 more. Call
when only 1 exchange remains — should get 400.

**E2E**: load a session, click Back, verify last round disappears.
Click Start, do a converse, verify it resumes from the rewound point.

**Edge cases**:
- Back at conversation start → backend 400, UI unchanged
- Back mid-stream → stream aborted cleanly, round popped
- Back during approval wait → approval cleared, round popped
- Voice "go back" → Gemini calls tool → same result as button

## Future: branch switching

After back, the orphaned branch still exists in the JSONL. The
`GET /sessions/{id}/leaves` endpoint already returns all branch tips.
A future feature could show a branch selector — but that's a separate
todo. This one only handles linear rewind.
