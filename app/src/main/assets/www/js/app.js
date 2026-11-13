/*
 * Ties the library and solver together and talks to the Android side.
 */
(function (global) {
    'use strict';

    const bridge = global.AndroidBridge || null;
    const libraryView = document.getElementById('library-view');
    const solverView = document.getElementById('solver-view');
    const solverHost = solverView.querySelector('.solver-host');
    const headerTitle = solverView.querySelector('.solver-header-title');
    const headerSub = solverView.querySelector('.solver-header-sub');
    const fileInput = document.querySelector('.file-input-fallback');

    let solver = null; // the open AppCrosswordSolver
    let openEntry = null;

    function setBars(view) {
        if (!bridge) return;
        // White status bar icons on the headers of both pages; navigation bar
        // icons to suit the page underneath them.
        bridge.setBarStyle(false, !Settings.isDark());
    }

    function showLibrary() {
        solverView.hidden = true;
        libraryView.hidden = false;
        document.body.classList.remove('solving');
        setBars('library');
        Library.render();
    }

    function closeSolver() {
        if (!solver) return;
        solver.destroy();
        solver = null;
        openEntry = null;
        Library.flush();
        solverHost.replaceChildren();
        solverHost.className = 'solver-host';
        showLibrary();
    }

    function openPuzzle(entry) {
        const puzzle = Store.readJSON(Store.puzzleFile(entry.id));
        if (!puzzle) {
            UI.alert({
                title: 'Puzzle missing',
                message: 'The saved copy of this puzzle could not be read. Delete it and add the file again.',
            });
            return;
        }
        const progressFile = Store.progressFile(entry.id);
        const store = {
            load: () => Store.readJSON(progressFile),
            save(data) {
                Store.writeJSON(progressFile, data);
                Library.updateProgress(entry.id, SolverApp.summarize(puzzle, data));
            },
            notes: {
                read: () => Store.readNotes(entry.id),
                write: (text) => Store.writeNotes(entry.id, text),
            },
        };

        Library.markOpened(entry.id);
        headerTitle.textContent = puzzle.title || Library.displayTitle(entry);
        headerSub.textContent = puzzle.author || '';
        libraryView.hidden = true;
        solverView.hidden = false;
        document.body.classList.add('solving');
        setBars('solver');
        try {
            openEntry = entry;
            solver = SolverApp.create(solverHost, puzzle, store);
        } catch (e) {
            console.error(e);
            solver = null;
            openEntry = null;
            solverHost.replaceChildren();
            showLibrary();
            UI.alert({ title: 'Couldn’t open puzzle', message: String(e.message || e) });
        }
    }

    function pickFiles() {
        if (bridge) bridge.pickFiles();
        else fileInput.click();
    }

    function base64ToBytes(b64) {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    // The gear in both headers.
    for (const btn of document.querySelectorAll('.settings-btn')) {
        // In a puzzle, Settings also offers the keyboard option, Clear grid
        // and Reset puzzle; on the home page, the library options.
        btn.addEventListener('click', () => Settings.open(() => (solver
            ? Settings.solverItems().concat(solver.puzzleSettings())
            : Settings.libraryItems())));
    }
    Settings.onLibraryChange(() => Library.render());
    Settings.onSolverChange(() => { if (solver) solver._showErrors(); });
    Settings.onChange(() => setBars());

    // The header's back button (and the solver's own, which the app hides)
    // closes the puzzle.
    solverView.addEventListener('click', (e) => {
        if (e.target.closest('.back-btn, .solver-header-back')) {
            e.preventDefault();
            closeSolver();
        }
    });

    // Browser fallback for development.
    fileInput.addEventListener('change', async () => {
        const files = await Promise.all(Array.from(fileInput.files).map(async (f) => ({
            name: f.name,
            bytes: new Uint8Array(await f.arrayBuffer()),
        })));
        fileInput.value = '';
        if (files.length) Library.importFiles(files);
    });

    const App = {
        /**
         * Called by the Android side with files from the system picker, or
         * from another app ("Open with" or "Share"). In the second case,
         * `openAfter` is true and the puzzle opens straight away.
         */
        async onFilesPicked(json, openAfter) {
            let items;
            try {
                items = JSON.parse(json);
            } catch (e) {
                items = [];
            }
            if (!items.length) return [];
            const files = items.map((it) => ({
                name: it.name,
                error: it.error,
                bytes: it.data != null ? base64ToBytes(it.data) : null,
            }));
            // A file from another app lands in the library, whatever was
            // on screen when it arrived.
            if (openAfter) {
                UI.closeTop();
                closeSolver();
            }
            const ids = await Library.importFiles(files);
            // Temporary diagnostic (finding why "Open with" isn't offered):
            // show the type the system gives each file picked with +.
            if (!openAfter && items.some((it) => it.type)) {
                UI.alert({
                    title: 'File type (diagnostic)',
                    message: items.map((it) => it.name + '\n' + it.type + '\n' + it.uri).join('\n\n'),
                });
            }
            if (openAfter && ids.length === 1) {
                const entry = Library.puzzleById(ids[0]);
                if (entry) openPuzzle(entry);
            }
            return ids;
        },

        /** Window insets (status bar, navigation bar, keyboard) in CSS pixels. */
        setInsets(insets) {
            if (!insets) return;
            const root = document.documentElement.style;
            root.setProperty('--inset-top', (insets.top || 0) + 'px');
            root.setProperty('--inset-right', (insets.right || 0) + 'px');
            root.setProperty('--inset-bottom', (insets.bottom || 0) + 'px');
            root.setProperty('--inset-left', (insets.left || 0) + 'px');
            root.setProperty('--ime', (insets.ime || 0) + 'px');
            // Remember how tall the phone's keyboard is, so pop-ups can be
            // placed clear of it before it opens (see App.keyboardTop).
            if (insets.ime > 0) {
                try { localStorage.setItem('keyboardHeight', String(Math.round(insets.ime))); } catch (e) { /* ignore */ }
            }
            if (solver) solver._layout();
        },

        /**
         * Where the top of the phone's keyboard will be when it opens: as
         * last seen, or, before it has ever opened, a typical height (42%
         * of the screen, navigation bar included).
         */
        keyboardTop() {
            let h = 0;
            try { h = parseInt(localStorage.getItem('keyboardHeight'), 10) || 0; } catch (e) { /* ignore */ }
            if (!h) h = Math.round(window.innerHeight * 0.42);
            return window.innerHeight - h;
        },

        /** System back. Returns true if handled; false lets the app close. */
        handleBack() {
            if (UI.closeTop()) return true;
            if (solver) {
                if (!solver.handleBack()) closeSolver();
                return true;
            }
            return Library.handleBack();
        },

        /** The app is going to the background: stop the clock and save. */
        onAppPause() {
            if (solver) solver.pauseForBackground();
            Library.flush();
        },

        /** For tests: the open puzzle's id, if any. */
        openPuzzleId: () => (openEntry ? openEntry.id : null),
    };

    global.App = App;

    // Long-presses select text and pop up the system menu otherwise.
    document.addEventListener('contextmenu', (e) => {
        if (!e.target.closest('input, textarea')) e.preventDefault();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) App.onAppPause();
    });

    if (bridge) {
        try {
            App.setInsets(JSON.parse(bridge.getInsets()));
        } catch (e) { /* insets arrive again once the page has loaded */ }
    }

    Library.init({ openPuzzle, pickFiles });
    showLibrary();
})(window);
