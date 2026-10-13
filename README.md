# Now Playing

A phone-first web app that makes the **second slide** of an Instagram carousel:
a silent, looping "now playing" animation, so viewers notice that a song is
attached to the post.

- **Slide 1** is your photo. This app never opens, edits or re-saves it.
- **Slide 2** is an MP4 made here, the same shape as slide 1, with no audio track.
- The real song is added afterwards, in Instagram's own music picker.

Plain HTML, CSS and JavaScript. No build step, no npm needed to run it, no
backend, no accounts. Your photos never leave the phone. The only thing that
touches the network is the song search.

**Live:** <https://chungsyon.github.io/now-playing/>

---

## Running it locally

Any static file server. From this folder:

```sh
python3 -m http.server 8777
```

Then open <http://localhost:8777/>.

`localhost` counts as a secure context, so the video encoder works there. **A
local network address like `http://192.168.1.20:8777` does not** - the browser
blocks WebCodecs on it. That is why phone testing goes through GitHub Pages.

---

## Deploying

The site is already published from the `main` branch of
<https://github.com/chungsyon/now-playing>. Every `git push` updates it:

```sh
git add -A && git commit -m "what changed" && git push
```

Give it about a minute. The repo's **Actions** tab shows a "pages build and
deployment" job; when it is green the new version is live.

If you ever need to set this up again from scratch: repo → **Settings** →
**Pages** → *Source: Deploy from a branch*, *Branch: `main`*, folder `/ (root)`.

All paths in this project are relative, so the app works from a sub-folder URL
without any extra configuration.

---

## Installing it on your iPhone

1. Open <https://chungsyon.github.io/now-playing/> in Safari.
2. Tap the share button, then **Add to Home Screen**.
3. Open it from the Home Screen. It runs full screen, with no Safari chrome.

### Making sure the phone gets a new version

The app keeps a copy of itself on the device so it opens with no signal, which
means a push does not always reach the phone immediately.

**When you change any file in `js/`, `css/`, `index.html` or `assets/`, raise
`VERSION` at the top of `sw.js` by one before you push.** That is the switch
that tells every phone to throw away its copy and fetch the new one.

```js
const VERSION = 2;   // was 1
```

If you forget, the phone will show the old version once more and pick up the
new one on the following launch. To force it immediately: swipe the app away in
the app switcher and open it again.

One more thing that catches people out: GitHub Pages tells browsers to hold on
to files for **10 minutes** (`cache-control: max-age=600`). So even before the
service worker gets involved, Safari may keep serving the old JavaScript for a
few minutes after a push. If a change does not appear, it is almost always this
rather than a broken deploy. Wait ten minutes, or test in a private tab.

---

## How it works

### The four screens

| Screen | What it is for |
|---|---|
| **Home** | Start with a photo, choose the slide shape, reopen a draft or a saved style. |
| **Song** | Search two catalogues at once, by anything or by artist, or type the details yourself. Set where your Instagram clip starts. |
| **Editor** | Preview at the top, loop bar under it, and a sheet of controls: Layers, Effects, Animation, Song. |
| **Export** | Both slides side by side, what the file is, and two taps to get it into Photos. |

### The files

```
index.html              the shell: the room light, the grain, one <main>
css/app.css             every colour, size and easing curve, in one place
js/app.js               holds the project, moves between screens, saves
js/model.js             the document model, valueAt, the templates
js/render.js            the one render function, plus the WebGL effect runner
js/effects.js           the effect registry: one entry per effect
js/color.js             pulling colours out of an image (median cut)
js/gestures.js          drag, pinch, twist
js/db.js                IndexedDB: drafts and styles
js/search.js            asks both catalogues, merges and scores the answers
js/itunes.js            the Apple catalogue
js/deezer.js            the Deezer catalogue
js/net.js               fetch and JSONP, shared by both
js/links.js             works out what a pasted address points at
js/oembed.js            asks Spotify and YouTube what a link is called
js/export.js            frames to a silent MP4
js/ui.js                small helpers shared by the screens
js/screens/*.js         one file per screen
sw.js                   the offline copy. VERSION lives here
```

### The five things that were worth getting right early

**1. A project is plain JSON.** `{ version, aspect, song, loopSeconds, template,
layers: [...] }`, and each layer is `{ id, type, visible, locked, props, effects }`.
You can print one to the console and read it.

