import SwiftUI

@main
struct ReduckApp: App {
    @State private var settings = SettingsStore()

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                SessionListView()
            }
            .environment(settings)
        }
    }
}
