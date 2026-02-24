# Gemini Live API — Feature Map & Leverage Analysis

## Context

Claude Talks uses Gemini Live as a voice-to-code bridge: user speaks → Gemini STT + routing → `converse` tool → Claude Code SDK → response → ephemeral TTS session → audio to user. The question is: what Gemini Live features exist, what are we using, and what could we leverage more?

---

## 1. Full Feature Map (from SDK docs)

| # | Feature | Description |
|---|---------|-------------|
| **Connection** | | |
| 1 | WebSocket bidi | Persistent low-latency connection via `ai.live.connect()` |
| 2 | Ephemeral tokens | Client-side auth without exposing API keys |
| **Input** | | |
| 3 | `sendRealtimeInput` (audio) | Raw PCM stream, subject to VAD, best-effort ordering |
| 4 | `sendClientContent` (text/audio) | Structured context injection, deterministic ordering, no VAD |
| 5 | Video frames | Live video streaming (camera/screen) |
| 6 | Incremental content updates | Prefill conversation history turn-by-turn |
| **Output** | | |
| 7 | AUDIO modality | Native speech generation |
| 8 | TEXT modality | Text responses |
| 9 | _(one modality per session)_ | Can't mix audio + text output |
| **VAD** | | |
| 10 | Automatic VAD | Default — detects speech start/stop automatically |
| 11 | VAD tuning | `startOfSpeechSensitivity`, `endOfSpeechSensitivity`, `prefixPaddingMs`, `silenceDurationMs` |
| 12 | Manual VAD | Disable auto, send `activityStart`/`activityEnd` manually |
| 13 | `audioStreamEnd` | Signal pause > 1s to flush buffered audio |
| 14 | Interruption | `serverContent.interrupted` flag when user cuts in |
| **Transcription** | | |
| 15 | Input transcription | User's speech → text (separate ASR pipeline, not model context) |
| 16 | Output transcription | Model's speech → text |
| **Voice & Language** | | |
| 17 | Voice selection | `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName` (e.g. "Kore") |
| 18 | 70+ languages | Auto-detect, or restrict via system instructions |
| **Native Audio** | | |
| 19 | Affective dialog | Adapts tone/emotion to user's expression (v1alpha) |
| 20 | Proactive audio | Model decides when NOT to respond (v1alpha) |
| 21 | Thinking | `thinkingConfig.thinkingBudget` — reason before speaking |
| 22 | Thought summaries | `includeThoughts: true` |
| **Tools** | | |
| 23 | Function calling | Declare functions, receive `toolCall`, send `sendToolResponse` |
| 24 | Async functions | `behavior: "NON_BLOCKING"` — model continues while function runs |
| 25 | Response scheduling | `scheduling: "INTERRUPT" | "WHEN_IDLE" | "SILENT"` for async responses |
| 26 | Google Search | Grounding with `{ googleSearch: {} }` |
| 27 | Multiple tools | Combine function calling + search in one session |
| **Session Management** | | |
| 28 | Context window compression | `slidingWindow` — enables unlimited session duration |
| 29 | Session resumption | `sessionResumption.handle` — survive WebSocket drops, 2hr validity |
| 30 | GoAway message | Advance warning before server disconnect, includes `timeLeft` |
| 31 | Generation complete | `generationComplete` signal |
| **Observability** | | |
| 32 | Token count | `usageMetadata.totalTokenCount` + per-modality breakdown |
| 33 | Media resolution | `mediaResolution` config for input quality |

---

## 2. Current Usage Map

### Using (9 features)

| Feature | Where | How |
|---------|-------|-----|
| WebSocket bidi | `gemini.ts:262` | `ai.live.connect()` |
| `sendRealtimeInput` | `data.svelte.ts:269` | Mic PCM → Gemini |
| `sendClientContent` | `gemini.ts:252` | Nudge messages only |
| AUDIO modality | `gemini.ts:265` | Main session config (but output IGNORED) |
| Automatic VAD | default | Not explicitly configured |
| Input transcription | `gemini.ts:268` | `inputAudioTranscription: {}` — user STT |
| Output transcription | `tts-session.ts:61` | TTS session only — logging |
| Function calling | `tools.ts` | Single `converse` tool (BLOCKING) |
| Interruption | `gemini.ts:223` | `sc.interrupted` clears queues |

### Not Using (24 features)

