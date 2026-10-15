import Foundation

/*
 PASTED LINKS
 ------------
 Work out what a pasted address points at, so the search box takes a link as
 readily as words. Apple and Deezer put the kind of thing and its number in
 the address itself; Spotify and YouTube ids only mean something inside their
 own service, so those are asked about through oEmbed instead.

   music.apple.com/us/album/untrue/893175779?i=893175788   one track
   music.apple.com/us/album/untrue/893175779               a whole album
   music.apple.com/us/artist/burial/468355684              a performer
   deezer.com/track/80546728                               one track
*/

enum CatalogSource: String, Codable, Hashable, Sendable { case itunes, deezer }
enum LinkKind: String, Hashable, Sendable { case track, album, artist }
enum OEmbedSource: String, Hashable, Sendable { case spotify, youtube }

enum MusicLink: Hashable, Sendable {
    case lookup(CatalogSource, LinkKind, String)
    case oembed(OEmbedSource, String)
    /// A link we can name but not open.
    case unsupported(String)
}

/// Find the first match of a pattern, case-insensitively, with its groups.
func firstMatch(_ pattern: String, in text: String, options: NSRegularExpression.Options = [.caseInsensitive]) -> [String]? {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: options),
          let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
    return (0..<match.numberOfRanges).map { i in
        Range(match.range(at: i), in: text).map { String(text[$0]) } ?? ""
    }
}

func matches(_ pattern: String, _ text: String) -> Bool {
    firstMatch(pattern, in: text) != nil
}

/// nil when this is not a link at all.
func parseMusicLink(_ text: String) -> MusicLink? {
    // A share sheet rarely hands over a bare address: usually the song's name
    // with the address somewhere inside. A trailing full stop or bracket
    // belongs to the sentence, not the address.
    let raw = text.trimmingCharacters(in: .whitespacesAndNewlines)
    var trimmed = raw
    if let inside = firstMatch(#"(?:https?://|spotify:)\S+"#, in: raw)?.first {
        trimmed = inside.replacingOccurrences(of: #"[.,;:)\]}>'"]+$"#, with: "", options: .regularExpression)
    }

    if !matches(#"^https?://"#, trimmed) && !matches("(music\\.apple|deezer|spotify|youtu)", trimmed) {
        return nil
    }

    // Apple. A track number in the query wins: an album address carrying one
    // is a link to that single track on that album.
    if matches(#"music\.apple\.com"#, trimmed) {
        if let id = firstMatch(#"[?&]i=(\d+)"#, in: trimmed)?[1] { return .lookup(.itunes, .track, id) }
        if let path = firstMatch(#"/(album|song|artist)/[^/]*/(\d+)"#, in: trimmed) {
            let kind: LinkKind = path[1].lowercased() == "song" ? .track : path[1].lowercased() == "album" ? .album : .artist
            return .lookup(.itunes, kind, path[2])
        }
        return .unsupported("That Apple Music link")
    }

    // Spotify, every shape: spotify: URIs, locale paths, the shortener.
    if matches(#"open\.spotify\.com|spotify\.link|^spotify:"#, trimmed) {
        return .oembed(.spotify, trimmed)
    }

    // YouTube: videos, youtu.be, Shorts and music.youtube.com.
    if matches(#"youtube\.com|youtu\.be"#, trimmed) {
        return .oembed(.youtube, trimmed)
    }

    if matches(#"(^|\.|//)deezer\.com"#, trimmed) {
        // link.deezer.com hides the real address behind a redirect.
        if matches(#"link\.deezer\.com"#, trimmed) { return .unsupported("That shortened Deezer link") }
        if let path = firstMatch(#"/(track|album|artist)/(\d+)"#, in: trimmed),
           let kind = LinkKind(rawValue: path[1].lowercased()) {
            return .lookup(.deezer, kind, path[2])
        }
        return .unsupported("That Deezer link")
    }
    return nil
}
