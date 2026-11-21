<!-- shared-preferences:start -->
## David's preferences (shared across all of David's apps)

This section is the same in every one of David's app repos. If David states a new general preference
(not specific to this app), add it here, in this file, and commit it. David's Mac copies it to the other repos.

**Who David is.** A guitar teacher and gigging guitarist (he/him) who builds personal and teaching apps with Claude.
Comfortable with tech but not a programmer: explain in plain words, skip jargon, keep replies short and
concrete. Likes to see things working: verify before saying "done".

**How the apps are built and hosted**
- Public web apps on GitHub Pages under the **davyrockett** GitHub account (never an Artifact or a hosted
  service). Live at `https://www.davyrockett.com/<repo>/` (since 2026-10-18; old
  `davyrockett.github.io` links redirect there). The website itself is the `davyrockett.github.io` repo.
- Each app: `index.html` (+ `app.js` / `styles.css` when bigger), `sw.js` service worker for offline use
  with an update banner, `manifest.webmanifest`, `icons/` drawn by `tools/make-icons.py`, a
  `Start <App>.command` for local testing on the Mac, and a README written for David.
- **`move.js`** (since 2026-10-17): every app loads `move.js` as its first script and lists it in `sw.js`
  `ASSETS`. It carries the app's settings over when the apps move from davyrockett.github.io to
  davyrockett.com (plan: `Claude Apps/move-to-davyrockett-com.md`; master copy `Claude Apps/tools/move.js`).
  Keep it; a new app gets a copy with `data-keep` set to its own localStorage key prefix.
- **`suite.js`** (since 2026-10-18): every app also loads `<script src="suite.js" defer></script>` (in `ASSETS` too).
  It shows an "All apps" button when the app was opened from David's app suite (www.davyrockett.com/apps, one Home
  Screen icon for everything; master copy `Claude Apps/tools/suite.js`). New apps get it too. If a new app syncs,
  add it to `SYNCED` in the website's `apps/launcher.js` so the suite's one access key reaches it.
- **`share.js`** (since 2026-10-19): Settings in every app has a **Share** section (the app's link, "Copy link",
  and "Share…" where the device can). Load `<script src="share.js" defer></script>` (in `ASSETS` too) and add a
  `data-share` block using the app's own classes (see `Claude Apps/tools/share.js`). First Frets has its own
  share section with a QR code instead.
- **Every change must bump the version** (`tools/bump.sh` where it exists, otherwise `VERSION` in `sw.js`
  and the matching app version). Without it, installed copies on phones never update.
- Settings (gear icon) always has **Appearance: Light / Dark / Auto** and **Check for updates**.
  Apps open in **Light** unless changed in Settings.
- Design follows David's First Frets app: warm off-white / dark-brown palette, bright orange accent (#F57C14; dark mode #FF9433; David tried his logo orange #E27039, too red) and
  davyrockett grey secondary text (#676767; dark mode #A3A3A3),
  Big Shoulders Display headings, Atkinson Hyperlegible body text, works well on a phone.
- Data lives on the device (localStorage / IndexedDB). Apps whose data must sync between phone and Mac
  use a separate `davyrockett/<app>-data` repo (`data.json`) and an access key pasted into Settings.
  Never commit keys, tokens or anything in `private/`.
- **Publish when done:** commit, push to `main`, and confirm the live site shows the new version.
  End with a brief summary of what changed. David's Mac pulls GitHub changes into its Dropbox copy
  automatically, so pushing is all that's needed.

**Taste**
- Labels and descriptions plain and descriptive. Jokes belong in names (e.g. "Page Fright"), not taglines.
- Keep screens uncluttered: show extra controls only when they're relevant.
- Nothing should jump around: when a control doesn't apply, grey it out in place rather than hiding it, and
  reserve space for things that appear, so other controls never shift.
- **Pop-ups close with a tap outside** (David, 2026-10-31): any settings sheet or pop-up closes when you tap or
  click outside it, and still keeps its own Close / Done button. Forms with typing ask "Discard your changes?" first.
- **No AI voices, ever:** no text-to-speech or synthesised singing in any app. Use written instructions on
  screen, and instrument or synth sounds for audio.
- Commit messages: a short, plain description of the change.
- When renaming or moving an app, keep the old address working with a redirect repo.

**New apps:** create the repo under davyrockett and turn on GitHub Pages; David's Mac downloads new
davyrockett repos into `~/Dropbox/Local/Claude Apps/` automatically. Give each new app its own CLAUDE.md
with this section (copy it from any other app) plus an "## This app" section.
Also add every new app to David's unlinked app list, **www.davyrockett.com/apps** (`apps/index.html` in the
website repo, `Claude Apps/website`): icon, name and one-line description, in the right group.
<!-- shared-preferences:end -->

## This app

Launch Control: David's Apple Reminders as a 3D launch control room (three.js r128, vendored in `vendor/`). Built
2026-11-20 from a chat demo David loved ("This is SO fun"); he asked for "a permanent page that syncs with Reminders".
Live: https://www.davyrockett.com/launch-control/ See README.md.