**2. Every number can become animated later.** A property is stored either as a
plain value or as `{ keyframes: [...] }`, and everything reads it through one
helper, `valueAt(prop, t)`. Version 1 only writes plain values, but a timeline
editor can be added later without touching any drawing code.

**3. One render function.** `render(stage, project, t)`. The preview and the
export call the same one, at different sizes. All positions are stored as
fractions of the slide rather than pixels, which is what makes that work: what
you line up on a 343px preview is exactly what lands in a 1080px file.

**4. An effect registry.** Adding an effect means adding one entry to
`js/effects.js` with a name, its slider definitions and a fragment shader. The
Effects panel builds its sliders from that entry; nothing else changes. Blur is
the one entry with no shader: see the note on blur further down.

**4a. The furniture moves as one.** `movesWith(project, layer)` in
`js/model.js` answers what a gesture picks up. By default that is every
unlocked, visible layer except the photo, so dragging the cover drags the
words, the bar and the buttons with it and the spacing you set stays set. A
pinch or a twist works on the whole arrangement, about its middle. Two ways
out: turn grouping off in the Layers panel, or lock the one layer you want to
leave behind.

**4b. Gestures snap.** The last little bit of every gesture is done for you: a
position lands on the middle of the slide or on anything standing still
(within 1.4% of the slide), and a tilt lands on a multiple of 15 degrees
(within 4). Guides are drawn on the overlay canvas while a finger is down, so
they never reach the file. `pullTo`, `pullAngle` and `placeMembers` in
`js/gestures.js` are the whole of it, and `js/gestures.test.mjs` checks them.

**5. Local-first saving.** Drafts autosave to IndexedDB, photo and cover
included. A style is the same project with the photo and song stripped out.

---

## The look

The interface is built the way an iOS app is built, following Apple's design
guidance (the `apple-design` skill), so it feels native on the phone it lives
on. All of it lives in `css/app.css`.

- **System type.** SF on Apple devices, sized on Apple's text styles, with
  tracking that tightens as text grows. The slide still draws its words in
  DM Sans, Instrument Serif and JetBrains Mono, so `js/app.js` loads those
  faces by name at startup.
- **Inset grouped lists**, like Settings. A section header names a group and a
  footnote explains it.
- **One tint** (system pink) for anything you can press. The photo is the most
  colourful thing on screen.
- **Translucent chrome.** The navigation bar is a blurred material that content
  scrolls under. It is clear at the top of a page and turns solid once
  something is underneath. A large title in the page becomes a small one in the
  bar.
- **Native controls**: segmented controls with a sliding thumb, switches,
  round-thumb sliders and capsule chips. Every button shrinks slightly the
  moment it is pressed, not when the finger lifts.
- **Motion with a direction.** Going forward slides in from the right and going
  back slides in from the left. Toasts come in from the top and leave the same
  way. Transitions are critically damped, with no overshoot.
- Follows the system **light and dark appearance**, and respects
  `prefers-reduced-motion`, `prefers-reduced-transparency` and
  `prefers-contrast`.

---

## Decisions, and why

