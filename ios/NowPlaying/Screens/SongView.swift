import PhotosUI
import SwiftUI

/*
 SONG
 ----
 Find the track, then say where your Instagram clip starts. The clip start is
 what the progress bar on the slide counts from, so the numbers on the slide
 match the ones in Instagram.

 The screen shows either the results or the track you picked, never both:
 with both on screen, the button that continues sits under twenty-five rows.
*/

struct SongView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("np-scope") private var scopeRaw = SearchScope.all.rawValue
    @AppStorage("np-country") private var country = "US"
    @State private var query = ""
    @State private var outcome = SearchOutcome()
    @State private var searching = false
    @State private var notice = ""
    /// The last search failed (offline, or a catalogue error), not "no match".
    @State private var failed = false
    @State private var searchTask: Task<Void, Never>?
    @State private var showingManual = false
    /// Set when the box is filled in by picking a result, not by typing.
    @State private var settingQuery = false

    private var scope: SearchScope { SearchScope(rawValue: scopeRaw) ?? .all }
    private var song: Song { model.project?.song ?? Song() }
    private var chosen: Bool { !song.title.isEmpty && model.browsing != true }

    var body: some View {
        List {
            if chosen {
                ChosenSong(onSearchAgain: { model.browsing = true })
            } else {
                Section {
                    Picker("What to match", selection: Binding(get: { scope }, set: { scopeRaw = $0.rawValue })) {
                        ForEach(SearchScope.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                results
            }

            Section("Not listed") {
                DisclosureGroup("Enter the Details Yourself", isExpanded: $showingManual) {
                    ManualSongForm(onDone: { showingManual = false })
                }
                .tint(Color.accentColor)
            }

            Section {
                HStack {
                    Text("Country")
                    Spacer()
                    TextField("US", text: Binding(get: { country }, set: { country = String($0.uppercased().prefix(2)) }))
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .multilineTextAlignment(.trailing)
                        .frame(width: 60)
                        .onSubmit { search(now: true) }
                }
            } header: {
                Text("Store")
            } footer: {
                Text("Two-letter country code. Korea has no songs in this catalogue, only videos, so searches there fall back to the US store.")
            }
        }
        .navigationTitle("Song")
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Song, artist, or a pasted link")
        .autocorrectionDisabled()
        .onSubmit(of: .search) { search(now: true) }
        .onChange(of: query) { _, text in
            if settingQuery {
                settingQuery = false
                return
            }
            // Typing means you are looking again, so put the results back.
            if !song.title.isEmpty && text.trimmingCharacters(in: .whitespaces) != model.lastQuery { model.browsing = true }
            search(now: false)
        }
        .onChange(of: scopeRaw) { _, _ in if !query.trimmingCharacters(in: .whitespaces).isEmpty { search(now: true) } }
        .onAppear {
            if model.browsing == nil { model.browsing = song.title.isEmpty }
            if query.isEmpty { query = model.lastQuery }
            if model.browsing == true && !query.isEmpty && outcome.songs.isEmpty { search(now: true) }
        }
        .animation(.smooth(duration: 0.3), value: chosen)
    }

    // MARK: - Choosing

    @ViewBuilder
    private var results: some View {
        let reading = searching ? "" : outcome.label ?? outcome.artistName ?? (outcome.songs.isEmpty ? "" : "\(outcome.songs.count) found")
        Section {
            if searching && outcome.songs.isEmpty {
                HStack {
                    Spacer()
                    ProgressView().accessibilityLabel("Searching")
                    Spacer()
                }
                .padding(.vertical, 12)
            } else if outcome.songs.isEmpty {
                emptyState
            } else {
                ForEach(outcome.songs) { hit in
                    ResultRow(hit: hit) { pick(hit) }
                }
            }
        } header: {
            HStack {
                Text("Results")
                Spacer()
                Text(reading).lineLimit(1)
            }
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if !notice.isEmpty && !failed { Text(notice) }
                // A link from a service we cannot look up became a search, so
                // say so rather than letting it look like an exact answer.
                if let service = outcome.viaService, let title = outcome.viaTitle, !searching, !outcome.songs.isEmpty {
                    Text("\(service) only gives the name, so these are matches for \"\(title)\". Check the artist before you pick.")
                }
            }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        VStack(alignment: .leading, spacing: 6) {
            if term.isEmpty {
                Text("Type a song or an artist, or paste a link. Korean and any other script work fine.")
            } else if failed {
                Text(notice)
                Button("Try Again") { search(now: true) }
                    .foregroundStyle(Color.accentColor)
            } else if let unsupported = outcome.unsupported {
                Text("\(unsupported) cannot be opened here.")
                Text("Apple Music, Spotify, YouTube and full Deezer links all work. For anything else, type the song and the artist instead.")
                    .font(.footnote).foregroundStyle(.secondary)
            } else if outcome.linkFailed || parseMusicLink(term) != nil && outcome.viaService == nil {
                Text("That link did not lead anywhere. Try the song name instead.")
            } else if let service = outcome.viaService, let title = outcome.viaTitle {
                Text("That \(service) link is \"\(title)\", but neither catalogue has it.")
                Text("Try the artist name alongside the title, or use By artist.")
                    .font(.footnote).foregroundStyle(.secondary)
            } else if outcome.noMatch {
                Text("Nothing on Apple matches \(term).")
                Text("Short words often match nothing at all. More of the title usually finds it, or switch to By artist and use the performer's name.")
                    .font(.footnote).foregroundStyle(.secondary)
            } else if notice.isEmpty {
                Text(scope == .artist ? "No performer by that name. Try Everything instead."
                                      : "Nothing came back for that. If it is a performer, try By artist.")
            } else {
                Text(notice)
            }
        }
        .foregroundStyle(.secondary)
        .padding(.vertical, 6)
    }

    private func search(now: Bool) {
        searchTask?.cancel()
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        model.lastQuery = term
        guard !term.isEmpty else {
            outcome = SearchOutcome()
            notice = ""
            failed = false
            searching = false
            return
        }
        let scope = self.scope
        let country = self.country.isEmpty ? "US" : self.country
        searchTask = Task {
            if !now { try? await Task.sleep(for: .milliseconds(350)) }
            guard !Task.isCancelled else { return }
            searching = true
            do {
                let found = try await searchSongs(term, scope: scope, country: country)
                guard !Task.isCancelled else { return }
                outcome = found
                failed = false
                notice = found.fellBack ? "The \(country) store had nothing, so this is the US store." : ""
            } catch {
                guard !Task.isCancelled else { return }
                outcome = SearchOutcome()
                failed = true
                notice = (error as? SearchFailure) == .offline
                    ? "No connection. Song search needs one; everything else works offline."
                    : "Something didn't come through. Try once more."
            }
            searching = false
        }
    }

    private func pick(_ hit: SongHit) {
        searchTask?.cancel()
        let line = [hit.title, hit.artist].filter { !$0.isEmpty }.joined(separator: " ")
        model.lastQuery = line
        model.browsing = false
        if query != line {
            settingQuery = true
            query = line
        }
        Task { await model.pickSong(hit) }
    }
}

private struct ResultRow: View {
    let hit: SongHit
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                AsyncImage(url: URL(string: hit.artworkUrl100)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Color(.tertiarySystemFill)
                }
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text(hit.title).foregroundStyle(Color.primary).lineLimit(1)
                    Text([hit.artist, hit.album, hit.year].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.footnote)
                        .foregroundStyle(Color.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 4) {
                    Text(formatTime(hit.durationMs / 1000))
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(Color.secondary)
                    if !hit.version.isEmpty { Tag(text: hit.version) }
                }
            }
        }
        .accessibilityHint("Use this song")
    }
}

