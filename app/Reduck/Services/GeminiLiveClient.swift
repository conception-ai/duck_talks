import Foundation

// ═══════════════════════════════════════════════════════════════
// MARK: - Gemini Live Wire Protocol Types
// ═══════════════════════════════════════════════════════════════

/// Namespace for Gemini Live API wire protocol types.
/// Reference: docs/gemini-live-api-swift-reference.md
enum Gemini {

    // MARK: Shared

    struct Blob: Codable, Sendable {
        let mimeType: String
        let data: String
    }

    struct Part: Codable, Sendable {
        var text: String?
        var inlineData: Blob?
    }

    struct Content: Codable, Sendable {
        var role: String?
        var parts: [Part]
    }

    /// Encodes as `{}` — used for feature flags like `inputAudioTranscription`.
    struct EmptyObject: Codable, Sendable {}

    // MARK: Client → Server

    struct SetupConfig: Encodable, Sendable {
        var model: String
        var generationConfig: GenerationConfig?
        var systemInstruction: Content?
        var tools: [Tool]?
        var inputAudioTranscription: EmptyObject?
        var outputAudioTranscription: EmptyObject?
        var realtimeInputConfig: RealtimeInputConfig?
        var contextWindowCompression: ContextWindowCompression?
        var sessionResumption: SessionResumption?
    }

    struct GenerationConfig: Encodable, Sendable {
        var responseModalities: [String]?
        var temperature: Double?
        var speechConfig: SpeechConfig?
    }

    struct SpeechConfig: Encodable, Sendable {
        let voiceConfig: VoiceConfig
    }

    struct VoiceConfig: Encodable, Sendable {
        let prebuiltVoiceConfig: PrebuiltVoiceConfig
    }

    struct PrebuiltVoiceConfig: Encodable, Sendable {
        let voiceName: String
    }

    struct Tool: Encodable, Sendable {
        var functionDeclarations: [FunctionDeclaration]?
        var googleSearch: EmptyObject?
    }

    struct FunctionDeclaration: Encodable, Sendable {
        let name: String
        let description: String
        var parameters: [String: JSONValue]?
    }

    struct ClientContent: Encodable, Sendable {
        let turns: [Content]
        let turnComplete: Bool
    }

    struct RealtimeInput: Encodable, Sendable {
        var audio: Blob?
        var text: String?
        var activityStart: EmptyObject?
        var activityEnd: EmptyObject?
        var audioStreamEnd: Bool?
    }

    struct ToolResponse: Encodable, Sendable {
        let functionResponses: [FunctionResponse]
    }

    struct FunctionResponse: Encodable, Sendable {
        let id: String
        let name: String
        let response: [String: JSONValue]
    }

    // MARK: VAD / Session Config

    struct RealtimeInputConfig: Encodable, Sendable {
        var automaticActivityDetection: AutomaticActivityDetection?
        var activityHandling: String?
        var turnCoverage: String?
    }

    struct AutomaticActivityDetection: Encodable, Sendable {
        var disabled: Bool?
        var startOfSpeechSensitivity: String?
        var endOfSpeechSensitivity: String?
        var prefixPaddingMs: Int?
        var silenceDurationMs: Int?
    }

    struct ContextWindowCompression: Encodable, Sendable {
        var slidingWindow: SlidingWindow?
        var triggerTokens: Int?
    }

    struct SlidingWindow: Encodable, Sendable {
        var targetTokens: Int?
    }

    struct SessionResumption: Codable, Sendable {
        var handle: String?
    }

    // MARK: Server → Client

    struct ServerMessage: Decodable, Sendable {
        var setupComplete: EmptyObject?
        var serverContent: ServerContent?
        var toolCall: ToolCallMessage?
        var toolCallCancellation: ToolCallCancellation?
        var goAway: GoAway?
        var sessionResumptionUpdate: SessionResumptionUpdate?
        var usageMetadata: UsageMetadata?
    }

