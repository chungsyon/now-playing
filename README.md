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
| **Song** | Search the iTunes catalogue by anything or by artist, or type the details yourself. Set where your Instagram clip starts. |
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
js/itunes.js            song search
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
Effects panel builds its sliders from that entry; nothing else changes.

**5. Local-first saving.** Drafts autosave to IndexedDB, photo and cover
included. A style is the same project with the photo and song stripped out.

---

## The look

The app is a darkroom bench, not a dark app. Three rules hold it together, and
they are all enforced in `css/app.css`:

1. **Nothing is filled except the one thing you are meant to press.** Every
   other control is a hairline and some light catching an edge. There are no
   cards, no panels, and no rounded rectangle sitting inside a slightly lighter
   rounded rectangle. That pattern is what makes most dark apps look alike.
2. **Only pressable things have corners.** Buttons get a 10px radius; there is
   exactly one `border-radius` rule in the whole stylesheet. Everything else is
   square, like a print or a frame of film.
3. **Time is always visible**, in monospace, to one decimal. A darkroom is a
   place of measurement, so counts and durations sit at the end of the rule
   that labels each group.

Two pieces carry most of the character. The **title card** is the screen's name
set large in tracked capitals with a short rule of safelight under it. The
**bottle label** is a group's name in small tracked capitals, with a rule
running out to a measured value at the end of it, the way a chemistry bottle is
labelled:

```
TRAY ------------------------------------------------ 03 frames
```

The loop is shown on an **enlarger timer**: a ring with a sweep of light
running round it and the count beside it, rather than a progress bar. It is the
one piece of instrumentation in the app, and it is the time motif made literal.

In the editor the slide has no frame, no corner radius and no shadow; it sits
on black with the controls receding beneath it. On a square slide it reaches
both screen edges. On 4:5 and 3:4 it stops 12 to 36px short, because an editor
has to show you the whole frame and the bench needs its height.

---

## Decisions, and why

**Muxer: [Mediabunny](https://mediabunny.dev) 1.59.1**, vendored at
`vendor/mediabunny-1.59.1.min.mjs` (MPL-2.0, licence alongside it). Chosen over
`mp4-muxer` because it ships a real single-file ES-module build, writes the
index at the front of the file for us, and works out the H.264 decoder
configuration from the encoder automatically.

**Rendering: hand-written WebGL, not PixiJS.** Pixi's ES-module build is about
400KB of someone else's code, and you said you want to read every file. The
three effects plus the future corner-pin are roughly 150 lines of shader you
can actually follow. `CanvasRenderingContext2D.filter` is deliberately not used
anywhere; it is unreliable in Safari.

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

**Searching by artist is a different request, not a filter.** The API documents
an `attribute` parameter (`artistTerm`, `songTerm`) that is supposed to narrow
what the words match against. For music it is silently ignored: `artistTerm`,
`songTerm` and no attribute at all return byte-identical results. So **By
artist** instead finds the performer with `entity=musicArtist`, then asks for
that artist's catalogue by id. Two requests rather than one, which is why it is
a mode you choose rather than the default. It is the difference between
twenty-five songs called Burial and Burial's actual records. There is no
"title" scope for the same reason: it could not have done anything.

**Song search needs no fallback in practice.** The iTunes Search API and the
artwork CDN both send `Access-Control-Allow-Origin: *`, so a normal fetch works
and covers load without spoiling the canvas. The JSONP path in `js/itunes.js`
is kept in case that ever changes.

**Dark only.** The whole idea is a darkroom, and a light mode would be a lit
one. This is the one place the app ignores `prefers-color-scheme` on purpose.
It does respect `prefers-reduced-motion`: movement becomes a plain fade, and
the editor preview starts paused.

---

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
