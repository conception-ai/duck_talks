# Sound Design

## Why sound matters here

This is a voice-first interface. The user may not be looking at the screen. Every piece of information that would normally be conveyed visually — loading spinners, error banners, state changes — must have an auditory equivalent or be lost.

Sound is the primary feedback channel. Visual UI is the fallback.

## Core principle: resolve ambiguity

A sound is justified if and only if it resolves an ambiguity that the user cannot resolve otherwise. Three tests:

1. **What ambiguity does it resolve?** If the user would be confused or uncertain without it, it earns its place.
2. **Is silence sufficient?** Silence is a signal too — "done," "nothing happening," "interrupted." Don't add sound where silence already communicates.
3. **Does it survive repetition?** The user will hear this sound hundreds of times. If it demands attention or carries emotional weight, it will become irritating. Neutral > pleasant > dramatic.

Every candidate sound that fails any of these tests is excluded. The vocabulary should be as small as possible and no smaller.

## Design constraints

### Whitelist, not blacklist

The previous architecture let Gemini speak by default and tried to suppress unwanted speech. This is a blacklist — block what you don't want and hope you caught everything. It leaked constantly.

The new architecture blocks all Gemini audio by default. Sound only passes through an explicit gate. This is a whitelist — only allow what you specifically intend. Leaks are structurally impossible.

This principle applies beyond the audio gate. Every sound in the system should be an intentional, programmatic decision. No sound should be a side effect of a language model's behavior.

### Functional, not decorative

Each sound maps to exactly one system state transition. No sound exists for aesthetics, branding, or "polish." If you can't name the state transition a sound represents, it doesn't belong.

### Neutral over expressive

Productivity tool, not a game. Sounds should be:
- **Short** — under 200ms for events, looping for states
- **Soft** — low amplitude, won't startle
- **Timbrally simple** — sine waves and filtered noise, not chords or melodies
- **Pitch-coded** — rising = positive/ready, falling = negative/stopped, flat = neutral/ongoing

Emotional neutrality is a feature. The tap that says "heard you" should feel the same whether the user just asked to delete a database or rename a variable.

### The gap problem

The critical UX challenge is dead air. The timeline of a single exchange:

```
User speaks ──── 0s
VAD silence ──── +0.2s
Gemini routes ── +0.5-1.5s
Claude TTFT ──── +2-10s
Claude streams ─ +N seconds
Done ─────────── silence
```

Between speech end and Claude's voice, there can be 3-12 seconds of silence. In a voice-first interface, ambiguous silence is the worst possible signal. Each gap needs exactly one sound to fill it — no more.

## The vocabulary

Five sounds. Each resolves one gap in the auditory experience.

### Taxonomy

Sounds fall into two categories:

**Events** — punctual, fire-and-forget. Mark a discrete state transition.
- Tap, Error, Ready, Stopped

**States** — continuous, looping. Indicate an ongoing condition.
- Pulse (thinking)

The only voice in the system is Gemini TTS reading Claude's text. It is not "our" sound — it's the content delivery mechanism. We control when it's allowed through (the gate), but we don't design it.

### What's excluded and why

| Candidate | Why excluded |
|-----------|-------------|
| Approval prompt | User chose review mode — they're already watching. Visual UI suffices. |
| Interrupt ack | Audio stopping IS the feedback. Sound on silence is redundant. |
| "Done" chime | Silence after voice = done. Adding a chime adds no information. |
| Per-chunk ticks | Voice is continuous. Ticks during speech are noise. |
| Gemini verbal ack | The entire point of muting. Replaced by tap. |

The exclusion list is as important as the inclusion list. Every sound you don't add is cognitive load you don't impose.

---

## Sound specifications

### 1. TAP

**State transition**: tool call received (user intent captured, routing to Claude)

**Resolves**: the 0.5-1.5s gap between speech end and system acknowledgment. Without it, the user doesn't know if the system heard them.

**Character**: damped sine dropping 700→400Hz over 80ms. 3ms soft attack. Sounds like tapping a wooden block — neutral, percussive, no emotional valence.

**File**: `public/sounds/tap.wav` (7KB)

**Timing**: plays immediately on `converse` tool call, before any async work begins.

### 2. PULSE

**State transition**: Claude is processing (TTFT gap)

**Resolves**: the 2-10s gap between tap and Claude's voice. Without it, silence after a tap feels like the system crashed.

**Character**: 80Hz sine with gentle amplitude wobble (swell and fade, 1 cycle/sec). Very soft — present enough to say "alive," quiet enough to disappear when voice starts. Audio equivalent of a loading spinner.

**File**: `public/sounds/pulse.wav` (265KB, 3s demo — loops in production)

**Timing**: starts immediately after tap. Hard-stops (no fade) the instant the first Claude SSE chunk arrives. The voice beginning IS the resolution — any transition sound would delay it.

### 3. ERROR

**State transition**: Claude request failed, connection dropped, timeout

**Resolves**: without it, the pulse either plays forever or stops silently. Both are worse than explicit failure notification.

**Character**: two soft sine tones at 420Hz then 320Hz, each ~150ms with smooth rise-fall envelope. Clearly "something went wrong" without being alarming.

**File**: `public/sounds/error.wav` (31KB)

**Timing**: plays when error is detected. Replaces both the pulse (if active) and any expected voice.

### 4a. READY

**State transition**: Gemini connection established, mic is live

**Resolves**: confirms the async connection succeeded and the user can start speaking. Without it, the user taps the mic orb and waits in uncertainty.

**Character**: sine sweep 350→550Hz over 200ms with smooth bell envelope. Rising = positive, ready, open.

**File**: `public/sounds/ready.wav` (18KB)

### 4b. STOPPED

**State transition**: session ended

**Resolves**: confirms the session actually closed (especially important if the user tapped stop while Claude was speaking).

**Character**: sine sweep 550→350Hz over 200ms. Mirror of ready. Falling = closed, done.

**File**: `public/sounds/stopped.wav` (18KB)

---

## Flow integration

### Normal exchange (direct mode)

```
User speaks ─────────────────── (real world)
VAD silence ─────────────────── (silence, ~200ms)
Tool call ───────────────────── TAP
Claude TTFT ─────────────────── PULSE ... PULSE ... PULSE
First chunk ─────────────────── voice begins (pulse hard-stops)
Streaming ───────────────────── voice continues
Done ────────────────────────── silence (= done)
```

### Error during processing

```
Tool call ───────────────────── TAP
Claude TTFT ─────────────────── PULSE ... PULSE
Error ───────────────────────── ERROR (pulse stops)
```

### User interrupts Claude

```
Claude streaming ────────────── voice playing
User speaks ─────────────────── voice stops instantly (= interrupt ack)
```

### Session lifecycle

```
User taps mic orb ───────────── (visual: connecting state)
Connection established ──────── READY
... conversation ...
User taps stop ──────────────── STOPPED
```

### Review/correct mode

```
Tool call ───────────────────── TAP
Approval wait ───────────────── PULSE ... (system is MUTED, awaiting user)
User approves ───────────────── (pulse continues — now waiting for Claude)
First chunk ─────────────────── voice begins (pulse hard-stops)
```

Note: no distinct sound for "awaiting approval." The pulse already communicates "system is working." From the user's perspective, the wait is continuous — they don't need to distinguish "waiting for approval UI" from "waiting for Claude." The visual approval buttons handle that distinction.