**Muxer: [Mediabunny](https://mediabunny.dev) 1.59.1**, vendored at
`vendor/mediabunny-1.59.1.min.mjs` (MPL-2.0, licence alongside it). Chosen over
`mp4-muxer` because it ships a real single-file ES-module build, writes the
index at the front of the file for us, and works out the H.264 decoder
configuration from the encoder automatically.

**Rendering: hand-written WebGL, not PixiJS.** Pixi's ES-module build is about
400KB of someone else's code, and you said you want to read every file. Grain
and vignette plus the future corner-pin are a few dozen lines of shader you can
actually follow.

**Blur is the exception: it uses the browser's own gaussian.** A five-tap
shader blur only looks smooth over a few pixels. Stretched across a wide radius
the taps sit too far apart and the original edges survive as ribbing: nine
white bars blurred hard still read as nine bars. `ctx.filter = 'blur(...)'` is
a real gaussian, smoother and cheaper, and Safari has had it since 17. Older
Safari draws the layer sharp instead. Blur therefore runs first, on the 2D
canvas, before the shader chain, which is also the order that makes sense:
grain belongs on top of a blurred photo, not underneath where the blur would
wipe it.

**Blur radius is per 1000px of slide width, not in pixels.** The preview is
drawn smaller than the export, so a radius in pixels would come out weaker in
the file than it looked on screen.

**Layers are drawn one at a time, then composited.** Each layer goes onto its
own scratch canvas, runs through its own effect chain, and only then lands on
the slide. That is what makes per-layer effects possible, and it is also what
will make a true corner-pin possible later: a projective warp is just another
pass in the same place.

**No audio, structurally.** Only a video track is ever added to the output, so
an audio track cannot exist. Verified by reading a finished file back: one
track, video handler, zero audio tracks.

**Seamless loop.** The record turns a whole number of times over the loop, so
the last frame lines up with the first. The requested speed is rounded to reach
that, and the Animation tab shows the real speed rather than pretending it used
the number you set. Verified: rendering the slide at `t = 0` and at
`t = loopSeconds` produces an identical frame.

*Side effect worth knowing:* at the default 30 rpm over 8 seconds the record
turns 4 times, so the picture actually repeats every 2 seconds. The loop is
still correct, it just contains four identical turns. Only the progress bar
cares about the full loop length.

**The progress bar dissolves rather than snaps.** At the loop point the bar has
to go back to where it started. Instead of jumping, the ending state
cross-fades into the starting state over the last third of a second, so the
reset reads as a soft cut. The track line itself stays solid throughout, so
nothing flickers.

**Saving is a separate button from rendering.** iOS only opens the share sheet
in answer to a real tap, and that permission has already expired by the time a
long render finishes.

**Searching in Korean works; the Korean store does not.** Any script can be
typed into the search box and the right track comes back. What comes back is
the name Apple files the track under internationally, so 밤편지 returns
"Through the Night by IU"; the artist is the thing to recognise it by. Some
titles do come back in Korean. Separately, the **KR store returns no songs at
all** through this API, only music videos, which carry no length and so cannot
drive the progress bar. Setting the store to KR therefore falls back to the US
store automatically and says so on screen.

**Two catalogues, because neither one is enough.** They fail in opposite
directions, measured on the same queries:

| query | Deezer | Apple |
|---|---|---|
| `작업` | 23 real hits of 25 | 0 of 25 |
| `작업실` | 21 | 2 |
| `봄날` | 20 | 8 |
| `radiohead creep` | finds the Radiohead recording first | acoustic and covers first |
| `아이유` | finds AKMU | finds IU |
| `뉴진스` | finds a cover version | finds NewJeans |
| `archangel burial` | finds meditation music | finds Burial |

Deezer indexes Korean song *titles*; Apple knows Korean *artist names*, filing
아이유 under IU and 뉴진스 under NewJeans. So both are asked at once and the
answers merged. Deezer needs no key either, but its search endpoint sends no
CORS header, so it is asked through JSONP. Its cover images do send one, so
covers still load as blobs and the export is unaffected.

**Results are scored, because Apple answers an unmatchable query with filler.**
It does not send back an empty list when it cannot match your words; it sends
popular songs. `작업` returned Taylor Swift and Fleetwood Mac with nothing to
mark them as padding. Every result is now scored by how many of the words you
typed it actually contains, with a word in the title or the artist worth more
than a word in the album, and one extra point when the title is exactly what
you typed. That single rule sorts out every row of the table above: `작업`
rises from Deezer, Archangel by Burial beats Archangel Uriel because it matches
both words rather than one, and Creep beats Creep (Acoustic).

A batch where nothing scores at all is thrown away and the screen says so.

**One more signal, for Korean artist names.** Scoring alone would have binned
아이유, because Apple files it under "IU" and no result contains the letters
typed. A real artist match comes back as one performer's catalogue while filler
scatters: measured, genuine matches run 0.63 to 0.92 of results by a single
artist, filler 0.08 to 0.15. So a batch survives if half or more is one
performer, and the heading then names them, which is also how you find out that
방탄소년단 was read as BTS. Both signals are used together rather than one after
the other, because either alone gets a case wrong: 뉴진스 turns up a single
cover version by name while Apple quietly has the whole NewJeans catalogue
filed under a name that matches nothing.

**Pasted links open, by one of two routes.** Apple and Deezer put the kind of
thing and its number in the address itself, so those are looked up exactly, no
request needed to tell an album from a track. Spotify and YouTube ids only mean
something inside their own service, but both publish a keyless oEmbed endpoint
that names the track and sends the header a browser needs to read it. So those
links are turned into a search of the other two catalogues, which is the only
way to get a length and a canvas-safe cover out of them.

| paste | what happens |
|---|---|
| `music.apple.com/.../album/x/893175779?i=893175788` | that one track, exactly |
| `music.apple.com/.../album/untrue/893175779` | all 13 tracks, headed *Untrue* |
| `music.apple.com/.../artist/burial/468355684` | that performer's tracks |
| `deezer.com/track` · `/album` · `/artist` | the same, exactly |
| `open.spotify.com/track/...` | searched for by name |
| `spotify:track:...` and `/intl-de/` paths | the same |
| `youtube.com/watch` · `youtu.be` · `/shorts` | searched by name and channel |
| `music.youtube.com/watch` | the same |
| `link.deezer.com/s/...` | named, and explained |

The difference matters and the screen says so. A Spotify or YouTube link
produces *matches for a name*, not the track itself, and the results carry a
line saying which name was used and to check the artist before picking.
YouTube is the better of the two because it names the channel as well as the
video, so Rick Astley comes back first; Spotify gives the title alone, so a
common title can be ambiguous. Video furniture such as `(Official Video)` and
`(4K Remaster)` is stripped before searching, while anything that might be part
of a real title, such as `(feat. ...)` or `(Acoustic)`, is left alone.

Shortened `spotify.link` addresses go to Spotify's endpoint, which resolves
them on its own side. Shortened `link.deezer.com` ones cannot be followed:
Deezer's oEmbed sends no CORS header and ignores a JSONP callback, so those are
named rather than failing quietly.

**YouTube and Spotify as search catalogues were ruled out**, which is a
separate question from opening their links. There is no official YouTube Music
API; the YouTube Data API needs a key, public and abusable in a site with no
server, and allows **100 `search.list` calls per day for the whole app**, not
per person. Spotify's Web API needs an OAuth token, which needs a secret, which
needs a server. Their oEmbed endpoints are used instead precisely because they
need neither.

**Song search needs no fallback in practice.** The iTunes Search API and the
artwork CDN both send `Access-Control-Allow-Origin: *`, so a normal fetch works
and covers load without spoiling the canvas. The JSONP path in `js/itunes.js`
is kept in case that ever changes.

**Light and dark.** The interface follows `prefers-color-scheme`. With
`prefers-reduced-motion`, movement becomes a plain fade and the editor preview
starts paused.

---

### Three sizes

Phones are still what this is written for, and nothing in the main stylesheet
is written for anything else. Two sizes are added on top, and only two.

**From 640px** — a tablet held upright, or a small window. The column stops
being a phone's width and the slide gets bigger. Same shape, more room. An
iPad upright is 768 or 834 and lands here: standing the bench on its side at
that width would leave the slide narrower than it is on the phone.

**From 1024px** — a tablet turned sideways, or a desktop. The bench leaves the
bottom of the screen and stands beside the slide, which then takes everything
left over. Lists run in two columns. Nothing moves in the markup to do this:
`.screen--editor` becomes a grid and the three pieces are placed by name, so
one stylesheet drives both shapes.

**A mouse cannot pinch or twist**, which left scale and rotate unreachable on
a desktop. So the four dots on the selection are grabbable: drag one to
resize, drag just outside one to turn. They are hit from `layerBounds`, the
same box the editor draws, so what you grab is always what you see. A handle
works about the middle of the layer it belongs to, not the middle of the
group, for two reasons: the corner then stays under the pointer instead of
drifting off it, and a handle that happened to sit near the group's middle
would otherwise have enormous leverage. The rest of the group still follows,
anchored on the one you are holding.

Arrow keys nudge, Shift for bigger steps. Nudging does not snap: pressing an
arrow is already saying exactly where you want it, and a guide would swallow
every step near the middle. A line in the Layers panel says all this, and
only on a device with a pointer.

### Keeping it quick on a phone

A slide is small, but a phone redraws it thirty times a second while a thumb
is on it, so the work per frame is the whole game. Five things keep it down.

**A layer with no effects goes straight onto the slide.** The scratch canvas
exists so an effect can see a layer whole. A layer with no effect does not
need it, and skipping it saves a full-slide clear and a full-slide copy per
layer per frame. That alone halved the cost of a frame.

**A layer that holds still is drawn once.** Only the record and the progress
bar look different at different moments of the loop. The blurred photo behind
them is the same picture every frame, so it is kept and reused until something
it depends on changes. `layerSignature` in `js/render.js` is the list of what
that means.

**Redraws are coalesced.** A finger reports up to 120 times a second, and each
report used to draw a frame there and then, which is two or three frames of
work inside one frame of screen time. Now a report asks for a redraw and the
next animation frame does one.

**The preview runs at 30fps, the rate of the file.** Drawing at the screen's
60 or 120 would be twice the work to show the same thing.

**WebGL is only started when a shader is.** Grain and vignette need it, blur
and everything else do not, so most slides never make a GL context at all.
Rebuilding the stage is also held off until the iOS address bar has finished
sliding, and ignored entirely for a change of a few pixels.

**Bitrate follows length.** Ninety seconds at the rate a six-second loop gets
is a file too big to move around on a phone, so the ceiling comes down with
length, aiming at about 20MB. Short loops are untouched. `bitrateFor` in
`js/export.js`.

*Worth knowing:* mediabunny's `Quality` takes a factor from 0 to 1, not a
number of bits. The rate goes in `bitrate`, and a rate passed as a `Quality`
is silently ignored, which is what used to happen here.

## What is vendored

| What | Version | Licence |
|---|---|---|
| Mediabunny (MP4 muxer) | 1.59.1 | MPL-2.0, `vendor/mediabunny-LICENSE.txt` |
| Phosphor Icons (29 glyphs) | regular weight | MIT, `assets/phosphor-LICENSE.txt` |
| Instrument Serif | latin subset | SIL Open Font License 1.1 |
| DM Sans | latin subset | SIL Open Font License 1.1 |
| JetBrains Mono | latin subset | SIL Open Font License 1.1 |

No album art or photographs are committed to this repo, and `.gitignore` is set
up to keep it that way.

---

## Not in this version

Corner-pin onto surfaces in a photo, CD and cassette templates, a keyframe
timeline, the longer effect list, a desktop layout, Android testing. The
architecture is built expecting all of them.

---

## Changelog

- **0.17.1** - With Move together on, a corner of the glass card or the
  colour window resizes the whole arrangement. Off, it reshapes just that
  one, as before.
- **0.17.0** - Two new templates. Window: the photo in black and white
  with one framed window where it stays in full colour, under a title in an
  elegant serif. Bookmark: a tall strip of frosted glass down one side, one
  corner swept rounder than the rest, a round cover and a warm title. Text
  layers get a font picker (Serif, Elegant, Sans, Round, Mono), a weight
  slider, a Capitals switch and, for lines of their own, a text box. Any
  photo can be turned black and white (keyframeable). The template is
  picked from a pop-up menu in the top bar, as four no longer fit side by
  side. New faces: Cormorant Garamond and Montserrat (SIL Open Font
  License).
- **0.16.2** - With Move together on, the glass card moves with everything
  on it, whichever layer you hold. The artist line is semibold, slightly
  larger, and in the title's own colour, so it no longer sinks into the
  photo. The player controls are back, pause and forward (« ‖ »), as in
  Apple Music.
- **0.16.1** - The editor preview draws at the screen's full sharpness (3x on
  an iPhone, was 2x), so text on the slide is crisp. The angle shown while
  turning a layer sits in a small dark capsule in the system font.
