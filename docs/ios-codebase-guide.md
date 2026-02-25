# Reduck iOS — Codebase Guide

How the iOS app is structured, what each file does, and how they connect. Assumes you know the Svelte version.

## How it all fits together

```
User opens app
    → ReduckApp.swift creates SettingsStore, wraps everything in NavigationStack
    → SessionListView loads — fetches GET /api/sessions from Express backend
    → User taps a session → navigates to LiveView(sessionId: "abc-123")
    → LiveView fetches GET /api/sessions/abc-123/messages → renders chat bubbles
    → (Phase 2+) User taps mic → Gemini Live WebSocket opens, voice loop starts
```

The iOS app is a **thin client** — all Claude Code logic stays on the Express backend running on your Mac. The app just does UI + voice + HTTP.

## File-by-file walkthrough

### `ReduckApp.swift` — Entry point

```
Svelte equivalent: App.svelte (router setup)
```

Creates the `SettingsStore` and injects it into the view tree via `.environment()`. Any child view can pull it out with `@Environment(SettingsStore.self)` — no prop drilling.

`NavigationStack` is the iOS equivalent of `svelte-spa-router`. Instead of `push('/live/abc')`, views use `NavigationLink(value: "abc")` and the stack handles the transition with native iOS animations.

### `Models/ContentBlock.swift` — The content block union

```
Svelte equivalent: src/shared/types.ts → ContentBlock type
```

This is the most complex file. The Express API returns JSON like:
```json
{"type": "text", "text": "hello"}
{"type": "tool_use", "id": "123", "name": "Read", "input": {...}}
{"type": "tool_result", "tool_use_id": "123", "content": "file contents..."}
```

In TypeScript, this is a union type discriminated by `type`. In Swift, it's an `enum` where each case carries its own data shape:

```swift
enum ContentBlock {
    case text(String)                    // just the text
    case toolUse(id, name, input)        // tool call details
    case toolResult(toolUseId, content)  // result of a tool call
    case thinking(thinking, signature)   // extended thinking block
    case image(mediaType, data)          // base64 image
}
```

The long `init(from decoder:)` method is the custom JSON parser — it reads `"type"` first, then decodes the right fields for that case. Same role as a Pydantic `model_validator`.

