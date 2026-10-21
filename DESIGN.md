# Vape 'n' Vibe UI

## Design read

- **Surface:** compact native desktop application UI, with a passive recording overlay.
- **Audience:** people who repeatedly dictate text while working in other apps.
- **Single job:** make the active shortcut, input source, language, and transcription engine fast to verify and change.
- **Task and risk:** frequent, low-decision settings changes; recording and processing state must remain unmistakable.
- **Platform:** 400 × 470 Electron settings window (content size), keyboard and pointer input, plus a transparent 340 × 150 mouse-through overlay.

## Direction: Mercury (shipping)

Chosen from the five directions in `design/ui-lab/`. Monochrome and object-first: a chrome droplet built from per-pixel metaballs is the product's signature. It swells and splits with each speech band while you talk and contracts to a single orbiting bead while the transcript is produced. Red appears only when the mic is live.

- **Settings window:** the orb heads the window with the status line and shortcut key beneath it. The key sinks while recording. The orb stands on a polished floor and is mirrored in it. The four settings sit in one chrome "deck" lit the same way as the orb: a bright top rim fading through a dark horizon, metal-inked icons, and hairlines that catch the light mid-row. While recording, the red on-air light also spills under the deck. Buttons and the shortcut keycap share the chrome rim, and the primary action is polished silver. The dictionary is a compact 288 px card that grows out of its tile: one pill field per entry (heard as, arrow, write as, add), rows below, and a one-line footer instead of explanatory paragraphs. The Words tab only appears for Whisper, the one engine that uses words.
- **Overlay:** a black pill that grows to show the live caption and a running timer, then shrinks to the bead. On key release it switches to the bead immediately; main only confirms "processing" after the renderer's stop tail, so the pill would otherwise collapse and reappear.
- **Engine:** `src/renderer/orb.js` is shared by both windows and reads the same 128-bin analyser data the app already streams. Both render loops stop once the orb is at rest.

## Motion and focus

- Every hover fades in rather than snapping. Gradient surfaces (deck rows, pill buttons) get their hover light from a layer that fades in, because CSS can't fade one gradient into another.
- Presses scale down slightly (0.94 to 0.96, and 0.88 on small round buttons). Menus, the dictionary card, list items and the silver primary button animate both in and out, and page switches slide 10 px in the direction of travel.
- Focus rings appear only after keyboard input. `renderer.js` sets `html[data-input]` from the last input type, so clicking a dropdown or field never leaves a ring behind.
- Live caption: only new or revised words are added. Each one fades up out of a 5 px blur, and the line glides left to make room (a FLIP animation, 420 ms) instead of jumping.
- Reduced motion turns all of this off.

## Semantic tokens

- Canvas and surfaces: `#0b0b0c`, `#141416`, `#1b1b1e`, hover `#232327`
- Lines: `#29292d`, strong `#3a3a40`
- Text: `#f2f2f3`, soft `#c7c7cc`, muted `#98989f` (6.4:1 on tiles)
- On air: `#ff453a` for marks, `#ff8a82` for text
- Focus: white 2 px ring; tiles ring as a whole when their control has keyboard focus
- Radius: full for controls, 18 px deck and dictionary card, 14 px rows
- Chrome material: `--rim` (top-lit border gradient), `--deck-fill`, `--metal-fill`, and the `#chrome-ink` SVG gradient for icons
- Type: Geist for UI, Geist Mono for the key, version and timer, Slackey for the wordmark
- Motion: 140 ms state colour, spring physics on the orb, 220 ms dictionary scale-in from the tile corner; reduced motion renders a single static orb frame per state and removes travel

## UI lab: five redesign directions (2026-10-21)

Interactive prototype in `design/ui-lab/index.html`. Each direction keeps every existing control, state and IPC input (128-bin analyser data, `viz-mode`, `partial-text`) and only changes presentation, so any one can be ported into `src/renderer/` without touching the main process.

- **01 Plume:** the current vapor identity pushed further. Keycap hero, coral speech ribbon with a 320-particle plume, processing inhales into a green trace.
- **02 Console:** warm analog channel strip. Backlit talk key, VU needle with spring ballistics and peak hold, tape strip that rewinds while transcribing.
- **03 Scope:** ink-blue oscilloscope. Tabs replace the menu, phosphor trace with persistence, Lissajous morph while decoding, elapsed clock.
- **04 Transcript:** light editorial. Settings as one editable sentence, paper caption card, pen-pressure ink line that dries while proofreading.
- **05 Mercury:** monochrome chrome metaballs. Orb hero above four peer tiles, overlay pill that grows with your words and shrinks to an orbiting bead.

Fingerprint 2026-10-21 · plume: header menu · record-led hero + rows · compact · metrics absent · inline actions · modal
Fingerprint 2026-10-21 · console: header menu · split deck (key + meter) · compact · level meter inline · inline actions · modal
Fingerprint 2026-10-21 · scope: top tabs · record-led screen + definition grid · compact · elapsed clock inline · inline actions · separate tab
Fingerprint 2026-10-21 · transcript: header menu · form-as-sentence · comfortable · metrics absent · typographic links · side sheet
Fingerprint 2026-10-21 · mercury: header menu · object hero + peer tiles · comfortable · metrics absent · tile actions · bottom sheet

## Brand assets

Rendered from code in `design/brand/` with the same liquid-metal shader as the in-app orb, so the icon, installer and app stay one object. Regenerate with `npm run build:brand` (needs Playwright resolvable by Node and Pillow).

- **App icon:** a chrome droplet mid-splash, the pose the orb takes while you talk, lit from below by the red on-air light on a near-black studio squircle.
- **Menu-bar glyph:** the same splash as a template silhouette so macOS tints it for light and dark menu bars.
- **DMG:** 660 × 420 window. The wordmark sits above, mercury beads hop from the app to Applications, and the footer gives the one next step: hold fn and talk. Finder labels sit on mid-grey plates so they read in both appearance modes.
