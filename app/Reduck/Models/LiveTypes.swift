import Foundation

/// Port of `chat-types.ts` Status, PendingTool, PendingApproval, etc.

enum Status: Sendable {
    case idle
    case connecting
    case connected
}

enum InteractionMode: String, Codable, Sendable {
    case direct
    case review
}

struct PendingTool: Sendable {
    let name: String
    var args: [String: JSONValue]
    var text: String
    var blocks: [ContentBlock]
    var streaming: Bool
}

struct PendingApproval: Sendable {
    let instruction: String
}

struct VoiceEvent: Identifiable, Sendable {
    let id = UUID()
    let role: VoiceRole
    var text: String
    let ts: Date

    enum VoiceRole: Sendable {
        case user
        case gemini
    }
}

struct Correction: Identifiable, Codable, Sendable {
    let id: String
    let original: String
    let corrected: String
}
