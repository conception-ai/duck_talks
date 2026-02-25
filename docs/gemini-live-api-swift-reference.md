# Gemini Live API — Swift WebSocket Client Implementation Reference

> **Goal**: Implement a native Swift WebSocket client for the Gemini Live API, bypassing Firebase. This document contains all the protocol details, message schemas, and behavioral specs needed to build the client from scratch using `URLSessionWebSocketTask`.

---

## 1. WebSocket Endpoint

Connect to:

```
wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent
```

**Authentication**: Pass your API key as a query parameter:

```
wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=YOUR_API_KEY
```

For production client-side apps, use **ephemeral tokens** instead (see Section 9).

---

## 2. Session Lifecycle

1. **Open WebSocket** connection to the endpoint above.
2. **Send setup message** (`BidiGenerateContentSetup`) as the **first and only first** message.
3. **Wait for** `setupComplete` response before sending anything else.
4. **Exchange messages** — send audio/text/video, receive audio/text/tool calls.
5. **Session ends** when the WebSocket closes, or a `goAway` message is received.

---

## 3. Audio Format Specifications

| Direction | Format | Sample Rate | Bit Depth | Channels |
|-----------|--------|-------------|-----------|----------|
| **Input** (mic → server) | Raw PCM, little-endian | 16kHz (native, but any rate accepted if declared via MIME type) | 16-bit | Mono |
| **Output** (server → speaker) | Raw PCM, little-endian | 24kHz | 16-bit | Mono |

MIME type for input audio: `audio/pcm;rate=16000`

---

## 4. Client → Server Messages

Every message sent must be a JSON object with **exactly one** of these top-level fields:

```json
{
  "setup": BidiGenerateContentSetup,
  "clientContent": BidiGenerateContentClientContent,
  "realtimeInput": BidiGenerateContentRealtimeInput,
  "toolResponse": BidiGenerateContentToolResponse
}
```

### 4.1 `setup` — Session Configuration (first message only)

```json
{
  "setup": {
    "model": "models/gemini-2.5-flash-native-audio-preview-12-2025",
    "generationConfig": {
      "responseModalities": ["AUDIO"],
      "temperature": 0.7,
      "speechConfig": {
        "voiceConfig": {
          "prebuiltVoiceConfig": {
            "voiceName": "Kore"
          }
        }
      }
    },
    "systemInstruction": {
      "parts": [{ "text": "You are a helpful assistant." }]
    },
    "tools": [],
    "realtimeInputConfig": {
      "automaticActivityDetection": {
        "disabled": false,
        "startOfSpeechSensitivity": "START_SENSITIVITY_HIGH",
        "endOfSpeechSensitivity": "END_SENSITIVITY_HIGH",
        "prefixPaddingMs": 20,
        "silenceDurationMs": 100
      },
      "activityHandling": "START_OF_ACTIVITY_INTERRUPTS",
      "turnCoverage": "TURN_INCLUDES_ONLY_ACTIVITY"
    },
    "inputAudioTranscription": {},
    "outputAudioTranscription": {},
    "sessionResumption": {},
    "contextWindowCompression": {
      "slidingWindow": {},
      "triggerTokens": 100000
    }
  }
}
```

**Key `generationConfig` fields:**
- `responseModalities`: `["AUDIO"]` or `["TEXT"]` — only ONE allowed per session.
- `candidateCount`, `maxOutputTokens`, `temperature`, `topP`, `topK`, `presencePenalty`, `frequencyPenalty`
- `speechConfig`: voice selection (see Section 7)
- `mediaResolution`: optional, for video input

**Key setup fields:**
- `model` (required): e.g. `"models/gemini-2.5-flash-native-audio-preview-12-2025"` or `"models/gemini-live-2.5-flash-preview"`
- `systemInstruction`: Content object with text parts
- `tools`: array of Tool objects (function declarations, google_search, etc.)
- `realtimeInputConfig`: VAD configuration (see Section 6)
- `inputAudioTranscription`: `{}` to enable input transcription
- `outputAudioTranscription`: `{}` to enable output transcription
- `sessionResumption`: `{}` for new session, or `{ "handle": "<token>" }` to resume
- `contextWindowCompression`: sliding window config for long sessions
- `proactivity`: `{ "proactiveAudio": true }` (v1alpha only)
- `enableAffectiveDialog`: `true` (v1alpha only)

### 4.2 `clientContent` — Text/Context Input

