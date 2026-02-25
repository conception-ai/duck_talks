import SwiftUI

/// Port of `ui.svelte.ts` — persistent user preferences.
/// Uses @Observable (iOS 17+) with manual UserDefaults persistence.
@Observable
final class SettingsStore {
    private static let storageKey = "claude-talks:ui"

    var apiKey: String? {
        didSet { persist() }
    }
    var mode: InteractionMode {
        didSet { persist() }
    }
    var model: String {
        didSet { persist() }
    }
    var systemPrompt: String {
        didSet { persist() }
    }
    var permissionMode: String {
        didSet { persist() }
    }
    var readbackEnabled: Bool {
        didSet { persist() }
    }
    var serverURL: String {
        didSet { persist() }
    }

    init() {
        let defaults = Self.load()
        self.apiKey = defaults.apiKey
        self.mode = defaults.mode
        self.model = defaults.model
        self.systemPrompt = defaults.systemPrompt
        self.permissionMode = defaults.permissionMode
        self.readbackEnabled = defaults.readbackEnabled
        self.serverURL = defaults.serverURL
    }

    var baseURL: String {
        serverURL.isEmpty ? "http://localhost:8000" : serverURL
    }

    func cyclePermissionMode() {
        permissionMode = permissionMode == "plan" ? "acceptEdits" : "plan"
    }

    // MARK: - Persistence

    private struct Persisted: Codable {
        var apiKey: String?
        var mode: InteractionMode = .direct
        var model: String = "sonnet"
        var systemPrompt: String = Defaults.systemPrompt
        var permissionMode: String = "plan"
        var readbackEnabled: Bool = false
        var serverURL: String = "http://localhost:8000"
    }

    private static func load() -> Persisted {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let persisted = try? JSONDecoder().decode(Persisted.self, from: data) else {
            return Persisted()
        }
        return persisted
    }

    private func persist() {
        let persisted = Persisted(
            apiKey: apiKey,
            mode: mode,
            model: model,
            systemPrompt: systemPrompt,
            permissionMode: permissionMode,
            readbackEnabled: readbackEnabled,
            serverURL: serverURL
        )
        if let data = try? JSONEncoder().encode(persisted) {
            UserDefaults.standard.set(data, forKey: Self.storageKey)
        }
    }
}

// MARK: - Defaults

enum Defaults {
    static let model = "sonnet"
    static let permissionMode = "plan"
    static let systemPrompt = """
    Your output will be spoken aloud through text-to-speech. You are having a live voice conversation.

    BREVITY IS EVERYTHING. The user is LISTENING, not reading.

    Answer ASAP with what you are going to do, do it, then report what you did.
    2-3 sentences by default. Maximum 5 even when asked to elaborate.
    Talk like a sharp coworker. Short sentences. Contractions.
    No markdown. No bullets. No code fences. No headers. Everything is plain speech.
    """
}