/// A small capsule saying which recording a result probably is.
struct Tag: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(Capsule().fill(Color.accentColor.opacity(0.12)))
            .foregroundStyle(Color.accentColor)
    }
}

// MARK: - Chosen

private struct ChosenSong: View {
    let onSearchAgain: () -> Void
    @Environment(AppModel.self) private var model

    var body: some View {
        let song = model.project?.song ?? Song()
        let total = max(1, Int((song.durationMs / 1000).rounded()))
        Section {
            VStack(spacing: 8) {
                CoverThumb(image: model.media.cover, size: 200, radius: 12)
                    .shadow(color: .black.opacity(0.18), radius: 16, y: 8)
                    .padding(.bottom, 6)
                Text(song.title)
                    .font(.title3.weight(.semibold))
                    .multilineTextAlignment(.center)
                Text([song.artist, song.year].filter { !$0.isEmpty }.joined(separator: " · "))
                    .foregroundStyle(.secondary)
                if !song.version.isEmpty { Tag(text: song.version) }
                Button("Choose a Different Song", action: onSearchAgain)
                    .buttonStyle(.borderless)
                    .padding(.top, 4)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
        }

        Section {
            ValueSlider(label: "Starts at",
                        value: Binding(get: { min(song.clipStartSeconds, Double(total - 1)) },
                                       set: { value in model.edit { $0.song.clipStartSeconds = value } }),
                        range: 0...Double(max(1, total - 1)), step: 1, format: formatTime)
        } header: {
            HStack {
                Text("Clip start")
                Spacer()
                Text("\(formatTime(song.clipStartSeconds)) of \(formatTime(Double(total)))").monospacedDigit()
            }
        } footer: {
            Text("Set this where you start the clip in Instagram, so the time on the slide matches the music.")
        }

        Section {
            Button {
                // Back to the editor if it is underneath; on to it if not.
                if let i = model.path.firstIndex(of: .editor) {
                    model.path = Array(model.path.prefix(through: i))
                } else {
                    model.path = [.editor]
                }
            } label: {
                Text("Continue")
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 34)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        }
    }
}

// MARK: - Not listed

private struct ManualSongForm: View {
    let onDone: () -> Void
    @Environment(AppModel.self) private var model
    @State private var title = ""
    @State private var artist = ""
    @State private var album = ""
    @State private var minutes = 0
    @State private var seconds = 0
    @State private var coverItem: PhotosPickerItem?

