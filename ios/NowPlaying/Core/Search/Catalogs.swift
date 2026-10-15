import Foundation

/*
 THE TWO CATALOGUES
 ------------------
 Apple's iTunes Search API and Deezer's public API. Neither needs a key or an
 account. Only the words you type leave this device; nothing about your photo
 or your project is ever sent.

 Apple is better at Korean artist names (it files 아이유 under IU); Deezer
 indexes Korean song titles (작업 finds 23 real tracks there and none at Apple).
 So both are asked, and Search.swift merges them.
*/

/// One track, from either catalogue, in one shape.
struct SongHit: Identifiable, Hashable, Sendable {
    var id: String
    var source: CatalogSource
    var title: String
    var artist: String
    var album: String
    var year: String
    var durationMs: Double
    var artworkUrl100: String
    /// Biggest first; whichever loads is the one that gets drawn.
    var coverUrls: [String]
    var version = ""

    var asSong: Song {
        Song(id: id, source: source.rawValue, title: title, artist: artist, album: album, year: year,
             durationMs: durationMs, version: version, artworkUrl100: artworkUrl100, coverUrls: coverUrls,
             clipStartSeconds: 0)
    }
}

enum SearchFailure: Error { case offline, failed }

/// How long to wait before giving up on either catalogue.
let searchTimeout: TimeInterval = 12

func getJSON(_ url: URL) async throws -> [String: Any] {
    var request = URLRequest(url: url, timeoutInterval: searchTimeout)
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    do {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw SearchFailure.failed }
        return (try JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    } catch let error as URLError where [.notConnectedToInternet, .networkConnectionLost, .dataNotAllowed].contains(error.code) {
        throw SearchFailure.offline
    }
}

private func url(_ base: String, _ query: [String: String]) -> URL {
    var parts = URLComponents(string: base)!
    parts.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
    return parts.url!
}

// MARK: - Apple

enum AppleCatalog {
    static let base = "https://itunes.apple.com"

    /// Apple serves any size of cover by rewriting the filename.
    static func artwork(_ url100: String, _ size: Int) -> String {
        url100.replacingOccurrences(of: #"/\d+x\d+bb\."#, with: "/\(size)x\(size)bb.", options: .regularExpression)
    }

    static func normalise(_ t: [String: Any]) -> SongHit? {
        guard let id = t["trackId"] as? Int, let ms = t["trackTimeMillis"] as? Double ?? (t["trackTimeMillis"] as? Int).map(Double.init),
              ms > 0 else { return nil }
        let art = t["artworkUrl100"] as? String ?? ""
        return SongHit(
            id: "it\(id)", source: .itunes,
            title: t["trackName"] as? String ?? "",
            artist: t["artistName"] as? String ?? "",
            album: t["collectionName"] as? String ?? "",
            year: String((t["releaseDate"] as? String ?? "").prefix(4)),
            durationMs: ms, artworkUrl100: art,
            coverUrls: art.isEmpty ? [] : [artwork(art, 1200), artwork(art, 600), art]
        )
    }

    static func searchTracks(_ term: String, country: String) async throws -> [SongHit] {
        let data = try await getJSON(url(base + "/search", ["term": term, "entity": "song", "limit": "25", "country": country]))
        return (data["results"] as? [[String: Any]] ?? []).compactMap(normalise)
    }

    /// Find the performer, then ask for their catalogue by id.
    static func searchArtistTracks(_ term: String, country: String) async throws -> (songs: [SongHit], artist: String?) {
        let found = try await getJSON(url(base + "/search", ["term": term, "entity": "musicArtist", "limit": "5", "country": country]))
        guard let artist = (found["results"] as? [[String: Any]] ?? []).first(where: { $0["artistId"] != nil }),
              let artistId = artist["artistId"] as? Int else { return ([], nil) }
        let data = try await getJSON(url(base + "/lookup", ["id": String(artistId), "entity": "song", "limit": "50", "country": country]))
        let rows = data["results"] as? [[String: Any]] ?? []
        return (rows.filter { $0["wrapperType"] as? String == "track" }.compactMap(normalise), artist["artistName"] as? String)
    }

    static func lookup(_ id: String, country: String) async throws -> SongHit? {
        let data = try await getJSON(url(base + "/lookup", ["id": id, "country": country]))
        return (data["results"] as? [[String: Any]] ?? []).lazy.compactMap(normalise).first
    }

    /// Everything on an album or by a performer. The first row describes the
    /// album or the artist rather than a track, and names the heading.
    static func tracks(_ id: String, country: String) async throws -> (songs: [SongHit], label: String?) {
        let data = try await getJSON(url(base + "/lookup", ["id": id, "entity": "song", "limit": "60", "country": country]))
        let rows = data["results"] as? [[String: Any]] ?? []
        let owner = rows.first { $0["wrapperType"] as? String != "track" }
        return (rows.filter { $0["wrapperType"] as? String == "track" }.compactMap(normalise),
                owner.flatMap { $0["collectionName"] as? String ?? $0["artistName"] as? String })
    }
}

// MARK: - Deezer

enum DeezerCatalog {
    static let base = "https://api.deezer.com"

