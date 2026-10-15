# Now Playing for iPhone

The native version of the web app in the folder above: the same four screens,
the same five templates and the same slide, built in SwiftUI for iPhone and
set up for the App Store.

- iOS 17 or later, iPhone only, portrait.
- No accounts, no analytics, no third-party code. Photos never leave the phone.
- The exported MP4 has one video track and no audio track, as before.

## Opening it

1. Install **Xcode** from the Mac App Store (16 or later).
2. Open `ios/NowPlaying.xcodeproj`.
3. Select the **NowPlaying** target → **Signing & Capabilities** → choose your
   **Team**. Change the bundle identifier (`com.chungsyon.nowplaying`) if you
   want a different one; it must be unique on the App Store.
4. Pick an iPhone simulator or your own iPhone and press **Run** (⌘R).

The project file is generated from `project.yml` by
[XcodeGen](https://github.com/yonaskolb/XcodeGen). After adding or removing a
Swift file, run `xcodegen` in this folder (install once with
`brew install xcodegen`). Editing existing files needs nothing.

## Tests

The model, renderer, video export, search and saving are plain Swift with no
UIKit in them, so they also build as a Swift package and test on a Mac:

```sh
cd ios
swift test
```

Set `NP_RENDER_DIR` to a folder to keep every template as a PNG and the test
export as an MP4, to look at them:

```sh
NP_RENDER_DIR=/tmp/np swift test
```

The same tests run in Xcode with ⌘U.

## Where things are

| Folder | What it holds |
|---|---|
| `NowPlaying/Core` | the document model, templates, keyframes, renderer, Liquid Glass, effects, colours, gestures' geometry, video export, saving, song search. Ported one-to-one from `js/`. |
| `NowPlaying/App` | the app's state: the open project, undo and redo, autosave, navigation |
| `NowPlaying/Editor` | the editor screen: the preview, touch handling, the panels |
| `NowPlaying/Screens` | Home, Song, Export, About |
| `NowPlaying/Resources` | the icon, the accent colour, the slide's typefaces and their licence, the privacy manifest |
| `Tests/CoreTests` | the web app's tests ported, plus rendering and export checks |

| Web | iPhone |
|---|---|
| `js/model.js` | `Core/Model.swift` |
| `js/render.js` | `Core/Renderer.swift`, `Core/Glass.swift` |
| `js/effects.js` | `Core/Effects.swift` (grain and vignette run on the pixels; blur uses Core Image) |
| `js/color.js` | `Core/Palette.swift` |
| `js/gestures.js` | `Core/Geometry.swift` (the sums), `Editor/EditorEngine.swift` (the fingers) |
| `js/export.js` + Mediabunny | `Core/VideoExporter.swift` (AVAssetWriter, H.264, no audio track) |
| `js/db.js` (IndexedDB) | `Core/DraftStore.swift` (files in Application Support) |
| `js/search.js`, `itunes.js`, `deezer.js`, `links.js`, `oembed.js` | `Core/Search/` |
| `js/screens/*.js` | `Screens/`, `Editor/` |

### What changed on the way

- **Grain moves.** Film grain now changes 24 times a second in the preview and
  the file. On the web it froze after the first frame because the layer was
  cached.
- **Deleting a keyframe is a button.** A phone has no Delete key, so picking a
  keyframe on a strip shows a bin beside it.
- **Saving.** "Save to Photos" saves straight into the library (it asks once,
  for add-only access). Share sends the file anywhere else, Instagram included.
- **Rendering is native**, frame by frame through AVFoundation's H.264
  encoder, with a Stop button. The screen stays awake while it works.
- **Arrow-key nudging** is not here: it was for desktop keyboards, and this
  is an iPhone app. ⌘Z and ⇧⌘Z still work with a keyboard attached.

## Publishing to the App Store

Done in the project already:

- App icon (1024×1024, no transparency), accent colour, launch screen.
- `PrivacyInfo.xcprivacy`: no tracking, no data collected, and the one
  required-reason API used (UserDefaults, for the search settings).
- Photo library permission is **add-only**, with the reason in plain words.
  Choosing a photo uses the system picker, which needs no permission at all.
- `ITSAppUsesNonExemptEncryption = NO`, so no export-compliance questions.
- iPhone only, portrait only; version 1.0, build 1.
- Font licences (SIL OFL) ship in the app, under About → Typefaces.

Your steps:

1. Join the [Apple Developer Program](https://developer.apple.com/programs/)
   if you have not ($99 a year).
2. In [App Store Connect](https://appstoreconnect.apple.com) → **Apps** → **+**,
   create the app with your bundle identifier. The App Store **name** must be
   unique; "Now Playing" is very likely taken, so try something like
   "Now Playing Slide" or "Carousel Song Slide". The name under the icon on
   the phone can stay "Now Playing".
3. **Privacy Policy URL:** `https://chungsyon.github.io/now-playing/privacy.html`
   (the page is in this repo; push to publish it). **Support URL:** the
   repository's Issues page works.
4. **App Privacy:** answer "Data Not Collected".
5. **Screenshots:** the five in `Screenshots/` are ready (6.9", which
   covers every iPhone). `AppStore.md` says how to take them again.
6. In Xcode: choose **Any iOS Device**, then **Product → Archive** →
   **Distribute App** → **App Store Connect**.
7. Back in App Store Connect, pick the build, fill in the description and
   category (Photo & Video), and **Submit for Review**.

Before each later update, raise **MARKETING_VERSION** (1.0 → 1.1) and/or
**CURRENT_PROJECT_VERSION** (1 → 2) in `project.yml`, run `xcodegen`, and
archive again.

### Worth knowing before review

- **Catalogue terms.** The iTunes Search API and the Deezer API are public and
  keyless, but each has terms for commercial apps (Apple's asks that artwork
  and metadata promote the content; Deezer's simple API terms limit commercial
  use). A free app that shows the cover to credit the song is the common case,
  but read both before charging for the app.
- **Instagram's name.** The app mentions Instagram in its instructions, which
  is fine. Keep it out of the app's name and icon.