| Feature | Impact | Effort |
|---------|--------|--------|
| **Session resumption** | High — sessions die on disconnect, no recovery | Medium |
| **Context window compression** | High — hard 15min limit, then dead | Low |
| **GoAway message** | Medium — no graceful reconnect | Low |
| **VAD tuning** | Medium — false cuts, ambient triggers | Low |
| **Voice selection** | Low — UX polish | Low |
| **Async function calling** | High — architectural unlock (see below) | High |
| **Response scheduling** | High — tied to async functions | High |
| **Affective dialog** | Medium — natural TTS tone | Low |
| **Thinking** | Low — Gemini is just a relay | Low |
| **Google Search** | Low — not aligned with current product vision | Medium |
| **Token count** | Low — observability | Low |
| **Incremental content updates** | Medium — could prefill CC history as context | Medium |
| **Video input** | Low — audio-only use case today | High |
| **Generation complete** | Low — informational | Low |
| **Manual VAD** | Low — auto is fine for now | Medium |
| Ephemeral tokens | N/A — server-side app | - |
| TEXT modality | N/A — we want audio | - |
| Media resolution | N/A — no video | - |

---

## 3. First Principles Analysis

### The Current Architecture

```
User → Mic → [Main Gemini Live] → "converse" tool call → Claude Code SDK
                  ↑ STT only                                     ↓
                  (audio output IGNORED)                   text stream
                                                                 ↓
User ← Speaker ← [TTS Gemini Live] ← sentence buffer ← Claude chunks
                  (ephemeral, 1 per call)
```

**The core design choice**: Gemini is a dumb relay. System prompt says "NEVER answer yourself." We use its ears (STT) and separately rent its mouth (TTS), but we deliberately suppress its brain.

**Why this works**: Clean separation. Claude owns intelligence, Gemini owns audio I/O. No context contamination — tool response is always `{ result: "done" }`, so Claude's full responses never enter Gemini's context window.

**Why this has limits**:
- BLOCKING tool = Gemini is frozen during Claude's response (5-30s)
- User can't speak while Claude responds (mic gated or buffered)
- Two WebSocket connections per converse call (cost, complexity)
- Hard 15min session limit (no compression/resumption)
- No graceful disconnect recovery

### The Three Tiers of Opportunity

#### Tier 1: Reliability (low effort, high impact)

**Session resilience** — 3 config additions that eliminate session death:

```ts
config: {
  // ... existing
  contextWindowCompression: { slidingWindow: {} },        // unlimited duration
  sessionResumption: { handle: previousHandle ?? null },  // survive reconnects
}
// + handle goAway and sessionResumptionUpdate messages
```

This is the single highest-ROI change. Today, a Gemini crash (which happens regularly with preview models) kills the entire session. With resumption, we'd reconnect transparently.

**VAD tuning** — reduce false triggers:

```ts
realtimeInputConfig: {
  automaticActivityDetection: {
    endOfSpeechSensitivity: "END_SENSITIVITY_LOW",   // wait longer before cutting
    silenceDurationMs: 500,                            // allow pauses
  }
}
```

#### Tier 2: UX Polish (low effort, medium impact)

- **Voice selection** — expose `speechConfig.voiceConfig` in Settings modal for TTS session
- **Token count tracking** — log `usageMetadata` for cost awareness
- **Affective dialog** on TTS session — Claude's responses read with natural emotion
- **Generation complete** — know exactly when response is fully done (vs. relying on `turnComplete`)

#### Tier 3: Architectural Shift (high effort, high impact)

**NON_BLOCKING converse + single session**: The biggest unlock. Instead of two sessions:

```
User → Mic → [Single Gemini Live] → converse(NON_BLOCKING) → Claude Code SDK
                  ↕                                                  ↓
User ← Speaker ←  ↑  ← FunctionResponse(scheduling: INTERRUPT) ← response
```

How it works:
1. `converse` declared with `behavior: "NON_BLOCKING"`
2. Gemini calls it, but does NOT freeze — user can keep talking
3. Claude streams response. When done, send `FunctionResponse` with the response text and `scheduling: "INTERRUPT"`
4. Gemini speaks the response using its own audio output
5. User can interrupt naturally (VAD handles it)

