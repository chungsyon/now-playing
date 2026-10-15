import SwiftUI

/// What the app is, what it does with your things, and whose work it uses.
struct AboutView: View {
    @Environment(\.dismiss) private var dismiss

    private var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? "1"
        return "\(short) (\(build))"
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Now Playing makes the second slide of a carousel: a silent, looping animation that shows a song is attached. Add the real song in Instagram's music picker.")
                }
                Section("Privacy") {
                    Label("Your photos, drafts and styles never leave this phone.", systemImage: "lock")
                    Label("Song search sends only the words you type to Apple's and Deezer's public catalogues. Pasted Spotify and YouTube links are named through their public oEmbed services.", systemImage: "magnifyingglass")
                    Label("No accounts, no tracking, no analytics.", systemImage: "hand.raised")
                }
                Section("Acknowledgements") {
                    NavigationLink("Typefaces") { LicenceText(file: "OFL", title: "Typefaces") }
                    Text("Song details and covers come from the Apple iTunes Search API and the Deezer API. Now Playing is not affiliated with Apple, Deezer, Spotify, YouTube or Instagram.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Section {
                    LabeledContent("Version", value: version)
                }
            }
            .navigationTitle("About")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

private struct LicenceText: View {
    let file: String
    let title: String

    var body: some View {
        ScrollView {
            Text((try? String(contentsOf: Bundle.main.url(forResource: file, withExtension: "txt") ?? URL(fileURLWithPath: "/"), encoding: .utf8)) ?? "")
                .font(.footnote.monospaced())
                .textSelection(.enabled)
                .padding()
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
