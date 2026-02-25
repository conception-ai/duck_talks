import Foundation

/// Port of `data.svelte.ts` — core app state.
/// Two-array model: messages (persistent) + voiceLog (ephemeral).
@MainActor @Observable
final class LiveStore {
    // --- Reactive state ---
    var status: Status = .idle
    var messages: [Message] = []
    var voiceLog: [VoiceEvent] = []
    var pendingInput = ""
    var pendingTool: PendingTool?
    var pendingApproval: PendingApproval?
    var toast = ""
    var streamingText = ""

    // --- Session ---
    var sessionId: String?
    var leafUuid: String?

    // --- Converse task ---
    private var converseTask: Task<Void, Never>?
    private var toastTimer: Task<Void, Never>?

    private let converse: ConverseClient
    private let settings: SettingsStore

    init(settings: SettingsStore) {
        self.settings = settings
        self.converse = ConverseClient(baseURL: settings.baseURL)
    }

    // MARK: - Load history from backend

    func loadHistory(_ id: String) async {
        guard let url = URL(string: "\(settings.baseURL)/api/sessions/\(id)/messages") else { return }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            messages = try JSONDecoder().decode([Message].self, from: data)
            sessionId = id
            leafUuid = nil
        } catch {
            pushError("Failed to load: \(error.localizedDescription)")
        }
    }

    // MARK: - Send instruction (text mode)

    func sendInstruction(_ instruction: String) {
        let trimmed = instruction.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        messages.append(.user(trimmed))
        streamingText = ""
        status = .connected

        let sid = sessionId
        let lid = leafUuid
        let config = ConverseClient.Config(
            model: settings.model,
            systemPrompt: settings.systemPrompt,
            permissionMode: settings.permissionMode
        )

        converseTask = Task {
            var blocks: [ContentBlock] = []
            var fullText = ""

            await converse.stream(
                instruction: trimmed,
                sessionId: sid,
                leafUuid: lid,
                config: config,
                onChunk: { @MainActor text in
                    fullText += text
                    self.streamingText = fullText
                },
                onBlock: { @MainActor blockData in
                    if let decoded = try? JSONDecoder().decode(ContentBlock.self, from: blockData) {
                        blocks.append(decoded)
                    }
                },
                onDone: { @MainActor newSid, _, _ in
                    if !blocks.isEmpty {
                        self.messages.append(.assistant(blocks: blocks))
                    } else if !fullText.isEmpty {
                        self.messages.append(.assistant(text: fullText))
                    }
                    self.streamingText = ""
                    if let newSid { self.sessionId = newSid }
                    self.leafUuid = nil
                    self.status = .idle
                },
                onError: { @MainActor msg in
                    self.pushError(msg)
                    self.streamingText = ""
                    self.status = .idle
                }
            )
        }
    }

    // MARK: - Abort

    func abort() {
        converseTask?.cancel()
        converseTask = nil
        streamingText = ""
        status = .idle
    }

    // MARK: - Toast

    func pushError(_ text: String) {
        toast = text
        toastTimer?.cancel()
        toastTimer = Task {
            try? await Task.sleep(for: .seconds(4))
            self.toast = ""
        }
    }
}