`JSONValue` enum at the bottom handles arbitrary JSON values in tool inputs (since `Any` isn't allowed in strict Swift).

### `Models/Message.swift` — Chat message

```
Svelte equivalent: src/client/lib/chat-types.ts → Message interface
```

A message has a `role` (user/assistant) and `content` that's either a plain string (user messages) or an array of `ContentBlock` (assistant messages with text + tool uses + thinking).

The custom `Codable` handles this: tries to decode `content` as a string first, falls back to `[ContentBlock]`. This matches the backend's dual format — `GET /api/sessions/:id/messages` returns user content as strings and assistant content as block arrays.

The `static func user("hello")` and `static func assistant(text: "response")` are factory methods for creating messages in code (used later when building messages from SSE streams).

### `Models/SessionInfo.swift` — Session list item

```
Svelte equivalent: SessionInfo interface in home/+page.svelte
```

Tiny struct — just `id`, `name`, `summary`, `updatedAt`. Decoded from `GET /api/sessions`. The `CodingKeys` enum maps `updated_at` (JSON) → `updatedAt` (Swift).

### `Models/LiveTypes.swift` — Voice session state

```
Svelte equivalent: src/client/lib/chat-types.ts → Status, PendingTool, PendingApproval, etc.
```

All the types needed for the live voice session:
- `Status` — `idle | connecting | connected` (drives UI: show mic button vs waveform vs "connecting...")
- `InteractionMode` — `direct | review` (auto-execute vs approval gate)
- `PendingTool` — tracks an in-flight Claude tool call (name, streaming text, accumulated blocks)
- `PendingApproval` — holds the instruction text while waiting for user accept/reject
- `VoiceEvent` — ephemeral speech log entry (user said X, Gemini error Y)

### `Stores/SettingsStore.swift` — User preferences

```
Svelte equivalent: src/client/routes/live/stores/ui.svelte.ts
```

`@Observable` class — any SwiftUI view reading a property automatically re-renders when it changes. Same as Svelte's `$state()` but at the class level.

Each property has `didSet { persist() }` — every change auto-saves to `UserDefaults` (iOS's `localStorage`). Load on init, save on every mutation.

Key difference from Svelte version: includes `serverURL` (default `http://localhost:8000`) since the iOS app connects over the network instead of same-origin.

### `Views/SessionListView.swift` — Home page

```
Svelte equivalent: src/client/routes/home/+page.svelte
```

Three states: loading spinner, error view, or session list. Direct mapping to the Svelte `{#if loading} / {:else if error} / {:else}` blocks.

`.task { await loadSessions() }` — runs the fetch when the view appears. Like Svelte's `onMount`. Auto-cancels if user navigates away before it finishes.

`.refreshable { ... }` — pull-to-refresh. Free native behavior, no library needed.

`List(sessions) { session in ... }` — renders each session as a tappable row. Wrapping in `NavigationLink(value: session.id)` makes it navigate to `LiveView` on tap.

### `Views/LiveView.swift` — Main chat + voice interface

```
Svelte equivalent: src/client/routes/live/+page.svelte
```

Phase 1 scaffold — two zones:
1. **Chat scroll** — `ScrollView` + `LazyVStack` of `ChatBubbleView`. `LazyVStack` = only renders visible items (like virtual scrolling). Auto-scrolls to bottom via `ScrollViewReader` + `.onChange(of: messages.count)`.
2. **Input bar** — placeholder mic button. Will be wired to Gemini in Phase 4.

Loads chat history on appear if a `sessionId` was passed (navigated from session list).

### `Views/ChatBubbleView.swift` — Message rendering

```
Svelte equivalent: the message rendering section of live/+page.svelte
```

User messages: right-aligned, gray bubble, plain text.
Assistant messages: left-aligned, no bubble, rendered as:
1. Thinking blocks (collapsible `DisclosureGroup`)
2. Text content (rendered as Markdown via `MarkdownUI` library)
3. Tool uses (expandable `ToolUseView` components)

The `toolResultMap` parameter matches tool_use IDs to their results (built by `buildToolResultMap` in MessageHelpers) so tool uses can show their output inline.

### `Views/ToolUseView.swift` — Tool call display

```
Svelte equivalent: the tool-use details rendering in live/+page.svelte
```

Expandable disclosure group showing tool name (purple capsule badge), input (instruction text or raw JSON), and result text. Matches the Svelte app's collapsible tool call display.

### `Views/SettingsSheet.swift` — Settings modal

```
Svelte equivalent: the Settings modal in live/+page.svelte
```

Form with: server URL, Gemini API key, mode picker (direct/review), model picker, permission mode, readback toggle, system prompt editor with reset button.

Uses draft state (`@State` variables) — edits don't apply until you tap Save. This prevents partial updates while the user is still editing.

### `Utilities/MessageHelpers.swift` — Pure functions on Message

```
Svelte equivalent: src/client/lib/message-helpers.ts
```

Extensions on `Message` that extract specific content:
- `.textContent` — all text blocks joined (like `messageText()`)
- `.toolUses` — array of (id, name, input) tuples (like `messageToolUses()`)
- `.thinkingBlocks` — array of thinking strings (like `messageThinking()`)
- `.isToolResultOnly` — true if user message is just tool results (hidden in UI)

`buildToolResultMap()` — scans all messages, builds a dict of `tool_use_id → result_text`. Used by `ChatBubbleView` to show results next to their tool calls.

## Data flow

```
Express backend (Mac :8000)
    ↓ HTTP
APIClient / ConverseClient (Services/)
    ↓ typed Swift objects
LiveStore (Stores/) — @Observable
    ↓ automatic reactivity
Views/ — SwiftUI re-renders
```

Views never talk to the network directly (except the simple Phase 1 fetches in SessionListView/LiveView — those will move to proper services in Phase 2).

## Build & run

```bash
cd app/
xcodegen generate              # regenerate .xcodeproj from project.yml
xcodebuild -project Reduck.xcodeproj -scheme Reduck \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' build
```

Add a new SPM dependency: edit `packages:` in `project.yml`, then `xcodegen generate`.

Add a new Swift file: just create it anywhere under `Reduck/` — xcodegen auto-discovers by directory.
