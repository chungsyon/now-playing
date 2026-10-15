# App Store listing

Everything App Store Connect asks for, ready to paste. Character limits are
Apple's; every field below fits.

## App information

| Field | Value |
|---|---|
| Name (30) | Now Playing Slide |
| Subtitle (30) | Song slides for your carousel |
| Bundle ID | `com.chungsyon.nowplaying` (or the publisher's own, see below) |
| SKU | NOWPLAYING1 |
| Primary language | English (U.S.) |
| Primary category | Photo & Video |
| Secondary category | Music |
| Content rights | Does not contain, show or access third-party content: **No**. It shows song names and covers from Apple's and Deezer's public catalogues, to credit the song. |
| Age rating | Answer **None** to every question → **4+** |
| Price | Free |

If "Now Playing Slide" is taken, try "Now Playing: Song Slide" or
"Carousel Song Slide". The name under the icon stays "Now Playing".

## Version 1.0

**Promotional text (170)**

> Pick a photo and a song. Get a looping slide that shows what's playing, ready to sit next to your photo in an Instagram carousel.

**Description (4000)**

> Now Playing makes the second slide of a carousel: a short, silent, looping video that shows the song your post goes with.
>
> Choose a photo, find the song, pick a look, and save. Then add the slide next to your photo in Instagram and attach the real song with Instagram's music picker.
>
> FIVE LOOKS
> • Vinyl: your photo with a sleeve in the corner and the record turning behind it.
> • Player: a large cover on a pane of glass over your blurred photo, with the time running underneath.
> • Window: your photo in black and white, with one window where it stays in full colour.
> • Media: a wide panel made of the cover, with the song and its controls, like a phone's media card.
> • Bookmark: a tall strip of glass down one side, with a round cover.
>
> MAKE IT YOURS
> • Move, resize and turn anything with your fingers. Guides snap things into line.
> • Animate any value with keyframes on a timeline.
> • Add blur, film grain and a vignette.
> • Colours are taken from your photo and the cover, and text stays readable on both.
> • Save a look as a style and reuse it on the next photo.
>
> FIND THE SONG
> • Search by song, artist or album, or paste a Apple Music, Spotify, Deezer or YouTube link.
> • Or type the song in yourself.
>
> PRIVATE BY DESIGN
> • Your photos, drafts and styles never leave your phone.
> • No account, no tracking, no ads.
> • The app only asks to add the finished video to your library. It never sees the rest of it.
>
> Now Playing is not affiliated with Instagram, Apple Music, Spotify, YouTube or Deezer.

**Keywords (100)**

```
carousel,song,music,slide,vinyl,record,album,cover,post,now playing,template,loop,video,aesthetic
```

No brand names in keywords: Apple rejects other companies' trademarks there.

**What's New**: leave empty for 1.0.

## URLs

| Field | Value |
|---|---|
| Privacy Policy URL | https://chungsyon.github.io/now-playing/privacy.html |
| Support URL | https://github.com/chungsyon/now-playing/issues |
| Marketing URL | https://chungsyon.github.io/now-playing/ (optional) |

The privacy page goes live once `privacy.html` is merged into the branch that
GitHub Pages publishes.

## App Privacy

Answer **"No, we do not collect data from this app"**. The label then reads
**Data Not Collected**. This matches `PrivacyInfo.xcprivacy`.

## App Review information

- **Sign-in required**: No.
- **Notes**:

> No account is needed. To try it: tap "Choose a Photo", pick any photo, search for a song (for example "Blinding Lights"), pick a result, then tap Export → Make the Slide → Save to Photos.
>
> Song search uses Apple's iTunes Search API and the Deezer API, both public and keyless. Only the search words are sent. The video has no audio track: users add the real song inside Instagram.

## Screenshots

Upload the 6.9" set (1320 × 2868) only. Apple scales it for every other
iPhone. They are in `ios/Screenshots/`, in order:

1. Home
2. Editor, Vinyl
3. Editor, Player
4. Editor, Media
5. Export

The song in them is made up ("Late Summer Light" by Nora Field) and the
cover (`Screenshots/cover.jpg`) was drawn for them, so no one else's artwork
or name is in the listing. To take them again, on the iPhone 18 Pro Max
simulator, in `ios/`:

```sh
xcrun simctl addmedia booted Screenshots/cover.jpg   # once per simulator
TEST_RUNNER_SHOTS=$PWD/Screenshots xcodebuild test -project NowPlaying.xcodeproj \
  -scheme Screenshots -destination 'platform=iOS Simulator,name=iPhone 18 Pro Max' \
  -only-testing:NowPlayingUITests/Walkthrough/testScreenshots
```

## Publishing from a friend's account

The account that publishes owns the app. Two ways:

**A. The friend adds you to their team (recommended).** The friend goes to
App Store Connect → Users and Access → **+**, adds your Apple ID with the
**App Manager** role, and ticks **Access to Certificates, Identifiers &
Profiles**. You accept the email. In Xcode → Settings → Accounts, sign in;
the friend's team appears. Then:

1. In `ios/project.yml`, set `DEVELOPMENT_TEAM` to the friend's Team ID
   (developer.apple.com → Membership details), and run `xcodegen` in `ios/`.
2. Xcode: **Any iOS Device (arm64)** → Product → **Archive** → Distribute
   App → **App Store Connect** → Upload.
3. In App Store Connect, the friend (or you) creates the app with the bundle
   ID, pastes this listing, picks the build and submits for review.

**B. The friend builds it.** Send them the repository. They do steps 1–3
on their own Mac with their own team.

Either way, the bundle ID must be registered under the friend's team. If
`com.chungsyon.nowplaying` is already used elsewhere, change
`PRODUCT_BUNDLE_IDENTIFIER` in `project.yml` (and the tests' ID below it) to
something like `com.<friend>.nowplaying`, then run `xcodegen`.
