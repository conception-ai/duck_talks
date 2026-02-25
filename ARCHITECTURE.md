# Architecture

Reduck is a voice interface for coding agents. A user speaks, a voice relay dispatches the instruction to an agent, the agent streams back results, and TTS reads them aloud.

## Core Abstraction

```
User ←→ Voice Relay ←→ Agent ←→ Codebase
             ↕              ↕
           TTS         Session Store
             ↕
         Audio I/O
```

There are **five fundamental roles**. Each has a clear contract. Some are injectable today, others should be.

## Roles

### 1. Agent (server-side)

**What it does:** Receives an instruction string, streams back a response as text deltas + content blocks (tool_use, tool_result), and emits a final result with session metadata.

**Contract (output):**
```
Instruction → Stream<TextDelta | ContentBlock | Result>
```

**Current implementation:** Claude Code via `@anthropic-ai/claude-agent-sdk` `query()`. Stateless — each call spawns a subprocess, session continuity via `resume` option pointing to JSONL on disk.

**Injectable?** YES — the `ConverseApi` interface already abstracts this. Any agent that can stream text + structured blocks works. The server is a thin HTTP/SSE adapter; the client never touches the agent SDK directly.

**What would change for a different agent:** Replace `claude-client.ts`. The SSE protocol (`{text}`, `{block}`, `{done, session_id}`) is the contract. Agent-specific features (fork, permission_mode) become optional fields.

### 2. Session Store (server-side)

**What it does:** Persists conversation history. Supports: list sessions, load a conversation tree, fork at a specific node.

**Current implementation:** Claude Code's JSONL files on disk (`~/.claude/projects/<slug>/<session_id>.jsonl`). Tree structure via `uuid`/`parentUuid` links. Read-only from Reduck's perspective — Claude Code owns the writes.

**Injectable?** PARTIALLY — the `Conversation` class and `types.ts` model Claude Code's specific format. The tree-walking logic (`walkPath`, `leaves`, `activeLeaf`) is generic. The JSONL parsing and entry types (`UserEntry`, `AssistantEntry`, `SystemEntry`, etc.) are Claude Code-specific.

To decouple: define a `SessionStore` interface with `list()`, `loadPath(sessionId, leafUuid)`, `fork(sessionId, leafUuid)`. Implement it for Claude Code's JSONL format. Alternative agents bring their own implementation.

### 3. Voice Relay (client-side)

**What it does:** Bidirectional audio gateway with VAD (voice activity detection) and STT. Listens to user speech, decides when to dispatch tool calls, manages turn-taking.

**Key insight:** It's a *relay*, not a participant. It decides WHEN to call the agent based on user speech, but doesn't generate its own content. The prompt enforces this: "DO NOT talk to the user. You are a relay only."

**Current implementation:** Gemini Live API via WebSocket (`gemini.ts`). Declares `converse` and `stop` as BLOCKING tools. When user speaks, Gemini decides whether it's a converse instruction or a stop command and calls the appropriate tool.

**Injectable?** NOT YET — `gemini.ts` directly imports `GoogleGenAI`. The `LiveBackend` interface exists but only covers the output side (sendRealtimeInput, sendClientContent). The creation and configuration (model choice, tool declarations, system prompt) are hardcoded.

**To decouple:** Extract a `VoiceRelayFactory` that takes configuration (tools, system prompt) and returns a `LiveBackend` + message callback. The orchestration logic (what happens on tool call, how converse flows, approval gating) stays in a generic handler that any relay implementation feeds into.

**Mobile concern:** Voice relay currently lives client-side (browser WebSocket → Gemini). For mobile, two options:
- **Same pattern:** Mobile app opens its own Gemini WebSocket (lower latency, per-platform implementation)
- **Server-mediated:** Server holds the Gemini connection, mobile sends audio via WebSocket to server (single implementation, higher latency)

### 4. TTS (client-side)

**What it does:** Converts agent text output to spoken audio. Streaming — receives text chunks as they arrive, buffers into sentences, speaks them progressively.

**Contract:**
```
send(text)      → buffer and speak
finish()        → flush buffer, drain remaining audio
interrupt()     → stop immediately, discard buffer
close()         → tear down connection
```

**Current implementation:** A second Gemini Live session (`tts-session.ts`) with a "read aloud exactly" system prompt. Sentence buffer (`buffer.ts`) batches text into natural units before sending.

