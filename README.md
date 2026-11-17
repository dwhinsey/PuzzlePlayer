# puzPlayer

An Android app for solving crosswords from local **.puz**, **.ipuz** and **.jpz**
files.

## Features

**Library (home page)**
- Lists every puzzle you've added, showing whether each is new, in progress
  (with its time) or solved. Puzzles in progress come first (the most
  recently opened at the top), then new ones, then solved ones under a
  "Completed" heading.
- **Settings → Hide solved puzzles** (on the home page) leaves solved puzzles
  out of the list and search.
- **+** in the top bar opens the phone's file picker; you can pick several
  files at once. Puzzles are copied into the app, so the originals can be moved
  or deleted afterwards. The same file added twice is spotted and skipped.
- **Open with puzPlayer**: tap a .puz, .ipuz or .jpz file in another app
  (an email attachment, a download, a file manager) and choose puzPlayer.
  The puzzle is added to the library and opens straight away; if it's already
  there, it just opens. **Share → puzPlayer** works too. Because these
  files usually arrive with a generic "binary file" type, puzPlayer may
  also be offered for other unrecognised files; it says so if one isn't a
  crossword.
- Folders (nested if you like): the folder button creates one in the current
  folder; puzzles added while inside a folder go into it.
- Search by title or author with the magnifier in the top bar (searches every
  folder; the back arrow or Back gesture closes it). Search by size too:
  **mini** (4x4 to 6x6), **midi** (7x7 to 12x12), **weekday** (13x13 to
  18x18), **Sunday** (19x19 and up), going by the larger side; or a grid
  size such as **14x15**, which also finds 15x14; or one side, **15** or
  **15x**, for every grid with a side of 15. Words combine, e.g.
  "weekday jones".
- Sort by date added (newest/oldest), title (A–Z/Z–A) or size (smallest/
  biggest; puzzles of the same size keep the date or title order used before).
- Long-press a puzzle or folder for its menu: move to folder, rename, reset
  progress, delete.

**Solver**
- A touch-first solver: grid, clue bar, keyboard, timer, pencil, rebus (the
  **...** key) and check/reveal (the **Assist** menu). Clear grid and Reset
  puzzle are in the solver's Settings sheet, under "This puzzle". Revealing
  only turns the letters it supplies purple; correct entries keep their
  colour.
- The on-screen keyboard tracks each finger separately, so fast, overlapping
  taps don't drop letters. A key types when the finger lifts, as on Gboard
  (slide to a neighbouring key before lifting to change it), and a pop-up
  shows the letter above the key while it is held (can be turned off in the
  solver's Settings).
- A header bar across the top holds the back button, the puzzle's title and
  author, and a settings button. Below it: the timer on the left; pencil,
  **Notes** and **Assist** on the right.
- **Show timer** (solver's Settings, under Miscellaneous; on by default):
  turned off, the solver shows an **Info** button where the timer was (it
  opens the pause card: title, author, Resume), the home page shows no
  times, and the win message leaves out the time. The time is still kept,
  so turning the timer back on shows it as before.
- **Solving** (solver's Settings, both on by default): **Skip filled
  squares** (typing jumps over squares that already have a letter) and
  **Auto-advance to next clue** (the end of an answer moves on to the next
  clue).
- **Error Check Mode** (solver's Settings, under Accessibility): wrong
  letters turn red as they are typed.
- **Colorblind Mode** (solver's Settings, under Accessibility): marks that
  don't rely on colour. A wrong letter (after a check, or in Error Check
  Mode) gets a dot in the square's top-right corner; a revealed square gets
  a folded corner there.
- **Notes:** a scratch pad for each puzzle (the timer pauses while it's
  open), saved as you type and kept until
  the puzzle is reset (from the solver's Settings or by long-pressing it in
  the library)
  or deleted.
- **Settings** (the gear on the home page and in the solver) **→ Appearance:**
  Light, Dark (a neutral grey "Graphite" palette, css/theme-dark.css) or
  Match phone setting (the default).
- Once a puzzle is solved its letters are locked: you can still move around
  the grid and read the clues, and Clear grid or Reset puzzle starts over.
- Progress (letters, pencil marks, reveals and time) is saved as you go and
  survives closing the app. The timer pauses when you leave the app.
- Scrambled .puz files can be solved but not checked; the app says so.

## How it's built

The app is a small native Android shell (plain Java, no libraries) around a
WebView. The library and solver are HTML/CSS/JS in
`app/src/main/assets/www/`:

| File | Purpose |
| --- | --- |
| `js/crossword-solver.js` | The base solver, shared with the web version, unchanged apart from two layout queries marked `App:` |
| `css/solver.css` | The base solver's CSS: touch layout always on, comment styles removed |
| `js/solver-app.js` | Runs the base solver in the app: puzzle conversion, saving, back button, pause |
| `js/parsers.js` | .puz / .ipuz / .jpz (including zipped .jpz) readers |
| `js/library.js` | Home page: list, folders, search, sort, import |
| `js/storage.js` | Saving, via the Android bridge |
| `js/settings.js` | Settings (appearance) and the Settings sheet |
| `css/theme-dark.css` | Dark mode colours |
| `fonts/` | Public Sans (regular and italic), the app's font, with its licence (SIL Open Font License) |
| `js/app.js` | Wiring, back button, system bars |

To bring a change from the web version of the solver across, copy its
`js/solver.js` over `js/crossword-solver.js` and its `css/solver.css` over
`css/solver.css`, then redo the few `App:` edits described at the top of each
file.

The Java side (`MainActivity`, `PuzzleBridge`) provides the system file picker,
storage in the app's private files directory (written atomically), window
insets for the edge-to-edge layout, and the back gesture.

You can also open `app/src/main/assets/www/index.html` in a desktop browser
(with phone emulation in dev tools) to work on the interface; it falls back to
`localStorage` and an ordinary file input there.

## Building

- **GitHub Actions:** every push builds a debug APK. Open the run under the
  repository's *Actions* tab and download the `puzPlayer-debug-apk` artifact.
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
