import Foundation
import Testing
@testable import NowPlaying

/// Ported from js/links.test.mjs, plus the scoring rules from the README.
@Test func pastedLinks() {
    let yt = "https://music.youtube.com/watch?v=hY7eMYA5VyQ&si=MSDqIYOwKadajc9q"
    for text in [yt, "Something About You\n\(yt)", "check this out \(yt) !"] {
        #expect(parseMusicLink(text) == .oembed(.youtube, yt), "\(text)")
    }
    // A sentence's punctuation is not part of the address.
    #expect(parseMusicLink("listen (\(yt)).") == .oembed(.youtube, yt))
    #expect(parseMusicLink("i love this https://music.apple.com/us/album/untrue/893175779?i=893175788")
            == .lookup(.itunes, .track, "893175788"))
    #expect(parseMusicLink("https://music.apple.com/us/album/untrue/893175779") == .lookup(.itunes, .album, "893175779"))
    #expect(parseMusicLink("https://music.apple.com/us/artist/burial/468355684") == .lookup(.itunes, .artist, "468355684"))
    #expect(parseMusicLink("https://www.deezer.com/track/80546728") == .lookup(.deezer, .track, "80546728"))
    #expect(parseMusicLink("https://link.deezer.com/s/abc") == .unsupported("That shortened Deezer link"))
    #expect(parseMusicLink("spotify:track:2TpxZ7JUBn3uw46aR7qd6V") == .oembed(.spotify, "spotify:track:2TpxZ7JUBn3uw46aR7qd6V"))
    // Words are words.
    #expect(parseMusicLink("radiohead creep") == nil)
}

private func hit(_ title: String, _ artist: String, _ album: String = "", source: CatalogSource = .itunes) -> SongHit {
    SongHit(id: UUID().uuidString, source: source, title: title, artist: artist, album: album, year: "",
            durationMs: 1000, artworkUrl100: "", coverUrls: [])
}

@Test func scoringPrefersWhatYouTyped() {
    let tokens = queryTokens("archangel burial")
    #expect(score(hit("Archangel", "Burial"), tokens) > score(hit("Archangel Uriel", "Meditation"), tokens))
    let creep = queryTokens("creep")
    #expect(score(hit("Creep", "Radiohead"), creep) > score(hit("Creep (Acoustic)", "Radiohead"), creep))
    #expect(score(hit("작업실", "X"), queryTokens("작업실")) > 0)
    #expect(flatten("너랑 나") == "너랑나")
    #expect(versionTag(hit("Creep (Acoustic)", "Radiohead")) == "Acoustic")
    #expect(versionTag(hit("Song", "A", "Live at Wembley")) == "Live")
    // Apple wins ties: it carries the year.
    let merged = dedupe([hit("Song", "A", source: .deezer), hit("song", "a", source: .itunes)])
    #expect(merged.count == 1 && merged[0].source == .itunes)
}

@Test func oembedTitlesAreTidied() {
    #expect(OEmbed.tidyTitle("Never Gonna Give You Up (Official Music Video)") == "Never Gonna Give You Up")
    #expect(OEmbed.tidyTitle("Song (feat. Someone)") == "Song (feat. Someone)")
    #expect(OEmbed.tidyChannel("Rick Astley - Topic") == "Rick Astley")
    #expect(OEmbed.query("Rick Astley - Never Gonna Give You Up", "Rick Astley") == "Rick Astley - Never Gonna Give You Up")
}
