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
- **Open with PuzzlePlayer**: tap a .puz, .ipuz or .jpz file in another app
  (an email attachment, a download, a file manager) and choose PuzzlePlayer.
  The puzzle is added to the library and opens straight away; if it's already
  there, it just opens. **Share → PuzzlePlayer** works too. Because these
  files usually arrive with a generic "binary file" type, PuzzlePlayer may
  also be offered for other unrecognised files; it says so if one isn't a
  crossword.
- Folders (nested if you like): the folder button creates one in the current
  folder; puzzles added while inside a folder go into it.
- Search by title or author with the magnifier in the top bar (searches every
  folder; the back arrow or Back gesture closes it).
- Sort by date added (newest/oldest) or title (A–Z/Z–A).
- Every puzzle and folder has a **⋮** menu (or long-press it): move to folder,
  rename, reset progress, delete.

**Solver**
- The hinseypuzzles.com solver, as it works on a phone: same grid, clue bar,
  keyboard, timer, pencil, rebus (the **...** key), check/reveal, Clear Grid
  and Reset Puzzle. The comment section is left out.
- The on-screen keyboard tracks each finger separately, so fast, overlapping
  taps don't drop letters. A key types when the finger lifts, as on Gboard
  (slide to a neighbouring key before lifting to change it), and a pop-up
  shows the letter above the key while it is held.
- A header bar across the top holds the back button, the puzzle's title and
  author, and a settings button.
- **Settings** (the gear on the home page and in the solver) **→ Appearance:**
  Light, Dark (a neutral grey "Graphite" palette, css/theme-dark.css) or
  Match phone setting.
- Progress (letters, pencil marks, reveals and time) is saved as you go and
  survives closing the app. The timer pauses when you leave the app.
- Scrambled .puz files can be solved but not checked; the app says so.

## How it's built

The app is a small native Android shell (plain Java, no libraries) around a
WebView. The library and solver are HTML/CSS/JS in
`app/src/main/assets/www/`:

| File | Purpose |
| --- | --- |
| `js/crossword-solver.js` | The site's `js/solver.js`, unchanged apart from two layout queries marked `App:` |
| `css/solver.css` | The site's solver CSS: touch layout always on, comment styles removed |
| `js/solver-app.js` | Runs the site's solver in the app: puzzle conversion, saving, back button, pause |
| `js/parsers.js` | .puz / .ipuz / .jpz (including zipped .jpz) readers |
| `js/library.js` | Home page: list, folders, search, sort, import |
| `js/storage.js` | Saving, via the Android bridge |
| `js/settings.js` | Settings (appearance) and the Settings sheet |
| `css/theme-dark.css` | Dark mode colours |
| `js/app.js` | Wiring, back button, system bars |

To bring a change from the website across, copy the site's `js/solver.js`
over `js/crossword-solver.js` and its `css/solver.css` over `css/solver.css`,
then redo the few `App:` edits described at the top of each file.

The Java side (`MainActivity`, `PuzzleBridge`) provides the system file picker,
storage in the app's private files directory (written atomically), window
insets for the edge-to-edge layout, and the back gesture.

You can also open `app/src/main/assets/www/index.html` in a desktop browser
(with phone emulation in dev tools) to work on the interface; it falls back to
`localStorage` and an ordinary file input there.

## Building

- **GitHub Actions:** every push builds a debug APK. Open the run under the
  repository's *Actions* tab and download the `PuzzlePlayer-debug-apk` artifact.
  The same run installs it on Android 15 and 16 emulators, checks that it
  starts, and runs a short import / solve / force-close / reopen test
  (`ci/`); screenshots from it are in the `emulator-output-*` artifacts.
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
