# Vibe brief: frontend look and feel

Use this brief for every visual and interaction decision in the app's interface. It covers only how the app looks, moves and speaks. It doesn't change what the app does.

## The idea in one line

**A happy photographer in a darkroom, at the moment the print comes up in the tray.**

The room is dark, but the darkness is where the good part happens. The feeling is hopeful and quietly excited, never gloomy. Every time I use the app, it should feel like watching an image appear.

## Keywords

**Warm · patient · crafted · hopeful · grounded · cinematic · quiet**

Not: flashy, techy, cute, bouncy, neon, trendy, loud, clinical.

## Touchstones

- **A photo darkroom:** amber safelight, trays, prints hanging to dry, and the calm focus of working by hand.
- **Christopher Nolan films:** real film grain and real light, restraint, big images with small type, simple title cards with wide letter spacing on dark backgrounds, and time as a theme (a ticking clock, a moving timeline).

## Color: the darkroom

- The base is **warm near-black**, never cold blue-black or pure `#000`. Surfaces step up in small, warm steps.
- **Safelight amber** is the one accent. Use it sparingly, like the only light in the room: the primary action, the selected state, the active timeline.
- **Print white**, a warm off-white, is for text and the rare moments of full light. Never pure `#FFF` for large areas.
- Muted text is warm grey, still readable (at least 4.5:1 contrast).
- The user's photo is always the most colorful thing on screen. The interface stays neutral so the photo sets the mood.

Starting palette (adjust freely, but keep the temperature):

| Role | Value |
|---|---|
| Room (background) | `#141312` |
| Deep room (behind photos) | `#0E0D0C` |
| Surface / raised | `#1E1C1A` / `#2A2724` |
| Hairline | `#3A3632` |
| Print white (text) | `#F3EFE9` |
| Muted | `#A8A097` |
| Safelight (accent) | `#F2A65A` |
| Text on accent | `#1A1410` |

## Light and texture

- **Light comes from somewhere.** A very soft, warm glow can fall from the top of the screen, like a safelight overhead, with a gentle falloff toward the corners. Use it as a subtle vignette, not a visible gradient wash.
- **Film grain over everything.** A very faint, static grain layer across the interface (just perceptible, never noisy) makes screens feel like film, not flat digital.
- Shadows are soft and warm. No hard drop shadows, no glossy surfaces, no glassmorphism.
- Corners are gently rounded (roughly 10–22 px): soft like photo paper edges, not bubbly.

## Typography: title cards and darkroom labels

- **Screen titles:** an elegant serif with warmth (e.g. Instrument Serif), set large and calm. It's the handmade, crafted voice.
- **Labels and small headings:** a clean sans (e.g. DM Sans), often **small, uppercase, with wide letter spacing**, like a Nolan title card or the label on a chemistry bottle.
- **Time and numbers:** a monospace (e.g. JetBrains Mono) for timestamps, counters and values. Time is a quiet motif, so timestamps should look deliberate and precise.
- Keep the type small and calm, with plenty of space around it. The image is big; the words stay small.

## Motion: slow, weighted, filmic

- **Everything develops rather than pops.** Things fade up from dark, with contrast and brightness rising slightly as they appear, like a print in developer. Nothing pops, bounces or springs.
- **Timing:** unhurried but never sluggish. About 250–400 ms for interface transitions, and longer (about 800 ms–1.5 s) for the big "image appears" moments. Use smooth ease-out curves. No overshoot.
- **Screen changes** feel like cuts in a film: a quick fade through the dark room, or a gentle cross-fade. No sliding carousels or zooming cards.
- **Time motif:** timestamps tick and progress lines move steadily and precisely, like a clock in a quiet room.
- Loading and working states should feel like developing, not waiting: a slow brightening, a line of light moving across, a print coming up. Never a generic spinner.
- Respect "reduce motion": replace movement with simple fades.

## The hero moments (make these feel special)

- **Opening the app:** the room is dark and calm, then the interface fades up softly, like the safelight switching on.
- **A photo arriving:** the user's photo develops onto the screen from dark to full, the first "print coming up" moment.
- **Finishing a slide:** the biggest moment. The finished slide rises from black to full light, and the room seems to brighten slightly around it. This is where the hope lives. It should feel like holding up a finished print.

## Layout

- **The photo is the hero.** Give it the most space and the calmest surroundings. Controls sit below it or recede into the dark.
- Generous negative space. Let screens breathe, like a gallery wall or a film frame.
- Controls feel like quiet, well-made tools: thin lines, simple shapes, precise alignment.
- Touch targets stay comfortable (at least 44 px) even when the controls look minimal.

## Icons

- Thin, rounded stroke icons (about 1.5–1.8 px), simple and quiet. One style throughout.
- No emoji, no filled cartoon icons, no playful mascots.

## Voice: how the app speaks

Calm, warm, brief, like a friendly person working next to you in the darkroom. Encouraging, never hyped. Darkroom words used lightly, never forced.

| Instead of | Say |
|---|---|
| "Upload an image" | "Start with a photo" |
| "Processing…" | "Developing…" |
| "Export complete!" | "Your print is ready." |
| "Error: failed to load" | "Something didn't come through. Try once more." |
| "No drafts" | "Nothing in the tray yet." |

No exclamation marks, no jargon, no jokes that break the mood.

## Do / don't

**Do:** warm darks, one amber light, faint grain, big photo, small spaced-out type, slow fades, precise ticking time, moments of light that feel earned.

**Don't:** pure black or pure white areas, cool blue-greys, neon or multicolor accents, visible gradient washes, glassmorphism, bouncy or springy animations, spinners, emoji, crowded screens, anything that looks like Spotify, Apple Music or a generic social app.

## The test

When a screen is done, ask: *Does this feel like a quiet darkroom where something good is about to appear?* If it feels like a tech dashboard, a toy, or a streaming app, it's off.
