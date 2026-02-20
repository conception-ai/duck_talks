# Iterative Prompt Optimization for Voice Agents

How to systematically improve a system prompt when an LLM's output is consumed by voice (TTS), not text.

## Why voice is different

A paragraph that takes 2 seconds to read takes 15 seconds to listen to. The user can't skim, can't scroll back, can't cmd-F. Verbosity is 7x more expensive in voice than in text. This changes what "good output" means — brevity is not a style preference, it's a usability constraint.

## The core insight

Most prompts address **formatting** (no markdown, use contractions, be natural) but not **information volume**. Telling an LLM "talk naturally" produces natural-sounding walls of text. The fix is to constrain *how much* to say, not just *how* to say it.

Three layers of the problem:
1. **No length constraint** — the prompt never says "2-3 sentences"
2. **No progressive disclosure signal** — the model doesn't know to stop and let the user pull more
3. **No medium awareness** — the model doesn't understand the cost of verbosity in audio

## Method: Replay-based A/B testing

### Setup

You need:
- A backend that accepts a system prompt as a parameter (not hardcoded)
- A way to replay the same conversation turns against different prompts
- Session continuity (same session ID across turns) so context builds naturally

### The loop

1. **Pick a representative conversation.** 3-5 turns that cover the behaviors you care about: a simple question, a multi-part answer, a "tell me more" follow-up. Real conversations from production are best — they expose failure modes you wouldn't script.

2. **Run the baseline.** Send the conversation turns with the current prompt. Save every response with its character count. This is your control.

3. **Hypothesize.** Don't just tweak words. Identify the *category* of problem:
   - Too long? → Add a length constraint with a number ("2-3 sentences")
   - Unnecessary preamble? → Add "skip filler phrases" with concrete anti-examples
   - No invitation to go deeper? → Add "end with a hook"
   - Missing information? → Loosen a constraint or add a carve-out

4. **Replay with the new prompt.** Same turns, fresh session. Compare character counts AND content quality. A shorter response that drops critical information is worse, not better.

5. **Analyze per-turn.** Don't just look at averages. Each turn type (simple question, enumeration, elaboration) may need different treatment. A prompt that nails turn 1 might still fail on turn 3.

6. **Iterate.** Usually 2-3 rounds is enough. Diminishing returns after that — at some point you're overfitting to your test conversation.

### What to measure

- **Character count per turn.** The primary signal. Voice output should be dramatically shorter than text output — 60-90% reduction is typical and correct.
- **Information completeness.** Did the model answer what was asked? Brevity that drops the answer is a regression.
- **Progressive disclosure hooks.** Does the response end with a way for the user to go deeper? ("Want details?" / "Should I dig in?") These are load-bearing — without them, brevity feels like the model is withholding.
- **Filler ratio.** How many words are "let me check" / "I'll look into that" / "great question" vs. actual content? In voice, every filler phrase is stolen attention.

## What we learned

### Rules that worked (high impact)

**Hard length cap with a number.** "2-3 sentences by default. Maximum 5 even when asked to elaborate." Vague instructions like "be concise" do almost nothing. A concrete number works.

**"Skip filler phrases" with anti-examples.** Telling the model *not* to say "let me check that for you" or "let me read the file" eliminated 20-30% of wasted output. The anti-examples are key — without them, the model doesn't know what counts as filler.

**"End with a hook."** This is the progressive disclosure mechanism. "Want the implementation details?" or "Should I dig into any of those?" turns a dead-end answer into a conversation. Without this rule, concise answers feel abrupt.

### Rules that didn't matter much

**"Talk like a coworker"** — the model already does this naturally. Including it doesn't hurt but it's not the lever.

**Formatting rules** (no markdown, no bullets) — necessary but not sufficient. The model can produce perfectly formatted walls of text.

### The progressive disclosure mental model

Think of it as a CEO briefing. The assistant gives the minimum decision-quality information, then waits. The user steers: "tell me more," "what about X," "skip to the action items." The model calibrates depth to the question.

Concretely this means:
- "List the todos" → count + one-line summary + "which one interests you?"
- "Tell me more about X" → the what + the why + what's left to do + "want implementation details?"
- "Give me everything" → now you can go deep

Each "tell me more" should go exactly one level deeper, not dump everything remaining.

### Counterfactual: what if we'd only changed formatting?

The original prompt already said "no markdown, use contractions, be natural." Responses were 1,900-3,500 characters — full specs read aloud. Formatting rules alone reduce character count by maybe 10-15% (removing markdown syntax). The length constraint + progressive disclosure rules produced 60-90% reduction. The leverage is overwhelmingly in information dosing, not formatting.

## Prompt template (starting point for future iterations)

```
Your output will be spoken aloud through text-to-speech. You are having a live voice conversation.

BREVITY IS EVERYTHING. The user is LISTENING, not reading. Every extra sentence costs 5-10 seconds of their attention.

How to answer:
- 2-3 sentences by default. Maximum 5 even when asked to elaborate.
- Give the minimum needed to be useful, then stop.
- If there are multiple items, give the count and a one-line overview. Let the user pick what to expand.
- When asked "tell me more", go ONE level deeper. Not everything. End with a hook so the user can pull more.
- Never dump a full spec or plan unless the user explicitly asks for exhaustive detail.

How to talk:
- Short sentences. Contractions. Skip filler phrases — don't narrate actions, just give results.
- No markdown. No bullets. No code fences. Everything is plain speech.
- Say code references naturally. Spell out symbols.
```

## Reproducing the experiment

Pick any 3-turn conversation. Send each turn to the LLM backend with the system prompt as a parameter, reusing the session ID across turns. Compare response lengths and quality. The test script pattern:

```
for each prompt variant:
    session_id = null
    for each turn in conversation:
        response, session_id = call_backend(turn, system_prompt, session_id)
        record(response, len(response))
    compare with previous variant
```

No special tooling needed — a curl loop or a short Python script works. The key is same turns, fresh session, controlled comparison.