**Injectable?** YES — `StreamingTTS` interface is already clean. Swap for: browser SpeechSynthesis API (free, offline, lower quality), ElevenLabs (high quality, paid), or any service that accepts streaming text and produces streaming audio.

### 5. Audio I/O (client-side)

**What it does:** Mic capture (PCM 16kHz mono → base64 chunks) and speaker playback (base64 PCM 24kHz → gapless audio scheduling).

**Current implementation:** Browser AudioWorklet + AudioContext (`audio.ts`).

**Injectable?** YES for cross-platform — `AudioPort` interface exists. Mobile would provide native implementations (AVAudioEngine on iOS, AudioRecord on Android). The PCM format (sample rate, bit depth) is the contract.

## Dependency Injection Status

| Role | Interface | Implementation | Injectable? |
|------|-----------|---------------|-------------|
| Agent | `ConverseApi` | Claude Code SDK | YES |
| Session Store | _(none yet)_ | JSONL files | Needs interface |
| Voice Relay | `LiveBackend` (partial) | Gemini Live | Needs factory |
| TTS | `StreamingTTS` | Gemini Live | YES |
| Audio I/O | `AudioPort` | Browser APIs | YES |

## Data Flow

### Happy path: user speaks an instruction

```
1. Mic → base64 PCM chunks → Voice Relay (Gemini)
2. Gemini VAD detects end-of-speech
3. Gemini calls `converse` tool with transcribed instruction
4. Client sends POST /api/converse (SSE) → Server
5. Server calls Agent SDK query() → Agent subprocess
6. Agent streams: text deltas + tool_use/tool_result blocks
7. Server relays as SSE events → Client
8. Client feeds text to TTS (sentence-buffered)
9. TTS → audio chunks → Speaker
10. On completion: result event with session_id, cost, duration
```

### Interrupt path

```
1. User speaks "stop" / "cancel" during active converse
2. Voice Relay detects keyword (via `voice-approval.ts` listener)
3. Client aborts SSE fetch + interrupts TTS
4. Agent subprocess terminates current query
5. UI shows partial results
```

### Review mode (approval gate)

```
1–3. Same as happy path
4. Instead of executing, client holds for approval
5. Instruction is read back via TTS
6. User says "yes"/"go" (voice) or clicks approve (UI)
7. On approve: execute converse with (possibly edited) instruction
8. On reject: unfreeze Gemini, no agent call
```

## Protocol: Server ↔ Client (SSE)

The SSE protocol is the **stable contract** between server and any client. All events are `data: <json>\n\n`.

| Event | Shape | Meaning |
|-------|-------|---------|
| Text delta | `{text: string}` | Partial assistant text |
| Content block | `{block: {type, ...}}` | Complete tool_use or tool_result |
| Done | `{done: true, session_id, cost_usd, duration_ms}` | Stream complete |
| Error | `{done: true, error: string}` | Stream failed |

A mobile client needs to implement only this SSE consumer (or a WebSocket equivalent) plus the voice/audio stack for its platform.

## What's Hardcoded vs. What's a Choice

**Hardcoded (core to the product):**
- The relay pattern (voice → tool dispatch → agent → TTS → audio)
- SSE streaming from server to client
- Tree-structured conversation history
- The orchestration logic: how tool calls map to converse/stop actions

**Choices (should be swappable):**
- Which agent (Claude, GPT, local LLM)
- Which voice relay (Gemini, OpenAI Realtime, future providers)
- Which TTS (Gemini, ElevenLabs, browser native)
- Which platform (web, iOS, Android)
- Session storage backend (files, database, API)

## File Map

```
src/
  server/                    # Express API server
    cli.ts                   # Entry point, .env, prereqs
    routes.ts                # HTTP endpoints (SSE streaming)
    claude-client.ts         # Agent SDK wrapper (injectable)
  client/                    # Svelte web app
    routes/live/
      gemini.ts              # Voice relay orchestration
      tts-session.ts         # TTS via Gemini Live
      converse.ts            # SSE consumer (ConverseApi impl)
      audio.ts               # Browser mic + speaker
      types.ts               # Port interfaces
      tools.ts               # Tool declarations for voice relay
      voice-approval.ts      # Keyword detection for approve/reject
      buffer.ts              # Sentence buffer for TTS
    lib/
      chat-types.ts          # Shared render types
  shared/                    # Used by both server and client
    types.ts                 # Session entry types, content blocks
    models.ts                # Conversation tree, fork, preview
```
