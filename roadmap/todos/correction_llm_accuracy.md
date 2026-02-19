# LLM Auto-Correction Accuracy

Status: needs work before shipping
Created: 2026-02-19
Related: `plans/002_stt_correction_research.md`

## What exists today

A stateless LLM call that rewrites Gemini's tool-call instruction using
accumulated user corrections as few-shot examples.

```
User speaks → Gemini Live STT → converse({ instruction }) → LLM corrects → approval UI
```

### Key files

| File | What it does |
|------|-------------|
| `vibecoded_apps/claude_talks/src/routes/live/correct.ts` | `correctInstruction(llm, instruction, corrections)` — the LLM call |
| `vibecoded_apps/claude_talks/src/routes/live/gemini.ts:207-226` | Mode branching: `correct` path calls `correctInstruction` then `holdForApproval` |
| `vibecoded_apps/claude_talks/src/routes/live/+page.svelte:28-32` | DI wiring: builds closure over `createLLM` + `corrections.corrections` |
| `vibecoded_apps/claude_talks/src/lib/llm.ts` | `createLLM({ apiKey })` — Gemini text generation abstraction |
| `vibecoded_apps/claude_talks/src/routes/live/stores/corrections.svelte.ts` | Persisted corrections store (`addSTT`, `remove`) |
| `vibecoded_apps/claude_talks/src/routes/live/types.ts:42` | `Correction` type (has `heard`, `meant`, `audioChunks`) |

### Current prompt (correct.ts)

```
Fix speech-to-text errors in this instruction.

Known corrections:
- "what's the latest commit we did?" → "what branch are we in?"

Instruction: "What is the latest commit?"

Return only the corrected text.
```

### Data flow through the system

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌────────────┐
│ User speaks │ ──→ │ Gemini Live  │ ──→ │ correct.ts  │ ──→ │ Approval   │
│ (audio)     │     │ STT + tool   │     │ LLM rewrite │     │ UI         │
└─────────────┘     │ call         │     └─────────────┘     │ Accept/    │
                    │              │           ↑              │ Edit/      │
                    │ instruction: │     corrections[]        │ Reject     │
                    │ "What is the │     from localStorage    └────────────┘
                    │ latest       │                                │
                    │ commit?"     │                          ┌─────▼──────┐
                    └──────────────┘                          │ Claude     │
                                                             │ Code       │
                                                             └────────────┘
```

## Observed problems

### 1. Hallucinated corrections

With stored correction:
  `"what's the latest commit we did?" → "what branch are we in?"`

The LLM receives `"What is the latest commit?"` and rewrites it to
`"What branch are we in?"` — a completely wrong correction.

**Root cause:** the prompt says "fix STT errors" but gives no constraint
to only apply corrections when words actually match. The LLM sees a
superficially similar sentence ("latest commit" appears in both) and
generalizes the example into a semantic rewrite.

**Worse case:** with zero matching patterns, the LLM still rewrites.
It treats the examples as "this user tends to mean X when they say Y"
rather than "these specific words were misheard."

### 2. No way to know if correction is right

The LLM can't hear audio. It only sees text. Two identical-looking
instructions could mean different things depending on what the user
actually said. Without audio context, the LLM is guessing.

### 3. Corrections are sentence-level, not word-level

The stored corrections map full sentences to full sentences:
  `"what's the latest commit we did?" → "what branch are we in?"`

But STT errors are word-level: "commit" → "complete", "suite" → "sweet".
The prompt conflates these — it asks the LLM to fix an instruction using
sentence-level examples, so it pattern-matches on intent not on misheard words.

## What to try next

### A. Word-level corrections instead of sentence-level

Store corrections as word/phrase pairs, not full sentences:
  `"complete" → "commit"`, `"sweet" → "suite"`

Extract these automatically when the user edits an instruction: diff the
original vs edited text, find changed tokens, store only the changed pairs.

The prompt becomes simple pattern matching:
```
Replace misheard words in this instruction using these known STT errors:
- "complete" → "commit"
- "sweet" → "suite"

If no words match, return the instruction unchanged.

Instruction: "What is the latest complete?"
```

This is more constrained and less likely to hallucinate.

### B. Test in isolation first (outside Gemini Live)

Before integrating, test `correctInstruction` as a standalone function
with various inputs. Build a small test harness:

```typescript
// test-correction.ts
const corrections = [
  { heard: 'complete', meant: 'commit' },
  { heard: 'sweet', meant: 'suite' },
];

const cases = [
  { input: 'What is the latest complete?', expected: 'What is the latest commit?' },
  { input: 'Run the test sweet', expected: 'Run the test suite' },
  { input: 'What is a closure?', expected: 'What is a closure?' },  // no change
  { input: 'Tell me the latest complete and the test sweet',
    expected: 'Tell me the latest commit and the test suite' },      // two fixes
];
```

Run each case 3-5 times to measure consistency (LLM output is stochastic).

### C. Audio-aware correction (longer term)

The `Correction` type already stores `audioChunks`. The LLM could receive
audio alongside text to make better decisions. Two approaches:

1. **Gemini multimodal call** — send audio + text prompt to `createLLM`.
   The `llm.ts` abstraction already supports `Part[]` with `inlineData`.
   Prompt: "Listen to this audio. The STT transcribed it as X. Based on
   what you hear, should it be corrected to Y?"

2. **Calibration loop** (from research doc `plans/002_stt_correction_research.md`):
   Feed correction audio via `sendRealtimeInput` at session start, paired
   with text labels. This was proven to work in experiments 8/9 but was
   stripped in Phase 1 because `sendClientContent` with audio was brittle.
   The `sendRealtimeInput` approach is different and did work — could be
   revisited.

### D. Constrained output

Force the LLM to return structured JSON instead of free text:

```typescript
const result = await llm.json<{ corrected: string; changed: boolean }>(
  prompt,
  {
    type: 'object',
    properties: {
      corrected: { type: 'string' },
      changed: { type: 'boolean' },
    },
    required: ['corrected', 'changed'],
  },
);
```

The `changed` field lets us skip unnecessary rewrites and avoids the
"return the instruction unchanged" ambiguity.

## Timing issue (separate but related)

The LLM correction adds ~2 seconds after the tool call arrives.
During this time the user sees a pending tool with no approval buttons.

Measured via E2E (2026-02-19):
- Tool call arrives → LLM correction dispatched: 0ms (synchronous)
- LLM correction round-trip: ~2,087ms (Gemini Flash API)
- During those 2s: Gemini sends outputTranscription, audio, turnComplete

Options:
1. Show a "Correcting..." spinner while the LLM call runs
2. Show the raw instruction immediately, swap in corrected text when ready
3. Accept the 2s delay (it's after Gemini's ~10s processing anyway)

See `gemini.ts:207-226` for the async `.then()` pattern where the delay
originates.

## Test assets

| Asset | Path | Notes |
|-------|------|-------|
| Recording | `vibecoded_apps/claude_talks/public/recordings/what_is_latest_commit.json` | 522 chunks, 16kHz PCM, ~4s |
| Recording | `vibecoded_apps/claude_talks/public/recordings/converse_closure_question.json` | Closure question |
| Test script | `vibecoded_apps/claude_talks/test-audio-correction.mjs` | Standalone Gemini Live test |
| Research log | `plans/002_stt_correction_research.md` | Full experiment history |