Used for text messages and establishing conversation context. **Interrupts** any current model generation.

```json
{
  "clientContent": {
    "turns": [
      {
        "role": "user",
        "parts": [{ "text": "Hello, how are you?" }]
      }
    ],
    "turnComplete": true
  }
}
```

- `turns`: array of Content objects (role: "user" or "model")
- `turnComplete`: `true` to signal the model should start generating; `false` to continue buffering

### 4.3 `realtimeInput` — Audio/Video/Text Streaming

Used for continuous real-time streaming. Does **NOT** interrupt model generation. Optimized for responsiveness over ordering.

```json
{
  "realtimeInput": {
    "audio": {
      "mimeType": "audio/pcm;rate=16000",
      "data": "<base64-encoded-PCM-bytes>"
    }
  }
}
```

Other fields (send only one per message):
- `audio`: `Blob` — audio stream chunk
- `video`: `Blob` — video stream frame
- `text`: `string` — realtime text input
- `activityStart`: `{}` — manual VAD: marks start of user speech (only when auto VAD disabled)
- `activityEnd`: `{}` — manual VAD: marks end of user speech (only when auto VAD disabled)
- `audioStreamEnd`: `true` — signals mic was turned off (only when auto VAD enabled)

**Blob format:**
```json
{
  "mimeType": "audio/pcm;rate=16000",
  "data": "<base64-encoded-bytes>"
}
```

### 4.4 `toolResponse` — Function Call Responses

```json
{
  "toolResponse": {
    "functionResponses": [
      {
        "id": "<function-call-id>",
        "name": "turn_on_the_lights",
        "response": { "result": "success" }
      }
    ]
  }
}
```

Match each `FunctionResponse.id` to the `FunctionCall.id` from the server's `toolCall` message.

---

## 5. Server → Client Messages

Server messages contain a `usageMetadata` field (optional) plus **exactly one** of:

```json
{
  "usageMetadata": UsageMetadata,

  "setupComplete": {},
  "serverContent": BidiGenerateContentServerContent,
  "toolCall": BidiGenerateContentToolCall,
  "toolCallCancellation": BidiGenerateContentToolCallCancellation,
  "goAway": GoAway,
  "sessionResumptionUpdate": SessionResumptionUpdate
}
```

### 5.1 `setupComplete`

Empty object `{}`. Signals that the session is ready for messages.

### 5.2 `serverContent`

The main response message:

```json
{
  "serverContent": {
    "modelTurn": {
      "parts": [
        {
          "inlineData": {
            "mimeType": "audio/pcm;rate=24000",
            "data": "<base64-encoded-audio>"
          }
        }
      ]
    },
    "turnComplete": false,
    "interrupted": false,
    "generationComplete": false,
    "inputTranscription": { "text": "what the user said" },
    "outputTranscription": { "text": "what the model said" },
    "groundingMetadata": {}
  }
}
```

**Key fields:**
- `modelTurn`: Content with parts containing `inlineData` (audio bytes) or `text`
- `turnComplete`: `true` when model is done with its turn
- `interrupted`: `true` when user barged in and generation was cancelled
- `generationComplete`: `true` when model finished generating (before playback finishes)
- `inputTranscription.text`: transcription of user's audio input (if enabled)
- `outputTranscription.text`: transcription of model's audio output (if enabled)

**Important behavior on interruption:**
- When `interrupted` is `true`, stop audio playback immediately and clear the playback queue.
- No `generationComplete` is sent for interrupted turns.
- Flow: `interrupted` → `turnComplete`

### 5.3 `toolCall`

```json
{
  "toolCall": {
    "functionCalls": [
      {
        "id": "call-123",
        "name": "turn_on_the_lights",
        "args": {}
      }
    ]
  }
}
```

### 5.4 `toolCallCancellation`

Sent when a tool call should be cancelled (e.g., user interrupted before it executed):

```json
{
  "toolCallCancellation": {
    "ids": ["call-123"]
  }
}
```

### 5.5 `goAway`

Server is about to close the connection:

```json
{
  "goAway": {
    "timeLeft": "30s"
  }
}
```

Use this to trigger session resumption before disconnection.

### 5.6 `sessionResumptionUpdate`

```json
{
  "sessionResumptionUpdate": {
    "newHandle": "<opaque-token>",
    "resumable": true
  }
}
```

