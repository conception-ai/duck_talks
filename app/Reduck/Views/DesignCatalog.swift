import SwiftUI
import MarkdownUI

/// Isolated catalog of every visual state — no backend, no stores.
/// Designer can open this from the session list toolbar and iterate freely.
struct DesignCatalog: View {
    var body: some View {
        List {
            Section("Chat Bubbles") {
                // User message
                ChatBubbleView(
                    message: .user("Can you refactor the auth module to use JWT?"),
                    toolResultMap: [:]
                )

                // Short assistant text
                ChatBubbleView(
                    message: .assistant(text: "Sure, I'll update the auth module to use JWT tokens."),
                    toolResultMap: [:]
                )

                // Long assistant with markdown
                ChatBubbleView(
                    message: .assistant(text: """
                    I've made the following changes:

                    1. Replaced session cookies with **JWT tokens**
                    2. Added `jsonwebtoken` as a dependency
                    3. Updated the middleware in `auth.ts`

                    The token expires after 24 hours. You can configure this in `config.ts`.
                    """),
                    toolResultMap: [:]
                )

                // Thinking + text
                ChatBubbleView(
                    message: .assistant(blocks: [
                        .thinking(
                            thinking: "The user wants JWT auth. I need to check the current auth setup first, then replace the session-based approach. Let me look at the middleware...",
                            signature: nil
                        ),
                        .text("I'll refactor the auth module. Let me start by reading the current implementation."),
                    ]),
                    toolResultMap: [:]
                )

                // Tool use (no result yet)
                ChatBubbleView(
                    message: .assistant(blocks: [
                        .text("Let me read the current auth setup."),
                        .toolUse(id: "tool-1", name: "Read", input: [
                            "file_path": .string("/src/auth/middleware.ts"),
                        ]),
                    ]),
                    toolResultMap: [:]
                )

                // Tool use with result
                ChatBubbleView(
                    message: .assistant(blocks: [
                        .text("Here's what I found:"),
                        .toolUse(id: "tool-2", name: "Read", input: [
                            "file_path": .string("/src/auth/middleware.ts"),
                        ]),
                        .toolUse(id: "tool-3", name: "Edit", input: [
                            "file_path": .string("/src/auth/middleware.ts"),
                            "instruction": .string("Replace session check with JWT verification"),
                        ]),
                    ]),
                    toolResultMap: [
                        "tool-2": "export function authMiddleware(req, res, next) {\n  const session = req.session;\n  if (!session?.userId) return res.status(401).send('Unauthorized');\n  next();\n}",
                        "tool-3": "Applied edit successfully.",
                    ]
                )
            }

            Section("Streaming States") {
                // Simulated streaming bubble (static preview)
                HStack {
                    Markdown("I'm looking at the codebase now and will make the changes to...")
                        .markdownTextStyle { FontSize(14) }
                        .padding(4)
                        .opacity(0.7)
                    Spacer(minLength: 60)
                }
            }

            Section("Input Bar — Idle") {
                InputBarPreview(status: .idle, text: "")
                InputBarPreview(status: .idle, text: "Fix the login bug")
            }

            Section("Input Bar — Connected") {
                InputBarPreview(status: .connected, text: "")
            }

            Section("Toast") {
                Text("Failed to load: connection refused")
                    .font(.caption)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color.red.opacity(0.85))
                    .clipShape(Capsule())
            }

            Section("Session Row") {
                SessionRowPreview(
                    name: "Refactor auth module",
                    summary: "Updated JWT handling and middleware",
                    time: "5m ago"
                )
                SessionRowPreview(
                    name: "Fix CI pipeline",
                    summary: "Resolved flaky test in user-service by adding retry logic",
                    time: "2h ago"
                )
                SessionRowPreview(
                    name: "Add dark mode",
                    summary: "",
                    time: "3d ago"
                )
            }

            Section("Empty States") {
                ContentUnavailableView(
                    "No Sessions",
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text("Start a new conversation")
                )
                .frame(height: 200)

                ContentUnavailableView(
                    "Failed to Load",
                    systemImage: "exclamationmark.triangle",
                    description: Text("Could not connect to server")
                )
                .frame(height: 200)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Design Catalog")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Preview Helpers (private to this file)

private struct InputBarPreview: View {
    let status: Status
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            if status == .connected {
                Text("Listening...")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button(action: {}) {
                    Image(systemName: "stop.fill")
                        .font(.caption)
                        .foregroundStyle(.white)
                        .frame(width: 30, height: 30)
                        .background(Color.red)
                        .clipShape(Circle())
                }
            } else {
                Text(text.isEmpty ? "Reply..." : text)
                    .font(.subheadline)
                    .foregroundStyle(text.isEmpty ? .tertiary : .primary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button(action: {}) {
                    Image(systemName: "arrow.up")
                        .font(.caption.bold())
                        .foregroundStyle(.white)
                        .frame(width: 30, height: 30)
                        .background(text.isEmpty ? Color.gray : Color.accentColor)
                        .clipShape(Circle())
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }
}

private struct SessionRowPreview: View {
    let name: String
    let summary: String
    let time: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(name)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .lineLimit(1)
                Spacer()
                Text(time)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if !summary.isEmpty {
                Text(summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
    }
}

#Preview {
    NavigationStack {
        DesignCatalog()
    }
}
