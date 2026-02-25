# Architecture

Reduck is a voice interface for coding agents.

```
User ←→ Voice Relay ──→ Agent Backend ──→ Codebase
             ↕                │
           TTS            ┌───┴───┐
             ↕            │ Agent │  (the LLM / tool-using process)
         Audio I/O        └───┬───┘
                              │
                         State (CRUD)
                         Sandbox (orthogonal)
```

Two connections from the client:

1. **SSE** to the Reduck server → Agent Backend (instructions, session CRUD)
2. **WebSocket** directly to Gemini (voice relay + TTS — latency-sensitive)

The SSE protocol is the **deployment boundary**. Everything server-side of it varies by deployment mode. The Gemini connection is always direct from client, but in managed mode the server vends ephemeral tokens.

```
              SSE boundary
                  │
  Client          │    Server
  ───────         │    ──────
  UI              │    Agent Backend
  Audio I/O       │      ├─ Agent (converse)
                  │      ├─ State (CRUD)
                  │      └─ Sandbox (orthogonal)
                  │    Auth (managed only)
                  │    Token vending (managed only)
                  │
           Direct to Gemini
           ─────────────────
           Voice Relay (WS)
           TTS (WS)
```

## Agent Backend

The Agent Backend is one logical unit with three concerns:

### Agent (converse)

The core: receives an instruction, streams back text deltas + content blocks, emits a result.

```
Instruction → AsyncGenerator<TextDelta | ContentBlock | Result>
```

This is the LLM-powered process that reads files, writes code, calls tools. Current: Claude Code via `@anthropic-ai/claude-agent-sdk` `query()`. Could be any agent that speaks the same streaming protocol.

The client never touches the agent directly. It consumes SSE events through `ConverseApi`.

### State (CRUD)

Everything the agent operates on and produces: files, conversation history, artifacts. Reduck reads this state for display but never writes it — the agent owns writes.

Operations exposed to the client:
- **List** sessions
- **Read** a conversation path (tree walk)
- **Read** messages for a session
- **Fork** a conversation at a specific node

Current: Claude Code's JSONL files on disk (`~/.claude/projects/<slug>/<session_id>.jsonl`). Tree structure via `uuid`/`parentUuid` links.

In managed mode, this becomes API calls to whatever backs the agent's state — a remote filesystem, a database, an object store. The interface is the same; the storage is different.

### Sandbox (orthogonal)

The execution environment the agent runs in. Orthogonal to the agent itself — you can run the same agent in different sandboxes.

- **Local:** The user's machine. No isolation. The agent reads/writes the real filesystem.
- **Managed:** A container, VM, or cloud sandbox. Isolated. The agent operates on a remote filesystem.

Sandbox concerns: lifecycle (start/stop), resource limits, networking, persistence, security boundaries. None of these leak into Reduck — it only talks to the Agent Backend through SSE regardless of where the sandbox runs.

### Interface

```typescript
interface AgentBackend {
  // Agent (converse)
  converse(message: string, opts: ConverseOpts): AsyncGenerator<Chunk>;

  // State (CRUD)
  listSessions(): Promise<SessionInfo[]>;
  loadPath(sessionId: string, leafUuid?: string): Promise<PathEntry[]>;
  loadMessages(sessionId: string): Promise<MessageResponse[]>;
  fork(sessionId: string, leafUuid: string): Promise<string>;
}
```

One interface, one injection point. `routes.ts` receives an `AgentBackend` via `createApp()`. The choice of implementation — local subprocess + JSONL files vs. remote API — is a deployment decision in `cli.ts`.

## Client Roles

### Voice Relay — needs `VoiceRelayFactory`

Bidirectional audio gateway: VAD + STT + tool dispatch. It's a *relay*, not a participant — it decides WHEN to call the agent, not WHAT to say.

Current: Gemini Live API via WebSocket. Declares `converse` and `stop` as BLOCKING tools.

**Partially injectable.** `LiveBackend` interface exists for the output side. Creation, configuration, and the Gemini SDK import are hardcoded in `gemini.ts`. The orchestration logic (tool call → converse flow, approval gating, abort semantics) is interleaved with Gemini-specific message shapes.

### TTS — `StreamingTTS`

Streaming text-to-speech. Receives chunks, sentence-buffers, speaks progressively.

```
send(text) → buffer and speak
finish()   → flush, drain remaining audio
interrupt() → stop immediately
close()    → tear down
```

Current: A second Gemini Live session. **Already injectable** — the `StreamingTTS` interface is clean.

### Audio I/O — `AudioPort`

Mic capture (PCM 16kHz mono) and speaker playback (PCM 24kHz gapless). Current: Browser AudioWorklet + AudioContext. **Already injectable** — interface exists.

## Injection Status