- Store `newHandle` when `resumable` is `true`
- Use it in the next connection's `setup.sessionResumption.handle`
- Tokens are valid for **2 hours** after the last session termination

### 5.7 `usageMetadata`

```json
{
  "usageMetadata": {
    "promptTokenCount": 100,
    "responseTokenCount": 50,
    "totalTokenCount": 150,
    "thoughtsTokenCount": 20,
    "promptTokensDetails": [{ "modality": "AUDIO", "tokenCount": 80 }],
    "responseTokensDetails": [{ "modality": "AUDIO", "tokenCount": 50 }]
  }
}
```

---

## 6. Voice Activity Detection (VAD)

### Automatic VAD (default)

Server-side VAD detects speech start/end automatically. Configure via `realtimeInputConfig.automaticActivityDetection`:

| Parameter | Type | Description |
|-----------|------|-------------|
| `disabled` | bool | Default `false`. Set `true` to use manual VAD. |
| `startOfSpeechSensitivity` | enum | `START_SENSITIVITY_HIGH` (default) or `START_SENSITIVITY_LOW` |
| `endOfSpeechSensitivity` | enum | `END_SENSITIVITY_HIGH` (default) or `END_SENSITIVITY_LOW` |
| `prefixPaddingMs` | int32 | Required speech duration before start-of-speech commits. Lower = more sensitive. |
| `silenceDurationMs` | int32 | Required silence before end-of-speech commits. Higher = tolerates longer pauses. |

**Activity handling** (`realtimeInputConfig.activityHandling`):
- `START_OF_ACTIVITY_INTERRUPTS` (default): User speech interrupts model (barge-in)
- `NO_INTERRUPTION`: Model continues even when user speaks

**Turn coverage** (`realtimeInputConfig.turnCoverage`):
- `TURN_INCLUDES_ONLY_ACTIVITY` (default): Only speech included in turn
- `TURN_INCLUDES_ALL_INPUT`: All input including silence included

### Manual VAD

When `automaticActivityDetection.disabled = true`:
- Client must send `activityStart` before audio and `activityEnd` after speech ends
- No `audioStreamEnd` needed in this mode

### Audio Stream Pause

When auto VAD is enabled and the mic is paused for >1 second:
- Send `audioStreamEnd: true` to flush cached audio
- Resume by sending audio data again

---

## 7. Voice Selection

Available voices for native audio models (also used by TTS models):
Aoede, Charon, Fenrir, Kore, Leda, Orus, Puck, Zephyr, and more.

Set in config:
```json
"speechConfig": {
  "voiceConfig": {
    "prebuiltVoiceConfig": {
      "voiceName": "Kore"
    }
  }
}
```

Listen to all voices at https://aistudio.google.com/app/live

---

## 8. Session Management

### Session Duration Limits (without compression)

| Session Type | Max Duration |
|-------------|-------------|
| Audio only | ~15 minutes |
| Audio + Video | ~2 minutes |

### Context Window Limits

| Model Type | Context Window |
|-----------|---------------|
| Native audio models | 128k tokens |
| Other Live API models | 32k tokens |

### Context Window Compression

Enable sliding window compression for unlimited session duration:

```json
"contextWindowCompression": {
  "slidingWindow": {
    "targetTokens": 50000
  },
  "triggerTokens": 100000
}
```

- `triggerTokens`: compression triggers when context exceeds this (default: 80% of model limit)
- `targetTokens`: target size after compression (default: triggerTokens/2)
- System instructions are always preserved

### Session Resumption

For surviving connection resets (~10 min connection lifetime):

1. Include `"sessionResumption": {}` in setup
2. Store `newHandle` from `sessionResumptionUpdate` messages when `resumable = true`
3. On reconnect, pass handle: `"sessionResumption": { "handle": "<stored-handle>" }`
4. Handles valid for **2 hours** after last session termination
5. You can change config (except model) when resuming

---

## 9. Ephemeral Tokens (for client-side auth)

For client-to-server connections without exposing your API key:

**Create token** (server-side, REST call):

```
POST https://generativelanguage.googleapis.com/v1beta/authTokens?key=YOUR_API_KEY

{
  "authToken": {
    "expireTime": "2025-01-01T00:30:00Z",
    "newSessionExpireTime": "2025-01-01T00:01:00Z",
    "uses": 1,
    "bidiGenerateContentSetup": { ... }
  }
}
```

**Use token** — two options:
1. Query param: `?access_token=<token>`
2. HTTP header: `Authorization: Token <token>`

