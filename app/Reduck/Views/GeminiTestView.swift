import SwiftUI

/// Throwaway smoke test for GeminiLiveClient. Delete after validation.
/// No LiveStore, no ConverseClient, no backend — pure WebSocket test.
struct GeminiTestView: View {
    @Environment(SettingsStore.self) private var settings
    @State private var client: GeminiLiveClient?
    @State private var log: [String] = []
    @State private var status = "idle"

    var body: some View {
        VStack(spacing: 0) {
            // Status
            HStack {
                Circle()
                    .fill(status == "connected" ? .green : status == "connecting" ? .orange : .gray)
                    .frame(width: 8, height: 8)
                Text(status).font(.caption).foregroundStyle(.secondary)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)

            // Log
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(log.enumerated()), id: \.offset) { i, line in
                            Text(line)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(line.starts(with: "ERR") ? .red : .primary)
                                .id(i)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                }
                .onChange(of: log.count) {
                    if let last = log.indices.last {
                        proxy.scrollTo(last, anchor: .bottom)
                    }
                }
            }

            Divider()

            // Controls
            HStack(spacing: 12) {
                Button("Connect + Send") { runTest() }
                    .disabled(status == "connecting" || status == "connected")
                Button("Clear") { log.removeAll() }
                Spacer()
            }
            .padding(16)
            .background(.bar)
        }
        .navigationTitle("WS Test")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func runTest() {
        guard let apiKey = settings.apiKey, !apiKey.isEmpty else {
            log.append("ERR: Set Gemini API key in settings first")
            return
        }

        status = "connecting"
        log.append("→ connecting...")

        let c = GeminiLiveClient(apiKey: apiKey, setup: .init(
            model: "gemini-2.5-flash-native-audio-preview-12-2025",
            generationConfig: .init(responseModalities: ["AUDIO"]),
            systemInstruction: .text("You are a helpful assistant. Keep responses to one sentence."),
            outputAudioTranscription: .init()
        ))
        client = c

        c.onMessage = { msg in
            if let sc = msg.serverContent {
                if let t = sc.outputTranscription?.text {
                    log.append("◀ \(t)")
                }
                if sc.modelTurn != nil {
                    let parts = sc.modelTurn!.parts
                    let hasAudio = parts.contains { $0.inlineData != nil }
                    let hasText = parts.contains { $0.text != nil }
                    if hasAudio { log.append("♪ audio chunk") }
                    if hasText {
                        let texts = parts.compactMap(\.text).joined()
                        log.append("◀ text: \(texts)")
                    }
                }
                if sc.turnComplete == true {
                    log.append("✓ turn complete")
                    c.close()
                    status = "idle"
                }
                if sc.interrupted == true {
                    log.append("⚡ interrupted")
                }
            }
            if let tc = msg.toolCall {
                for fc in tc.functionCalls {
                    log.append("🔧 tool: \(fc.name)(\(fc.args ?? [:]))")
                }
            }
            if msg.usageMetadata != nil {
                let u = msg.usageMetadata!
                log.append("📊 tokens: \(u.totalTokenCount ?? 0)")
            }
        }

        c.onError = { error in
            log.append("ERR: \(error.localizedDescription)")
        }

        c.onClose = { code, reason in
            log.append("⏏ closed: \(code.rawValue) \(reason ?? "")")
            status = "idle"
        }

        Task {
            do {
                try await c.connect()
                status = "connected"
                log.append("✓ setupComplete")

                c.sendClientContent(.init(
                    turns: [.text("Hello, say one sentence.", role: "user")],
                    turnComplete: true
                ))
                log.append("→ sent: Hello, say one sentence.")
            } catch {
                log.append("ERR: \(error.localizedDescription)")
                status = "idle"
            }
        }
    }
}
