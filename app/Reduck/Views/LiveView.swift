import SwiftUI
import MarkdownUI

/// Port of `live/+page.svelte` — main voice/chat interface.
struct LiveView: View {
    let sessionId: String?
    @Environment(SettingsStore.self) private var settings
    @State private var store: LiveStore?
    @State private var inputText = ""

    var body: some View {
        VStack(spacing: 0) {
            if let store {
                // Zone 1: Chat scroll
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(store.messages) { msg in
                                if !msg.isToolResultOnly {
                                    ChatBubbleView(message: msg, toolResultMap: buildToolResultMap(store.messages))
                                        .id(msg.id)
                                }
                            }

                            // Streaming bubble
                            if !store.streamingText.isEmpty {
                                HStack {
                                    Markdown(store.streamingText)
                                        .markdownTextStyle { FontSize(14) }
                                        .padding(4)
                                        .opacity(0.7)
                                    Spacer(minLength: 60)
                                }
                                .id("streaming")
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                    }
                    .onChange(of: store.messages.count) {
                        scrollToBottom(proxy)
                    }
                    .onChange(of: store.streamingText) {
                        scrollToBottom(proxy)
                    }
                }

                Divider()

                // Zone 2: Input bar
                HStack(spacing: 8) {
                    TextField("Reply...", text: $inputText, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(.subheadline)
                        .lineLimit(1...5)
                        .onSubmit { send() }

                    if store.status == .connected {
                        Button(action: { store.abort() }) {
                            Image(systemName: "stop.fill")
                                .font(.caption)
                                .foregroundStyle(.white)
                                .frame(width: 30, height: 30)
                                .background(Color.red)
                                .clipShape(Circle())
                        }
                    } else {
                        Button(action: { send() }) {
                            Image(systemName: "arrow.up")
                                .font(.caption.bold())
                                .foregroundStyle(.white)
                                .frame(width: 30, height: 30)
                                .background(inputText.trimmingCharacters(in: .whitespaces).isEmpty ? Color.gray : Color.accentColor)
                                .clipShape(Circle())
                        }
                        .disabled(inputText.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(.bar)

                // Toast
                if !store.toast.isEmpty {
                    Text(store.toast)
                        .font(.caption)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.red.opacity(0.85))
                        .clipShape(Capsule())
                        .padding(.bottom, 4)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Live")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            let s = LiveStore(settings: settings)
            store = s
            if let sessionId {
                await s.loadHistory(sessionId)
            }
        }
        .animation(.default, value: store?.toast.isEmpty)
    }

    private func send() {
        let text = inputText
        inputText = ""
        store?.sendInstruction(text)
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        if store?.streamingText.isEmpty == false {
            proxy.scrollTo("streaming", anchor: .bottom)
        } else if let last = store?.messages.last {
            proxy.scrollTo(last.id, anchor: .bottom)
        }
    }
}
