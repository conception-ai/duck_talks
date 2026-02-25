import SwiftUI
import MarkdownUI

/// Port of `live/+page.svelte` — main voice/chat interface.
/// Phase 1: Scaffold only. Voice and streaming wired in later phases.
struct LiveView: View {
    let sessionId: String?
    @Environment(SettingsStore.self) private var settings
    @State private var messages: [Message] = []
    @State private var loading = false

    var body: some View {
        VStack(spacing: 0) {
            // Zone 1: Chat scroll
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(messages) { msg in
                            if !msg.isToolResultOnly {
                                ChatBubbleView(message: msg, toolResultMap: buildToolResultMap(messages))
                                    .id(msg.id)
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                }
                .onChange(of: messages.count) {
                    if let last = messages.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }

            Divider()

            // Zone 2: Input bar (placeholder for now)
            InputBarView()
        }
        .navigationTitle("Live")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if let sessionId {
                await loadHistory(sessionId)
            }
        }
    }

    private func loadHistory(_ id: String) async {
        loading = true
        defer { loading = false }
        do {
            let url = URL(string: "\(settings.baseURL)/api/sessions/\(id)/messages")!
            let (data, _) = try await URLSession.shared.data(from: url)
            messages = try JSONDecoder().decode([Message].self, from: data)
        } catch {
            print("[live] failed to load history: \(error)")
        }
    }
}

/// Placeholder input bar — mic button wired in Phase 4.
struct InputBarView: View {
    var body: some View {
        HStack {
            Text("Reply...")
                .foregroundStyle(.tertiary)
                .font(.subheadline)
            Spacer()
            Button(action: {}) {
                Image(systemName: "mic.fill")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 34, height: 34)
                    .background(Color(.systemGray6))
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.bar)
    }
}