    struct ServerContent: Decodable, Sendable {
        var modelTurn: Content?
        var turnComplete: Bool?
        var interrupted: Bool?
        var generationComplete: Bool?
        var inputTranscription: Transcription?
        var outputTranscription: Transcription?
    }

    struct Transcription: Decodable, Sendable {
        let text: String
    }

    struct ToolCallMessage: Decodable, Sendable {
        let functionCalls: [FunctionCall]
    }

    struct FunctionCall: Decodable, Sendable {
        let id: String
        let name: String
        var args: [String: JSONValue]?
    }

    struct ToolCallCancellation: Decodable, Sendable {
        let ids: [String]
    }

    struct GoAway: Decodable, Sendable {
        var timeLeft: String?
    }

    struct SessionResumptionUpdate: Decodable, Sendable {
        var newHandle: String?
        var resumable: Bool?
    }

    struct UsageMetadata: Decodable, Sendable {
        var promptTokenCount: Int?
        var responseTokenCount: Int?
        var totalTokenCount: Int?
        var thoughtsTokenCount: Int?
        var promptTokensDetails: [TokenDetail]?
        var responseTokensDetails: [TokenDetail]?
    }

    struct TokenDetail: Decodable, Sendable {
        var modality: String?
        var tokenCount: Int?
    }
}

// MARK: - Convenience Initializers

extension Gemini.SpeechConfig {
    /// `SpeechConfig.voice("Kore")` instead of nested init.
    static func voice(_ name: String) -> Self {
        .init(voiceConfig: .init(prebuiltVoiceConfig: .init(voiceName: name)))
    }
}

extension Gemini.Content {
    /// `Content.text("Hello", role: "user")` instead of nested Part init.
    static func text(_ text: String, role: String? = nil) -> Self {
        .init(role: role, parts: [.init(text: text)])
    }
}

extension Gemini.RealtimeInput {
    /// `RealtimeInput.audio(base64)` instead of nested Blob init.
    static func audio(_ base64: String, mimeType: String = "audio/pcm;rate=16000") -> Self {
        .init(audio: .init(mimeType: mimeType, data: base64))
    }
}

// MARK: - Private Send Envelopes

private struct SetupEnvelope: Encodable {
    let setup: Gemini.SetupConfig
}

private struct ClientContentEnvelope: Encodable {
    let clientContent: Gemini.ClientContent
}

private struct RealtimeInputEnvelope: Encodable {
    let realtimeInput: Gemini.RealtimeInput
}

private struct ToolResponseEnvelope: Encodable {
    let toolResponse: Gemini.ToolResponse
}

// ═══════════════════════════════════════════════════════════════
// MARK: - GeminiLiveClient
// ═══════════════════════════════════════════════════════════════

enum GeminiLiveError: Error, LocalizedError {
    case invalidURL
    case invalidMessage
    case setupFailed

    var errorDescription: String? {
        switch self {
        case .invalidURL: "Invalid Gemini Live WebSocket URL"
        case .invalidMessage: "Invalid message from server"
        case .setupFailed: "Server did not return setupComplete"
        }
    }
}

/// WebSocket client for the Gemini Live (BidiGenerateContent) API.
/// Swift equivalent of `@google/genai`'s `ai.live.connect()`.
///
/// Both the relay session (mic → tool calls) and TTS session (text → audio)
/// use this same client with different `SetupConfig`.
///
/// ```swift
/// let client = GeminiLiveClient(apiKey: key, setup: .init(
///     model: "gemini-2.5-flash-native-audio-preview-12-2025",
///     generationConfig: .init(responseModalities: ["AUDIO"]),
///     systemInstruction: .text("You are a helpful assistant.")
/// ))
/// client.onMessage = { msg in ... }
/// try await client.connect()
/// client.sendRealtimeInput(.audio(base64Chunk))
/// ```
@MainActor
final class GeminiLiveClient {
    private static let endpoint =
        "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"

