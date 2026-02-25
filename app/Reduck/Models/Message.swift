import Foundation

/// Port of `chat-types.ts` Message interface.
/// Content can be a plain string (user) or structured blocks (assistant).
struct Message: Identifiable, Sendable {
    let id = UUID()
    var uuid: String?
    let role: Role
    let content: MessageContent

    enum Role: String, Codable, Sendable {
        case user
        case assistant
    }

    enum MessageContent: Sendable {
        case string(String)
        case blocks([ContentBlock])
    }
}

// MARK: - Codable (custom — backend returns heterogeneous `content`)

extension Message: Codable {
    private enum CodingKeys: String, CodingKey {
        case uuid, role, content
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        uuid = try container.decodeIfPresent(String.self, forKey: .uuid)
        role = try container.decode(Role.self, forKey: .role)

        // content is either a string or an array of ContentBlock
        if let str = try? container.decode(String.self, forKey: .content) {
            content = .string(str)
        } else if let blocks = try? container.decode([ContentBlock].self, forKey: .content) {
            content = .blocks(blocks)
        } else {
            content = .string("")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(uuid, forKey: .uuid)
        try container.encode(role, forKey: .role)
        switch content {
        case .string(let str):
            try container.encode(str, forKey: .content)
        case .blocks(let blocks):
            try container.encode(blocks, forKey: .content)
        }
    }
}

// MARK: - Convenience initializers

extension Message {
    static func user(_ text: String) -> Message {
        Message(role: .user, content: .string(text))
    }

    static func assistant(text: String) -> Message {
        Message(role: .assistant, content: .blocks([.text(text)]))
    }

    static func assistant(blocks: [ContentBlock]) -> Message {
        Message(role: .assistant, content: .blocks(blocks))
    }
}