- **0.16.0** - Liquid Glass. The card is now a clear pane whose rounded rim
  works like a lens: every pixel of the rim is bent by Snell's law through a
  squircle-shaped edge, red, green and blue bend by slightly different
  amounts for a faint rainbow fringe, and a highlight follows the edge's
  angle to a light above and to the left. New cards are much clearer (glass
  blur 12 instead of 30).
- **0.15.0** - Glassier glass: the backdrop is saturated and brightened, bends
  near the rim as a thick pane would, and the card has a sharp specular line
  along the top, a fainter one along the bottom, a brighter rim, a diagonal
  gloss and a thin dark outline. The card moves on its own when held, its
  corners reshape it freely, and Width and Height sliders size it. On the
  keyframe strips a tap on empty space adds a keyframe, a tap on one picks
  it, and Delete removes the picked one.
- **0.14.0** - The glass card's corner roundness and blur are sliders (and
  keyframeable) under Layers while the card is on. A clean-up pass: Animate
  comes first when a layer is selected, the sheet keeps its place when it
  redraws, sheet groups are no longer squeezed (the Effects tab was cutting
  its sliders off), rows fade under the tabs, and layer rows drop subtitles
  that only repeated their name.
- **0.13.0** - Undo and redo: buttons beside the back button in the editor,
  and ⌘Z / Ctrl+Z, ⇧⌘Z / Ctrl+Y. A drag or a slider pull is one step.
  Opacity joins position, size and rotation as something to keyframe, and a
  click on a keyframe deletes it.