- **Publish:** run `tools/bump.sh` (bumps `sw.js` VERSION and `window.APP_VERSION`), commit, push, confirm the live `sw.js`.
- **Test locally:** `python3 -m http.server 8784` here, open http://localhost:8784/. The service worker is skipped on
  localhost. `private/` is gitignored (handy for a test copy of tasks.json; never commit reminders).
- **Data:** PRIVATE repo `davyrockett/launch-control-data`. `tasks.json` = `{checked, updated, lists, tasks:[{id, list,
  name, due "YYYY-MM-DDTHH:mm" local, allDay, priority?, repeats?}]}`, written only by the Mac. `done.json` =
  `{requests, log}`: the page appends Done taps to `requests`; the Mac ticks them off and moves them to `log` (last 30).
  The page keeps tapped ones hidden (`lc.pending`) until the log shows them handled and `checked` is later.
- **Mac side:** `mac/LaunchControlSync.swift` (EventKit), built by `mac/install.command` into
  `~/Applications/Launch Control Sync.app` (ad-hoc signed; a rebuild may need Reminders permission again), launchd
  agent `com.davyrockett.launch-control-sync` (KeepAlive). Saves on every Reminders change (EKEventStoreChanged),
  checks done.json every minute (ETag, so 304s are free), and re-saves at least every 3 hours as a heartbeat. GitHub key
  from `gh auth token --user davyrockett`. Log: `~/Library/Logs/launch-control-sync.log`. Test: `"…/Launch Control Sync" export|once`.
- Midnight reminders with no time count as all-day. Completing a repeating reminder moves it to its next date.
- **Night (dark) is the default** (David, 2026-11-20, "Make night mode the default"), an exception to the shared
  "Light unless changed" rule. Appearance: Dusk or Night; the toolbar button switches between them.
- Phone: the list is a sheet along the bottom (fold button); a tall screen frames the room from outside it, and walls,
  back wall and ceiling hide while the camera is outside them ("dollhouse"). Camera glides are time-based.
- **Layout = urgency** (David, 2026-11-20: "feel the urgency and lack of urgency"): rows step away from the viewer.
  NOW (Overdue + Today) up front and biggest, Overdue with flashing alarm beacons; NEXT (Tomorrow + This week) behind and
  wider; LATER (This month + Later) at the back, smaller and dimmer (`LAY` in app.js). Deep space (no date) is a globe far
  out past the window. (The floor pulses that ran toward the viewer were removed 2026-11-21.)
- **Looks** (David, 2026-11-20, picked from previews): Night = dark room + aurora (soft purple/teal/magenta washes from
  above that slowly breathe, `aurora`). "Day" = **Dusk**: the same dark room and dark screens, a touch lighter, with a
  sunset through the window (no aurora). Panels/UI are dark in both. Settings and the toolbar say Dusk / Night (the stored
  values stay `light` / `dark`). The earlier all-white and light-grey day views were rejected as too far from night.
- Edges: the night glow pass draws into a multisampled buffer (WebGL 2), so edges stay smooth.
- **Materials** (David, 2026-11-20: "try using real materials"): floor tiles, brushed metal (desks, frames, mullions),
  wall panels with screws and rubber keyboard decks are textures drawn in code (`texSet`; map + bump + roughness),
  near-white so the day/night palette still sets the tone. `box()` scales UVs to real size (`TEXU` units per repeat).
  The v4 attempt at colour management/tone mapping/shadows/reflections was undone at David's request.
- **Fit-out** (David, 2026-11-21, picked "Fitted out" from three polish previews over "Grounded" = mirror floor + soft shadows and
  "Atmosphere" = light shafts, spot cones, vignette): ceiling trusses with light panels, server racks on the side walls, window sill
  and header, hazard stripes round the NOW row, NOW / NEXT / LATER painted on the floor (`marks`, `drawMarks`), a glow strip under
  each desk. Plain geometry and glowing colour only, no extra lights. Ceiling and wall pieces go in `shellStrips` so they hide in the
  dollhouse view. Chairs were tried in the preview and dropped (they blocked the keyboards). Preview code: `private/looks.js` (v1-v3).
- **2026-11-21:** David: "Get rid of balls in middle of room" (the runway pulses; the thin floor line stays) and "Up resolution,
  especially on phone": phones render at their own pixel density up to 3 (was 1.6), desktop at 1.5-2, and screens/cards are drawn
  with 2x the pixels (`ctex(w, h, k)`; big screen 1.5x on phones). If a phone gets choppy, lower the cap in `setPixelRatio`.
  The toolbar Dusk/Night button names the look you switch TO; David asked to swap it, then agreed it was right as is.
- **Big screen headline** (David, 2026-11-21): a gentle motivating line instead of the old "next launch" countdown,
  which he found confusing. Lines are written in app.js (`MSG`; no AI, offline), some built from his real overdue/today
  reminders and the time of day. New one on open, every 20 minutes, or on click; `lc.msg-seen` avoids repeats.
- localStorage keys start with `lc.` (`data`, `pending`, `theme`, `sync-token`).
