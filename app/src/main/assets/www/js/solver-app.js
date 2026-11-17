/*
 * Runs the base CrosswordSolver (js/crossword-solver.js) inside the app.
 *
 *   - Converts a puzzle from js/parsers.js into the shape the solver expects
 *     (the shape the base solver's parseIpuz() produces).
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
    // The base solver's keyboard types on 'click'. On a touch screen a click only
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
            press.preview = letter && Settings.keyPreview() ? showPreview(key, letter) : null;
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
            e.preventDefault(); // keeps focus on the grid, as the base solver's mousedown handler does
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

    // Strength of shaded squares in dark mode. The base solver's 68% suits white
    // squares but washes out dark ones and hides their numbers.
    const DARK_SHADE_ALPHA = 0.24;

    // Space (px) wanted around the timer row, above and below together,
    // before it switches to its compact size.
    const TOPBAR_MIN_ROOM = 24;

    // Size limits for the notes pop-up (px).
    const NOTES_MAX_HEIGHT = 340;
    const NOTES_MIN_HEIGHT = 180;

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
            this._chooseTopbarSize();
            super._layout();
            this._centreTopbar();
            this._centreOnGrid();
            this._drawGridLines();
        }

        // ----- Long clues -----

        /**
         * A clue too long for the bar even at its smallest size scrolls: it
         * starts at the top (css/app.css keeps it from spilling out above
         * the bar), and the edge with more text fades out. Clues are also
         * re-fitted once the app's font has loaded: fitted before then, with
         * the narrower stand-in font, a long clue could end up too big.
         */
        _setUpClueScroll() {
            for (const el of this.clueTextEls || []) {
                el.addEventListener('scroll', () => this._markClueOverflow(el), { passive: true });
                this._setUpClueTap(el);
                // Dead zones between the arrows and the clue. A touch screen
                // pulls a tap onto the nearest tappable thing, so an empty gap
                // would still trigger an arrow; these catch it and do nothing.
                for (const beside of [el.previousElementSibling, el.nextElementSibling]) {
                    if (!beside) continue;
                    const gap = document.createElement('span');
                    gap.className = 'clue-gap';
                    gap.setAttribute('aria-hidden', 'true');
                    gap.addEventListener('click', (e) => e.stopPropagation());
                    if (beside === el.previousElementSibling) el.before(gap); else el.after(gap);
                }
                // Press shade on the clue and the arrows while a finger is
                // down (css/app.css): on at once, fading on lift, and on the
                // clue cleared as soon as it starts to scroll. The clue's
                // shade is its own layer, the clue's width and the bar's full
                // height (the clue's box is shorter than the bar).
                const bar = el.parentElement;
                // Scroll bar for a clue too long for the bar (_markClueOverflow).
                const track = document.createElement('span');
                track.className = 'clue-scroll';
                track.setAttribute('aria-hidden', 'true');
                track.appendChild(document.createElement('span'));
                bar.appendChild(track);
                el.scrollTrack = track;
                const shade = document.createElement('span');
                shade.className = 'clue-press';
                shade.setAttribute('aria-hidden', 'true');
                bar.appendChild(shade);
                const pressClue = () => {
                    shade.style.left = el.offsetLeft + 'px';
                    shade.style.width = el.offsetWidth + 'px';
                    shade.classList.add('on');
                };
                const releaseClue = () => shade.classList.remove('on');
                el.addEventListener('pointerdown', pressClue);
                for (const type of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(type, releaseClue);
                el.addEventListener('scroll', releaseClue, { passive: true });
                for (const btn of bar.querySelectorAll('.clue-nav-btn')) {
                    const off = () => btn.classList.remove('pressing');
                    btn.addEventListener('pointerdown', () => btn.classList.add('pressing'));
                    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(type, off);
                }
            }
            if (document.fonts && document.fonts.ready) {
                const refit = () => { if (!this.destroyed) this._fitClueText(); };
                document.fonts.ready.then(refit);
                // And whenever a font finishes loading later (italic, say).
                this.fontsLoaded = refit;
                document.fonts.addEventListener('loadingdone', refit);
            }
        }

        /**
         * Tapping the clue swaps between the across and down entries at the
         * cursor (as tapping the selected square again does). Only a tap
         * counts: a finger that moves, or a clue that scrolls, is a scroll,
         * so long clues still scroll without swapping.
         */
        _setUpClueTap(el) {
            let start = null;
            el.addEventListener('pointerdown', (e) => {
                start = { x: e.clientX, y: e.clientY, scroll: el.scrollTop, time: Date.now() };
            });
            el.addEventListener('pointercancel', () => { start = null; });
            el.addEventListener('click', (e) => {
                const s = start;
                start = null;
                if (!s) return;
                const moved = Math.hypot(e.clientX - s.x, e.clientY - s.y);
                if (moved > 10 || Math.abs(el.scrollTop - s.scroll) > 1 || Date.now() - s.time > 600) return;
                this._swapDirectionAtCursor();
            });
        }

        _swapDirectionAtCursor() {
            if (!this.selected || this.rebusMode) return;
            const { row, col } = this.selected;
            const clues = this.cellClues[row][col];
            if (!clues.across || !clues.down) return;
            this.overwriteMode = false;
            this.direction = this.direction === 'across' ? 'down' : 'across';
            this._updateUI();
        }

        _fitClueText() {
            // Fit without the scroll bar's extra room, then add it (and the
            // bar) only if the clue still overflows.
            for (const el of this.clueTextEls || []) el.classList.remove('scrollable');
            super._fitClueText();
            for (const el of this.clueTextEls || []) {
                if (el.scrollHeight - el.clientHeight > 1) el.classList.add('scrollable');
                this._markClueOverflow(el);
            }
        }

        _markClueOverflow(el) {
            const more = el.scrollHeight - el.clientHeight;
            el.classList.toggle('more-above', more > 1 && el.scrollTop > 1);
            el.classList.toggle('more-below', more > 1 && el.scrollTop < more - 1);
            // The scroll bar: a track beside the clue, the thumb sized to the
            // part showing and placed to match the scroll.
            const track = el.scrollTrack;
            if (!track) return;
            const show = more > 1 && el.classList.contains('scrollable');
            track.classList.toggle('on', show);
            if (!show) return;
            const height = el.clientHeight - 8;
            track.style.left = (el.offsetLeft + el.offsetWidth) + 'px';
            track.style.top = (el.offsetTop + 4) + 'px';
            track.style.height = height + 'px';
            const thumbHeight = Math.max(12, height * el.clientHeight / el.scrollHeight);
            const thumb = track.firstElementChild;
            thumb.style.height = thumbHeight + 'px';
            thumb.style.top = ((height - thumbHeight) * Math.min(1, el.scrollTop / more)) + 'px';
        }

        /**
         * Light mode's grid lines: an exact number of screen pixels each (2,
         * in grey, like the NYT app; css/app.css), the same everywhere. CSS
         * borders can't do that (the WebView rounds a border to a whole CSS
         * pixel, 2 or 3 screen pixels on most phones), so the lines are
         * drawn on a layer over the grid. There is no line between two black
         * squares side by side, so neighbouring black squares join up. css/app.css drops the squares' own lines in light mode and
         * hides this layer in dark mode, which keeps its border lines.
         */
        _drawGridLines() {
            const grid = this.gridEl;
            const wrap = this.gridWrapEl;
            if (!grid || !wrap || this.destroyed || !this.cellEls || !this.cellEls.length) return;
            const NS = 'http://www.w3.org/2000/svg';
            if (!this.gridLinesEl) {
                const svg = document.createElementNS(NS, 'svg');
                svg.setAttribute('class', 'grid-lines');
                svg.setAttribute('aria-hidden', 'true');
                const path = document.createElementNS(NS, 'path');
                path.setAttribute('shape-rendering', 'crispEdges');
                path.setAttribute('fill', 'none');
                svg.appendChild(path);
                wrap.appendChild(svg);
                this.gridLinesEl = svg;
                this.gridLinesPath = path;
                // Redraw whenever the grid changes size (rotation, keyboard,
                // a different top row).
                if (window.ResizeObserver) {
                    this.gridLinesObserver = new ResizeObserver(() => this._drawGridLines());
                    this.gridLinesObserver.observe(grid);
                }
            }
            const dpr = window.devicePixelRatio || 1;
            const wr = wrap.getBoundingClientRect();
            const gr = grid.getBoundingClientRect();
            if (!gr.width) return;
            const cs = getComputedStyle(grid);
            const snap = (v) => Math.round(v * dpr) / dpr;
            const left = snap(gr.left + parseFloat(cs.borderLeftWidth)) - wr.left;
            const top = snap(gr.top + parseFloat(cs.borderTopWidth)) - wr.top;
            const right = snap(gr.right - parseFloat(cs.borderRightWidth)) - wr.left;
            const bottom = snap(gr.bottom - parseFloat(cs.borderBottomWidth)) - wr.top;
            // Line width in screen pixels (css/app.css, --grid-line-px). The
            // WebView draws squares from whole screen pixel to whole screen
            // pixel; an even width straddles the edge, an odd one ends at it.
            const px = Math.max(1, Math.round(parseFloat(getComputedStyle(this.gridLinesEl).getPropertyValue('--grid-line-px')) || 1));
            const line = (edge) => (Math.round(edge * dpr) - (px % 2) * 0.5) / dpr;
            const { width, height } = this.puzzle;
            const xs = [left];
            for (let c = 0; c < width - 1; c++) xs.push(this.cellEls[0][c].getBoundingClientRect().right);
            xs.push(right + wr.left);
            const ys = [top];
            for (let r = 0; r < height - 1; r++) ys.push(this.cellEls[r][0].getBoundingClientRect().bottom);
            ys.push(bottom + wr.top);
            // Square edges in layer coordinates, snapped to screen pixels.
            const ex = xs.map((x, i) => (i === 0 ? left : i === xs.length - 1 ? right : snap(x) - wr.left));
            const ey = ys.map((y, i) => (i === 0 ? top : i === ys.length - 1 ? bottom : snap(y) - wr.top));
            const block = (r, c) => !this.puzzle.cells[r][c];
            // Each segment runs half a line width past its square, so lines
            // meet without notches at the corners.
            const over = px / 2 / dpr;
            let d = '';
            // Vertical lines, one run per stretch of squares that isn't a
            // pair of black squares side by side.
            for (let c = 0; c < width - 1; c++) {
                const x = (line(xs[c + 1]) - wr.left).toFixed(3);
                let start = -1;
                for (let r = 0; r <= height; r++) {
                    const draw = r < height && !(block(r, c) && block(r, c + 1));
                    if (draw && start < 0) start = r;
                    if (!draw && start >= 0) {
                        d += 'M' + x + ' ' + (ey[start] - over).toFixed(3) + 'V' + (ey[r] + over).toFixed(3);
                        start = -1;
                    }
                }
            }
            // Horizontal lines, likewise for squares one above the other.
            for (let r = 0; r < height - 1; r++) {
                const y = (line(ys[r + 1]) - wr.top).toFixed(3);
                let start = -1;
                for (let c = 0; c <= width; c++) {
                    const draw = c < width && !(block(r, c) && block(r + 1, c));
                    if (draw && start < 0) start = c;
                    if (!draw && start >= 0) {
                        d += 'M' + (ex[start] - over).toFixed(3) + ' ' + y + 'H' + (ex[c] + over).toFixed(3);
                        start = -1;
                    }
                }
            }
            this.gridLinesPath.setAttribute('d', d);
            this.gridLinesPath.setAttribute('stroke-width', String(px / dpr));
        }

        /**
         * A tall grid leaves little room above it. If the full-size timer row
         * would leave less than TOPBAR_MIN_ROOM around it, use the compact
         * one. Decided from the full-size row's height (measured while it is
         * showing), so switching sizes can't flip the decision back.
         */
        _chooseTopbarSize() {
            const root = this.root;
            const topbar = this.topbarEl;
            const wrap = this.gridWrapEl;
            if (!topbar || !wrap || !root.clientHeight || !wrap.clientWidth) return;
            if (!root.classList.contains('compact-top')) this.fullTopbarHeight = topbar.offsetHeight;
            if (!this.fullTopbarHeight) return;
            // Height of the other rows: clue bar and keyboard (whose padding
            // includes the navigation bar).
            let others = 0;
            for (const child of root.children) {
                if (child === topbar || child.contains(wrap)) continue;
                const cs = getComputedStyle(child);
                if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue;
                others += child.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
            }
            const room = root.clientHeight - others - this.fullTopbarHeight;
            const gridHeight = wrap.clientWidth / this.puzzle.width * this.puzzle.height;
            root.classList.toggle('compact-top', room - gridHeight < TOPBAR_MIN_ROOM);
        }

        /**
         * Pop-ups centre on the grid rather than on the whole screen: the
         * solver's own cards (start, pause, result) by placing them within
         * their overlay, and the app's dialogs (clear, reset) through
         * --grid-centre-y, which css/app.css uses while solving.
         */
        _centreOnGrid() {
            if (!this.gridEl || this.destroyed) return;
            const grid = this.gridEl.getBoundingClientRect();
            if (!grid.height) return;
            const mid = grid.top + grid.height / 2;
            document.documentElement.style.setProperty('--grid-centre-y', Math.round(mid) + 'px');
            for (const overlay of this.root.querySelectorAll(':scope > .solver-overlay')) {
                const card = overlay.querySelector('.solver-overlay-card');
                if (!card) continue;
                if (overlay.hidden) continue;
                const box = overlay.getBoundingClientRect();
                const cs = getComputedStyle(overlay);
                // The card is placed within the overlay's padding.
                const padTop = parseFloat(cs.paddingTop) || 0;
                const inner = box.height - padTop - (parseFloat(cs.paddingBottom) || 0);
                // A card taller than the space (long notes, a small screen) scrolls.
                card.style.boxSizing = 'border-box';
                card.style.maxHeight = Math.floor(inner) + 'px';
                card.style.overflowY = 'auto';
                const top = mid - box.top - padTop - card.offsetHeight / 2;
                overlay.style.alignItems = 'flex-start';
                card.style.marginTop = Math.round(Math.max(0, Math.min(top, inner - card.offsetHeight))) + 'px';
            }
        }

        _watchOverlays() {
            // The base solver shows and hides these by toggling `hidden`.
            this.overlayWatcher = new MutationObserver(() => this._centreOnGrid());
            // Also any change inside the card (text, parts shown or hidden)
            // that alters its height.
            for (const overlay of this.root.querySelectorAll(':scope > .solver-overlay')) {
                this.overlayWatcher.observe(overlay, {
                    attributes: true, attributeFilter: ['hidden'],
                    childList: true, subtree: true, characterData: true,
                });
            }
        }

        /**
         * The grid sits at the bottom of the space it's given, leaving a band
         * between the header and the grid. Move the timer row down to the
         * middle of that band. A transform, so the solver's own measurements
         * of the layout are untouched.
         *
         * A grid wider than it is tall (11x9, say) leaves a much bigger band:
         * it's centred in its space instead, the spare height split above and
         * below it, and the timer row goes in the middle of the part above.
         * Square and tall grids (15x15, 21x21, 14x15) keep the layout above.
         */
        _centreTopbar() {
            if (!this.topbarEl || !this.gridEl || !this.gridWrapEl) return;
            const wide = this.puzzle.width > this.puzzle.height;
            this.gridWrapEl.style.alignItems = wide ? 'center' : '';
            const gridTop = this.gridEl.getBoundingClientRect().top;
            const wrapTop = this.gridWrapEl.getBoundingClientRect().top;
            const spare = Math.max(0, Math.round(gridTop - wrapTop));
            this.topbarEl.style.transform = spare ? 'translateY(' + Math.round(spare / 2) + 'px)' : '';
        }

        _render() {
            super._render();
            this._watchOverlays();
            this._setUpClueScroll();
            // "?" becomes "Assist"; Clear Grid and Reset Puzzle move to the
            // Settings sheet (see puzzleSettings below).
            this.helpBtn.textContent = 'Assist';
            this.helpBtn.classList.add('assist-btn');

            // Notes: between the pencil and Assist.
            const notesBtn = document.createElement('button');
            notesBtn.type = 'button';
            notesBtn.className = 'icon-btn notes-btn';
            notesBtn.textContent = 'Notes';
            notesBtn.setAttribute('aria-label', 'Notes');
            notesBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                notesBtn.blur();
                this.openNotes();
            });
            this.topbarRightEl.insertBefore(notesBtn, this.helpBtn.closest('.help-wrap'));
            this.notesBtn = notesBtn;
            // With the timer turned off (Settings > Miscellaneous), an "Info"
            // button takes the timer's place: it opens the pause card, with
            // the title, author and Resume. CSS shows one or the other.
            const infoBtn = document.createElement('button');
            infoBtn.type = 'button';
            infoBtn.className = 'icon-btn notes-btn info-btn';
            infoBtn.textContent = 'Info';
            infoBtn.setAttribute('aria-label', 'Puzzle info');
            infoBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                infoBtn.blur();
                this._pauseTimer();
            });
            const timerWrap = this.topbarEl.querySelector('.timer-wrap');
            this.topbarEl.insertBefore(infoBtn, timerWrap);
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

        /** Runs one of the base solver's methods that asks window.confirm() first, answering yes. */
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
                message: Settings.showTimer() ? 'All letters are removed. The timer keeps running.' : 'All letters are removed.',
                okLabel: 'Clear',
                danger: true,
            }).then((ok) => { if (ok && !this.destroyed) this._confirmed(super.clearGrid); });
        }

        resetPuzzle() {
            const hasNotes = !!this._readNotes().trim();
            UI.confirm({
                title: 'Reset the puzzle?',
                message: Settings.showTimer()
                    ? (hasNotes
                        ? 'All letters are removed, the timer goes back to zero, and your notes are deleted.'
                        : 'All letters are removed and the timer goes back to zero.')
                    : (hasNotes ? 'All letters and your notes are removed.' : 'All letters are removed.'),
                okLabel: 'Reset',
                danger: true,
            }).then((ok) => {
                if (!ok || this.destroyed) return;
                this._writeNotes('');
                this._confirmed(super.resetPuzzle);
            });
        }

        // ----- Notes -----

        _readNotes() {
            return this.appStore && this.appStore.notes ? this.appStore.notes.read() : '';
        }

        _writeNotes(text) {
            if (this.appStore && this.appStore.notes) this.appStore.notes.write(text);
        }

        /** The notes pop-up. Saved as you type; kept until the puzzle is reset. */
        openNotes() {
            this._setHelpMenuOpen(false);
            // The clock stops while the notes are open and restarts after.
            const wasRunning = !!this.timerInterval;
            if (wasRunning) {
                clearInterval(this.timerInterval);
                this.timerInterval = null;
                this._save();
            }
            let timer = null;
            // Centred on the grid and short enough to stay clear of the
            // phone's keyboard, so it doesn't move when the keyboard opens.
            const grid = this.gridEl.getBoundingClientRect();
            const header = document.querySelector('.solver-header').getBoundingClientRect();
            const gap = 10;
            let centreY = grid.top + grid.height / 2;
            const below = App.keyboardTop() - gap - centreY;
            let height = Math.min(NOTES_MAX_HEIGHT, 2 * below);
            if (height < NOTES_MIN_HEIGHT) {
                // Not enough room around the grid's middle: as tall as the
                // minimum allows, sitting just above the keyboard.
                height = Math.min(NOTES_MIN_HEIGHT, App.keyboardTop() - gap - (header.bottom + gap));
                centreY = App.keyboardTop() - gap - height / 2;
            }
            UI.notes({
                title: 'Notes',
                centreY,
                height,
                value: this._readNotes(),
                onInput: (text) => {
                    clearTimeout(timer);
                    timer = setTimeout(() => this._writeNotes(text), 300);
                },
            }).then((text) => {
                clearTimeout(timer);
                this._writeNotes(text);
                if (this.destroyed) return;
                if (wasRunning) this._startInterval();
                this.gridEl.focus();
            });
        }

        /** Items for the Settings sheet while this puzzle is open. */
        puzzleSettings() {
            return [
                { section: 'This puzzle' },
                { indent: 1, label: 'Clear grid', action: () => this.clearGrid() },
                { indent: 1, label: 'Reset puzzle', sub: Settings.showTimer() ? 'Clears the grid and the timer' : 'Clears the grid', danger: true, action: () => this.resetPuzzle() },
            ];
        }

        // With the timer turned off there's no pause button: the card comes
        // from Info (or from leaving the app), so it doesn't say "Game Paused".
        _pauseTimer() {
            super._pauseTimer();
            if (!Settings.showTimer()) this.overlayPausedMsgEl.hidden = true;
        }

        // With the timer turned off, the win message leaves out the time.
        _showSuccessPopup() {
            super._showSuccessPopup();
            if (!Settings.showTimer()) this.resultMessageEl.textContent = 'You solved the puzzle!';
        }

        // ----- Solving settings: Skip filled squares, Auto-advance -----

        // Moving to another clue (the clue bar's arrows, Tab, or the end of
        // an answer when typing over letters) lands on its first empty
        // square, with Skip filled squares on; on its first square if it's
        // full or the setting is off. Backspacing into the previous clue
        // (toEnd) still lands on its last square.
        _jumpClue(delta, toEnd = false) {
            super._jumpClue(delta, toEnd);
            if (toEnd || !Settings.skipFilled()) return;
            const clue = this._currentClue();
            if (!clue) return;
            const empty = clue.cells.find(([r, c]) => !this.userGrid[r][c]);
            if (empty && (empty[0] !== this.selected.row || empty[1] !== this.selected.col)) {
                this._selectCell(empty[0], empty[1]);
            }
        }

        // The base solver's behaviour is both on: typing into an empty square jumps
        // to the answer's next empty square, and on to the next clue with an
        // empty square at the end; typing over a letter moves one square on.
        _commitCellEntry(value) {
            if (Settings.skipFilled() && Settings.autoAdvance()) {
                super._commitCellEntry(value);
                return;
            }
            if (!this.selected) return;
            const { row, col } = this.selected;
            if (this.userGrid[row][col]) this.overwriteMode = true;
            this._setLetter(row, col, value);
            const clue = this._currentClue();
            if (!clue) return;
            const cells = clue.cells;
            const idx = cells.findIndex(([r, c]) => r === row && c === col);
            if (idx < 0) return;
            if (Settings.skipFilled() && !this.overwriteMode) {
                for (let i = idx + 1; i < cells.length; i++) {
                    const [r, c] = cells[i];
                    if (!this.userGrid[r][c]) {
                        this._selectCell(r, c);
                        return;
                    }
                }
                // Nothing empty after this square: the next clue (with an
                // empty square) if auto-advance is on; otherwise stay put.
                if (Settings.autoAdvance()) this._advanceToNextUnfilledClue();
                return;
            }
            if (idx < cells.length - 1) {
                this._selectCell(cells[idx + 1][0], cells[idx + 1][1]);
            } else if (Settings.autoAdvance()) {
                this._jumpClue(1);
            }
        }

        // ----- Error Check Mode -----

        // With the setting on, a letter that doesn't match the answer shows
        // red as soon as it's in the grid; right ones keep their usual colour.
        _updateUI() {
            super._updateUI();
            this._showErrors();
        }

        _showErrors() {
            if (!this.cellEls || !this.cellEls.length) return;
            const on = this.puzzle.hasKey && Settings.errorCheck();
            const { cells, width, height } = this.puzzle;
            for (let r = 0; r < height; r++) {
                for (let c = 0; c < width; c++) {
                    const cell = cells[r][c];
                    if (!cell) continue;
                    const entry = this.userGrid[r][c];
                    const wrong = on && !!entry && !!cell.solution &&
                        entry.toUpperCase() !== cell.solution.toUpperCase();
                    this.cellEls[r][c].classList.toggle('error-check-wrong', wrong);
                }
            }
        }

        // ----- Reveal -----

        // The base solver marks every revealed square as revealed (purple), even
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
            // A revealed letter is right: drop any "wrong" mark from an
            // earlier check (it showed as a dot in Colorblind Mode).
            this.cellEls[r][c].classList.remove('correct', 'incorrect');
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
            if (this.overlayWatcher) this.overlayWatcher.disconnect();
            if (this.gridLinesObserver) this.gridLinesObserver.disconnect();
            if (this.fontsLoaded && document.fonts) document.fonts.removeEventListener('loadingdone', this.fontsLoaded);
            document.documentElement.style.removeProperty('--grid-centre-y');
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
        let solver;
        try {
            solver = new AppCrosswordSolver(rootEl, toSolverPuzzle(parsedPuzzle), { backUrl: '#library' });
        } finally {
            incomingStore = null;
        }
        // The base solver opens every puzzle on its Start/Resume card. A puzzle
        // already under way goes straight to the grid, clock running (a
        // solved one's clock stays stopped); a new one still gets the card.
        if (solver.hasSavedProgress) solver._startTimer();
        return solver;
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