    var body: some View {
        Group {
            TextField("Song title", text: $title)
            TextField("Artist", text: $artist)
            TextField("Album (optional)", text: $album)
            HStack {
                Text("Length")
                Spacer()
                TextField("0", value: $minutes, format: .number)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 44)
                Text(":")
                TextField("00", value: $seconds, format: .number)
                    .keyboardType(.numberPad)
                    .frame(width: 44)
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Length, minutes and seconds")
            PhotosPicker(selection: $coverItem, matching: .images, photoLibrary: .shared()) {
                Label("Add Your Own Cover", systemImage: "photo")
            }
            Button("Use These Details") {
                let name = title.trimmingCharacters(in: .whitespaces)
                guard !name.isEmpty else {
                    model.toast("A title is the one thing it needs.")
                    return
                }
                model.useManualSong(title: name, artist: artist.trimmingCharacters(in: .whitespaces),
                                    album: album.trimmingCharacters(in: .whitespaces),
                                    seconds: max(0, min(30, minutes)) * 60 + max(0, min(59, seconds)))
                onDone()
            }
            .font(.body.weight(.semibold))
        }
        .onAppear {
            let song = model.project?.song ?? Song()
            title = song.title
            artist = song.artist
            album = song.album
            minutes = Int(song.durationMs / 60000)
            seconds = Int(song.durationMs.truncatingRemainder(dividingBy: 60000) / 1000)
        }
        .onChange(of: coverItem) { _, item in
            guard let item else { return }
            coverItem = nil
            Task {
                guard let data = try? await item.loadTransferable(type: Data.self) else {
                    model.toast("That cover didn't come through. Try another one.")
                    return
                }
                // Kept as a modest JPEG: a cover is never shown bigger than the slide.
                let image = await Task.detached { ImageLoading.decode(data, maxPixels: 1600) }.value
                await model.setCover(image.flatMap { ImageLoading.jpeg($0) })
                model.toast("Cover added.")
            }
        }
    }
}
