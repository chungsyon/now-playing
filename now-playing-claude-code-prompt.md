# Build "Now Playing" — a phone-first web app for Instagram music slides

## What this is

I post street photography on Instagram (nature, people, urban scenes) and attach a song with Instagram's music feature. Most people don't notice there's a song. I want a web app that makes a second carousel slide, a silent looping "now playing" animation, so viewers see that music is playing.

- **Slide 1:** my original photo. The app never edits, re-saves or re-exports it.
- **Slide 2:** a silent looping MP4 made by this app, the same aspect ratio as slide 1.
- The real song is added in Instagram's music picker. **The exported video must never contain audio.**

I'm building this for my own use and will add features as I use it. Build a small, solid first version whose foundations make later features easy to add.

## Hard constraints

- **Plain HTML, CSS and JavaScript only.** Use native ES modules (`<script type="module">`). No TypeScript, no React/Vue/Svelte, no bundler, no build step, no npm needed to run it. I want to read and edit every file myself.
- **It must run straight from GitHub Pages** as a static site. Use only relative paths, because the site will live under `https://<user>.github.io/<repo>/`.
- **Third-party libraries are allowed only as vendored ES-module files** in `/vendor/`, committed to the repo, with the version noted in the README. No runtime CDN dependencies except the one API below.
- **No backend and no accounts.** Photos never leave the device. The only network call is the iTunes Search API, plus loading the cover image it returns.
- **Target:** iPhone Safari first (iOS 17+), used as a Home Screen web app. Android and desktop come later, but don't break them on purpose.
- **Mobile-first, touch-first UI.** Every tap target is at least 44 px. Test layouts at 390×844.
- Keep code readable and commented in plain English. I'm not an experienced programmer.

## Phase 0 — prove export works first (do this before anything else)

Build a tiny standalone test page, `spike/export-test.html`:

1. Draw a black vinyl record with grooves and a colored center label, spinning on a colored background, at 1080×1350.
2. Render an 8-second loop at 30 fps **frame by frame** (not a real-time screen recording), so the output is identical every time.
3. Encode it as a silent H.264 MP4 using **WebCodecs `VideoEncoder`** plus a vendored MP4 muxer. I suggest **Mediabunny**; mp4-muxer is an alternative. Choose one and explain why.
4. Show progress while it renders.
5. Save it with `navigator.share({ files: [...] })`, checking `navigator.canShare` first, so the iPhone share sheet offers "Save Video". Fall back to a download link.
6. Add a fallback path if `VideoEncoder` is unavailable (for example `MediaRecorder` on a canvas stream), and show clearly on screen which path was used.

**Then stop.** Tell me how to open it on my iPhone. Phone testing needs HTTPS: a plain local-network IP won't allow WebCodecs, so walk me through pushing to GitHub Pages or another simple HTTPS option. I'll confirm that the video saves to Photos, loops cleanly, and attaches to an Instagram carousel before we continue.

## Phase 1 — the first real version

### Flow (4 screens)

