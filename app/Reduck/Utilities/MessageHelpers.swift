import Foundation

/// Port of `message-helpers.ts` — pure functions on Message.

extension Message {
    /// Extract all text from message content.
    var textContent: String {
        switch content {
        case .string(let str):
            return str
        case .blocks(let blocks):
            return blocks.compactMap { block in
                if case .text(let text) = block { return text }
                return nil
            }.joined(separator: "\n")
        }
    }

    /// Extract tool_use blocks.
    var toolUses: [(id: String, name: String, input: [String: JSONValue])] {
        guard case .blocks(let blocks) = content else { return [] }
        return blocks.compactMap { block in
            if case .toolUse(let id, let name, let input) = block {
                return (id: id, name: name, input: input)
            }
            return nil
        }
    }

    /// Extract thinking blocks.
    var thinkingBlocks: [String] {
        guard case .blocks(let blocks) = content else { return [] }
        return blocks.compactMap { block in
            if case .thinking(let thinking, _) = block { return thinking }
            return nil
        }
    }

    /// Check if this is a user message containing only tool_result blocks.
    var isToolResultOnly: Bool {
        guard role == .user, case .blocks(let blocks) = content else { return false }
        return blocks.allSatisfy { block in
            if case .toolResult = block { return true }
            return false
        }
    }
}

/// Build a map of tool_use_id → result text from all messages.
/// Port of `buildToolResultMap()`.
func buildToolResultMap(_ messages: [Message]) -> [String: String] {
    var map: [String: String] = [:]
    for msg in messages {
        guard case .blocks(let blocks) = msg.content else { continue }
        for block in blocks {
            if case .toolResult(let toolUseId, let content) = block {
                switch content {
                case .string(let str):
                    map[toolUseId] = str
                case .array(let arr):
                    if let data = try? JSONEncoder().encode(arr) {
                        map[toolUseId] = String(data: data, encoding: .utf8) ?? ""
                    }
                }
            }
        }
    }
    return map
}