- **0.12.0** - Position, size and angle can be keyframed: select a layer and
  use the Animate rows under Layers, then drag or pinch it at another moment.
  Keyframes slide along their strip to change when they happen. A Glass card
  switch under Arrange puts the frosted card behind any template, Vinyl
  included. The app reloads itself once when an update arrives.
- **0.11.0** - Keyframes. Drag the loop bar under the slide to any moment and
  tap the diamond beside a slider to keyframe it there; values ease between
  keyframes as the loop plays. Works on the background blur and every effect
  slider. Once a slider has keyframes, moving it records one at the playhead.
- **0.10.0** - The Player sits on a pane of frosted glass: the photo behind it
  blurred, tinted from the cover, with an edge that catches the light. The
  bar, the buttons and the words take their colours from the cover. The
  Player is laid out for the slide's own shape, so the card holds everything
  on any shape, and long titles shrink to fit it. A Blur amount slider sits
  under Background while the photo is blurred.
- **0.9.0** - The interface rebuilt on Apple's design language: system type,
  inset grouped lists, a translucent navigation bar with large titles,
  segmented controls, switches, push and pop transitions, and light and dark
  appearance. Nothing the app does changed.
- **0.8.0** - A desktop and iPad layout. From 640px the column widens; from
  1024px, which is an iPad turned sideways, the bench moves to the side of
  the slide and lists run in two columns. The four dots on the selection
  became grabbable, because a mouse cannot pinch or twist: drag a corner to
  resize, just outside one to turn. Arrow keys nudge. The phone layout is
  untouched.
