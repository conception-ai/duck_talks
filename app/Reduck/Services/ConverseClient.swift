import Foundation

/// Port of `converse.ts` — SSE stream consumer for `/api/converse`.
/// Uses URLSession.AsyncBytes to parse SSE events.
final class ConverseClient: Sendable {
    let baseURL: String

    init(baseURL: String) {
        self.baseURL = baseURL
    }

    struct Config: Sendable {
        let model: String
        let systemPrompt: String
        let permissionMode: String
    }

    /// Stream a converse request. Calls onChunk for text deltas, onBlock for content blocks,
    /// onDone when complete. Mirrors the SSE protocol from routes.ts.
    func stream(
        instruction: String,
        sessionId: String?,
        leafUuid: String?,
        config: Config,
        onChunk: @MainActor @Sendable @escaping (String) -> Void,
        onBlock: @MainActor @Sendable @escaping (Data) -> Void,
        onDone: @MainActor @Sendable @escaping (String?, Double?, Int?) -> Void,
        onError: @MainActor @Sendable @escaping (String) -> Void
    ) async {
        guard let url = URL(string: "\(baseURL)/api/converse") else {
            await onError("Invalid server URL")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var payload: [String: Any] = [
            "instruction": instruction,
            "model": config.model,
            "system_prompt": config.systemPrompt,
            "permission_mode": config.permissionMode,
        ]
        if let sid = sessionId { payload["session_id"] = sid }
        if let lid = leafUuid { payload["leaf_uuid"] = lid }

        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        do {
            let (bytes, response) = try await URLSession.shared.bytes(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                await onError("Server returned \(code)")
                return
            }

            var buf = ""
            for try await line in bytes.lines {
                buf += line + "\n"

                if line.isEmpty {
                    for part in buf.components(separatedBy: "\n") {
                        let trimmed = part.trimmingCharacters(in: .whitespaces)
                        guard trimmed.hasPrefix("data: ") else { continue }
                        let json = String(trimmed.dropFirst(6))
                        guard let data = json.data(using: .utf8),
                              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }

                        if let text = obj["text"] as? String {
                            await onChunk(text)
                        }
                        if let block = obj["block"] as? [String: Any],
                           let blockData = try? JSONSerialization.data(withJSONObject: block) {
                            await onBlock(blockData)
                        }
                        if obj["done"] as? Bool == true {
                            let sid = obj["session_id"] as? String
                            let cost = obj["cost_usd"] as? Double
                            let duration = obj["duration_ms"] as? Int
                            if let err = obj["error"] as? String {
                                await onError(err)
                            }
                            await onDone(sid, cost, duration)
                        }
                    }
                    buf = ""
                }
            }
        } catch {
            await onError(error.localizedDescription)
        }
    }
}
