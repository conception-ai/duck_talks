import Foundation

/// Port of `types.ts` ContentBlock union type.
/// Uses enum with associated values — Swift's equivalent of TS discriminated unions.
enum ContentBlock: Codable, Sendable, Equatable {
    case text(String)
    case thinking(thinking: String, signature: String?)
    case toolUse(id: String, name: String, input: [String: JSONValue])
    case toolResult(toolUseId: String, content: ToolResultContent)
    case image(mediaType: String, data: String)

    enum ToolResultContent: Codable, Sendable, Equatable {
        case string(String)
        case array([[String: JSONValue]])
    }

    // MARK: - Codable

    private enum CodingKeys: String, CodingKey {
        case type
        case text, thinking, signature
        case id, name, input
        case toolUseId = "tool_use_id"
        case content
        case source
    }

    private enum BlockType: String, Codable {
        case text, thinking
        case toolUse = "tool_use"
        case toolResult = "tool_result"
        case image
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(BlockType.self, forKey: .type)

        switch type {
        case .text:
            let text = try container.decode(String.self, forKey: .text)
            self = .text(text)

        case .thinking:
            let thinking = try container.decode(String.self, forKey: .thinking)
            let signature = try container.decodeIfPresent(String.self, forKey: .signature)
            self = .thinking(thinking: thinking, signature: signature)

        case .toolUse:
            let id = try container.decode(String.self, forKey: .id)
            let name = try container.decode(String.self, forKey: .name)
            let input = try container.decodeIfPresent([String: JSONValue].self, forKey: .input) ?? [:]
            self = .toolUse(id: id, name: name, input: input)

        case .toolResult:
            let toolUseId = try container.decode(String.self, forKey: .toolUseId)
            if let str = try? container.decode(String.self, forKey: .content) {
                self = .toolResult(toolUseId: toolUseId, content: .string(str))
            } else if let arr = try? container.decode([[String: JSONValue]].self, forKey: .content) {
                self = .toolResult(toolUseId: toolUseId, content: .array(arr))
            } else {
                self = .toolResult(toolUseId: toolUseId, content: .string(""))
            }

        case .image:
            let source = try container.decode(ImageSource.self, forKey: .source)
            self = .image(mediaType: source.mediaType, data: source.data)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case .text(let text):
            try container.encode("text", forKey: .type)
            try container.encode(text, forKey: .text)

        case .thinking(let thinking, let signature):
            try container.encode("thinking", forKey: .type)
            try container.encode(thinking, forKey: .thinking)
            try container.encodeIfPresent(signature, forKey: .signature)

        case .toolUse(let id, let name, let input):
            try container.encode("tool_use", forKey: .type)
            try container.encode(id, forKey: .id)
            try container.encode(name, forKey: .name)
            try container.encode(input, forKey: .input)

        case .toolResult(let toolUseId, let content):
            try container.encode("tool_result", forKey: .type)
            try container.encode(toolUseId, forKey: .toolUseId)
            switch content {
            case .string(let str):
                try container.encode(str, forKey: .content)
            case .array(let arr):
                try container.encode(arr, forKey: .content)
            }

        case .image(let mediaType, let data):
            try container.encode("image", forKey: .type)
            try container.encode(ImageSource(mediaType: mediaType, data: data), forKey: .source)
        }
    }

    private struct ImageSource: Codable, Sendable, Equatable {
        let type: String = "base64"
        let mediaType: String
        let data: String

        enum CodingKeys: String, CodingKey {
            case type
            case mediaType = "media_type"
            case data
        }
    }
}

// MARK: - JSONValue (type-safe Any replacement for tool inputs)

/// Recursive JSON value type — avoids `Any` while staying Codable.
enum JSONValue: Codable, Sendable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let bool = try? container.decode(Bool.self) {
            self = .bool(bool)
        } else if let num = try? container.decode(Double.self) {
            self = .number(num)
        } else if let str = try? container.decode(String.self) {
            self = .string(str)
        } else if let obj = try? container.decode([String: JSONValue].self) {
            self = .object(obj)
        } else if let arr = try? container.decode([JSONValue].self) {
            self = .array(arr)
        } else {
            self = .null
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let v): try container.encode(v)
        case .number(let v): try container.encode(v)
        case .bool(let v): try container.encode(v)
        case .object(let v): try container.encode(v)
        case .array(let v): try container.encode(v)
        case .null: try container.encodeNil()
        }
    }

    /// Convenience: extract string value if this is `.string`.
    var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }
}