- **0.7.1** - Faster, and smaller files for long loops. A frame costs about
  half what it did, the preview runs at the rate of the file rather than the
  screen, and a drag draws once per frame instead of once per finger report.
  The export bitrate now comes down as the loop gets longer: a minute of the
  busiest thing this makes went from 90MB to 19MB. Short loops are unchanged.
  Dragging the Length slider also works now; it used to rebuild the panel
  under your thumb and stop after one step.
- **0.7.0** - Four changes. The loop now runs up to 90 seconds instead of 15.
  Gestures snap: to the middle of the slide, to anything standing still, and
  to clean angles when tilting. The cover, the words, the bar and the buttons
  move as one arrangement unless you turn that off or lock a layer. And blur
  is the browser's own gaussian rather than a five-tap shader, so a blurred
  background is smooth instead of ribbed, and is the same strength in the file
  as it was in the preview.
- **0.6.1** - A pasted link is found inside whatever came with it. A share
  sheet usually hands over the song's name and the address together, and the
  address on its own was the only shape that worked before.
- **0.6.0** - Spotify and YouTube links open too, through their keyless oEmbed
  endpoints: the link is resolved to a name and that name searched in the two
  catalogues that carry lengths and covers. YouTube Music, youtu.be and Shorts
  addresses all work. Results say which name was used, because this is a match
  by name rather than an exact lookup.
- **0.5.1** - Pasted links open directly. An Apple Music or Deezer address for
  a track opens that track; for an album or a performer it opens the list to
  choose from, named in the heading. Spotify and YouTube links are named rather
  than failing quietly.
- **0.5.0** - Deezer added as a second catalogue alongside Apple, because
  neither one alone handles Korean: Deezer indexes Korean song titles, Apple
  knows Korean artist names. Both are asked at once and the answers scored by
  how many of your words each result really contains. 작업 goes from nothing to
  nineteen results.
- **0.4.1** - Results are checked against what you typed. Apple answers an
  unmatchable query with popular songs rather than with nothing, so a search
  for 작업 came back full of Taylor Swift. Genuine matches now sort to the top
  and a batch containing none is replaced by an explanation.
- **0.4.0** - Search rebuilt. A **By artist** mode that finds the performer and
  lists their catalogue, an automatic fall back to the US store when the chosen
  one carries no songs, and a Song screen that shows either the results or the
  track you picked, never both, so the button that continues is no longer
  buried under twenty-five rows.
- **0.3.0** - The look rebuilt as a darkroom bench: no filled panels anywhere,
  title cards, bottle labels with measured values, an enlarger timer in place
  of the loop bar, and the slide sitting on black with no frame around it.
- **0.2.0** - The first real version. Four screens, two templates (Vinyl and
  Player), layers with drag, pinch and twist, three effects, colour extraction,
  drafts and styles in IndexedDB, song search, silent MP4 export, offline
  support and Home Screen install.
- **0.1.0** - Export spike (`spike/export-test.html`): proved a spinning record
  could be rendered frame by frame and encoded to a silent H.264 MP4.
