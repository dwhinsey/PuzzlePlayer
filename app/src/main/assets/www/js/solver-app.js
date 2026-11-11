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
        const re = /((?:\d+\s*(?:-|–)?\s*(?:,|and|&|or|\/)?\s*)+)(across|down)\b/gi;
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
        }

        _buildMobileKeyboard() {
            const keyboard = super._buildMobileKeyboard();
            this.releaseKeys = attachFastKeyboard(keyboard, this);
            return keyboard;
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
