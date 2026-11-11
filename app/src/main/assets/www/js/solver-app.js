/*
 * Runs the site's CrosswordSolver (js/crossword-solver.js) inside the app.
 *
 *   - Converts a puzzle from js/parsers.js into the shape the solver expects
 *     (the shape the site's parseIpuz() produces).
 *   - Saves progress to the app's storage instead of localStorage, and
 *     reports it to the library.
 *   - Stops the solver cleanly when you leave a puzzle, and pauses it when
 *     the app goes into the background.
 *   - Handles puzzles with no usable answer key (scrambled .puz files).
 */
(function (global) {
    'use strict';

    const CLUE_TAGS = new Set(['i', 'b', 'u', 'em', 'strong']);

    // The solver takes clue text with only <i>, <b>, <u>, <em> and <strong>
    // as markup and shows everything else literally, so entities are decoded
    // and any other tags dropped.
    function toClueText(html) {
        const s = String(html || '');
        if (!/[<&]/.test(s)) return s;
        const doc = new DOMParser().parseFromString('<div>' + s + '</div>', 'text/html');
        const walk = (nodes) => {
            let out = '';
            for (const n of nodes) {
                if (n.nodeType === 3) {
                    out += n.nodeValue;
                } else if (n.nodeType === 1) {
                    const tag = n.localName.toLowerCase();
                    const inner = walk(n.childNodes);
                    out += CLUE_TAGS.has(tag) ? '<' + tag + '>' + inner + '</' + tag + '>' : inner;
                }
            }
            return out;
        };
        return walk(doc.body.firstChild.childNodes);
    }

    // Clues that point at others, e.g. "See 17-Across" or "With 5- and 9-Down".
    function findRefs(text, known) {
        // Each number may be followed by several separators, as in
        // "17-, 25-, 49-, and 62-Across" (a comma and then "and").
        const re = /((?:\d+\s*[-\u2013]?(?:\s*(?:,|and|&|or|\/))*\s*)+)(across|down)\b/gi;
        const refs = [];
        const seen = new Set();
        let m;
        while ((m = re.exec(text))) {
            const direction = m[2].toLowerCase();
            for (const number of m[1].match(/\d+/g) || []) {
                const key = direction + ':' + number;
                if (known.has(key) && !seen.has(key)) {
                    seen.add(key);
                    refs.push({ direction, number });
                }
            }
        }
        return refs;
    }

    function toSolverPuzzle(p) {
        const width = p.width;
        const cells = [];
        for (let r = 0; r < p.height; r++) {
            const row = [];
            for (let c = 0; c < width; c++) {
                const cell = p.cells[r * width + c];
                row.push(cell.block || cell.void ? null : {
                    number: cell.number != null ? String(cell.number) : null,
                    // Without an answer key the solution is blank; check and
                    // reveal are switched off for such puzzles below.
                    solution: cell.solution || '',
                    styleColor: cell.color || null,
                    shapebg: cell.circle ? 'circle' : null,
                });
            }
            cells.push(row);
        }

        const known = new Set();
        for (const dir of ['across', 'down']) for (const c of p.clues[dir]) known.add(dir + ':' + c.num);

        const clues = {};
        for (const dir of ['across', 'down']) {
            clues[dir] = p.clues[dir].map((c) => {
                const text = toClueText(c.html);
                const plain = Parsers.htmlToText(c.html);
                return {
                    number: String(c.num),
                    text,
                    cells: c.cells.map((i) => [Math.floor(i / width), i % width]),
                    refs: findRefs(plain, known).filter((ref) => !(ref.direction === dir && ref.number === String(c.num))),
                };
            });
        }

        return {
            title: p.title,
            author: p.author,
            copyright: p.copyright,
            notes: p.notes,
            width,
            height: p.height,
            cells,
            clues,
            hasKey: p.hasSolution !== false,
        };
    }

    // ----- Keyboard -----
    //
    // The site's keyboard types on 'click'. On a touch screen a click only
    // arrives when a lone finger lifts: at normal typing speed the next
    // finger lands before the last one lifts, and that key's click never
    // comes. Here every finger is tracked on its own instead:
    //
    //   - A key types when its finger lifts, as on Gboard, so a finger can
    //     slide to the neighbouring key before letting go.
    //   - If another finger lands while a key is still held, the held key is
    //     typed at once, so overlapping taps always come out in order.
    //   - While a letter is held, a Gboard-style preview pops up above it.

    const PREVIEW_LINGER_MS = 60;

    function showPreview(key, letter) {
        const r = key.getBoundingClientRect();
        const width = Math.max(r.width * 1.35, 44);
        const height = r.height * 1.15;
        const left = Math.min(Math.max(r.left + r.width / 2 - width / 2, 4), window.innerWidth - width - 4);
        const p = document.createElement('div');
        p.className = 'kb-preview';
        p.textContent = letter;
        p.style.left = left + 'px';
        p.style.top = (r.top - height - 8) + 'px';
        p.style.width = width + 'px';
        p.style.height = height + 'px';
        p.style.fontSize = Math.round(height * 0.55) + 'px';
        document.body.appendChild(p);
        return p;
    }

    const letterOf = (key) => {
        const t = key.textContent.trim();
        return /^[A-Z]$/.test(t) ? t : null;
    };

    function attachFastKeyboard(keyboard, solver) {
        const held = new Map(); // pointerId -> { key, preview }, in the order pressed

        const actionFor = (key) => {
            if (key.classList.contains('kb-backspace')) return () => solver._backspaceAction();
            if (key.classList.contains('kb-more')) return () => solver._openRebusOverlay();
            const letter = letterOf(key);
            return letter ? () => solver._enterLetter(letter) : null;
        };

        const highlight = (press, key) => {
            if (press.key) press.key.classList.remove('pressed');
            if (press.preview) press.preview.remove();
            press.key = key;
            key.classList.add('pressed');
            const letter = letterOf(key);
            press.preview = letter ? showPreview(key, letter) : null;
        };

        const finish = (pointerId, type) => {
            const press = held.get(pointerId);
            if (!press) return;
            held.delete(pointerId);
            press.key.classList.remove('pressed');
            if (press.preview) {
                const preview = press.preview;
                setTimeout(() => preview.remove(), PREVIEW_LINGER_MS);
            }
            if (type) {
                const action = actionFor(press.key);
                if (action) action();
            }
        };

        keyboard.addEventListener('pointerdown', (e) => {
            const key = e.target.closest('.kb-key');
            if (!key || key.classList.contains('kb-spacer') || !actionFor(key)) return;
            e.preventDefault(); // keeps focus on the grid, as the site's mousedown handler does
            finish(e.pointerId, false);
            // Keys still held were pressed first, so they are typed first.
            for (const id of Array.from(held.keys())) finish(id, true);
            const press = { key: null, preview: null };
            highlight(press, key);
            held.set(e.pointerId, press);
        }, true);

        // Sliding a finger onto another key changes the key it will type.
        keyboard.addEventListener('pointermove', (e) => {
            const press = held.get(e.pointerId);
            if (!press) return;
            const under = document.elementFromPoint(e.clientX, e.clientY);
            const key = under && under.closest('.kb-key');
            if (key && key !== press.key && keyboard.contains(key) &&
                !key.classList.contains('kb-spacer') && actionFor(key)) {
                highlight(press, key);
            }
        }, true);

        keyboard.addEventListener('pointerup', (e) => finish(e.pointerId, true), true);
        keyboard.addEventListener('pointercancel', (e) => finish(e.pointerId, false), true);

        // The keys' own click handlers would type each letter a second time.
        keyboard.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
        }, true);

        // Leaving the puzzle mid-press shouldn't strand a preview on screen.
        return () => {
            for (const id of Array.from(held.keys())) finish(id, false);
        };
    }

    // Strength of shaded squares in dark mode. The site's 68% suits white
    // squares but washes out dark ones and hides their numbers.
    const DARK_SHADE_ALPHA = 0.24;

    // CrosswordSolver calls _load() from its constructor, before a subclass
    // could store anything on `this`, so the store is handed over here.
    let incomingStore = null;

    function isGrid(g, height, width, test) {
        return Array.isArray(g) && g.length === height &&
            g.every((row) => Array.isArray(row) && row.length === width && row.every(test));
    }

    class AppCrosswordSolver extends CrosswordSolver {
        _load() {
            this.appStore = incomingStore;
            const saved = this.appStore ? this.appStore.load() : null;
            if (!saved || typeof saved !== 'object') return;
            const { height, width } = this.puzzle;
            if (isGrid(saved.grid, height, width, (v) => typeof v === 'string')) this.userGrid = saved.grid;
            if (isGrid(saved.pencilGrid, height, width, (v) => typeof v === 'boolean')) this.pencilGrid = saved.pencilGrid;
            if (isGrid(saved.revealedGrid, height, width, (v) => typeof v === 'boolean')) this.revealedGrid = saved.revealedGrid;
            if (typeof saved.seconds === 'number') this.elapsedSeconds = saved.seconds;
        }

        _save() {
            if (!this.appStore || this.destroyed) return;
            this.appStore.save({
                grid: this.userGrid,
                pencilGrid: this.pencilGrid,
                revealedGrid: this.revealedGrid,
                seconds: this.elapsedSeconds,
                solved: !!this.puzzleSolved,
            });
        }

        // A solved puzzle's clock stays stopped, even after "Resume".
        _startInterval() {
            if (this.destroyed || this.puzzleSolved) return;
            super._startInterval();
        }

        _layout() {
            if (this.destroyed) return;
            super._layout();
            this._centreTopbar();
        }

        /**
         * The grid sits at the bottom of the space it's given, leaving a band
         * between the header and the grid. Move the timer row down to the
         * middle of that band. A transform, so the solver's own measurements
         * of the layout are untouched.
         */
        _centreTopbar() {
            if (!this.topbarEl || !this.gridEl || !this.gridWrapEl) return;
            const gridTop = this.gridEl.getBoundingClientRect().top;
            const wrapTop = this.gridWrapEl.getBoundingClientRect().top;
            const spare = Math.max(0, Math.round(gridTop - wrapTop));
            this.topbarEl.style.transform = spare ? 'translateY(' + Math.round(spare / 2) + 'px)' : '';
        }

        _render() {
            super._render();
            // "?" becomes "Assist"; Clear Grid and Reset Puzzle move to the
            // Settings sheet (see puzzleSettings below).
            this.helpBtn.textContent = 'Assist';
            this.helpBtn.classList.add('assist-btn');
            for (const b of Array.from(this.helpMenuEl.querySelectorAll('.solver-btn'))) {
                if (/^(Clear Grid|Reset Puzzle)$/.test(b.textContent.trim())) b.remove();
            }
            // For dark mode: each shaded square's lighter shade, and the black
            // squares whose right or lower neighbour is a letter square (those
            // edges keep their grid line; edges between two black squares
            // don't get one).
            const { cells, width, height } = this.puzzle;
            for (let r = 0; r < height; r++) {
                for (let c = 0; c < width; c++) {
                    const cell = cells[r][c];
                    if (cell) {
                        // Dark mode shades with the same colour, more lightly.
                        const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(cell.styleColor || '');
                        if (m) {
                            const [red, green, blue] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
                            this.cellEls[r][c].style.setProperty('--shade-dark',
                                'rgba(' + red + ',' + green + ',' + blue + ',' + DARK_SHADE_ALPHA + ')');
                        }
                        continue;
                    }
                    const el = this.cellEls[r][c];
                    if (c + 1 < width && cells[r][c + 1]) el.classList.add('open-right');
                    if (r + 1 < height && cells[r + 1][c]) el.classList.add('open-below');
                }
            }
        }

        _buildMobileKeyboard() {
            const keyboard = super._buildMobileKeyboard();
            this.releaseKeys = attachFastKeyboard(keyboard, this);
            return keyboard;
        }

        // ----- Clear and reset, from the Settings sheet -----

        /** Runs one of the site's methods that asks window.confirm() first, answering yes. */
        _confirmed(method) {
            const original = window.confirm;
            window.confirm = () => true;
            try {
                method.call(this);
            } finally {
                window.confirm = original;
            }
        }

        clearGrid() {
            UI.confirm({
                title: 'Clear the grid?',
                message: 'All letters are removed. The timer keeps running.',
                okLabel: 'Clear',
                danger: true,
            }).then((ok) => { if (ok && !this.destroyed) this._confirmed(super.clearGrid); });
        }

        resetPuzzle() {
            UI.confirm({
                title: 'Reset the puzzle?',
                message: 'All letters are removed and the timer goes back to zero.',
                okLabel: 'Reset',
                danger: true,
            }).then((ok) => { if (ok && !this.destroyed) this._confirmed(super.resetPuzzle); });
        }

        /** Items for the Settings sheet while this puzzle is open. */
        puzzleSettings() {
            return [
                { section: 'This puzzle' },
                { label: 'Clear grid', action: () => this.clearGrid() },
                { label: 'Reset puzzle', sub: 'Clears the grid and the timer', danger: true, action: () => this.resetPuzzle() },
            ];
        }

        // ----- Reveal -----

        // The site marks every revealed square as revealed (purple), even
        // ones already filled in correctly. Only letters the reveal supplies
        // are marked; correct entries keep their colour (and lose any pencil).
        _revealCell(r, c) {
            const solution = this.puzzle.cells[r][c].solution;
            const entry = this.userGrid[r][c];
            if (solution && entry && entry.toUpperCase() === solution.toUpperCase()) {
                this.pencilGrid[r][c] = false;
                return;
            }
            super._revealCell(r, c);
        }

        // ----- Puzzles without an answer key -----

        _noKey() {
            this._setHelpMenuOpen(false);
            UI.alert({
                title: 'Can’t check this puzzle',
                message: 'The answers in this file are scrambled, so squares can’t be checked or revealed.',
            });
        }

        checkSquare() { if (this.puzzle.hasKey) super.checkSquare(); else this._noKey(); }
        checkWord() { if (this.puzzle.hasKey) super.checkWord(); else this._noKey(); }
        checkPuzzle() { if (this.puzzle.hasKey) super.checkPuzzle(); else this._noKey(); }
        revealSquare() { if (this.puzzle.hasKey) super.revealSquare(); else this._noKey(); }
        revealWord() { if (this.puzzle.hasKey) super.revealWord(); else this._noKey(); }
        revealPuzzle() { if (this.puzzle.hasKey) super.revealPuzzle(); else this._noKey(); }

        _checkWin() {
            if (this.puzzle.hasKey) {
                super._checkWin();
                return;
            }
            const full = this._isGridFull();
            if (full && !this.gridWasFull) {
                this.resultHeadingEl.textContent = 'Grid complete';
                this.resultMessageEl.textContent = 'This puzzle’s answers are scrambled, so your solution can’t be checked.';
                this.resultBtnEl.textContent = 'OK';
                this.resultOverlayEl.hidden = false;
            }
            this.gridWasFull = full;
        }

        // ----- App lifecycle -----

        /** The app is going into the background: pause like the timer button does. */
        pauseForBackground() {
            if (this.timerInterval) this._pauseTimer();
            else this._save();
        }

        /** Back gesture: close the help menu or rebus entry first. */
        handleBack() {
            if (!this.helpMenuEl.hidden) {
                this._setHelpMenuOpen(false);
                return true;
            }
            if (this.rebusMode) {
                this._cancelRebus();
                return true;
            }
            return false;
        }

        destroy() {
            if (this.releaseKeys) this.releaseKeys();
            if (this.timerInterval) {
                clearInterval(this.timerInterval);
                this.timerInterval = null;
            }
            this._save();
            this.destroyed = true;
        }
    }

    function create(rootEl, parsedPuzzle, store) {
        incomingStore = store;
        try {
            return new AppCrosswordSolver(rootEl, toSolverPuzzle(parsedPuzzle), { backUrl: '#library' });
        } finally {
            incomingStore = null;
        }
    }

    /** Library summary of a saved progress object. */
    function summarize(parsedPuzzle, saved) {
        let open = 0;
        let filled = 0;
        parsedPuzzle.cells.forEach((cell, i) => {
            if (cell.block || cell.void) return;
            open++;
            const r = Math.floor(i / parsedPuzzle.width);
            const c = i % parsedPuzzle.width;
            const row = saved && Array.isArray(saved.grid) ? saved.grid[r] : null;
            if (row && row[c]) filled++;
        });
        const seconds = saved && typeof saved.seconds === 'number' ? saved.seconds : 0;
        let status = 'new';
        if (saved && saved.solved) status = 'done';
        else if (filled || seconds > 0) status = 'progress';
        return {
            status,
            percent: open ? Math.round((filled / open) * 100) : 0,
            elapsed: seconds * 1000,
        };
    }

    global.SolverApp = { create, summarize, toSolverPuzzle };
})(window);