Connect to: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained`

(Note the `Constrained` suffix in the endpoint when using ephemeral tokens.)

Defaults:
- `expireTime`: 30 minutes if not set (max 20 hours)
- `newSessionExpireTime`: 60 seconds if not set (max 20 hours)
- `uses`: 1 if not set (0 = unlimited)

---

## 10. Function Calling / Tool Use

### Declare tools in setup:

```json
"tools": [
  {
    "functionDeclarations": [
      {
        "name": "get_weather",
        "description": "Get weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": { "type": "string" }
          },
          "required": ["location"]
        }
      }
    ]
  }
]
```

### Google Search grounding:

```json
"tools": [{ "googleSearch": {} }]
```

### Flow:
1. Server sends `toolCall` with `functionCalls[]`
2. Client executes the function
3. Client sends `toolResponse` with matching `id`s
4. Server continues generation with the results

### Cancellation:
- If user interrupts during a tool call, server sends `toolCallCancellation` with the IDs
- Client should attempt to undo side effects if possible

---

## 11. Thinking (Native Audio Models)

Native audio model `gemini-2.5-flash-native-audio-preview-12-2025` supports thinking with dynamic thinking enabled by default.

```json
"generationConfig": {
  "responseModalities": ["AUDIO"],
  "thinkingConfig": {
    "thinkingBudget": 1024,
    "includeThoughts": true
  }
}
```

- `thinkingBudget`: 0 to disable, or number of thinking tokens
- `includeThoughts`: `true` to receive thought summaries in responses

---

## 12. Available Models

| Model | Description |
|-------|-------------|
| `gemini-2.5-flash-native-audio-preview-12-2025` | Latest native audio, supports thinking, affective dialog |
| `gemini-live-2.5-flash-preview` | General Live API model |
| `gemini-2.0-flash-live-preview-04-09` | Older Live API model |

Native audio models auto-detect language (24 supported languages). Do NOT explicitly set language code for native audio.

---

## 13. Swift Implementation Notes

### URLSessionWebSocketTask Usage

```swift
let url = URL(string: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=\(apiKey)")!
let task = URLSession.shared.webSocketTask(with: url)
task.resume()

// Send JSON message
func send(_ message: [String: Any]) async throws {
    let data = try JSONSerialization.data(withJSONObject: message)
    let string = String(data: data, encoding: .utf8)!
    try await task.send(.string(string))
}

// Receive loop
func receiveLoop() async throws {
    while true {
        let message = try await task.receive()
        switch message {
        case .string(let text):
            let json = try JSONSerialization.jsonObject(with: text.data(using: .utf8)!) as! [String: Any]
            handleServerMessage(json)
        case .data(let data):
            // Binary frames not typically used
            break
        @unknown default:
            break
        }
    }
}
```

### Audio Capture (AVAudioEngine)

```swift
// Input: 16kHz, mono, 16-bit PCM
let inputFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!

// Output: 24kHz, mono, 16-bit PCM  
let outputFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: 1, interleaved: true)!
```

### Base64 Encoding for Audio Chunks

Audio data in `realtimeInput.audio.data` and `serverContent.modelTurn.parts[].inlineData.data` is **base64-encoded** raw PCM bytes.

### Recommended Chunk Size

Send audio in chunks of ~1024 samples (64ms at 16kHz). Don't buffer too much — the API processes incrementally.

---

## 14. Key Documentation URLs

- **Get Started**: https://ai.google.dev/gemini-api/docs/live
- **Capabilities Guide** (VAD, transcription, voices, thinking): https://ai.google.dev/gemini-api/docs/live-guide
- **WebSocket API Reference** (full message schemas): https://ai.google.dev/api/live
- **Tool Use**: https://ai.google.dev/gemini-api/docs/live-tools
- **Session Management** (resumption, compression): https://ai.google.dev/gemini-api/docs/live-session
- **Ephemeral Tokens**: https://ai.google.dev/gemini-api/docs/ephemeral-tokens
- **Models Page**: https://ai.google.dev/gemini-api/docs/models
- **Python SDK source** (reference implementation): https://github.com/googleapis/python-genai/blob/main/google/genai/live.py
- **JS reference demo app**: https://github.com/GoogleCloudPlatform/generative-ai/tree/main/gemini/multimodal-live-api/native-audio-websocket-demo-apps/plain-js-demo-app
