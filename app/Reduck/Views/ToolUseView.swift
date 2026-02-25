import SwiftUI

/// Expandable tool_use display — port of the tool-use details from `+page.svelte`.
struct ToolUseView: View {
    let name: String
    let input: [String: JSONValue]
    let result: String?

    @State private var expanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 6) {
                // Show instruction if present, otherwise full input JSON
                if let instruction = input["instruction"]?.stringValue {
                    Text(instruction)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .italic()
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(.systemGray6))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                } else if !input.isEmpty {
                    Text(formatInput(input))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(.systemGray6))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }

                if let result, !result.isEmpty {
                    Text(result)
                        .font(.caption2)
                        .foregroundStyle(.primary)
                        .lineLimit(8)
                }
            }
        } label: {
            Text(name)
                .font(.caption)
                .fontDesign(.monospaced)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Color.purple.opacity(0.1))
                .foregroundStyle(.purple)
                .clipShape(Capsule())
        }
    }

    private func formatInput(_ input: [String: JSONValue]) -> String {
        guard let data = try? JSONEncoder().encode(input),
              let str = String(data: data, encoding: .utf8) else { return "{}" }
        return str
    }
}
