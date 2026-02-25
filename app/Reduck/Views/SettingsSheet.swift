import SwiftUI

/// Port of the Settings modal from `+page.svelte`.
struct SettingsSheet: View {
    @Environment(SettingsStore.self) private var settings
    @Environment(\.dismiss) private var dismiss

    @State private var keyDraft = ""
    @State private var serverDraft = ""
    @State private var modeDraft: InteractionMode = .direct
    @State private var modelDraft = ""
    @State private var permissionModeDraft = ""
    @State private var readbackDraft = false
    @State private var promptDraft = ""

    var body: some View {
        Form {
            Section("Server") {
                TextField("Server URL", text: $serverDraft)
                    .textContentType(.URL)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            }

            Section("API Key") {
                SecureField("Gemini API Key", text: $keyDraft)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            }

            Section("Preferences") {
                Picker("Mode", selection: $modeDraft) {
                    Text("Direct").tag(InteractionMode.direct)
                    Text("Review").tag(InteractionMode.review)
                }

                Picker("Model", selection: $modelDraft) {
                    Text("Haiku").tag("haiku")
                    Text("Sonnet").tag("sonnet")
                    Text("Opus").tag("opus")
                }

                Picker("Permission Mode", selection: $permissionModeDraft) {
                    Text("Plan").tag("plan")
                    Text("Accept Edits").tag("acceptEdits")
                }

                Toggle("Instruction Readback", isOn: $readbackDraft)
            }

            Section("System Prompt") {
                TextEditor(text: $promptDraft)
                    .font(.caption)
                    .frame(minHeight: 120)

                Button("Reset to Default") {
                    promptDraft = Defaults.systemPrompt
                }
                .foregroundStyle(.red)
            }
        }
        .navigationTitle("Settings")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    save()
                    dismiss()
                }
            }
        }
        .onAppear {
            keyDraft = settings.apiKey ?? ""
            serverDraft = settings.serverURL
            modeDraft = settings.mode
            modelDraft = settings.model
            permissionModeDraft = settings.permissionMode
            readbackDraft = settings.readbackEnabled
            promptDraft = settings.systemPrompt
        }
    }

    private func save() {
        if !keyDraft.trimmingCharacters(in: .whitespaces).isEmpty {
            settings.apiKey = keyDraft.trimmingCharacters(in: .whitespaces)
        }
        settings.serverURL = serverDraft
        settings.mode = modeDraft
        settings.model = modelDraft
        settings.permissionMode = permissionModeDraft
        settings.readbackEnabled = readbackDraft
        settings.systemPrompt = promptDraft
    }
}