    private let apiKey: String
    private let setupConfig: Gemini.SetupConfig
    private var wsTask: URLSessionWebSocketTask?
    private var receiveLoop: Task<Void, Never>?
    private var closed = false
    private let encoder = JSONEncoder()

    // --- Callbacks ---
    var onMessage: ((Gemini.ServerMessage) -> Void)?
    var onError: ((any Error) -> Void)?
    var onClose: ((URLSessionWebSocketTask.CloseCode, String?) -> Void)?

    init(apiKey: String, setup: Gemini.SetupConfig) {
        self.apiKey = apiKey
        self.setupConfig = setup
    }

    /// Connect, send setup message, wait for `setupComplete`, then start the receive loop.
    func connect() async throws {
        guard wsTask == nil else { return }

        guard let url = URL(string: "\(Self.endpoint)?key=\(apiKey)") else {
            throw GeminiLiveError.invalidURL
        }

        let ws = URLSession.shared.webSocketTask(with: url)
        ws.resume()
        wsTask = ws

        // Normalize model name — API expects "models/" prefix
        var config = setupConfig
        if !config.model.hasPrefix("models/") {
            config.model = "models/\(config.model)"
        }

        // Send setup
        let setupData = try encoder.encode(SetupEnvelope(setup: config))
        try await ws.send(.string(String(data: setupData, encoding: .utf8)!))

        // First message must be setupComplete
        let first = try await ws.receive()
        switch first {
        case .string(let text):
            guard let data = text.data(using: .utf8),
                  let msg = try? JSONDecoder().decode(Gemini.ServerMessage.self, from: data),
                  msg.setupComplete != nil else {
                throw GeminiLiveError.setupFailed
            }
        default:
            throw GeminiLiveError.setupFailed
        }

        // Start receive loop
        receiveLoop = Task { await self.runReceiveLoop() }
    }

    // MARK: Send

    /// Send real-time audio (or text/activity signals).
    func sendRealtimeInput(_ input: Gemini.RealtimeInput) {
        send(RealtimeInputEnvelope(realtimeInput: input))
    }

    /// Send text turns or conversation context.
    func sendClientContent(_ content: Gemini.ClientContent) {
        send(ClientContentEnvelope(clientContent: content))
    }

    /// Respond to a tool call from the server.
    func sendToolResponse(_ response: Gemini.ToolResponse) {
        send(ToolResponseEnvelope(toolResponse: response))
    }

    // MARK: Close

    /// Close the WebSocket connection and stop the receive loop.
    func close() {
        guard !closed else { return }
        closed = true
        receiveLoop?.cancel()
        receiveLoop = nil
        wsTask?.cancel(with: .normalClosure, reason: nil)
        wsTask = nil
    }

    // MARK: Private

    private func runReceiveLoop() async {
        guard let ws = wsTask else { return }

        while !closed && !Task.isCancelled {
            do {
                let message = try await ws.receive()
                if closed { break }

                switch message {
                case .string(let text):
                    guard let data = text.data(using: .utf8) else { continue }
                    do {
                        let msg = try JSONDecoder().decode(Gemini.ServerMessage.self, from: data)
                        onMessage?(msg)
                    } catch {
                        onError?(error)
                    }
                case .data:
                    break
                @unknown default:
                    break
                }
            } catch {
                if !closed {
                    closed = true
                    let code = ws.closeCode
                    let reason = ws.closeReason.flatMap { String(data: $0, encoding: .utf8) }
                    onClose?(code, reason)
                }
                break
            }
        }
    }

    private func send<T: Encodable>(_ envelope: T) {
        guard !closed, let ws = wsTask else { return }
        do {
            let data = try encoder.encode(envelope)
            let string = String(data: data, encoding: .utf8)!
            Task { try? await ws.send(.string(string)) }
        } catch {
            onError?(error)
        }
    }
}