| Role | Interface | Exists? | Current impl | Swappable? |
|------|-----------|---------|-------------|------------|
| Agent Backend | `AgentBackend` | NO | `claude-client.ts` + `models.ts` | Easy — extract interface |
| Voice Relay | `VoiceRelayFactory` | NO | `gemini.ts` (Gemini Live) | Hard — orchestration coupled |
| TTS | `StreamingTTS` | YES | `tts-session.ts` (Gemini Live) | Ready |
| Audio I/O | `AudioPort` | YES | `audio.ts` (browser APIs) | Ready |

## Data Flow

### Happy path

```
1. Mic → PCM chunks → Voice Relay (Gemini WS)
2. Gemini VAD detects end-of-speech
3. Gemini calls converse tool with transcribed instruction
4. Client POST /api/converse → Server (SSE stream opens)
5. Server → Agent Backend → streams text + blocks
6. Server relays as SSE → Client
7. Client feeds text to TTS (sentence-buffered)
8. TTS → audio → Speaker
9. Done event: session_id, cost, duration
```

### Interrupt

```
1. User says "stop" during active converse
2. Keyword listener detects it
3. Client aborts SSE fetch + interrupts TTS
4. Agent terminates current query
```

### Review mode

```
1–3. Same as happy path
4. Client holds for approval instead of executing
5. Instruction read back via TTS
6. User says "yes" (voice) or clicks approve (UI)
7. Approve → execute; Reject → unfreeze relay, no agent call
```

## SSE Protocol

The stable contract between server and any client. All events: `data: <json>\n\n`.

| Event | Shape | Meaning |
|-------|-------|---------|
| Text delta | `{text: string}` | Streaming assistant text |
| Content block | `{block: {type, ...}}` | Complete tool_use or tool_result |
| Done | `{done: true, session_id, cost_usd, duration_ms}` | Stream complete |
| Error | `{done: true, error: string}` | Stream failed |

## Deployment Modes

### Local (current)

Server runs on user's machine. Agent Backend = local subprocess + JSONL files. No auth.

```
Browser ──SSE──→ localhost:8000 ──subprocess──→ Claude Code CLI
                      │                             │
                      │                      ~/.claude/projects/*.jsonl
                      │
              (Gemini API key from .env, passed to client)
```

Requires: Claude Code CLI, API keys in .env, Node.js.

### Managed

Server is hosted. Agent Backend = remote agent + remote storage. Multi-tenant with auth. Client still connects directly to Gemini (latency), but with ephemeral tokens.

```
                       SSE (agent + CRUD)
Browser ──────────────────────────→ api.example.com ──API──→ Remote Agent
    │                                     │                       │
    │   WebSocket (voice + TTS)           │ Auth + routing    Remote state
    └─────────────────────────────→ Gemini API
                                      ↑
                               ephemeral token
                            (vended by backend)
```

**Ephemeral tokens** solve key management. The backend holds the real Gemini API key; the client gets a scoped, short-lived token (~1 min to start a session, ~30 min lifetime):

1. Client authenticates with Reduck backend
2. Backend calls `client.authTokens.create()` with constraints (model, modalities, `uses: 1`)
3. Backend returns ephemeral token to client
4. Client passes token to `GoogleGenAI({ apiKey: token.name })` — same SDK, same code path
5. On token expiry, client requests a new one (session resumption keeps the WS alive)

Token constraints can lock model, temperature, and modalities server-side — the client can't override them.

**What changes:**

| Component | Local → Managed |
|-----------|----------------|
| `AgentBackend` impl | subprocess + JSONL → remote API |
| `routes.ts` | no auth → auth middleware, per-user routing |
| _(new)_ | — → `GET /api/auth/gemini-token` endpoint |
| `gemini.ts` / `tts-session.ts` | `apiKey` from UI → ephemeral token from backend |

**What stays identical:** client orchestration logic, SSE protocol, port interfaces.

### Target server structure

```
src/server/
  cli.ts              # Entry point (both modes)
  routes.ts           # HTTP routes (mode-agnostic, receives AgentBackend)
  types.ts            # AgentBackend interface
  backends/
    local.ts          # AgentBackend: SDK subprocess + JSONL files
    managed.ts        # AgentBackend: remote API calls
```

## File Map (current)

```
src/
  server/
    cli.ts                 # Entry point, .env, prereqs
    routes.ts              # HTTP endpoints (SSE streaming)
    claude-client.ts       # Agent wrapper (converse only, no CRUD yet)
  client/
    routes/live/
      gemini.ts            # Voice relay orchestration
      tts-session.ts       # TTS via Gemini Live
      converse.ts          # SSE consumer (ConverseApi)
      audio.ts             # Browser mic + speaker
      types.ts             # Port interfaces
      tools.ts             # Tool declarations for relay
      voice-approval.ts    # Keyword detection
      buffer.ts            # Sentence buffer for TTS
    lib/
      chat-types.ts        # Shared render types
  shared/
    types.ts               # Session entry types, content blocks
    models.ts              # Conversation tree, fork, preview
```