    static func normalise(_ t: [String: Any], album: [String: Any]? = nil) -> SongHit? {
        guard let id = t["id"] as? Int, let duration = t["duration"] as? Int, duration > 0,
              let title = t["title"] as? String, !title.isEmpty else { return nil }
        let a = album ?? t["album"] as? [String: Any] ?? [:]
        let artist = (t["artist"] as? [String: Any])?["name"] as? String ?? ""
        return SongHit(
            id: "dz\(id)", source: .deezer, title: title, artist: artist,
            album: a["title"] as? String ?? "",
            // Deezer's search results carry no release year.
            year: "", durationMs: Double(duration) * 1000,
            artworkUrl100: a["cover_small"] as? String ?? a["cover_medium"] as? String ?? "",
            coverUrls: ["cover_xl", "cover_big", "cover_medium"].compactMap { a[$0] as? String }
        )
    }

    static func searchTracks(_ term: String) async throws -> [SongHit] {
        let data = try await getJSON(url(base + "/search", ["q": term, "limit": "25"]))
        return (data["data"] as? [[String: Any]] ?? []).compactMap { normalise($0) }
    }

    static func searchArtistTracks(_ term: String) async throws -> (songs: [SongHit], artist: String?) {
        let found = try await getJSON(url(base + "/search/artist", ["q": term, "limit": "5"]))
        guard let artist = (found["data"] as? [[String: Any]])?.first, let id = artist["id"] as? Int else { return ([], nil) }
        let top = try await getJSON(url(base + "/artist/\(id)/top", ["limit": "50"]))
        return ((top["data"] as? [[String: Any]] ?? []).compactMap { normalise($0) }, artist["name"] as? String)
    }

    /// One track, by id. Deezer gives a release date here, which search does not.
    static func track(_ id: String) async throws -> SongHit? {
        let t = try await getJSON(url(base + "/track/\(id)", [:]))
        guard var song = normalise(t) else { return nil }
        song.year = String((t["release_date"] as? String ?? "").prefix(4))
        return song
    }

    static func album(_ id: String) async throws -> (songs: [SongHit], label: String?) {
        let album = try await getJSON(url(base + "/album/\(id)", [:]))
        let rows = (album["tracks"] as? [String: Any])?["data"] as? [[String: Any]] ?? []
        let year = String((album["release_date"] as? String ?? "").prefix(4))
        // Tracks inside an album carry no album block, so it comes from around them.
        let songs = rows.compactMap { row -> SongHit? in
            guard var song = normalise(row, album: album) else { return nil }
            song.year = year
            return song
        }
        return (songs, album["title"] as? String)
    }