**What this enables**:
- No second WebSocket (simpler, cheaper)
- User can speak while Claude thinks ("actually, cancel that" / "also do X")
- Natural interruption (just talk, Gemini's VAD handles it)
- Affective dialog works on the response (Gemini reads with emotion)
- One session = one context = compression/resumption works for everything

**What this risks**:
- Claude's full responses enter Gemini's context window (context contamination)
- Gemini might add commentary or modify Claude's response
- `scheduling: "INTERRUPT"` may cut off user mid-sentence
- More complex state management (user can talk during Claude's response)

**Mitigation**: Context window compression keeps context bounded. Strong system prompt. `scheduling: "WHEN_IDLE"` instead of INTERRUPT for non-urgent responses.

---

## 4. Server Feedback Lifecycle — What Gemini Sends (Connection to Close)

### Phase 1: Connection

| Event | Source | What it carries | We log? |
|-------|--------|-----------------|---------|
| `onopen` | callback | Connection established | **Yes** — `gemini.ts:272` logs `"connected"` |
| _(connect latency)_ | measurable | Time from `ai.live.connect()` call to `onopen` | **No** — we set `t0` at function start but don't measure the gap to `onopen` specifically |

### Phase 2: User Speaking (audio streaming in)

| Event | Source | What it carries | We log? |
|-------|--------|-----------------|---------|
| `serverContent.inputTranscription.text` | `onmessage` | User's speech transcribed (from separate ASR pipeline, not model context) | **Yes** — `gemini.ts:233-241` logs `[user] <text>` |
| _(VAD speech-start)_ | internal | No explicit client-facing event — VAD runs server-side | **N/A** — invisible to us |
| _(audio chunk sends)_ | client-side | Each `sendRealtimeInput` call with PCM data | **No** — `data.svelte.ts:269` sends silently, no count/byte tracking |

### Phase 3: Model Processing & Response

| Event | Source | What it carries | We log? |
|-------|--------|-----------------|---------|
| `serverContent.modelTurn.parts[].inlineData.data` | `onmessage` | Audio output (base64 PCM bytes) | **Silently dropped** in main session (`gemini.ts:244` comment: "Main session audio output is ignored"). **Played** in TTS session (`tts-session.ts:70-76`) |
| `serverContent.modelTurn.parts[].text` | `onmessage` | Text output (when TEXT modality) | **Not handled** — we use AUDIO modality |
| `serverContent.modelTurn.parts[].executableCode.code` | `onmessage` | Code the model wants to execute (Google Search generates this) | **Not handled** |
| `serverContent.modelTurn.parts[].codeExecutionResult.output` | `onmessage` | Result of executed code | **Not handled** |
| `serverContent.outputTranscription.text` | `onmessage` | Transcription of model's own speech | **Now configured** on main session. **Yes** in TTS session — `tts-session.ts:80-81` logs `→ <text>` |
| `serverContent.interrupted` | `onmessage` | User interrupted model mid-generation. Ongoing generation is canceled/discarded | **Yes** — `gemini.ts:224-229` logs `"interrupted"` |
| `serverContent.turnComplete` | `onmessage` | Model finished its turn | **Yes** — `gemini.ts:246-247` logs `"done"` |
| `serverContent.generationComplete` | `onmessage` | Model finished generating (distinct from turnComplete — generation can complete before all audio is delivered) | **Now logged** |

### Phase 4: Tool Calls

| Event | Source | What it carries | We log? |
|-------|--------|-----------------|---------|
| `toolCall.functionCalls[]` | `onmessage` | Array of `{ id, name, args }` — model wants to invoke functions | **Yes** — `gemini.ts:94` logs tool name + args |
| _(tool response sent)_ | client-side | `sendToolResponse` with function responses | **Partially** — `gemini.ts:210` logs result for non-converse tools. Converse tool response (`{ result: "done" }`) is not explicitly logged |

### Phase 5: Session Metadata (periodic)

| Event | Source | What it carries | We log? |
|-------|--------|-----------------|---------|
| `usageMetadata.totalTokenCount` | `onmessage` | Total tokens consumed so far | **Now logged** |
| `usageMetadata.responseTokensDetails[]` | `onmessage` | Per-modality token breakdown (`{ modality, tokenCount }`) | **Now logged** |
| `sessionResumptionUpdate.resumable` | `onmessage` | Whether current session can be resumed | **Not handled** (not configured) |
| `sessionResumptionUpdate.newHandle` | `onmessage` | Token to resume this session later (2hr validity) | **Not handled** (not configured) |

### Phase 6: Disconnect

| Event | Source | What it carries | We log? |
|-------|--------|-----------------|---------|
| `goAway.timeLeft` | `onmessage` | Server warning: "I'm about to disconnect you in X time" | **Now logged** |
| `onerror` | callback | `ErrorEvent` with `.message` | **Yes** — `gemini.ts:277-278` logs + pushes error toast |
| `onclose` | callback | `CloseEvent` with `.code` and `.reason` | **Yes** — `gemini.ts:280-289` logs reason, shows toast if unexpected |

---

## 5. Recommended Priority

1. **Session resilience** (compression + resumption + GoAway) — eliminates the #1 reliability issue
2. **VAD tuning** — reduces false cuts, immediate UX improvement
3. **Voice selection** — simple settings addition
4. **Affective dialog on TTS** — one config line, natural-sounding output
5. **Token tracking** — observability
6. **NON_BLOCKING architecture** — evaluate as a separate exploration (prototype first)
