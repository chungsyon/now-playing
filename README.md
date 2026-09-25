# Now Playing

A phone-first web app that makes the **second slide** of an Instagram carousel:
a silent, looping "now playing" animation, so viewers notice that a song is
attached to the post.

- **Slide 1** is your photo. This app never touches it.
- **Slide 2** is an MP4 made here — same aspect ratio, no audio track.
- The real song is added afterwards in Instagram's own music picker.

Plain HTML, CSS and JavaScript. No build step, no npm needed to run it, no
backend. Your photos never leave the phone.

---

## Status

**Phase 0 — export spike.** Only `spike/export-test.html` exists so far. It
proves the hard part works before any app is built around it.

---

## Running it locally

Any static file server will do. From the project folder:

```sh
python3 -m http.server 8777
```

Then open <http://localhost:8777/spike/export-test.html>.

`localhost` counts as a secure context, so WebCodecs works there. **A plain
local-network address like `http://192.168.1.20:8777` does not** — the browser
blocks WebCodecs on it. That is why phone testing needs GitHub Pages (below).

---

## Putting it on your iPhone (GitHub Pages)

Do this once. After that, every `git push` updates the phone.

1. **Create the repo on GitHub.** In this folder:

   ```sh
   gh repo create now-playing --public --source=. --remote=origin --push
   ```

   (Or make an empty repo on github.com, then
   `git remote add origin https://github.com/<you>/now-playing.git && git push -u origin main`.)

2. **Turn on Pages.** On github.com go to the repo → **Settings** →
   **Pages** → under *Build and deployment* set **Source: Deploy from a
   branch**, **Branch: `main`**, folder **`/ (root)`** → **Save**.

3. **Wait about a minute.** The repo's **Actions** tab shows a "pages build and
   deployment" job. When it is green the site is live at:

   ```
   https://<your-github-username>.github.io/now-playing/
   ```

4. **Open the spike on your iPhone:**

   ```
   https://<your-github-username>.github.io/now-playing/spike/export-test.html
   ```

All paths in this project are relative, so the app works from that
sub-folder URL without any extra configuration.

### What to check on the phone

1. The page lists **what this device supports**. On iOS 17+ everything should
   be ticked.
2. Tap **Render 8-second loop**. The progress bar fills; it takes a few seconds.
3. Tap **Save video** → the iOS share sheet opens → choose **Save Video**.
4. In Photos: does it loop cleanly with no visible jump? Is it silent?
5. In Instagram: make a carousel, add any photo first, then this video, then
   add music. Does it accept the video as a second slide?

Add `?fallback=1` to the URL to force the MediaRecorder path instead, if you
want to compare.

---

## Decisions made in Phase 0

**Muxer: [Mediabunny](https://mediabunny.dev) 1.59.1**, vendored at
`vendor/mediabunny-1.59.1.min.mjs` (MPL-2.0, licence in
`vendor/mediabunny-LICENSE.txt`). Chosen over `mp4-muxer` because it ships a
real single-file ES-module build, writes the `moov` index at the front of the
file for us, and derives the H.264 decoder configuration from the encoder
automatically. `mp4-muxer` is smaller but leaves more of that plumbing to hand.

**Encoding: WebCodecs `VideoEncoder`, frame by frame.** The render loop draws
frame *n*, hands it to the encoder, waits, then draws frame *n+1*. Nothing
depends on wall-clock time, so the same input always produces the same file.

**Fallback: `MediaRecorder` on a canvas stream.** Real-time, so it is not
frame-exact and comes out slightly short of 8 s. Only used when `VideoEncoder`
is missing. The page always says which path it used.

**No audio, structurally.** Only a video track is ever added to the output
file, so an audio track cannot exist. Verified by reading the finished MP4 back:
one `trak`, video handler, zero audio tracks.

**Seamless loop.** 8 s × 30 fps = 240 frames, and the record turns exactly
4 whole times (30 rpm) across them. Frame 240 would be identical to frame 0, so
the loop closes with no jump. Any loop length works as long as the turn count
is a whole number.

**Saving is its own button.** iOS only opens a share sheet in response to a
fresh tap, and the permission expires while the long render is running. So
rendering and saving are two separate taps.

---

## Changelog

- **0.1.0** — Phase 0: export spike (`spike/export-test.html`). Spinning record
  rendered frame by frame at 1080×1350 and encoded to a silent H.264 MP4.
