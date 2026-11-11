/*
 * Ties the library and solver together and talks to the Android side.
 */
(function (global) {
    'use strict';

    const bridge = global.AndroidBridge || null;
    const libraryView = document.getElementById('library-view');
    const solverView = document.getElementById('solver-view');
    const fileInput = document.querySelector('.file-input-fallback');

    function setBars(view) {
        if (!bridge) return;
        // Library: white icons on the navy header. Solver: dark icons on light grey.
        if (view === 'solver') bridge.setBarStyle(true, true);
        else bridge.setBarStyle(false, true);
    }

    function showLibrary() {
        solverView.hidden = true;
        libraryView.hidden = false;
        document.body.classList.remove('solving');
        setBars('library');
        Library.render();
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
        const progress = Store.readJSON(Store.progressFile(entry.id));
        libraryView.hidden = true;
        solverView.hidden = false;
        document.body.classList.add('solving');
        setBars('solver');
        try {
            Solver.open(entry, puzzle, progress, {
                onSave(id, snapshot, summary) {
                    Store.writeJSON(Store.progressFile(id), snapshot);
                    Library.updateProgress(id, summary);
                },
                onExit: showLibrary,
            });
        } catch (e) {
            console.error(e);
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
        /** Called by the Android side with the files chosen in the system picker. */
        onFilesPicked(json) {
            let items;
            try {
                items = JSON.parse(json);
            } catch (e) {
                items = [];
            }
            if (!items.length) return;
            const files = items.map((it) => ({
                name: it.name,
                error: it.error,
                bytes: it.data != null ? base64ToBytes(it.data) : null,
            }));
            Library.importFiles(files);
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
        },

        /** System back. Returns true if handled; false lets the app close. */
        handleBack() {
            if (UI.closeTop()) return true;
            if (!solverView.hidden) {
                if (Solver.handleBack()) return true;
                Solver.exit();
                return true;
            }
            return Library.handleBack();
        },

        /** The app is going to the background: stop the clock and save. */
        onAppPause() {
            if (Solver.isOpen()) Solver.appPaused();
        },
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
