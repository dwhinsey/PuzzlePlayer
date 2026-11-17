/*
 * The base crossword solver, shared with the web version. Kept as close to
 * that copy as possible so changes can be brought across: the only edits
 * are the two layout queries below, marked "App:". Everything the app
 * needs on top (saving to the app's storage, the back button, pausing when
 * the app is put away) lives in js/solver-app.js, which extends this class.
 * The comment section is unused: the app never passes a commentSlug.
 */

/**
 * CrosswordSolver: renders an interactive crossword grid + clue lists from a
 * puzzle object produced by parseIpuz(), and handles keyboard/mouse solving
 * interaction similar to Crosshare/NYT-style solvers.
 */

/* Clues may carry light emphasis -- a themed puzzle might bold the hidden
   words inside a clue, for instance. Only these tags are honoured, and the
   text is built as real nodes rather than assigned as innerHTML, so anything
   else in a clue stays literal text. */
const CLUE_TAGS = new Set(['i', 'b', 'u', 'em', 'strong']);

function appendClueText(el, text) {
    const pattern = /<(\/?)(i|b|u|em|strong)>/gi;
    const stack = [el];
    const top = () => stack[stack.length - 1];
    let last = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) {
            top().appendChild(document.createTextNode(text.slice(last, match.index)));
        }
        const tag = match[2].toLowerCase();
        if (match[1]) {
            /* Clues are hand-written, so tags can close out of order --
               <b><u>x</b></u>. Close back to the matching element and reopen
               whatever was nested inside it, which is what a browser would
               do with the same markup. */
            const at = stack.map((n) => n.tagName && n.tagName.toLowerCase()).lastIndexOf(tag);
            if (at > 0) {
                const reopen = stack.slice(at + 1).map((n) => n.tagName.toLowerCase());
                stack.length = at;
                for (const name of reopen) {
                    const node = document.createElement(name);
                    top().appendChild(node);
                    stack.push(node);
                }
            }
        } else if (CLUE_TAGS.has(tag)) {
            const node = document.createElement(tag);
            top().appendChild(node);
            stack.push(node);
        }
        last = pattern.lastIndex;
    }
    if (last < text.length) top().appendChild(document.createTextNode(text.slice(last)));
    return el;
}

// Which screens solve with the app-like touch layout. Phones by width; touch
// tablets up to 1366px too, so an iPad gets the same interface at a larger
// size. Both strings are duplicated in css/solver.css and style.css.
// App: always the touch layout.
const MOBILE_LAYOUT_QUERY = 'all';
const TABLET_LAYOUT_QUERY = '(min-width: 701px)';

// Mobile browsers (Chrome/Samsung Internet in particular) don't always keep
// 100dvh in sync with the address bar's actual current on-screen state, which
// can leave the mobile solving layout taller than what's really visible.
// Measuring the live visual viewport ourselves and exposing it as a CSS
// variable is more reliable than depending on the CSS unit alone. Some
// browsers settle the toolbar into its final shown/hidden state slightly
// after load, or move it without firing a 'resize' event, so this re-checks
// on a few extra signals and for a short while after load, not just once.
(function setAppHeightVar() {
    function update() {
        const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
        document.documentElement.style.setProperty('--app-height', `${h}px`);
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.addEventListener('pageshow', update);
    window.addEventListener('scroll', update, { passive: true });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', update);
        window.visualViewport.addEventListener('scroll', update);
    }
    for (const delay of [100, 300, 600, 1000, 2000]) {
        setTimeout(update, delay);
    }
})();

