import SwiftUI
import MarkdownUI

/// Port of chat bubble rendering from `live/+page.svelte`.
struct ChatBubbleView: View {
    let message: Message
    let toolResultMap: [String: String]

    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 60) }

            VStack(alignment: .leading, spacing: 4) {
                if message.role == .user {
                    Text(message.textContent)
                        .font(.subheadline)
                } else {
                    // Thinking blocks
                    ForEach(Array(message.thinkingBlocks.enumerated()), id: \.offset) { _, thinking in
                        DisclosureGroup("Thinking...") {
                            Text(thinking)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(10)
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }

                    // Main text (rendered as markdown)
                    let text = message.textContent
                    if !text.isEmpty {
                        Markdown(text)
                            .markdownTextStyle {
                                FontSize(14)
                            }
                    }

                    // Tool uses
                    ForEach(message.toolUses, id: \.id) { tool in
                        ToolUseView(
                            name: tool.name,
                            input: tool.input,
                            result: toolResultMap[tool.id]
                        )
                    }
                }
            }
            .padding(message.role == .user ? EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12) : EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            .background(message.role == .user ? Color(.systemGray6) : .clear)
            .clipShape(RoundedRectangle(cornerRadius: message.role == .user ? 16 : 0))

            if message.role == .assistant { Spacer(minLength: 60) }
        }
    }
}
