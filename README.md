# PuzzlePlayer

An Android app for solving crosswords from local **.puz**, **.ipuz** and **.jpz**
files, using the mobile solving interface from hinseypuzzles.com.

## Features

**Library (home page)**
- Lists every puzzle you've added, showing whether each is new, in progress
  (with % filled and time) or solved.
- **+** in the top bar opens the phone's file picker; you can pick several
  files at once. Puzzles are copied into the app, so the originals can be moved
  or deleted afterwards. The same file added twice is spotted and skipped.
- Folders (nested if you like): the folder button creates one in the current
  folder; puzzles added while inside a folder go into it.
- Search by title or author (searches every folder).
- Sort by date added (newest/oldest) or title (A–Z/Z–A).
- Every puzzle and folder has a **⋮** menu (or long-press it): move to folder,
  rename, reset progress, delete.

**Solver**
- Grid, clue bar and on-screen keyboard, styled from the hinseypuzzles.com
  mobile solver. Tap a square to select it; tap it again (or the clue) to
  switch direction; ‹ › step through clues.
- Timer with pause (tap the timer). It pauses itself when you leave the app.
- Pencil mode, rebus entry (**123 → Rebus**), and check/reveal by square, word
  or puzzle, plus clear incorrect, reset and puzzle info/notes.
- Circles, shaded squares, rebus answers, italic clues and cross-references
  ("see 17-Across" highlights 17-Across in yellow).
- Progress is saved as you go and survives closing the app.
- Works with a hardware keyboard too (letters, arrows, Tab, Space, Backspace).

## How it's built

The app is a small native Android shell (plain Java, no libraries) around a
WebView. The library and solver are HTML/CSS/JS in
`app/src/main/assets/www/`:

| File | Purpose |
| --- | --- |
| `css/solver.css` | The site's solver CSS, mobile parts only |
| `js/parsers.js` | .puz / .ipuz / .jpz (including zipped .jpz) readers |
| `js/solver.js` | Solving interface |
| `js/library.js` | Home page: list, folders, search, sort, import |
| `js/storage.js` | Saving, via the Android bridge |
| `js/app.js` | Wiring, back button, system bars |

The Java side (`MainActivity`, `PuzzleBridge`) provides the system file picker,
storage in the app's private files directory (written atomically), window
insets for the edge-to-edge layout, and the back gesture.

You can also open `app/src/main/assets/www/index.html` in a desktop browser
(with phone emulation in dev tools) to work on the interface; it falls back to
`localStorage` and an ordinary file input there.

## Building

- **GitHub Actions:** every push builds a debug APK. Open the run under the
  repository's *Actions* tab and download the `PuzzlePlayer-debug-apk` artifact.
- **Android Studio:** open the project folder and press Run.
- **Command line:** with the Android SDK installed (`ANDROID_HOME` set),
  run `./gradlew assembleDebug`. The APK is written to
  `app/build/outputs/apk/debug/app-debug.apk`.

To install the APK on a phone, copy it over and open it; Android will ask you
to allow installs from that source the first time.

Requires Android 8.0 or newer.

## Limitations

- Scrambled ("locked") .puz files open and can be solved, but can't be checked
  or revealed, because the answers in them are scrambled.
- Diagramless and barred (cryptic-style) grids are shown as regular grids.
