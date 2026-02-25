import Foundation

/// API response from `GET /api/sessions`.
/// Port of `types.ts` SessionInfo.
struct SessionInfo: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let summary: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id, name, summary
        case updatedAt = "updated_at"
    }
}
