/*
 * The solving interface: grid, clue bar, on-screen keyboard, timer, pencil,
 * rebus entry and check/reveal. Built for touch; a hardware keyboard works too.
 */
(function (global) {
    'use strict';

    // Per-square marks, stored as bit flags.
    const PENCIL = 1, INCORRECT = 2, CORRECT = 4, REVEALED = 8;
    const LOCKED = CORRECT | REVEALED;

    const view = document.getElementById('solver-view');
    const q = (sel) => view.querySelector(sel);
    const E = {
        grid: q('.solver-grid'),
        wrap: q('.solver-grid-wrap'),
        timerWrap: q('.timer-wrap'),
        timer: q('.timer-display'),
        pauseBtn: q('.timer-pause-btn'),
        back: q('.back-btn'),
        pencil: q('.pencil-btn'),
        help: q('.help-btn'),
        helpMenu: q('.help-menu'),
        clueText: q('.clue-text'),
        clueInner: q('.clue-inner'),
        cluePrev: q('.clue-prev'),
        clueNext: q('.clue-next'),
        overlay: q('.solver-overlay'),
        ovTitle: q('.solver-overlay .overlay-title'),
        ovAuthor: q('.solver-overlay .overlay-author'),
        ovCopyright: q('.solver-overlay .overlay-copyright'),
        ovNotes: q('.solver-overlay .overlay-notes'),
        ovMessage: q('.solver-overlay .overlay-paused-message'),
        ovButton: q('.solver-overlay .overlay-start-btn'),
        rebus: q('.rebus-overlay'),
        rebusDisplay: q('.rebus-display'),
        rebusCancel: q('.rebus-cancel-btn'),
        rebusConfirm: q('.rebus-confirm-btn'),
        keyboard: q('.mobile-keyboard'),
    };

    const PAUSE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14"><rect x="5" y="3.5" width="4.5" height="17" rx="1.2" fill="currentColor"/><rect x="14.5" y="3.5" width="4.5" height="17" rx="1.2" fill="currentColor"/></svg>';
    const PLAY_ICON = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M6.5 3.8v16.4a1 1 0 0 0 1.5.9l13-8.2a1 1 0 0 0 0-1.7L8 3a1 1 0 0 0-1.5.8z" fill="currentColor"/></svg>';
    const BACKSPACE_ICON = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M8.5 5.5h11a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-11L3 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m11.5 9.5 5 5m0-5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

    let S = null; // the open puzzle's session
    let tickTimer = null;
    let resizeObserver = null;

    // ---------- Formatting ----------

    function formatTime(ms) {
        const total = Math.floor(ms / 1000);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const ss = String(s).padStart(2, '0');
        return h ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
    }

    // ---------- Puzzle geometry ----------

    const isOpenCell = (i) => {
        const c = S.P.cells[i];
        return !!c && !c.block && !c.void;
    };
    const isLocked = (i) => !!(S.marks[i] & LOCKED) || !!S.P.cells[i].given;
    const other = (dir) => (dir === 'across' ? 'down' : 'across');

    function clueIndexFor(i, dir) {
        return dir === 'across' ? S.acrossOf[i] : S.downOf[i];
    }

    function wordFor(i, dir) {
        const k = clueIndexFor(i, dir);
        return k >= 0 ? S.clues[k] : null;
    }

    function currentClue() {
        return wordFor(S.sel, S.dir);
    }

    function isCorrect(i) {
        const sol = S.P.cells[i].solution;
        const v = S.entries[i];
        if (!sol || !v) return false;
        // Accept the first letter of a rebus answer, as many solvers do.
        return v === sol || (sol.length > 1 && v === sol[0]);
    }

    // Finds clues mentioned in a clue's text, such as "17- and 23-Across".
    function findReferences(clue) {
        const text = Parsers.htmlToText(clue.html);
        const re = /((?:\d+\s*(?:-|–)?\s*(?:,|and|&|or|\/)?\s*)+)(across|down)\b/gi;
        const found = new Set();
        let m;
        while ((m = re.exec(text))) {
            const dir = m[2].toLowerCase();
            for (const num of m[1].match(/\d+/g) || []) {
                const k = S.clueByKey.get(dir + ':' + num);
                if (k != null && S.clues[k] !== clue) found.add(k);
            }
        }
        return Array.from(found);
    }

    // ---------- Building ----------

    function buildIndex() {
        const P = S.P;
        S.clues = [];
        S.clueByKey = new Map();
        S.acrossOf = new Int32Array(S.n).fill(-1);
        S.downOf = new Int32Array(S.n).fill(-1);
        for (const dir of ['across', 'down']) {
            for (const c of P.clues[dir]) {
                const k = S.clues.length;
                S.clues.push({ dir, num: c.num, html: c.html, cells: c.cells, k });
                S.clueByKey.set(dir + ':' + c.num, k);
                const map = dir === 'across' ? S.acrossOf : S.downOf;
                for (const i of c.cells) if (map[i] < 0) map[i] = k;
            }
        }
        for (const c of S.clues) c.refs = findReferences(c);
        S.openCells = [];
        for (let i = 0; i < S.n; i++) if (isOpenCell(i)) S.openCells.push(i);
    }

    function buildGrid() {
        const P = S.P;
        E.grid.innerHTML = '';
        S.cellEls = [];
        const frag = document.createDocumentFragment();
        for (let i = 0; i < S.n; i++) {
            const cell = P.cells[i];
            const r = Math.floor(i / P.width), c = i % P.width;
            const d = document.createElement('div');
            d.className = 'cell';
            d.dataset.i = i;
            if (c === P.width - 1) d.classList.add('edge-right');
            if (r === P.height - 1) d.classList.add('edge-bottom');
            if (cell.block) d.classList.add('block');
            if (cell.void) d.classList.add('block', 'void');
            if (!cell.block && !cell.void) {
                if (cell.number != null) {
                    const num = document.createElement('span');
                    num.className = 'cell-number';
                    num.textContent = cell.number;
                    d.appendChild(num);
                }
                if (cell.circle) {
                    const circle = document.createElement('div');
                    circle.className = 'cell-circle';
                    d.appendChild(circle);
                }
                if (cell.shade) {
                    d.classList.add('shaded');
                    d.style.setProperty('--shade-color', cell.shade);
                }
                const letter = document.createElement('span');
                letter.className = 'cell-letter';
                d.appendChild(letter);
            }
            S.cellEls.push(d);
            frag.appendChild(d);
        }
        E.grid.appendChild(frag);
        for (let i = 0; i < S.n; i++) if (isOpenCell(i)) renderCell(i);
    }

    function layoutGrid() {
        if (!S) return;
        const w = E.wrap.clientWidth;
        const h = E.wrap.clientHeight;
        if (!w || !h) return;
        const border = 2; // the grid's 1px frame on each side
        const size = Math.max(10, Math.floor(Math.min((w - border) / S.P.width, (h - border) / S.P.height)));
        E.grid.style.gridTemplateColumns = 'repeat(' + S.P.width + ', ' + size + 'px)';
        E.grid.style.setProperty('--cell-size', size + 'px');
    }

    // Long rebus entries shrink to fit the square.
    const REBUS_SCALE = [0.54, 0.54, 0.4, 0.3, 0.24, 0.2, 0.17];

    function renderCell(i) {
        const d = S.cellEls[i];
        const letter = d.lastChild;
        const v = S.entries[i] || '';
        if (letter.textContent !== v) letter.textContent = v;
        const scale = REBUS_SCALE[Math.min(v.length, REBUS_SCALE.length - 1)];
        letter.style.fontSize = v.length > 1 ? 'calc(var(--cell-size, 24px) * ' + scale + ')' : '';
        const m = S.marks[i];
        d.classList.toggle('pencil', !!(m & PENCIL) && !!v);
        d.classList.toggle('incorrect', !!(m & INCORRECT) && !!v);
        d.classList.toggle('correct', !!(m & CORRECT) && !(m & REVEALED));
        d.classList.toggle('revealed', !!(m & REVEALED));
    }

    // ---------- Highlighting and the clue bar ----------

    function refresh() {
        for (const i of S.lit) S.cellEls[i].classList.remove('selected', 'active-word', 'referenced', 'rebus-editing');
        S.lit = [];
        const light = (i, cls) => {
            S.cellEls[i].classList.add(cls);
            S.lit.push(i);
        };
        const clue = currentClue();
        if (clue) {
            for (const i of clue.cells) light(i, 'active-word');
            for (const k of clue.refs) {
                for (const i of S.clues[k].cells) if (!clue.cells.includes(i)) light(i, 'referenced');
            }
        }
        light(S.sel, 'selected');
        if (S.rebusText != null) light(S.sel, 'rebus-editing');
        renderClueBar(clue);
    }

    function renderClueBar(clue) {
        const key = clue ? clue.k : -1;
        if (key === S.shownClue) return;
        S.shownClue = key;
        E.clueInner.innerHTML = clue
            ? '<span class="clue-label">' + Parsers.escapeHtml(clue.num) + (clue.dir === 'across' ? 'A' : 'D') + '</span> ' + clue.html
            : '';
        fitClueText();
    }

    // Shrinks the clue until it fits the bar's fixed height.
    function fitClueText() {
        const box = E.clueText;
        const inner = E.clueInner;
        box.classList.remove('overflowing');
        inner.style.fontSize = '';
        const limit = box.clientHeight;
        if (!limit) return;
        let size = parseFloat(getComputedStyle(inner).fontSize);
        const min = Math.max(11, size * 0.68);
        while (inner.offsetHeight > limit && size > min) {
            size -= 0.5;
            inner.style.fontSize = size + 'px';
        }
        if (inner.offsetHeight > limit) box.classList.add('overflowing');
        box.scrollTop = 0;
    }

    // ---------- Selection and movement ----------

    function select(i, dir) {
        if (!isOpenCell(i)) return;
        S.sel = i;
        if (dir) S.dir = dir;
        if (!wordFor(i, S.dir) && wordFor(i, other(S.dir))) S.dir = other(S.dir);
        refresh();
        scheduleSave();
    }

    function toggleDirection() {
        if (wordFor(S.sel, other(S.dir))) {
            S.dir = other(S.dir);
            refresh();
            scheduleSave();
        }
    }

    function firstEmpty(clue) {
        return clue.cells.find((i) => !S.entries[i]);
    }

    function goToClue(k) {
        const clue = S.clues[k];
        const target = firstEmpty(clue);
        select(target != null ? target : clue.cells[0], clue.dir);
    }

    function currentClueIndex() {
        const k = clueIndexFor(S.sel, S.dir);
        return k >= 0 ? k : 0;
    }

    function stepClue(delta, onlyUnfinished) {
        const n = S.clues.length;
        if (!n) return false;
        const start = currentClueIndex();
        for (let step = 1; step <= n; step++) {
            const k = (((start + delta * step) % n) + n) % n;
            if (!onlyUnfinished || firstEmpty(S.clues[k]) != null) {
                goToClue(k);
                return true;
            }
        }
        return false;
    }

    function advanceAfterEntry(wasEmpty) {
        const clue = currentClue();
        if (!clue) return;
        const cells = clue.cells;
        const pos = cells.indexOf(S.sel);
        if (wasEmpty) {
            // Next empty square in this word, wrapping round to its start.
            for (let step = 1; step < cells.length; step++) {
                const j = cells[(pos + step) % cells.length];
                if (!S.entries[j]) {
                    select(j);
                    return;
                }
            }
            // The word is now full: on to the next clue with a gap.
            if (!stepClue(1, true) && pos < cells.length - 1) select(cells[pos + 1]);
            return;
        }
        if (pos < cells.length - 1) select(cells[pos + 1]);
        else stepClue(1, true) || select(S.sel);
    }

    function moveArrow(dr, dc) {
        const want = dc !== 0 ? 'across' : 'down';
        if (S.dir !== want && wordFor(S.sel, want)) {
            S.dir = want;
            refresh();
            return;
        }
        let r = Math.floor(S.sel / S.P.width), c = S.sel % S.P.width;
        for (;;) {
            r += dr;
            c += dc;
            if (r < 0 || c < 0 || r >= S.P.height || c >= S.P.width) return;
            const i = r * S.P.width + c;
            if (isOpenCell(i)) {
                select(i);
                return;
            }
        }
    }

    // ---------- Editing ----------

    function canEdit() {
        return S && !S.overlay && !S.completed && S.rebusText == null;
    }

    function setEntry(i, value) {
        S.entries[i] = value;
        S.marks[i] = value && S.pencil ? PENCIL : 0;
        renderCell(i);
    }

    function typeLetter(ch) {
        if (!canEdit()) return;
        const i = S.sel;
        if (isLocked(i)) {
            advanceAfterEntry(false);
            return;
        }
        const wasEmpty = !S.entries[i];
        setEntry(i, ch);
        advanceAfterEntry(wasEmpty);
        afterEdit();
    }

    function backspace() {
        if (!canEdit()) return;
        const i = S.sel;
        if (S.entries[i] && !isLocked(i)) {
            setEntry(i, '');
            afterEdit();
            return;
        }
        const clue = currentClue();
        let prev = null;
        if (clue) {
            const pos = clue.cells.indexOf(i);
            if (pos > 0) {
                prev = clue.cells[pos - 1];
            } else {
                const n = S.clues.length;
                const pc = S.clues[(clue.k - 1 + n) % n];
                S.dir = pc.dir;
                prev = pc.cells[pc.cells.length - 1];
            }
        }
        if (prev == null) return;
        select(prev);
        if (S.entries[prev] && !isLocked(prev)) {
            setEntry(prev, '');
            afterEdit();
        }
    }

    function afterEdit() {
        refresh();
        evaluate();
        scheduleSave();
    }

    function evaluate() {
        const full = S.openCells.every((i) => S.entries[i]);
        if (!full) {
            S.fullNoticeShown = false;
            return;
        }
        if (S.P.hasSolution) {
            if (S.openCells.every(isCorrect)) {
                S.completed = true;
                pauseTimer();
                updateTimer();
                showOverlay('solved');
                saveNow();
            } else if (!S.fullNoticeShown) {
                S.fullNoticeShown = true;
                showOverlay('almost');
            }
        } else if (!S.fullNoticeShown) {
            S.fullNoticeShown = true;
            showOverlay('unchecked');
        }
    }

    // ---------- Check / reveal ----------

    function cellsFor(scope) {
        if (scope === 'square') return [S.sel];
        if (scope === 'word') {
            const clue = currentClue();
            return clue ? clue.cells : [S.sel];
        }
        return S.openCells;
    }

    function check(scope) {
        let wrong = 0;
        for (const i of cellsFor(scope)) {
            if (!S.entries[i] || !S.P.cells[i].solution || (S.marks[i] & REVEALED)) continue;
            if (isCorrect(i)) S.marks[i] = CORRECT;
            else {
                S.marks[i] = (S.marks[i] & PENCIL) | INCORRECT;
                wrong++;
            }
            renderCell(i);
        }
        if (scope === 'puzzle' && !wrong) UI.toast('No mistakes so far');
        afterEdit();
    }

    function reveal(scope) {
        for (const i of cellsFor(scope)) {
            const sol = S.P.cells[i].solution;
            if (!sol || S.P.cells[i].given) continue;
            if (!isCorrect(i)) {
                S.entries[i] = sol;
                S.marks[i] = REVEALED;
            } else if (!(S.marks[i] & LOCKED)) {
                S.marks[i] = CORRECT;
            }
            renderCell(i);
        }
        afterEdit();
    }

    function clearIncorrect() {
        let n = 0;
        for (const i of S.openCells) {
            if (S.entries[i] && S.P.cells[i].solution && !isCorrect(i) && !isLocked(i)) {
                setEntry(i, '');
                n++;
            }
        }
        UI.toast(n ? 'Cleared ' + n + (n === 1 ? ' square' : ' squares') : 'Nothing to clear');
        afterEdit();
    }

    async function resetPuzzle() {
        const ok = await UI.confirm({
            title: 'Reset this puzzle?',
            message: 'All your answers and the timer will be cleared.',
            okLabel: 'Reset',
            danger: true,
        });
        if (!ok || !S) return;
        pauseTimer();
        for (const i of S.openCells) {
            S.entries[i] = S.P.cells[i].given || '';
            S.marks[i] = 0;
            renderCell(i);
        }
        S.elapsed = 0;
        S.started = false;
        S.completed = false;
        S.fullNoticeShown = false;
        S.pencil = false;
        renderPencil();
        updateTimer();
        if (S.clues.length) goToClue(0);
        showOverlay('start');
        saveNow();
    }

    async function onHelpAction(action) {
        closeHelpMenu();
        if (!S) return;
        if (action === 'info') {
            showOverlay('info');
            return;
        }
        if (action === 'reset') {
            resetPuzzle();
            return;
        }
        if (S.completed) return;
        if (!S.P.hasSolution) {
            UI.toast('This puzzle has no answer key to check against');
            return;
        }
        if (action === 'reveal-puzzle') {
            const ok = await UI.confirm({
                title: 'Reveal the whole puzzle?',
                message: 'Every square will be filled with the answer.',
                okLabel: 'Reveal',
                danger: true,
            });
            if (!ok) return;
        }
        const [verb, scope] = action.split('-');
        if (verb === 'check') check(scope);
        else if (verb === 'reveal') reveal(scope);
        else if (action === 'clear-incorrect') clearIncorrect();
    }

    function toggleHelpMenu() {
        if (E.helpMenu.hidden) {
            const noKey = !S.P.hasSolution;
            for (const b of E.helpMenu.querySelectorAll('[data-action]')) {
                const a = b.dataset.action;
                b.disabled = (noKey || S.completed) && a !== 'info' && a !== 'reset';
            }
            E.helpMenu.hidden = false;
            E.help.classList.add('active');
        } else {
            closeHelpMenu();
        }
    }

    function closeHelpMenu() {
        E.helpMenu.hidden = true;
        E.help.classList.remove('active');
    }

    // ---------- Pencil ----------

    function renderPencil() {
        E.pencil.classList.toggle('active', S.pencil);
        E.pencil.setAttribute('aria-pressed', String(S.pencil));
    }

    // ---------- Rebus ----------

    function openRebus() {
        if (!canEdit() || isLocked(S.sel)) return;
        S.rebusText = S.entries[S.sel] || '';
        buildKeyboard('abc');
        renderRebus();
        E.rebus.hidden = false;
        refresh();
    }

    function renderRebus() {
        E.rebusDisplay.textContent = S.rebusText;
    }

    function closeRebus(commit) {
        if (S.rebusText == null) return;
        const value = S.rebusText.trim().toUpperCase();
        S.rebusText = null;
        E.rebus.hidden = true;
        if (commit && !isLocked(S.sel)) {
            const wasEmpty = !S.entries[S.sel];
            setEntry(S.sel, value);
            if (value) advanceAfterEntry(wasEmpty);
            afterEdit();
        } else {
            refresh();
        }
    }

    // ---------- Timer ----------

    function elapsedMs() {
        return S.elapsed + (S.runningSince ? Date.now() - S.runningSince : 0);
    }

    function startTimer() {
        if (!S.runningSince && S.started && !S.completed && !S.overlay) S.runningSince = Date.now();
        updateTimer();
    }

    function pauseTimer() {
        if (S.runningSince) {
            S.elapsed += Date.now() - S.runningSince;
            S.runningSince = null;
        }
    }

    function updateTimer() {
        if (!S) return;
        const text = formatTime(elapsedMs());
        if (E.timer.textContent !== text) E.timer.textContent = text;
        const running = !!S.runningSince;
        if (S.timerIconRunning !== running) {
            S.timerIconRunning = running;
            E.pauseBtn.innerHTML = running || S.completed ? PAUSE_ICON : PLAY_ICON;
            E.pauseBtn.style.visibility = S.completed ? 'hidden' : '';
        }
    }

    // ---------- Overlays ----------

    function setText(el, text) {
        el.textContent = text || '';
        el.hidden = !text;
    }

    function showOverlay(mode) {
        closeHelpMenu();
        if (S.rebusText != null) closeRebus(false);
        S.overlay = mode;
        pauseTimer();
        const P = S.P;
        const title = P.title || S.entry.title || 'Untitled';
        const byline = P.author ? 'by ' + P.author : '';
        setText(E.ovTitle, title);
        E.ovTitle.classList.toggle('long', title.length > 60);
        setText(E.ovAuthor, '');
        setText(E.ovCopyright, '');
        setText(E.ovNotes, '');
        setText(E.ovMessage, '');
        if (mode === 'start' || mode === 'info') {
            setText(E.ovAuthor, byline);
            setText(E.ovCopyright, P.copyright);
            setText(E.ovNotes, P.notes);
            E.ovButton.textContent = mode === 'start' && !S.elapsed ? 'Start' : S.completed ? 'Close' : 'Resume';
        } else if (mode === 'paused') {
            setText(E.ovAuthor, byline);
            setText(E.ovMessage, 'Paused');
            E.ovButton.textContent = 'Resume';
        } else if (mode === 'solved') {
            setText(E.ovTitle, 'Congratulations!');
            E.ovTitle.classList.remove('long');
            setText(E.ovAuthor, 'You solved ' + title);
            setText(E.ovMessage, formatTime(elapsedMs()));
            E.ovButton.textContent = 'Done';
        } else if (mode === 'almost') {
            setText(E.ovTitle, 'Almost there');
            E.ovTitle.classList.remove('long');
            setText(E.ovNotes, 'The grid is full, but at least one square isn’t right yet.');
            E.ovButton.textContent = 'Keep trying';
        } else if (mode === 'unchecked') {
            setText(E.ovTitle, 'Grid complete');
            E.ovTitle.classList.remove('long');
            setText(E.ovNotes, 'This puzzle doesn’t include an answer key, so your solution can’t be checked.');
            E.ovButton.textContent = 'OK';
        }
        E.overlay.hidden = false;
        updateTimer();
        E.overlay.querySelector('.solver-overlay-card').scrollTop = 0;
    }

    function dismissOverlay() {
        if (!S || !S.overlay) return;
        const mode = S.overlay;
        S.overlay = null;
        E.overlay.hidden = true;
        if (mode === 'start') S.started = true;
        startTimer();
        scheduleSave();
        E.grid.focus({ preventScroll: true });
    }

    // ---------- Keyboard ----------

    const LAYOUTS = {
        abc: [
            'QWERTYUIOP'.split(''),
            ['_', ...'ASDFGHJKL'.split(''), '_'],
            ['MORE', ...'ZXCVBNM'.split(''), 'BACKSPACE'],
        ],
        more: [
            '1234567890'.split(''),
            ['_', '&', '-', '.', '/', '?', '!', '\'', '_'],
            ['ABC', 'REBUS', 'BACKSPACE'],
        ],
    };

    function buildKeyboard(layer) {
        E.keyboard.innerHTML = '';
        E.keyboard.dataset.layer = layer;
        for (const row of LAYOUTS[layer]) {
            const r = document.createElement('div');
            r.className = 'kb-row';
            for (const key of row) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'kb-key';
                b.tabIndex = -1;
                if (key === '_') {
                    b.classList.add('kb-spacer');
                    b.setAttribute('aria-hidden', 'true');
                } else if (key === 'BACKSPACE') {
                    b.classList.add('kb-backspace');
                    b.innerHTML = BACKSPACE_ICON;
                    b.setAttribute('aria-label', 'Backspace');
                } else if (key === 'MORE' || key === 'ABC') {
                    b.classList.add('kb-more');
                    b.textContent = key === 'MORE' ? '123' : 'ABC';
                } else if (key === 'REBUS') {
                    b.classList.add('kb-rebus');
                    b.textContent = 'Rebus';
                } else {
                    b.textContent = key;
                }
                b.dataset.key = key;
                r.appendChild(b);
            }
            E.keyboard.appendChild(r);
        }
    }

    let repeatTimer = null;

    function stopRepeat() {
        clearTimeout(repeatTimer);
        clearInterval(repeatTimer);
        repeatTimer = null;
    }

    function pressKey(key) {
        if (!S) return;
        if (key === 'MORE') return buildKeyboard('more');
        if (key === 'ABC') return buildKeyboard('abc');
        if (S.rebusText != null) {
            if (key === 'BACKSPACE') S.rebusText = S.rebusText.slice(0, -1);
            else if (key === 'REBUS') return;
            else if (S.rebusText.length < 12) S.rebusText += key;
            renderRebus();
            return;
        }
        if (key === 'REBUS') return openRebus();
        if (key === 'BACKSPACE') return backspace();
        typeLetter(key);
    }

    E.keyboard.addEventListener('pointerdown', (e) => {
        const b = e.target.closest('.kb-key');
        if (!b || b.classList.contains('kb-spacer')) return;
        e.preventDefault();
        b.classList.add('pressed');
        const key = b.dataset.key;
        pressKey(key);
        if (key === 'BACKSPACE') {
            stopRepeat();
            repeatTimer = setTimeout(() => {
                repeatTimer = setInterval(() => pressKey('BACKSPACE'), 90);
            }, 450);
        }
    });

    const release = () => {
        stopRepeat();
        for (const b of E.keyboard.querySelectorAll('.pressed')) b.classList.remove('pressed');
    };
    E.keyboard.addEventListener('pointerup', release);
    E.keyboard.addEventListener('pointercancel', release);
    E.keyboard.addEventListener('pointerleave', release);
    E.keyboard.addEventListener('contextmenu', (e) => e.preventDefault());

    // Hardware keyboards.
    document.addEventListener('keydown', (e) => {
        if (!S || view.hidden || UI.isOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key;
        if (S.overlay) {
            if (k === 'Enter' || k === 'Escape') {
                e.preventDefault();
                dismissOverlay();
            }
            return;
        }
        if (S.rebusText != null) {
            if (k === 'Enter') closeRebus(true);
            else if (k === 'Escape') closeRebus(false);
            else if (k === 'Backspace') pressKey('BACKSPACE');
            else if (/^[a-z0-9]$/i.test(k)) pressKey(k.toUpperCase());
            else return;
            e.preventDefault();
            return;
        }
        if (/^[a-z0-9]$/i.test(k)) typeLetter(k.toUpperCase());
        else if (k === 'Backspace' || k === 'Delete') backspace();
        else if (k === 'ArrowLeft') moveArrow(0, -1);
        else if (k === 'ArrowRight') moveArrow(0, 1);
        else if (k === 'ArrowUp') moveArrow(-1, 0);
        else if (k === 'ArrowDown') moveArrow(1, 0);
        else if (k === 'Tab' || k === 'Enter') stepClue(e.shiftKey ? -1 : 1, false);
        else if (k === ' ') toggleDirection();
        else if (k === 'Escape' && !E.helpMenu.hidden) closeHelpMenu();
        else return;
        e.preventDefault();
    });

    // ---------- Wiring ----------

    E.grid.addEventListener('click', (e) => {
        if (!S) return;
        const d = e.target.closest('.cell');
        if (!d) return;
        const i = +d.dataset.i;
        if (!isOpenCell(i)) return;
        if (i === S.sel) toggleDirection();
        else select(i);
    });

    E.clueText.addEventListener('click', () => S && toggleDirection());
    E.cluePrev.addEventListener('click', () => S && stepClue(-1, false));
    E.clueNext.addEventListener('click', () => S && stepClue(1, false));

    E.timerWrap.addEventListener('click', () => {
        if (!S || S.completed || S.overlay) return;
        showOverlay('paused');
        saveNow();
    });

    E.pencil.addEventListener('click', () => {
        if (!S) return;
        S.pencil = !S.pencil;
        renderPencil();
        scheduleSave();
    });

    E.help.addEventListener('click', (e) => {
        e.stopPropagation();
        if (S) toggleHelpMenu();
    });

    E.helpMenu.addEventListener('click', (e) => {
        const b = e.target.closest('[data-action]');
        if (b && !b.disabled) onHelpAction(b.dataset.action);
    });

    document.addEventListener('pointerdown', (e) => {
        if (!E.helpMenu.hidden && !e.target.closest('.help-wrap')) closeHelpMenu();
    });

    E.ovButton.addEventListener('click', dismissOverlay);
    E.rebusCancel.addEventListener('click', () => S && closeRebus(false));
    E.rebusConfirm.addEventListener('click', () => S && closeRebus(true));
    E.back.addEventListener('click', () => S && exit());

    // ---------- Saving ----------

    function snapshot() {
        return {
            v: 1,
            entries: S.entries,
            marks: S.marks,
            elapsed: elapsedMs(),
            started: S.started,
            completed: S.completed,
            pencil: S.pencil,
            fullNoticeShown: S.fullNoticeShown,
            sel: S.sel,
            dir: S.dir,
            updated: Date.now(),
        };
    }

    function summary() {
        const filled = S.openCells.filter((i) => S.entries[i]).length;
        const total = S.openCells.length || 1;
        const full = filled === S.openCells.length;
        let status = 'new';
        if (S.completed || (!S.P.hasSolution && full)) status = 'done';
        else if (S.started || filled) status = 'progress';
        return {
            status,
            percent: Math.round((filled / total) * 100),
            elapsed: elapsedMs(),
            revealed: S.openCells.some((i) => S.marks[i] & REVEALED),
        };
    }

    function saveNow() {
        if (!S) return;
        clearTimeout(S.saveTimer);
        S.saveTimer = null;
        S.callbacks.onSave(S.entry.id, snapshot(), summary());
    }

    function scheduleSave() {
        if (!S) return;
        clearTimeout(S.saveTimer);
        S.saveTimer = setTimeout(saveNow, 400);
    }

    // ---------- Public API ----------

    function open(entry, puzzle, progress, callbacks) {
        const n = puzzle.width * puzzle.height;
        const saved = progress && Array.isArray(progress.entries) && progress.entries.length === n ? progress : null;
        S = {
            entry,
            P: puzzle,
            n,
            callbacks,
            entries: saved ? saved.entries.map((v) => (v ? String(v).toUpperCase() : '')) : new Array(n).fill(''),
            marks: saved && Array.isArray(saved.marks) ? saved.marks.slice() : new Array(n).fill(0),
            elapsed: saved ? saved.elapsed || 0 : 0,
            runningSince: null,
            started: saved ? !!saved.started : false,
            completed: saved ? !!saved.completed : false,
            pencil: saved ? !!saved.pencil : false,
            fullNoticeShown: saved ? !!saved.fullNoticeShown : false,
            dir: saved && saved.dir === 'down' ? 'down' : 'across',
            sel: 0,
            lit: [],
            shownClue: null,
            overlay: null,
            rebusText: null,
            saveTimer: null,
            timerIconRunning: null,
        };
        while (S.marks.length < n) S.marks.push(0);
        puzzle.cells.forEach((c, i) => {
            if (c.given) S.entries[i] = c.given;
        });

        buildIndex();
        buildGrid();
        buildKeyboard('abc');
        renderPencil();
        closeHelpMenu();
        E.rebus.hidden = true;
        E.overlay.hidden = true;

        let start = saved && isOpenCell(saved.sel) ? saved.sel : null;
        if (start == null) start = S.clues.length ? S.clues[0].cells[0] : S.openCells[0];
        if (start == null) throw new Error('This puzzle has no squares to fill');
        S.sel = start;
        if (!wordFor(S.sel, S.dir) && wordFor(S.sel, other(S.dir))) S.dir = other(S.dir);

        layoutGrid();
        refresh();
        updateTimer();

        if (!resizeObserver) {
            resizeObserver = new ResizeObserver(() => {
                layoutGrid();
                if (S) {
                    S.shownClue = null;
                    renderClueBar(currentClue());
                }
            });
        }
        resizeObserver.observe(E.wrap);
        resizeObserver.observe(E.clueText);

        clearInterval(tickTimer);
        tickTimer = setInterval(updateTimer, 250);

        if (!S.started && !S.completed) showOverlay('start');
        else startTimer();

        E.grid.focus({ preventScroll: true });
    }

    function exit() {
        if (!S) return;
        const cb = S.callbacks;
        close();
        cb.onExit();
    }

    function close() {
        if (!S) return;
        pauseTimer();
        saveNow();
        clearInterval(tickTimer);
        tickTimer = null;
        stopRepeat();
        if (resizeObserver) resizeObserver.disconnect();
        S = null;
    }

    /** Back gesture: returns true if it was handled inside the solver. */
    function handleBack() {
        if (!S) return false;
        if (!E.helpMenu.hidden) {
            closeHelpMenu();
            return true;
        }
        if (S.rebusText != null) {
            closeRebus(false);
            return true;
        }
        return false;
    }

    function appPaused() {
        if (!S) return;
        if (S.runningSince && !S.overlay) showOverlay('paused');
        else pauseTimer();
        saveNow();
    }

    global.Solver = {
        open,
        close,
        exit,
        handleBack,
        appPaused,
        isOpen: () => !!S,
        layout: () => S && layoutGrid(),
        formatTime,
    };
})(window);
