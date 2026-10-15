import Foundation

/*
 SEARCH
 ------
 Asks both catalogues at once and works out what to show. Neither is good
 enough alone and they fail in opposite directions, so both are asked, the
 answers merged, and every result scored by how many of the words you typed
 it actually contains. Apple answers an unmatchable query with popular filler
 rather than nothing; scoring is what throws that away.
*/

enum SearchScope: String, CaseIterable, Identifiable, Sendable {
    case all, artist
    var id: String { rawValue }
    var label: String { self == .all ? "Everything" : "By artist" }
}

struct SearchOutcome: Sendable {
    var songs: [SongHit] = []
    /// Whose catalogue an artist search found, or the performer Apple read
    /// the words as.
    var artistName: String?
    /// The album or performer a pasted link opened.
    var label: String?
    var noMatch = false
    var unsupported: String?
    var linkFailed = false
    var viaService: String?
    var viaTitle: String?
    var searchedCountry = "US"
    var fellBack = false
}

// MARK: - Scoring

/// Lower case, spacing and punctuation out, so 너랑 나 matches 너랑나.
func flatten(_ text: String) -> String {
    text.lowercased().replacingOccurrences(of: #"[\s\-_'".,()\[\]/&!?:;]+"#, with: "", options: .regularExpression)
}

/// The words worth matching on. Single characters are too loose to count.
func queryTokens(_ term: String) -> [String] {
    term.lowercased()
        .components(separatedBy: CharacterSet(charactersIn: " \t\n,./&-_"))
        .map(flatten)
        .filter { $0.count >= 2 }
}

/**
 How well a result answers what you typed. A word in the title or artist is
 worth two, one in the album worth one, and a title that is exactly what you
 typed takes one more, so radiohead creep finds Creep before Creep (Acoustic).
 */
func score(_ song: SongHit, _ tokens: [String]) -> Int {
    if tokens.isEmpty { return 1 }
    let front = flatten("\(song.title) \(song.artist)")
    let back = flatten(song.album)
    var points = 0
    for token in tokens {
        if front.contains(token) { points += 2 } else if back.contains(token) { points += 1 }
    }
    if points > 0 && tokens.contains(flatten(song.title)) { points += 1 }
    return points
}

/// The performer behind the largest share of a batch. A real artist match
/// comes back as one catalogue (0.63 to 0.92 measured); filler scatters
/// (0.08 to 0.15). Half is a safe line.
func dominantArtist(_ songs: [SongHit]) -> (artist: String?, share: Double) {
    var counts: [String: Int] = [:]
    var order: [String] = []
    for song in songs {
        if counts[song.artist] == nil { order.append(song.artist) }
        counts[song.artist, default: 0] += 1
    }
    var best = 0
    var artist: String?
    for name in order where counts[name]! > best { best = counts[name]!; artist = name }
    return (artist, songs.isEmpty ? 0 : Double(best) / Double(songs.count))
}

/// A guess at which recording this is, so near-identical results differ.
func versionTag(_ song: SongHit) -> String {
    let text = "\(song.title) \(song.album)".lowercased()
    if matches(#"\blive\b|live at|live from|live in"#, text) { return "Live" }
    if text.contains("remaster") { return "Remaster" }
    if matches("acoustic|unplugged", text) { return "Acoustic" }
    if matches(#"\bdemo\b"#, text) { return "Demo" }
    if matches(#"instrumental|\(inst\.?\)|\[inst\.?\]"#, text) { return "Instrumental" }
    if matches(#"\bcover\b"#, text) { return "Cover" }
    return "Original"
}

/// The same recording from both catalogues is still one recording. Apple
/// wins ties: it carries the release year.
func dedupe(_ songs: [SongHit]) -> [SongHit] {
    var seen: [String: Int] = [:]
    var out: [SongHit] = []
    for song in songs {
        let key = "\(flatten(song.title))|\(flatten(song.artist))"
        if let i = seen[key] {
            if out[i].source == .deezer && song.source == .itunes { out[i] = song }
        } else {
            seen[key] = out.count
            out.append(song)
        }
    }
    return out
}

private func tagged(_ songs: [SongHit]) -> [SongHit] {
    songs.map { var s = $0; s.version = versionTag(s); return s }
}

private func uniqueById(_ songs: [SongHit]) -> [SongHit] {
    var seen = Set<String>()
    return songs.filter { seen.insert($0.id).inserted }
}

// MARK: - The search itself

/// Ask both at once. One failing is fine; only both failing is an error.
private func both<A: Sendable, B: Sendable>(_ a: @escaping @Sendable () async throws -> A,
                                            _ b: @escaping @Sendable () async throws -> B) async throws -> (A?, B?) {
    async let first: Result<A, Error> = { do { return .success(try await a()) } catch { return .failure(error) } }()
    async let second: Result<B, Error> = { do { return .success(try await b()) } catch { return .failure(error) } }()
    let (x, y) = await (first, second)
    switch (x, y) {
    case let (.failure(error), .failure):
        throw error
    default:
        return (try? x.get(), try? y.get())
    }
}

func searchSongs(_ term: String, scope: SearchScope, country: String) async throws -> SearchOutcome {
    let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
    var empty = SearchOutcome()
    empty.searchedCountry = country
    if trimmed.isEmpty { return empty }

    // A pasted address is answered directly rather than searched for.
    if let link = parseMusicLink(trimmed) {
        var out = await openLink(link, country: country)
        out.searchedCountry = country
        return out
    }

    var found = scope == .artist ? try await gatherByArtist(trimmed, country) : try await gatherEverything(trimmed, country)
    // Some stores carry no songs at all (Korea's has only videos, which have
    // no length). If nothing came back anywhere, try the US store.
    if found.songs.isEmpty && !found.noMatch && country != "US" {
        let retry = scope == .artist ? try await gatherByArtist(trimmed, "US") : try await gatherEverything(trimmed, "US")
        if !retry.songs.isEmpty {
            var out = retry
            out.searchedCountry = "US"
            out.fellBack = true
            return out
        }
    }
    found.searchedCountry = country
    return found
}

private func gatherEverything(_ term: String, _ country: String) async throws -> SearchOutcome {
    let (apple, deezer) = try await both({ try await AppleCatalog.searchTracks(term, country: country) },
                                         { try await DeezerCatalog.searchTracks(term) })
    let all = dedupe((apple ?? []) + (deezer ?? []))
    if all.isEmpty { return SearchOutcome() }

    let tokens = queryTokens(term)
    let hits = all.map { ($0, score($0, tokens)) }
        .filter { $0.1 > 0 }
        .enumerated()
        .sorted { $0.element.1 != $1.element.1 ? $0.element.1 > $1.element.1 : $0.offset < $1.offset }
        .map { $0.element.0 }

    // Apple may have read the words as a performer it files under another
    // spelling. Both signals are used: 뉴진스 turns up one cover by name while
    // Apple quietly has the whole NewJeans catalogue under a name that
    // matches nothing.
    let onlyApple = apple ?? []
    let (artist, share) = dominantArtist(onlyApple)
    let byArtist = artist != nil && share >= 0.5 ? onlyApple.filter { $0.artist == artist } : []

    if hits.isEmpty && byArtist.isEmpty {
        var out = SearchOutcome()
        out.noMatch = true
        return out
    }
    var out = SearchOutcome()
    out.songs = tagged(uniqueById(hits + byArtist))
    out.artistName = byArtist.isEmpty ? nil : artist
    return out
}

private func gatherByArtist(_ term: String, _ country: String) async throws -> SearchOutcome {
    let (apple, deezer) = try await both({ try await AppleCatalog.searchArtistTracks(term, country: country) },
                                         { try await DeezerCatalog.searchArtistTracks(term) })
    var out = SearchOutcome()
    out.songs = tagged(dedupe((apple?.songs ?? []) + (deezer?.songs ?? [])))
    // Name whichever catalogue actually found somebody, Apple first.
    out.artistName = apple?.artist ?? deezer?.artist
    return out
}

/// Open what a pasted address points at. A track comes back alone; an album
/// or a performer comes back as a list, named in the heading.
private func openLink(_ link: MusicLink, country: String) async -> SearchOutcome {
    var out = SearchOutcome()
    switch link {
    case .unsupported(let what):
        out.unsupported = what
    case let .oembed(source, address):
        // Spotify and YouTube can only be asked what a link is called; that
        // name is then searched for. A search, not a lookup, so the screen
        // says so.
        do {
            guard let named = try await OEmbed.resolve(source, address) else {
                out.linkFailed = true
                return out
            }
            let found = try await gatherEverything(named.query, country)
            out.songs = found.songs
            out.label = named.title
            out.viaService = source == .spotify ? "Spotify" : "YouTube"
            out.viaTitle = named.title
            out.noMatch = found.songs.isEmpty
        } catch {
            out.linkFailed = true
        }
    case let .lookup(source, kind, id):
        do {
            switch (source, kind) {
            case (.itunes, .track):
                out.songs = tagged([try await AppleCatalog.lookup(id, country: country)].compactMap { $0 })
            case (.itunes, _):
                let found = try await AppleCatalog.tracks(id, country: country)
                out.songs = tagged(found.songs)
                out.label = found.label
            case (.deezer, .track):
                out.songs = tagged([try await DeezerCatalog.track(id)].compactMap { $0 })
            case (.deezer, .album):
                let found = try await DeezerCatalog.album(id)
                out.songs = tagged(found.songs)
                out.label = found.label
            case (.deezer, .artist):
                let found = try await DeezerCatalog.artist(id)
                out.songs = tagged(found.songs)
                out.label = found.label
            }
        } catch {
            out.linkFailed = true
        }
    }
    return out
}