class CrosswordSolver {
    constructor(rootEl, puzzle, options = {}) {
        this.root = rootEl;
        this.puzzle = puzzle;
        this.storageKey = options.storageKey || null;
        /* Comments are optional: a page that doesn't set a slug, or doesn't
           load js/comments.js, simply has no comment button. */
        this.commentSlug = options.commentSlug || null;
        this.comments = (this.commentSlug && typeof CommentSection !== 'undefined')
            ? new CommentSection(this.commentSlug)
            : null;
        this.backUrl = options.backUrl || null;

        this.userGrid = this._emptyGrid();
        this.revealedGrid = this._emptyGrid(false);
        this.pencilGrid = this._emptyGrid(false);
        this.notesMode = false;
        this.rebusMode = false;
        this.rebusBuffer = '';
        this.elapsedSeconds = 0;
        this._load();
        this.hasSavedProgress = this.elapsedSeconds > 0 ||
            this.userGrid.some(row => row.some(letter => letter));

        this.selected = null;
        this.direction = 'across';
        this.overwriteMode = false;
        this.timerInterval = null;
        this.gridWasFull = this._isGridFull();
        this.puzzleSolved = this.gridWasFull && this._isGridCorrect();

        this.cellClues = this._buildCellClueMap();
        this.cellEls = [];

        this._render();
        this._selectFirstCell();
        this._bindEvents();
        this._updateUI();
        this._layout();

        window.addEventListener('resize', () => this._layout());
        window.addEventListener('orientationchange', () => this._layout());
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => this._layout());
        }
        if (window.ResizeObserver) {
            new ResizeObserver(() => this._layout()).observe(this.gridWrapEl);
        }
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => this._layout());
        }
    }

    _emptyGrid(fillWith = '') {
        return this.puzzle.cells.map(row => row.map(() => fillWith));
    }

    _buildCellClueMap() {
        const map = this.puzzle.cells.map(row => row.map(() => ({ across: null, down: null })));
        for (const clue of this.puzzle.clues.across) {
            for (const [r, c] of clue.cells) map[r][c].across = clue;
        }
        for (const clue of this.puzzle.clues.down) {
            for (const [r, c] of clue.cells) map[r][c].down = clue;
        }
        return map;
    }

    _isBlock(r, c) {
        const { height, width } = this.puzzle;
        if (r < 0 || r >= height || c < 0 || c >= width) return true;
        return this.puzzle.cells[r][c] === null;
    }

    _render() {
        this.root.innerHTML = '';
        this.root.classList.add('solver');

        const gridWrap = document.createElement('div');
        gridWrap.className = 'solver-grid-wrap';
        this.gridWrapEl = gridWrap;

        const grid = document.createElement('div');
        grid.className = 'solver-grid';
        grid.style.gridTemplateColumns = `repeat(${this.puzzle.width}, 1fr)`;
        grid.style.gridTemplateRows = `repeat(${this.puzzle.height}, 1fr)`;
        grid.style.aspectRatio = `${this.puzzle.width} / ${this.puzzle.height}`;
        grid.setAttribute('tabindex', '0');
        this.gridEl = grid;

        for (let r = 0; r < this.puzzle.height; r++) {
            const cellRow = [];
            for (let c = 0; c < this.puzzle.width; c++) {
                const cellData = this.puzzle.cells[r][c];
                const cellEl = document.createElement('div');

                if (!cellData) {
                    cellEl.className = 'cell block';
                } else {
                    cellEl.className = 'cell';
                }
                if (c === this.puzzle.width - 1) cellEl.classList.add('edge-right');
                if (r === this.puzzle.height - 1) cellEl.classList.add('edge-bottom');
                if (cellData) {
                    if (cellData.styleColor) {
                        cellEl.classList.add('shaded');
                        cellEl.style.setProperty('--shade-color', `#${cellData.styleColor}ad`);
                    }
                    if (cellData.number) {
                        const numEl = document.createElement('span');
                        numEl.className = 'cell-number';
                        numEl.textContent = cellData.number;
                        cellEl.appendChild(numEl);
                    }
                    if (cellData.shapebg === 'circle') {
                        const circleEl = document.createElement('span');
                        circleEl.className = 'cell-circle';
                        cellEl.appendChild(circleEl);
                    }
                    const letterEl = document.createElement('span');
                    letterEl.className = 'cell-letter';
                    cellEl.appendChild(letterEl);

                    cellEl.addEventListener('click', () => this._onCellClick(r, c));
                }

                grid.appendChild(cellEl);
                cellRow.push(cellEl);
            }
            this.cellEls.push(cellRow);
        }
        const desktopClueBar = this._buildClueBar('desktop-clue-bar');
        this.desktopClueBarEl = desktopClueBar.bar;
        gridWrap.appendChild(desktopClueBar.bar);
        gridWrap.appendChild(grid);
        gridWrap.appendChild(this._buildRebusOverlay());

        const clues = document.createElement('div');
        clues.className = 'solver-clues';
        this.acrossListEl = this._buildClueList('Across', this.puzzle.clues.across, 'across');
        this.downListEl = this._buildClueList('Down', this.puzzle.clues.down, 'down');
        clues.appendChild(this.acrossListEl.wrapper);
        clues.appendChild(this.downListEl.wrapper);

        this.root.appendChild(this._buildTopBar());

        const layout = document.createElement('div');
        layout.className = 'solver-layout';
        layout.appendChild(gridWrap);
        layout.appendChild(clues);
        this.root.appendChild(layout);

        const mobileClueBar = this._buildClueBar();
        this.root.appendChild(mobileClueBar.bar);
        this.root.appendChild(this._buildMobileKeyboard());

        this.clueTextEls = [mobileClueBar.text, desktopClueBar.text];

        this.root.appendChild(this._buildOverlay());
        this.root.appendChild(this._buildResultOverlay());
        if (this.comments) this.comments.mount(this.root);
        this.root.appendChild(this._buildLandscapeBlocker());
    }

    _buildTopBar() {
        const bar = document.createElement('div');
        bar.className = 'solver-topbar';

        /* Back and comments travel together: beside each other on mobile, and
           on desktop the group is reordered to sit just right of the timer,
           where the back button is hidden anyway. */
        const leftGroup = document.createElement('div');
        leftGroup.className = 'topbar-left';

        if (this.backUrl) {
            const backBtn = document.createElement('a');
            backBtn.href = this.backUrl;
            backBtn.className = 'icon-btn back-btn';
            backBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            backBtn.setAttribute('aria-label', 'Back to home');
            leftGroup.appendChild(backBtn);
        }

        const timerWrap = document.createElement('div');
        timerWrap.className = 'timer-wrap';
        timerWrap.setAttribute('role', 'button');
        timerWrap.setAttribute('aria-label', 'Pause timer');
        timerWrap.addEventListener('click', (e) => {
            const isMobileLayout = window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
            if (isMobileLayout || e.target === pauseBtn || pauseBtn.contains(e.target)) {
                this._pauseTimer();
            }
        });

        const timerEl = document.createElement('span');
        timerEl.className = 'timer-display';
        this.timerEl = timerEl;
        this._updateTimerDisplay();

        const pauseBtn = document.createElement('button');
        pauseBtn.type = 'button';
        pauseBtn.className = 'icon-btn timer-pause-btn';
        pauseBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="5" y="4" width="5" height="16" fill="currentColor"/><rect x="14" y="4" width="5" height="16" fill="currentColor"/></svg>';
        pauseBtn.setAttribute('aria-label', 'Pause timer');
        pauseBtn.tabIndex = -1;

        timerWrap.appendChild(timerEl);
        timerWrap.appendChild(pauseBtn);

        const rightGroup = document.createElement('div');
        rightGroup.className = 'topbar-right';

        const rebusBtn = document.createElement('button');
        rebusBtn.type = 'button';
        rebusBtn.className = 'icon-btn rebus-open-btn';
        rebusBtn.textContent = 'Rebus';
        rebusBtn.setAttribute('aria-label', 'Enter rebus');
        rebusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.rebusMode) {
                this._confirmRebus();
            } else {
                this._openInlineRebus();
            }
        });
        this.rebusBtn = rebusBtn;

        const printBtn = document.createElement('button');
        printBtn.type = 'button';
        printBtn.className = 'icon-btn print-btn';
        printBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9V3h12v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><rect x="4" y="9" width="16" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="7" y="14" width="10" height="7" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
        printBtn.setAttribute('aria-label', 'Print puzzle');
        printBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._printPuzzle();
        });

        const pencilBtn = document.createElement('button');
        pencilBtn.type = 'button';
        pencilBtn.className = 'icon-btn pencil-btn';
        pencilBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 21l1.5-5.5L16 4l4 4-11.5 11.5L3 21z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><line x1="14" y1="6" x2="18" y2="10" stroke="currentColor" stroke-width="1.8"/></svg>';
        pencilBtn.setAttribute('aria-label', 'Toggle notes mode');
        pencilBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.notesMode = !this.notesMode;
            pencilBtn.classList.toggle('active', this.notesMode);
            pencilBtn.blur();
        });

        if (this.comments) leftGroup.appendChild(this._buildCommentIcon());

        const helpWrap = document.createElement('div');
        helpWrap.className = 'help-wrap';

        const helpBtn = document.createElement('button');
        helpBtn.type = 'button';
        helpBtn.className = 'icon-btn help-btn';
        helpBtn.textContent = '?';
        helpBtn.setAttribute('aria-label', 'Help and tools');
        helpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._setHelpMenuOpen(this.helpMenuEl.hidden);
        });
        this.helpBtn = helpBtn;

        const helpMenu = document.createElement('div');
        helpMenu.className = 'help-menu';
        helpMenu.hidden = true;
        helpMenu.appendChild(this._makeButton('Check Square', () => { this.checkSquare(); this._setHelpMenuOpen(false); }));
        helpMenu.appendChild(this._makeButton('Check Word', () => { this.checkWord(); this._setHelpMenuOpen(false); }));
        helpMenu.appendChild(this._makeButton('Check Puzzle', () => { this.checkPuzzle(); this._setHelpMenuOpen(false); }));
        helpMenu.appendChild(this._makeButton('Reveal Square', () => { this.revealSquare(); this._setHelpMenuOpen(false); }));
        helpMenu.appendChild(this._makeButton('Reveal Word', () => { this.revealWord(); this._setHelpMenuOpen(false); }));
        helpMenu.appendChild(this._makeButton('Reveal Puzzle', () => { this.revealPuzzle(); this._setHelpMenuOpen(false); }));
        helpMenu.appendChild(this._makeButton('Clear Grid', () => { this.clearGrid(); this._setHelpMenuOpen(false); }));
        helpMenu.appendChild(this._makeButton('Reset Puzzle', () => { this.resetPuzzle(); this._setHelpMenuOpen(false); }));
        this.helpMenuEl = helpMenu;

        helpWrap.appendChild(helpBtn);
        helpWrap.appendChild(helpMenu);

        rightGroup.appendChild(rebusBtn);
        rightGroup.appendChild(printBtn);
        rightGroup.appendChild(pencilBtn);
        rightGroup.appendChild(helpWrap);

        bar.appendChild(leftGroup);
        bar.appendChild(timerWrap);
        bar.appendChild(rightGroup);
        this.topbarEl = bar;
        this.topbarRightEl = rightGroup;

        document.addEventListener('click', () => this._setHelpMenuOpen(false));

        return bar;
    }

    _printPuzzle() {
        const blob = buildPuzzlePdf(this.puzzle);
        const url = URL.createObjectURL(blob);
        const name = (this.puzzle.title || 'crossword').replace(/[\\/:*?"<>|]/g, '').trim();
        const link = document.createElement('a');
        link.href = url;
        link.download = `${name || 'crossword'}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    _buildOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'solver-overlay';

        const card = document.createElement('div');
        card.className = 'solver-overlay-card';

        const fields = [
            ['overlay-title', 'h2', this.puzzle.title],
            ['overlay-author', 'p', this.puzzle.author ? `by ${this.puzzle.author}` : ''],
            ['overlay-copyright', 'p', this.puzzle.copyright],
            ['overlay-notes', 'p', this.puzzle.notes]
        ];
        for (const [className, tag, text] of fields) {
            if (!text) continue;
            const el = document.createElement(tag);
            el.className = className;
            el.textContent = text;
            card.appendChild(el);
        }

        const pausedMsg = document.createElement('p');
        pausedMsg.className = 'overlay-paused-message';
        pausedMsg.textContent = 'Game Paused';
        pausedMsg.hidden = true;
        this.overlayPausedMsgEl = pausedMsg;
        card.appendChild(pausedMsg);

        const startBtn = document.createElement('button');
        startBtn.type = 'button';
        startBtn.className = 'overlay-start-btn';
        startBtn.textContent = this.hasSavedProgress ? 'Resume' : 'Start';
        startBtn.addEventListener('click', () => this._startTimer());
        this.overlayStartBtn = startBtn;

        card.appendChild(startBtn);
        overlay.appendChild(card);
        this.overlayEl = overlay;
        return overlay;
    }

    _startTimer() {
        this.overlayPausedMsgEl.hidden = true;
        this.overlayEl.hidden = true;
        this.gridEl.focus();
        this._layout();
        requestAnimationFrame(() => this._layout());
        this._startInterval();
    }

    _startInterval() {
        if (this.timerInterval) return;
        this.timerInterval = setInterval(() => {
            this.elapsedSeconds++;
            this._updateTimerDisplay();
            this._save();
        }, 1000);
    }

    _pauseTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this._save();
        this.overlayStartBtn.textContent = 'Resume';
        this.overlayPausedMsgEl.hidden = false;
        this.overlayEl.hidden = false;
    }

    _updateTimerDisplay() {
        this.timerEl.textContent = this._formatTime(this.elapsedSeconds);
    }

    _formatTime(totalSeconds) {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${mins}:${String(secs).padStart(2, '0')}`;
    }

    _buildResultOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'solver-overlay';
        overlay.hidden = true;

        const card = document.createElement('div');
        card.className = 'solver-overlay-card';

        const heading = document.createElement('h2');
        heading.className = 'overlay-title';
        this.resultHeadingEl = heading;

        const message = document.createElement('p');
        message.className = 'overlay-notes';
        this.resultMessageEl = message;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'overlay-start-btn';
        btn.addEventListener('click', () => { this.resultOverlayEl.hidden = true; });
        this.resultBtnEl = btn;

        card.appendChild(heading);
        card.appendChild(message);
        card.appendChild(btn);
        this.resultCommentBtn = this._buildCommentButton();
        if (this.resultCommentBtn) card.appendChild(this.resultCommentBtn);
        overlay.appendChild(card);
        this.resultOverlayEl = overlay;
        return overlay;
    }

    _showSuccessPopup() {
        this.resultHeadingEl.textContent = 'Congratulations!';
        this.resultMessageEl.textContent = `You solved the puzzle in ${this._formatTime(this.elapsedSeconds)}.`;
        this.resultBtnEl.textContent = 'View Puzzle';
        if (this.resultCommentBtn) this.resultCommentBtn.hidden = false;
        this.resultOverlayEl.hidden = false;
    }

    _showFailurePopup() {
        this.resultHeadingEl.textContent = 'Not quite...';
        this.resultMessageEl.textContent = 'At least one square is incorrect.';
        this.resultBtnEl.textContent = 'Keep Trying';
        /* Still mid-solve, and comments give answers away. */
        if (this.resultCommentBtn) this.resultCommentBtn.hidden = true;
        this.resultOverlayEl.hidden = false;
    }

    _buildCommentButton() {
        if (!this.comments) return null;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'overlay-comment-btn';
        btn.textContent = 'Comment Section';
        btn.hidden = true;
        /* Only shown once the puzzle is solved, so nothing left to spoil. */
        btn.addEventListener('click', () => this.comments.open());
        return btn;
    }

    _buildCommentIcon() {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'icon-btn comment-btn';
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
        btn.setAttribute('aria-label', 'Comments');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            btn.blur();
            /* Mid-solve, the comments are gated behind a spoiler warning. */
            this.comments.open({ warnSpoilers: !this.puzzleSolved });
        });
        return btn;
    }

    _buildLandscapeBlocker() {
        const blocker = document.createElement('div');
        blocker.className = 'landscape-blocker';
        const message = document.createElement('p');
        message.textContent = 'Change to portrait orientation to solve';
        blocker.appendChild(message);

        const query = window.matchMedia('(orientation: landscape) and (max-height: 500px)');
        const handleChange = (e) => {
            if (e.matches) {
                this.wasRunningBeforeLandscape = !!this.timerInterval;
                if (this.timerInterval) {
                    clearInterval(this.timerInterval);
                    this.timerInterval = null;
                }
            } else if (this.wasRunningBeforeLandscape) {
                this.wasRunningBeforeLandscape = false;
                this._startInterval();
            }
        };
        query.addEventListener('change', handleChange);
        handleChange(query);

        return blocker;
    }

    _buildRebusOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'rebus-overlay';
        overlay.hidden = true;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this._cancelRebus();
        });

        const card = document.createElement('div');
        card.className = 'solver-overlay-card';

        const heading = document.createElement('h2');
        heading.className = 'overlay-title';
        heading.textContent = 'Rebus';
        card.appendChild(heading);

        const display = document.createElement('div');
        display.className = 'rebus-display';
        this.rebusDisplayEl = display;
        card.appendChild(display);

        const actions = document.createElement('div');
        actions.className = 'rebus-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'icon-btn rebus-action-btn rebus-cancel-btn';
        cancelBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
        cancelBtn.setAttribute('aria-label', 'Cancel rebus entry');
        cancelBtn.addEventListener('click', () => this._cancelRebus());

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'icon-btn rebus-action-btn rebus-confirm-btn';
        confirmBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 13l4 4 10-10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        confirmBtn.setAttribute('aria-label', 'Confirm rebus entry');
        confirmBtn.addEventListener('click', () => this._confirmRebus());

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);
        card.appendChild(actions);

        overlay.appendChild(card);
        this.rebusOverlayEl = overlay;
        return overlay;
    }

    _openRebusOverlay() {
        if (!this.selected) {
            const firstAcross = this.puzzle.clues.across[0];
            if (!firstAcross) return;
            const [r, c] = firstAcross.cells[0];
            this.selected = { row: r, col: c };
            this._updateUI();
        }
        const { row, col } = this.selected;
        this.rebusMode = true;
        this.rebusBuffer = this.userGrid[row][col] || '';
        this._updateRebusDisplay();
        this.rebusOverlayEl.hidden = false;
        this.gridEl.focus();
    }

    _openInlineRebus() {
        if (!this.selected) {
            const firstAcross = this.puzzle.clues.across[0];
            if (!firstAcross) return;
            const [r, c] = firstAcross.cells[0];
            this.selected = { row: r, col: c };
        }
        const { row, col } = this.selected;
        this.rebusMode = true;
        this.rebusBuffer = this.userGrid[row][col] || '';
        this.gridEl.focus();
        this._updateUI();
    }

    _cancelRebus() {
        this.rebusMode = false;
        this.rebusOverlayEl.hidden = true;
        this.gridEl.focus();
        this._updateUI();
    }

    _confirmRebus() {
        const value = this.rebusBuffer.trim().toUpperCase();
        this.rebusMode = false;
        this.rebusOverlayEl.hidden = true;
        this.gridEl.focus();
        if (!value) {
            this._updateUI();
            return;
        }
        this._commitCellEntry(value);
    }

    _appendRebus(letter) {
        if (this.rebusBuffer.length >= 12) return;
        this.rebusBuffer += letter;
        this._updateRebusDisplay();
    }

    _backspaceRebus() {
        this.rebusBuffer = this.rebusBuffer.slice(0, -1);
        this._updateRebusDisplay();
    }

    _updateRebusDisplay() {
        if (this.rebusDisplayEl) this.rebusDisplayEl.textContent = this.rebusBuffer;
        this._updateUI();
    }

    _buildClueBar(extraClass) {
        const bar = document.createElement('div');
        bar.className = extraClass ? `mobile-clue-bar ${extraClass}` : 'mobile-clue-bar';

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'clue-nav-btn';
        prevBtn.textContent = '‹';
        prevBtn.addEventListener('mousedown', (e) => e.preventDefault());
        prevBtn.addEventListener('click', () => { this.overwriteMode = false; this._jumpClue(-1); });

        const text = document.createElement('span');
        text.className = 'clue-text';

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'clue-nav-btn';
        nextBtn.textContent = '›';
        nextBtn.addEventListener('mousedown', (e) => e.preventDefault());
        nextBtn.addEventListener('click', () => { this.overwriteMode = false; this._jumpClue(1); });

        bar.appendChild(prevBtn);
        bar.appendChild(text);
        bar.appendChild(nextBtn);
        return { bar, text };
    }

    _buildMobileKeyboard() {
        const keyboard = document.createElement('div');
        keyboard.className = 'mobile-keyboard';

        // Safari on iOS only applies :active to elements that have a touch
        // handler, so the pressed key is tracked explicitly instead.
        let pressedKey = null;
        const clearPressed = () => {
            if (pressedKey) pressedKey.classList.remove('pressed');
            pressedKey = null;
        };
        keyboard.addEventListener('touchstart', (e) => {
            clearPressed();
            pressedKey = e.target.closest('.kb-key:not(.kb-spacer)');
            if (pressedKey) pressedKey.classList.add('pressed');
        }, { passive: true });
        keyboard.addEventListener('touchend', clearPressed, { passive: true });
        keyboard.addEventListener('touchcancel', clearPressed, { passive: true });

        const rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
        rows.forEach((rowLetters, i) => {
            const rowEl = document.createElement('div');
            rowEl.className = 'kb-row';

            if (i === rows.length - 1) {
                const more = document.createElement('button');
                more.type = 'button';
                more.className = 'kb-key kb-more';
                more.textContent = '...';
                more.addEventListener('mousedown', (e) => e.preventDefault());
                more.addEventListener('click', () => this._openRebusOverlay());
                rowEl.appendChild(more);
            } else if (i === 1) {
                const spacer = document.createElement('div');
                spacer.className = 'kb-key kb-spacer';
                rowEl.appendChild(spacer);
            }

            for (const letter of rowLetters) {
                const key = document.createElement('button');
                key.type = 'button';
                key.className = 'kb-key';
                key.textContent = letter;
                key.addEventListener('mousedown', (e) => e.preventDefault());
                key.addEventListener('click', () => this._enterLetter(letter));
                rowEl.appendChild(key);
            }

            if (i === 1) {
                const spacer = document.createElement('div');
                spacer.className = 'kb-key kb-spacer';
                rowEl.appendChild(spacer);
            }

            if (i === rows.length - 1) {
                const backspace = document.createElement('button');
                backspace.type = 'button';
                backspace.className = 'kb-key kb-backspace';
                backspace.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M8 5h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H8l-7-7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
                backspace.addEventListener('mousedown', (e) => e.preventDefault());
                backspace.addEventListener('click', () => this._backspaceAction());
                rowEl.appendChild(backspace);
            }

            keyboard.appendChild(rowEl);
        });

        return keyboard;
    }

    _setHelpMenuOpen(open) {
        this.helpMenuEl.hidden = !open;
        this.helpBtn.classList.toggle('active', open);
    }

    _makeButton(label, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'solver-btn';
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        return btn;
    }

    _buildClueList(title, clueArr, dir) {
        const wrapper = document.createElement('div');
        wrapper.className = 'clue-list';
        const heading = document.createElement('h3');
        heading.textContent = title;
        wrapper.appendChild(heading);
        const ul = document.createElement('ul');
        const itemEls = new Map();
        for (const clue of clueArr) {
            const li = document.createElement('li');
            li.textContent = `${clue.number}. `;
            appendClueText(li, clue.text);
            li.addEventListener('click', () => {
                this.overwriteMode = false;
                this.direction = dir;
                this._selectCell(clue.cells[0][0], clue.cells[0][1]);
            });
            ul.appendChild(li);
            itemEls.set(clue.number, li);
        }
        wrapper.appendChild(ul);
        return { wrapper, itemEls, ul };
    }

    _selectFirstCell() {
        for (let r = 0; r < this.puzzle.height; r++) {
            for (let c = 0; c < this.puzzle.width; c++) {
                if (this.puzzle.cells[r][c]) {
                    this._selectCell(r, c);
                    return;
                }
            }
        }
    }

    _onCellClick(r, c) {
        if (this.rebusMode) {
            const wasEditing = this.selected && this.selected.row === r && this.selected.col === c;
            this._confirmRebus();
            if (wasEditing) return;
        }
        this.overwriteMode = false;
        if (this.selected && this.selected.row === r && this.selected.col === c) {
            const clues = this.cellClues[r][c];
            if (clues.across && clues.down) {
                this.direction = this.direction === 'across' ? 'down' : 'across';
            }
        } else {
            const clues = this.cellClues[r][c];
            if (!clues[this.direction]) {
                this.direction = clues.across ? 'across' : 'down';
            }
        }
        this._selectCell(r, c);
    }

    _selectCell(r, c) {
        if (this._isBlock(r, c)) return;
        if (this.rebusMode && (!this.selected || this.selected.row !== r || this.selected.col !== c)) {
            this._confirmRebus();
        }
        this.selected = { row: r, col: c };
        this._updateUI();
        this.gridEl.focus();
    }

    _currentClue() {
        if (!this.selected) return null;
        return this.cellClues[this.selected.row][this.selected.col][this.direction];
    }

    _bindEvents() {
        this.gridEl.addEventListener('keydown', (e) => this._onKeyDown(e));
    }

    _onKeyDown(e) {
        if (this.rebusMode) {
            if (e.key === 'Enter') {
                e.preventDefault();
                this._confirmRebus();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this._cancelRebus();
            } else if (/^[a-zA-Z]$/.test(e.key)) {
                e.preventDefault();
                this._enterLetter(e.key.toUpperCase());
            } else if (e.key === 'Backspace') {
                e.preventDefault();
                this._backspaceAction();
            }
            return;
        }

        if (!this.selected) return;
        const { row, col } = this.selected;

        if (/^[a-zA-Z]$/.test(e.key)) {
            e.preventDefault();
            this._enterLetter(e.key.toUpperCase());
        } else if (e.key === 'Backspace') {
            e.preventDefault();
            this._backspaceAction();
        } else if (e.key === 'Delete') {
            e.preventDefault();
            this._setLetter(row, col, '');
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            this.overwriteMode = false;
            this.direction = 'across';
            this._moveSelection(0, -1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            this.overwriteMode = false;
            this.direction = 'across';
            this._moveSelection(0, 1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.overwriteMode = false;
            this.direction = 'down';
            this._moveSelection(-1, 0);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.overwriteMode = false;
            this.direction = 'down';
            this._moveSelection(1, 0);
        } else if (e.key === ' ') {
            e.preventDefault();
            const clues = this.cellClues[row][col];
            if (clues.across && clues.down) {
                this.direction = this.direction === 'across' ? 'down' : 'across';
                this._updateUI();
            }
        } else if (e.key === 'Tab') {
            e.preventDefault();
            this.overwriteMode = false;
            this._jumpClue(e.shiftKey ? -1 : 1);
        }
    }

    _enterLetter(letter) {
        if (this.rebusMode) {
            this._appendRebus(letter);
            return;
        }
        this._commitCellEntry(letter);
    }

    _commitCellEntry(value) {
        if (!this.selected) return;
        const { row, col } = this.selected;
        const wasEmpty = !this.userGrid[row][col];
        if (!wasEmpty) this.overwriteMode = true;
        this._setLetter(row, col, value);
        if (this.overwriteMode) {
            this._advance();
        } else {
            this._advanceSkipFilled();
        }
    }

    _backspaceAction() {
        if (this.rebusMode) {
            this._backspaceRebus();
            return;
        }
        if (!this.selected) return;
        const { row, col } = this.selected;
        if (this.userGrid[row][col]) {
            this._setLetter(row, col, '');
        } else {
            this._retreat();
            this._setLetter(this.selected.row, this.selected.col, '');
        }
    }

    _moveSelection(dr, dc) {
        let r = this.selected.row + dr;
        let c = this.selected.col + dc;
        while (r >= 0 && r < this.puzzle.height && c >= 0 && c < this.puzzle.width) {
            if (!this._isBlock(r, c)) {
                this._selectCell(r, c);
                return;
            }
            r += dr;
            c += dc;
        }
    }

    _advance() {
        const clue = this._currentClue();
        if (!clue) return;
        const idx = clue.cells.findIndex(([r, c]) => r === this.selected.row && c === this.selected.col);
        if (idx >= 0 && idx < clue.cells.length - 1) {
            const [r, c] = clue.cells[idx + 1];
            this._selectCell(r, c);
        } else {
            this._jumpClue(1);
        }
    }

    _advanceSkipFilled() {
        const clue = this._currentClue();
        if (!clue) return;
        const idx = clue.cells.findIndex(([r, c]) => r === this.selected.row && c === this.selected.col);
        if (idx < 0) return;

        for (let i = idx + 1; i < clue.cells.length; i++) {
            const [r, c] = clue.cells[i];
            if (!this.userGrid[r][c]) {
                this._selectCell(r, c);
                return;
            }
        }

        this._advanceToNextUnfilledClue();
    }

    _advanceToNextUnfilledClue() {
        const list = this.direction === 'across' ? this.puzzle.clues.across : this.puzzle.clues.down;
        const clue = this._currentClue();
        const currentIdx = clue ? list.findIndex(cl => cl.number === clue.number) : -1;

        for (let step = 1; step <= list.length; step++) {
            const candidate = list[(currentIdx + step) % list.length];
            const emptyCell = candidate.cells.find(([r, c]) => !this.userGrid[r][c]);
            if (emptyCell) {
                this._selectCell(emptyCell[0], emptyCell[1]);
                return;
            }
        }

        this._jumpClue(1);
    }

    _retreat() {
        const clue = this._currentClue();
        if (!clue) return;
        const idx = clue.cells.findIndex(([r, c]) => r === this.selected.row && c === this.selected.col);
        if (idx > 0) {
            const [r, c] = clue.cells[idx - 1];
            this._selectCell(r, c);
            return;
        }

        const list = this.direction === 'across' ? this.puzzle.clues.across : this.puzzle.clues.down;
        const clueIdx = list.findIndex(cl => cl.number === clue.number);
        if (clueIdx <= 0) return; // already at the very first clue; don't wrap to the end

        this._jumpClue(-1, true);
    }

    _jumpClue(delta, toEnd = false) {
        const list = this.direction === 'across' ? this.puzzle.clues.across : this.puzzle.clues.down;
        const clue = this._currentClue();
        const currentIdx = clue ? list.findIndex(cl => cl.number === clue.number) : -1;
        let nextIdx = currentIdx + delta;
        if (nextIdx < 0) nextIdx = list.length - 1;
        if (nextIdx >= list.length) nextIdx = 0;
        const nextClue = list[nextIdx];
        if (!nextClue) return;
        const cell = toEnd ? nextClue.cells[nextClue.cells.length - 1] : nextClue.cells[0];
        this._selectCell(cell[0], cell[1]);
    }

    _setLetter(r, c, letter) {
        this.userGrid[r][c] = letter;
        this.revealedGrid[r][c] = false;
        this.pencilGrid[r][c] = this.notesMode && !!letter;
        this.cellEls[r][c].classList.remove('correct', 'incorrect');
        this._save();
        this._updateUI();
        this._checkWin();
    }

    _updateUI() {
        const activeClue = this._currentClue();
        const activeCells = new Set((activeClue ? activeClue.cells : []).map(([r, c]) => `${r},${c}`));

        const referencedCells = new Set();
        if (activeClue && activeClue.refs) {
            for (const ref of activeClue.refs) {
                const list = ref.direction === 'across' ? this.puzzle.clues.across : this.puzzle.clues.down;
                const refClue = list.find(clue => clue.number === ref.number);
                if (refClue) {
                    for (const [r, c] of refClue.cells) referencedCells.add(`${r},${c}`);
                }
            }
        }

        for (let r = 0; r < this.puzzle.height; r++) {
            for (let c = 0; c < this.puzzle.width; c++) {
                const cellData = this.puzzle.cells[r][c];
                if (!cellData) continue;
                const el = this.cellEls[r][c];
                const letterEl = el.querySelector('.cell-letter');
                const isRebusCell = this.rebusMode && !!this.selected && this.selected.row === r && this.selected.col === c;
                const letter = isRebusCell ? this.rebusBuffer : this.userGrid[r][c];
                letterEl.textContent = letter;
                letterEl.style.fontSize = letter && letter.length > 1
                    ? `calc(var(--cell-size, 24px) * ${Math.min(0.62, 1.15 / letter.length)})`
                    : '';

                const key = `${r},${c}`;
                el.classList.toggle('selected', !!this.selected && this.selected.row === r && this.selected.col === c);
                el.classList.toggle('active-word', activeCells.has(key));
                el.classList.toggle('referenced', referencedCells.has(key) && !activeCells.has(key));
                el.classList.toggle('revealed', !!this.revealedGrid[r][c]);
                el.classList.toggle('pencil', !!this.pencilGrid[r][c]);
                el.classList.toggle('rebus-editing', isRebusCell);
            }
        }

        const oppositeDirection = this.direction === 'across' ? 'down' : 'across';
        const crossingClue = this.selected
            ? this.cellClues[this.selected.row][this.selected.col][oppositeDirection]
            : null;

        for (const [dirList, itemEls, dirName] of [
            [this.puzzle.clues.across, this.acrossListEl.itemEls, 'across'],
            [this.puzzle.clues.down, this.downListEl.itemEls, 'down']
        ]) {
            for (const clue of dirList) {
                const li = itemEls.get(clue.number);
                const isActive = !!activeClue && activeClue.number === clue.number && dirName === this.direction;
                li.classList.toggle('active', isActive);
                if (isActive) this._scrollClueIntoView(li);

                const isCrossing = !!crossingClue && crossingClue.number === clue.number && dirName === oppositeDirection;
                li.classList.toggle('crossing', isCrossing);
                if (isCrossing) this._scrollClueIntoView(li);
            }
        }

        if (this.rebusBtn) this.rebusBtn.classList.toggle('active', this.rebusMode);

        if (this.clueTextEls) {
            const prefix = activeClue
                ? `${activeClue.number}${this.direction === 'across' ? 'A' : 'D'}. `
                : '';
            for (const el of this.clueTextEls) {
                /* The bar centres its content with flex, which would lay any
                   emphasis tags out as separate flex items -- so the whole
                   clue goes inside one inline child and flows normally. */
                const line = document.createElement('span');
                line.textContent = prefix;
                if (activeClue) appendClueText(line, activeClue.text);
                el.replaceChildren(line);
            }
            this._fitClueText();
        }
    }

    _scrollClueIntoView(li) {
        const ul = li.parentElement;
        const liRect = li.getBoundingClientRect();
        const ulRect = ul.getBoundingClientRect();
        const liTopWithinUl = (liRect.top - ulRect.top) + ul.scrollTop;
        const target = liTopWithinUl - (ul.clientHeight - liRect.height) / 2;
        const maxScroll = ul.scrollHeight - ul.clientHeight;
        ul.scrollTop = Math.max(0, Math.min(target, maxScroll));
    }

    _fitClueText() {
        if (!this.clueTextEls) return;
        for (const el of this.clueTextEls) this._fitClueTextEl(el);
    }

    _fitClueTextEl(el) {
        el.scrollTop = 0;
        if (!el.textContent) return;

        const isDesktop = !!el.closest('.desktop-clue-bar');
        const isTablet = !isDesktop && window.matchMedia(TABLET_LAYOUT_QUERY).matches;
        const maxFontPx = isDesktop ? 17 : (isTablet ? 22 : 16);
        const minFontPx = isDesktop ? 13 : (isTablet ? 15 : 12);
        // Each matches the fixed CSS height on the matching .clue-text.
        const boxHeight = isDesktop ? 50 : (isTablet ? 64 : 48);

        // Measure against the natural (unclamped) content height: scrollHeight
        // can never read below clientHeight once the box has a fixed height,
        // so height is freed up here to get the true content extent.
        el.style.height = 'auto';
        let fontPx = maxFontPx;
        el.style.fontSize = `${fontPx}px`;
        while (fontPx > minFontPx && el.scrollHeight > boxHeight + 1) {
            fontPx -= 1;
            el.style.fontSize = `${fontPx}px`;
        }
        el.style.height = '';
    }

    _layout() {
        const isMobile = window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
        this.root.classList.toggle('mobile', isMobile);
        if (isMobile) {
            this.topbarRightEl.style.marginRight = '';
            this.acrossListEl.ul.style.maxHeight = '';
            this.downListEl.ul.style.maxHeight = '';
            this._fitGridToContainer();
        } else {
            this.gridEl.style.width = '';
            this.gridEl.style.height = '';
            const renderedWidth = this.gridEl.getBoundingClientRect().width;
            if (renderedWidth > 0) {
                this.gridEl.style.setProperty('--cell-size', `${renderedWidth / this.puzzle.width}px`);
            }
            this._alignTopbarRightToGrid();
            this._matchClueListHeight();
        }
        this._fitClueText();
    }

    _matchClueListHeight() {
        const gridBottom = this.gridEl.getBoundingClientRect().bottom;
        for (const list of [this.acrossListEl, this.downListEl]) {
            const ulTop = list.ul.getBoundingClientRect().top;
            const height = gridBottom - ulTop;
            if (height > 0) list.ul.style.maxHeight = `${height}px`;
        }
    }

    _alignTopbarRightToGrid() {
        const barRect = this.topbarEl.getBoundingClientRect();
        const gridRect = this.gridEl.getBoundingClientRect();
        if (barRect.width === 0 || gridRect.width === 0) return;
        const offset = Math.max(0, barRect.right - gridRect.right);
        this.topbarRightEl.style.marginRight = `${offset}px`;
    }

    // Space the grid may occupy, derived from the solver's height minus its
    // other rows. The grid's own wrapper can't be measured for this: the
    // wrapper is sized by the grid, so reading its height to size the grid
    // collapses to zero.
    _availableGridHeight() {
        const total = this.root.clientHeight;
        if (total <= 0) return 0;
        let used = 0;
        for (const child of this.root.children) {
            if (child.contains(this.gridWrapEl)) continue;
            const cs = getComputedStyle(child);
            if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue;
            used += child.offsetHeight +
                (parseFloat(cs.marginTop) || 0) +
                (parseFloat(cs.marginBottom) || 0);
        }
        return total - used;
    }

    _fitGridToContainer() {
        const availW = this.gridWrapEl.clientWidth;
        const availH = this._availableGridHeight();
        if (availW <= 0 || availH <= 0) return;

        const isPortrait = window.innerHeight >= window.innerWidth;
        if (isPortrait) {
            const widthCell = availW / this.puzzle.width;
            const heightCell = availH / this.puzzle.height;
            if (widthCell <= heightCell) {
                // Fits vertically: fill the full screen width via pure CSS
                // (immune to any JS measurement/timing quirks) and let the
                // grid's own aspect-ratio derive the height.
                this.gridEl.style.width = '100%';
                this.gridEl.style.height = 'auto';
                this.gridEl.style.setProperty('--cell-size', `${widthCell}px`);
                return;
            }
            // Too tall for the space left over: shrink to fit rather than
            // let the wrapper clip the top rows off the grid.
            const cellSize = Math.floor(heightCell);
            if (cellSize <= 0) return;
            this.gridEl.style.width = `${cellSize * this.puzzle.width}px`;
            this.gridEl.style.height = `${cellSize * this.puzzle.height}px`;
            this.gridEl.style.setProperty('--cell-size', `${cellSize}px`);
            return;
        }

        // Landscape: fit within both dimensions, with a small safety
        // margin so rounding never clips the grid.
        const cellSize = Math.floor(Math.min(availW / this.puzzle.width, (availH - 6) / this.puzzle.height));
        if (cellSize <= 0) return;

        this.gridEl.style.width = `${cellSize * this.puzzle.width}px`;
        this.gridEl.style.height = `${cellSize * this.puzzle.height}px`;
        this.gridEl.style.setProperty('--cell-size', `${cellSize}px`);
    }

    checkSquare() {
        if (!this.selected) return;
        this._markCheck(this.selected.row, this.selected.col);
    }

    checkWord() {
        const clue = this._currentClue();
        if (!clue) return;
        for (const [r, c] of clue.cells) this._markCheck(r, c);
    }

    checkPuzzle() {
        for (let r = 0; r < this.puzzle.height; r++) {
            for (let c = 0; c < this.puzzle.width; c++) {
                if (this.puzzle.cells[r][c]) this._markCheck(r, c);
            }
        }
    }

    _markCheck(r, c) {
        const el = this.cellEls[r][c];
        const solution = this.puzzle.cells[r][c].solution;
        const filled = this.userGrid[r][c];
        el.classList.remove('correct', 'incorrect');
        if (!filled) return;
        el.classList.add(filled.toUpperCase() === solution.toUpperCase() ? 'correct' : 'incorrect');
    }

    revealSquare() {
        if (!this.selected) return;
        this._revealCell(this.selected.row, this.selected.col);
        this._save();
        this._updateUI();
        this._checkWin();
    }

    revealWord() {
        const clue = this._currentClue();
        if (!clue) return;
        for (const [r, c] of clue.cells) this._revealCell(r, c);
        this._save();
        this._updateUI();
        this._checkWin();
    }

    revealPuzzle() {
        for (let r = 0; r < this.puzzle.height; r++) {
            for (let c = 0; c < this.puzzle.width; c++) {
                if (this.puzzle.cells[r][c]) this._revealCell(r, c);
            }
        }
        this._save();
        this._updateUI();
        this._checkWin();
    }

    _revealCell(r, c) {
        this.userGrid[r][c] = this.puzzle.cells[r][c].solution;
        this.revealedGrid[r][c] = true;
        this.pencilGrid[r][c] = false;
    }

    clearGrid() {
        if (!confirm('Clear all letters from the grid?')) return;
        for (let r = 0; r < this.puzzle.height; r++) {
            for (let c = 0; c < this.puzzle.width; c++) {
                if (!this.puzzle.cells[r][c]) continue;
                this.userGrid[r][c] = '';
                this.revealedGrid[r][c] = false;
                this.pencilGrid[r][c] = false;
                this.cellEls[r][c].classList.remove('correct', 'incorrect');
            }
        }
        this.gridWasFull = false;
        this.puzzleSolved = false;
        this._save();
        this._updateUI();
    }

    resetPuzzle() {
        if (!confirm('Reset the puzzle? This clears the grid and timer.')) return;
        for (let r = 0; r < this.puzzle.height; r++) {
            for (let c = 0; c < this.puzzle.width; c++) {
                if (!this.puzzle.cells[r][c]) continue;
                this.userGrid[r][c] = '';
                this.revealedGrid[r][c] = false;
                this.pencilGrid[r][c] = false;
                this.cellEls[r][c].classList.remove('correct', 'incorrect');
            }
        }
        this.gridWasFull = false;
        this.puzzleSolved = false;

        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this.elapsedSeconds = 0;
        this._updateTimerDisplay();

        this.direction = 'across';
        const firstAcross = this.puzzle.clues.across[0];
        if (firstAcross) {
            const [r, c] = firstAcross.cells[0];
            this.selected = { row: r, col: c };
        }

        this._save();
        this._updateUI();

        this.overlayStartBtn.textContent = 'Start';
        this.overlayEl.hidden = false;
    }

    _isGridFull() {
        for (let r = 0; r < this.puzzle.height; r++) {
            for (let c = 0; c < this.puzzle.width; c++) {
                if (!this.puzzle.cells[r][c]) continue;
                if (!this.userGrid[r][c] || this.pencilGrid[r][c]) return false;
            }
        }
        return true;
    }

    _isGridCorrect() {
        for (let r = 0; r < this.puzzle.height; r++) {
            for (let c = 0; c < this.puzzle.width; c++) {
                const cellData = this.puzzle.cells[r][c];
                if (!cellData) continue;
                if ((this.userGrid[r][c] || '').toUpperCase() !== cellData.solution.toUpperCase()) return false;
            }
        }
        return true;
    }

    _checkWin() {
        if (this.puzzleSolved) return;

        const isFull = this._isGridFull();
        if (!isFull) {
            this.gridWasFull = false;
            return;
        }

        if (this._isGridCorrect()) {
            this.puzzleSolved = true;
            if (this.timerInterval) {
                clearInterval(this.timerInterval);
                this.timerInterval = null;
            }
            this._save();
            this._showSuccessPopup();
            this.root.dispatchEvent(new CustomEvent('solved', { bubbles: true }));
        } else if (!this.gridWasFull) {
            this._showFailurePopup();
        }
        this.gridWasFull = true;
    }

    _save() {
        if (!this.storageKey) return;
        try {
            localStorage.setItem(this.storageKey, JSON.stringify({
                grid: this.userGrid,
                pencilGrid: this.pencilGrid,
                seconds: this.elapsedSeconds,
                /* The home page reads this to mark the puzzle solved. It can't
                   work it out for itself: that needs the answer key. */
                solved: this.puzzleSolved
            }));
        } catch (e) {
            /* localStorage unavailable; solving still works, just without persistence */
        }
    }

    _load() {
        if (!this.storageKey) return;
        try {
            const saved = localStorage.getItem(this.storageKey);
            if (!saved) return;
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
                this.userGrid = parsed; // legacy format: just the grid
            } else if (parsed && typeof parsed === 'object') {
                if (parsed.grid) this.userGrid = parsed.grid;
                if (parsed.pencilGrid) this.pencilGrid = parsed.pencilGrid;
                if (typeof parsed.seconds === 'number') this.elapsedSeconds = parsed.seconds;
            }
        } catch (e) {
            /* ignore corrupt/unavailable storage */
        }
    }
}