    static func artist(_ id: String) async throws -> (songs: [SongHit], label: String?) {
        async let artist = getJSON(url(base + "/artist/\(id)", [:]))
        async let top = getJSON(url(base + "/artist/\(id)/top", ["limit": "50"]))
        let (a, t) = try await (artist, top)
        return ((t["data"] as? [[String: Any]] ?? []).compactMap { normalise($0) }, a["name"] as? String)
    }
}

// MARK: - Spotify and YouTube links

/*
 Neither can be looked up the way Apple and Deezer can. Both offer a public,
 keyless oEmbed endpoint that names what a link points at, which is enough to
 turn the link into a search. It is a search and not a lookup, so the screen
 says so.
*/
enum OEmbed {
    struct Named: Sendable {
        var query: String
        var title: String
        var artist: String
    }

    /// The words uploaders add that are about the video rather than the song.
    /// Anything that might be part of a real title, such as (feat. ...) or
    /// (Acoustic), is left alone.
    static let furniture = [
        #"\[[^\]]*\b(official|lyrics?|lyric|audio|video|mv|m/v|visuali[sz]er|teaser|performance)\b[^\]]*\]"#,
        #"\([^)]*\b(official|lyrics?|lyric|audio|video|mv|m/v|visuali[sz]er|teaser|performance)\b[^)]*\)"#,
        #"\([^)]*\b(\d+k|hd|hq|remaster(ed)?|full\s*version)\b[^)]*\)"#,
        #"\b(official\s+)?(music\s+)?video\b"#,
        #"\bfull\s+album\b"#,
    ]

    static func tidyTitle(_ title: String) -> String {
        var text = title
        for pattern in furniture {
            text = text.replacingOccurrences(of: pattern, with: " ", options: [.regularExpression, .caseInsensitive])
        }
        text = text.replacingOccurrences(of: #"\s{2,}"#, with: " ", options: .regularExpression)
        text = text.replacingOccurrences(of: #"[\s\-|·]+$"#, with: "", options: .regularExpression)
        return text.trimmingCharacters(in: .whitespaces)
    }

    /// "Rick Astley - Topic" and "ArtistVEVO" are channels, not artists.
    static func tidyChannel(_ name: String) -> String {
        var text = name
        for pattern in [#"\s*-\s*Topic$"#, #"VEVO$"#, #"\s*-\s*Official$"#] {
            text = text.replacingOccurrences(of: pattern, with: "", options: [.regularExpression, .caseInsensitive])
        }
        return text.trimmingCharacters(in: .whitespaces)
    }

    /// Join the two without saying the artist twice.
    static func query(_ title: String, _ artist: String) -> String {
        let clean = tidyTitle(title)
        let who = tidyChannel(artist)
        if who.isEmpty || clean.lowercased().contains(who.lowercased()) { return clean }
        return "\(clean) \(who)".trimmingCharacters(in: .whitespaces)
    }

    static func resolve(_ source: OEmbedSource, _ link: String) async throws -> Named? {
        let endpoint = source == .spotify
            ? url("https://open.spotify.com/oembed", ["url": link])
            : url("https://www.youtube.com/oembed", ["format": "json", "url": link])
        let data = try await getJSON(endpoint)
        guard let title = data["title"] as? String, !title.isEmpty else { return nil }
        // YouTube names the channel; Spotify names nobody.
        let artist = source == .youtube ? tidyChannel(data["author_name"] as? String ?? "") : ""
        return Named(query: query(title, artist), title: tidyTitle(title), artist: artist)
    }
}

/// The cover as bytes, biggest first, falling back a size at a time.
func fetchCover(_ song: Song) async -> Data? {
    let urls = song.coverUrls.isEmpty ? [song.artworkUrl100].filter { !$0.isEmpty } : song.coverUrls
    for string in urls {
        guard let url = URL(string: string) else { continue }
        if let (data, response) = try? await URLSession.shared.data(from: url),
           let http = response as? HTTPURLResponse, http.statusCode == 200, !data.isEmpty {
            return data
        }
    }
    return nil
}