1. **Home.** App title, a "Choose photo" button (file input accepting images from Photos), an aspect-ratio control (1:1, 4:5, 3:4, Custom; defaults to the photo's own ratio), a list of recent drafts, and a "Your styles" row (can be empty in v1 but leave the slot).
2. **Song.** A search field (song and artist name, or a pasted Apple Music link) and a results list showing cover, title, artist, album, year, duration and a version tag (Original / Live / Remaster / Acoustic, guessed from the title). One result is selected. A **clip-start picker** (slider plus mm:ss display, e.g. 1:12 of 3:45) sets where the on-slide progress bar starts, matching the clip I'll pick in Instagram. Also a "Can't find it? Enter details yourself" manual form, with an optional custom cover upload.
3. **Editor.** Live preview canvas at the top, a small play/pause loop bar under it, and a **bottom sheet** with tabs **Layers · Effects · Animation · Song**. A template switcher sits in the top bar and an Export button top-right.
4. **Export.** Side-by-side thumbnails of slide 1 (my photo) and slide 2 (the animation), format info (MP4, looping, size such as 1080×1350, "Audio: none"), a render progress bar, a "Save to Photos" button (share sheet), and a short "In Instagram" checklist: add the photo first, then this video; add *<song>* by *<artist>* in Music; start the clip at *<mm:ss>*.

### Templates in v1

- **Vinyl.** My photo is the background. An album sleeve (the cover) sits in a corner with a black record peeking out from behind it and spinning. Song title and artist are shown as small text.
- **Player.** The background is my photo blurred, or a solid color pulled from the cover or photo. A large album cover, title and artist, a **moving progress bar** with ticking timestamps (starting at the clip-start time and using the real track length), and play/prev/next icons. The icons are decorative.
- The player design must be **original**: no Spotify or Apple logos and no pixel copy of their UI.

### Editing in v1

- Tap a layer to select it. Drag to move, pinch to resize, two-finger twist to rotate. Selected layers show handles.
- Layers panel: list, select, show/hide, lock (the photo layer is locked by default).
- Background options: photo as-is, blurred photo, or a solid color pulled from the cover or photo (implement simple color extraction yourself, e.g. median-cut or k-means on a downscaled image).
- Effects per layer, applied in order and reorderable: **blur, film grain, vignette**. Build these so more effects can be added later (see the effect registry below).
- Animation tab: spin speed and direction, loop length (6–15 s, default 8), and whether the progress bar moves in real time or sped up.
- **Cover-free style option:** the record label and background use colors pulled from the cover, and the cover image itself isn't shown. Title and artist are always shown as credit.
- The album cover is always shown **unaltered** (no distortion or recoloring of the cover image itself).

### Export in v1

- Output width is 1080 px, height set by the aspect ratio (1080×1080, 1080×1350, 1080×1440, or custom), H.264 MP4 at 30 fps, about 8 Mbps, **no audio track**.
- **Seamless loop:** choose rotation so the record completes whole turns over the loop length. For the progress bar, make the jump back at the loop point look intentional (a short ease or fade). Explain your choice.
- The preview may render at lower resolution for speed, but export renders at full resolution through the **same render function**.

## Foundations to get right now (cheap now, painful later)

1. **Document model as plain JSON.** A project is `{ version, aspect, song, loopSeconds, layers: [...] }`. Each layer is `{ id, type, visible, locked, props, effects: [...] }`, with types such as `photo`, `cover`, `disc`, `text` and `progressBar`. Templates are functions that produce a starting layer list.
2. **Every numeric property can become animatable.** Store a property as either a plain value or `{ keyframes: [{ t, value, ease }] }`, and read it through one helper, `valueAt(prop, t)`. v1 uses only plain values, but keyframes should drop in later without restructuring.
3. **One pure render function:** `render(ctxOrStage, project, t, { width, height })`. Preview and export both call it.
4. **Effect registry:** each effect is registered with a name, parameter definitions (for auto-generated sliders) and an apply function. Adding an effect is a single new entry.
5. **Local-first saving.** Autosave drafts to IndexedDB, including the photo blob and fetched cover. Styles are saved projects without the photo or song, reusable later.
6. **Rendering tech.** Use WebGL for effects. Either vendor **PixiJS** (ESM build) or write small WebGL shaders yourself, whichever keeps the code simpler for me to read. Explain the choice. Don't rely on `CanvasRenderingContext2D.filter`, which is unreliable in Safari. The layer and effect system should later support a **true perspective corner-pin** (a projective warp, not a CSS skew), so don't design it out.

## Song search: iTunes Search API

- Endpoint: `https://itunes.apple.com/search?term=<query>&entity=song&limit=25` (add `country=` if needed; make it a setting). For a pasted Apple Music link, extract the track id and use `https://itunes.apple.com/lookup?id=<id>`.
- Use `trackName`, `artistName`, `collectionName`, `releaseDate`, `trackTimeMillis` and `artworkUrl100`.
- For large covers, replace `100x100` in `artworkUrl100` with `1200x1200` (fall back to `600x600` if that fails).
- **Check CORS on the live site.** If the browser blocks the request, fall back to the API's JSONP `callback=` parameter. Covers must load in a way that doesn't "taint" the canvas (use `crossOrigin="anonymous"`, or fetch as a blob and create an object URL). Verify that export still works with a fetched cover.
- Debounce searches and handle no results and offline states gracefully.

## Look and feel (from my mockups)

- Dark, warm "darkroom" palette so photos stand out. Put the colors in CSS custom properties:
  - background `#141312`, editor background `#0E0D0C`
  - surfaces `#1E1C1A` / `#2A2724`, borders `#3A3632`
  - text `#F3EFE9`, muted text `#A8A097`
  - one accent `#F2A65A`, with dark text `#1A1410` on accent buttons
- Type: a serif display face for screen titles (Instrument Serif), a clean sans for the UI (DM Sans), and a monospace for timestamps (JetBrains Mono). Vendor the font files, or use good system fallbacks so the app works offline.
- Bottom-sheet tabs underline the active tab in the accent color. The selected layer row gets an accent outline. Sliders use an accent fill.
- No emoji. Use simple inline stroke SVG icons. Real `<button>`, `<input>` and `<label>` elements, with `aria-label` on icon-only buttons.

## PWA and GitHub Pages

- `manifest.webmanifest` with a relative `start_url` and `scope`, a name, and icons (make simple original icons). Include an `apple-touch-icon` and iOS meta tags so it runs full-screen from the Home Screen. Respect safe-area insets.
- A service worker that caches the app shell for offline use, with a version constant I bump to force updates. Explain in the README how to make sure my phone gets the new version.
- A README covering: what the app is, how to run it locally (any static server), how to deploy to GitHub Pages step by step, how to install on an iPhone, and a changelog.
- A `.gitignore`. No album art or copyrighted images committed to the repo.

## Out of scope for v1 (planned for later; keep the architecture ready)

Corner-pin onto surfaces in a photo (phones, billboards, shop windows) with a magnifier handle, glare pass-through, lighting match and a mask brush · CD and cassette templates · keyframe editor UI and timeline · the full effect list (color adjustments, curves, duotone, halftone, scanlines, dust, glow, light leaks, tilt-shift, blend modes) · saved styles UI · desktop layout · Android testing.

## How to work with me

- Go phase by phase and stop at the end of each phase for me to test on my iPhone.
- Make small commits with clear messages.
- Explain decisions in plain language. When there's a real trade-off, ask me instead of guessing.
- If something in this spec turns out to be impossible or a bad idea in Safari, tell me and propose an alternative instead of silently working around it.
