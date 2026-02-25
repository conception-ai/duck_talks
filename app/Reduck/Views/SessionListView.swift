import SwiftUI

/// Port of `home/+page.svelte` — session list with navigation to LiveView.
struct SessionListView: View {
    @Environment(SettingsStore.self) private var settings
    @State private var sessions: [SessionInfo] = []
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        Group {
            if loading {
                ProgressView("Loading...")
                    .foregroundStyle(.secondary)
            } else if let error {
                ContentUnavailableView(
                    "Failed to Load",
                    systemImage: "exclamationmark.triangle",
                    description: Text(error)
                )
            } else if sessions.isEmpty {
                ContentUnavailableView(
                    "No Sessions",
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text("Start a new conversation")
                )
            } else {
                List(sessions) { session in
                    NavigationLink(value: session.id) {
                        SessionRow(session: session)
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Sessions")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: "new") {
                    Text("New")
                }
            }
            ToolbarItem(placement: .topBarLeading) {
                NavigationLink(destination: SettingsSheet()) {
                    Image(systemName: "gear")
                }
            }
        }
        .navigationDestination(for: String.self) { value in
            if value == "new" {
                LiveView(sessionId: nil)
            } else {
                LiveView(sessionId: value)
            }
        }
        .task {
            await loadSessions()
        }
        .refreshable {
            await loadSessions()
        }
    }

    private func loadSessions() async {
        loading = true
        error = nil
        do {
            let url = URL(string: "\(settings.baseURL)/api/sessions")!
            let (data, _) = try await URLSession.shared.data(from: url)
            sessions = try JSONDecoder().decode([SessionInfo].self, from: data)
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }
}

private struct SessionRow: View {
    let session: SessionInfo

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(session.name)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .lineLimit(1)
                Spacer()
                Text(relativeTime(session.updatedAt))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if !session.summary.isEmpty {
                Text(session.summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
    }

    private func relativeTime(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: iso) else { return "" }
        let diff = Date().timeIntervalSince(date)
        let mins = Int(diff / 60)
        if mins < 1 { return "just now" }
        if mins < 60 { return "\(mins)m ago" }
        let hours = mins / 60
        if hours < 24 { return "\(hours)h ago" }
        return "\(hours / 24)d ago"
    }
}
