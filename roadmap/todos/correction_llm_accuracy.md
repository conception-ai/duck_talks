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

### A. Audio-aware correction (primary approach)

The `Correction` type already stores `audioChunks` (PCM 16kHz). We have
the raw audio of what the user said. Send it to the LLM alongside the
text so it can actually hear the user and make an informed decision.

**Why this is the right approach:** the core problem is the LLM is
guessing based on text alone. It can't distinguish "the STT was wrong"
from "the user said something different." With audio, the LLM can
listen to what the user actually said and compare it to the transcription.

**Implementation — Gemini multimodal call:**

`llm.ts` already supports `Part[]` with `inlineData` via the `Message`
type. The `Input` type accepts `string | Message[]`. So `correct.ts`
can send audio directly:

```typescript
import { combineChunks } from '../../lib/stt';  // already exists, combines PCM chunks

async function correctInstruction(
  llm: LLM, instruction: string, audioChunks: RecordedChunk[], corrections: Correction[],
): Promise<string> {
  const audio = combineChunks(audioChunks);  // base64 PCM

  const result = await llm([{
    role: 'user',
    content: [
      { inlineData: { data: audio, mimeType: 'audio/pcm;rate=16000' } },
      { text: `The speech-to-text system transcribed this audio as:
"${instruction}"

Known transcription errors for this user:
${corrections.map(c => `- "${c.heard}" was actually "${c.meant}"`).join('\n')}

Listen to the audio. If the transcription has errors that match
the known patterns, return the corrected text. If the transcription
is accurate, return it unchanged.

Return only the final text, nothing else.` },
    ],
  }]);

  return result.trim() || instruction;
}
```

**Key change:** the function signature gains `audioChunks` parameter.
The audio is the `pendingApproval.audioChunks` captured by
`snapshotUtterance()` in `gemini.ts:135` before `commitTurn()` clears
the buffer.

**What needs to change:**

| File | Change |
|------|--------|
| `correct.ts` | Add `audioChunks` param, build multimodal `Message[]` |
| `gemini.ts:210` | Pass `audioChunks` to `correctInstruction` |
| `+page.svelte:28-32` | Update DI closure to forward audio chunks |
| `types.ts` (DataStoreMethods) | No change — `snapshotUtterance` already returns chunks |

**Wiring in gemini.ts (line 210):**

Currently:
```typescript
deps.correctInstruction(instruction).then(...)
```

Becomes:
```typescript
deps.correctInstruction(instruction, audioChunks).then(...)
```

The `audioChunks` are already available in scope — captured at line 135.

### B. Test in isolation first (before integrating)

Build a standalone test script that calls the multimodal correction
function with known recordings + known corrections. No Gemini Live needed.

```typescript
// test-correction.ts — run with: npx tsx test-correction.ts
import { createLLM } from './src/lib/llm';
import { correctInstruction } from './src/routes/live/correct';

const llm = createLLM({ apiKey: process.env.GEMINI_API_KEY! });

// Load a recording's audio chunks
const recording = JSON.parse(fs.readFileSync(
  'public/recordings/what_is_latest_commit.json', 'utf-8'
));

const corrections = [
  { type: 'stt', heard: 'complete', meant: 'commit', audioChunks: [] },
];

const cases = [
  // STT got it wrong — correction should apply
  { instruction: 'What is the latest complete?', expected: 'What is the latest commit?' },
  // STT got it right — should be unchanged
  { instruction: 'What is the latest commit?', expected: 'What is the latest commit?' },
  // Unrelated instruction — should be unchanged
  { instruction: 'What is a closure?', expected: 'What is a closure?' },
];

for (const c of cases) {
  const result = await correctInstruction(llm, c.instruction, recording.chunks, corrections);
  const pass = result === c.expected;
  console.log(`${pass ? 'PASS' : 'FAIL'} "${c.instruction}" → "${result}" (expected "${c.expected}")`);
}
```

Run each case 3-5 times to measure consistency (LLM output is stochastic).

**Key insight:** test with audio AND without audio. The audio is what
gives the LLM ground truth. Without audio, compare to text-only baseline
to quantify the improvement.

### C. Constrained output (combine with A)

Force structured JSON to avoid ambiguity:

```typescript
const result = await llm.json<{ corrected: string; changed: boolean }>(
  messages,
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

The `changed` field eliminates the "return unchanged" ambiguity.

### D. Word-level corrections (optional refinement)

Extract word/phrase diffs from sentence-level corrections automatically.
`"What is the latest complete?" → "What is the latest commit?"` becomes
`"complete" → "commit"`. More constrained examples = less hallucination.

Could be a post-processing step in `corrections.svelte.ts:addSTT()` or
computed on-the-fly in `correct.ts`.

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
