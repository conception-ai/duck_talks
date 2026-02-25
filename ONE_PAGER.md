# reduck — Voice Interface for Claude Code

## What it is

A voice-first chat interface that wraps Claude Code. You talk, it codes. The conversation is displayed as a standard chat UI (messages, tool calls, markdown), but the primary input is your voice.

**Stack:** Svelte 5 frontend + FastAPI backend + Claude Code Agent SDK + Gemini Live API for real-time voice.

## How it works

```
You speak → Gemini Live (STT + intent routing) → Claude Code (coding agent) → Gemini TTS (reads response aloud)
```

Gemini Live acts as a **transparent relay** — it listens to the user via WebSocket, transcribes speech, and calls a `converse` tool that forwards the instruction to Claude Code. Claude's streamed response is spoken aloud via a persistent TTS session (a second Gemini connection) and displayed in the chat UI simultaneously.

The backend is a thin FastAPI server that wraps the Claude Code Agent SDK and streams responses as SSE. Session state lives in Claude Code's native JSONL files — no separate database. You can resume, rewind (fork), and browse past sessions.

## Why

Claude Code is powerful but keyboard-bound. This makes it **ambient** — you can talk to your coding agent while looking at your editor, whiteboarding, or pacing. The chat UI is there when you want to read, but voice is the default.

It's also a **generic architecture**: Gemini handles real-time voice I/O (VAD, STT, interruption), Claude handles the actual work. The relay pattern means you get Gemini's low-latency voice pipeline without giving up Claude's coding ability. Swap Claude Code for any other backend and you have a voice-first interface for anything.

## Key design decisions

- **Two-agent split**: Gemini = ears and mouth. Claude = brain. Neither does the other's job.
- **Persistent TTS session**: One Gemini connection stays open for TTS across multiple converse calls. ~1.5s latency from text to first audio. Sentence-boundary buffering for natural speech.
- **Review mode**: Optional approval step — hear the instruction read back, say "accept"/"reject"/edit before it goes to Claude. Voice approval via browser `webkitSpeechRecognition`.
- **Fork-based rewind**: To "go back" in conversation, we create a new JSONL with only the path up to that message and resume from there. Claude Code's native session format, no custom persistence.
- **System prompt for voice**: Claude is told its output will be spoken aloud — keep it brief, conversational, no markdown formatting.

## Current state

Working end-to-end. Active roadmap items:
- **Stream tool calls**: Show what Claude is doing (reading files, searching) in real-time instead of blank gaps
- **Audio-aware STT correction**: Use recorded audio + LLM to fix Gemini's transcription errors (e.g. "commit" → "complete")
- **Mute Gemini voice**: Drop Gemini's own audio entirely, only let Claude's TTS through — whitelist instead of blacklist

## Repo structure

```
reduck/              — Python backend (FastAPI + Claude Code Agent SDK)
vibecoded_apps/
  claude_talks/      — Svelte 5 frontend
    src/routes/
      home/          — Session list
      live/          — Main voice interface (Gemini + Claude + TTS)
      recordings/    — Utterance replay browser
```
