/*
 * App settings, kept in settings.json, and the Settings sheet (the gear in
 * the solver's header). For now: appearance, light or dark.
 */
(function (global) {
    'use strict';

    const FILE = 'settings.json';
    const bridge = global.AndroidBridge || null;
    const media = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;
    const THEMES = ['light', 'dark', 'system'];

    // Until a choice is made in Settings, follow the phone's light or dark theme.
    const settings = { theme: 'system', ...(Store.readJSON(FILE) || {}) };
    if (!THEMES.includes(settings.theme)) settings.theme = 'system';

    // The phone's own dark theme. The app's WebView always reports a light
    // preference, so on Android the answer comes from the system instead.
    let systemDark = bridge && bridge.isNightMode ? !!bridge.isNightMode() : !!(media && media.matches);
    const listeners = [];

    // While the grid colours of one theme are being customised, the solver
    // shows that theme whatever the setting (js/grid-colors.js).
    let previewTheme = null;

    function isDark() {
        if (previewTheme) return previewTheme === 'dark';
        return settings.theme === 'dark' || (settings.theme === 'system' && systemDark);
    }

    // Custom grid colours, per theme: { light: { block: '#...' }, dark: {} }.
    // Saved a moment after the last change, as a colour slider sends many.
    function gridColorsFor(theme) {
        const all = settings.gridColors && typeof settings.gridColors === 'object' ? settings.gridColors : {};
        const own = all[theme];
        return own && typeof own === 'object' ? own : {};
    }

    let gridSaveTimer = null;
    function saveGridColorsSoon() {
        clearTimeout(gridSaveTimer);
        gridSaveTimer = setTimeout(() => Store.writeJSON(FILE, settings), 300);
    }

    function apply() {
        const dark = isDark();
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        // Colorblind Mode: shapes as well as colours (css/app.css).
        document.documentElement.classList.toggle('colorblind', !!settings.colorblind);
        // Timer turned off: no times in the solver or on the home page.
        document.documentElement.classList.toggle('timer-hidden', settings.showTimer === false);
        if (bridge && bridge.setThemeDark) bridge.setThemeDark(dark);
        for (const fn of listeners) fn(dark);
    }

    // Switching between light and dark: a short cross-fade (where the
    // WebView supports view transitions) rather than an instant flip.
    function applySmoothly() {
        const wasDark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (wasDark === isDark() || !document.startViewTransition) {
            apply();
            return;
        }
        document.startViewTransition(apply);
    }

    function setTheme(theme) {
        settings.theme = theme;
        Store.writeJSON(FILE, settings);
        // Android's launch screen, shown before the page loads, follows too.
        if (bridge && bridge.setThemeMode) bridge.setThemeMode(theme);
        applySmoothly();
    }

    /** Home page option: leave solved puzzles out of the library list. */
    function setHideSolved(hide) {
        settings.hideSolved = !!hide;
        Store.writeJSON(FILE, settings);
        for (const fn of libraryListeners) fn();
    }

    // ----- About (home page Settings) -----

    const LINKS = {
        site: 'https://hinseypuzzles.com',
        privacy: 'https://github.com/dwhinsey/PuzzlePlayer/blob/ccr-f3737f77-qcvs9g/PRIVACY.md',
        source: 'https://github.com/dwhinsey/PuzzlePlayer',
    };

    /** Links open in the phone's browser (MainActivity sends them there). */
    function link(text, href) {
        const a = UI.el('a', 'about-link', text);
        a.href = href;
        a.rel = 'noopener';
        return a;
    }

    function openAbout() {
        const version = (bridge && bridge.getVersion && bridge.getVersion()) || '1.0';
        const body = UI.el('div', 'about');
        body.appendChild(UI.el('p', 'about-version', 'Version ' + version));
        const credit = UI.el('p', 'about-text', 'Created by Derek Hinsey. See more from him at ');
        credit.appendChild(link('hinseypuzzles.com', LINKS.site));
        body.appendChild(credit);
        body.appendChild(UI.el('p', 'about-text', 'Free and open source under the MIT License.'));
        const links = UI.el('p', 'about-text about-links');
        links.append(link('Privacy Policy', LINKS.privacy), ' \u00b7 ', link('Source code on GitHub', LINKS.source));
        body.appendChild(links);
        UI.info({ title: 'puzPlayer', body });
    }

    const libraryListeners = [];
    const solverListeners = [];

    /**
     * extraItems: more sheet items (or a function returning them), e.g. the
     * open puzzle's options, Clear and Reset. Ticking a setting keeps the
     * sheet open; Clear and Reset close it.
     */
    function open(extraItems) {
        // In a puzzle, Light and Dark each offer their grid colours.
        const customize = (theme) => (global.GridColors && GridColors.available()
            ? { label: 'Customize…', action: () => GridColors.open(theme) }
            : null);
        const items = () => {
            const t = settings.theme;
            const extra = typeof extraItems === 'function' ? extraItems() : (extraItems || []);
            return [
                { section: 'Appearance' },
                {
                    indent: 1, label: 'Light', control: 'radio', checked: t === 'light', action: () => setTheme('light'),
                    extra: customize('light'),
                },
                {
                    indent: 1, label: 'Dark', control: 'radio', checked: t === 'dark', action: () => setTheme('dark'),
                    extra: customize('dark'),
                },
                {
                    indent: 1,
                    label: 'Match phone setting',
                    control: 'radio',
                    checked: t === 'system',
                    action: () => setTheme('system'),
                },
                ...extra,
            ].map((item) => ('checked' in item ? { keepOpen: true, ...item } : item));
        };
        UI.sheet({ title: 'Settings', items, closeLabel: 'Close' });
    }

    if (!bridge && media && media.addEventListener) {
        media.addEventListener('change', (e) => {
            systemDark = e.matches;
            applySmoothly();
        });
    }

    global.Settings = {
        isDark,
        open,
        hideSolved: () => !!settings.hideSolved,
        /** In-progress puzzles go first, most recently opened on top (default on). */
        progressFirst: () => settings.progressFirst !== false,
        /** Folder rows show how many puzzles (and solved) they hold (default off). */
        previewFolders: () => !!settings.previewFolders,
        /** Items for the home page's Settings sheet (not shown in a puzzle). */
        libraryItems: () => [
            { section: 'Library' },
            {
                indent: 1,
                label: 'Hide solved puzzles',
                control: 'switch',
                checked: !!settings.hideSolved,
                action: () => setHideSolved(!settings.hideSolved),
            },
            {
                indent: 1,
                label: 'Keep In Progress puzzles on top',
                control: 'switch',
                checked: settings.progressFirst !== false,
                action: () => {
                    settings.progressFirst = settings.progressFirst === false;
                    Store.writeJSON(FILE, settings);
                    for (const fn of libraryListeners) fn();
                },
            },
            {
                indent: 1,
                label: 'Preview folder contents',
                control: 'switch',
                checked: !!settings.previewFolders,
                action: () => {
                    settings.previewFolders = !settings.previewFolders;
                    Store.writeJSON(FILE, settings);
                    for (const fn of libraryListeners) fn();
                },
            },
            { indent: 1, label: 'About', chevron: true, action: openAbout },
        ],
        onLibraryChange: (fn) => libraryListeners.push(fn),
        /** Whether a pressed key shows its letter above it (default on). */
        keyPreview: () => settings.keyPreview !== false,
        /** Typing skips squares that are already filled (default on). */
        skipFilled: () => settings.skipFilled !== false,
        /** The end of an answer moves on to the next clue (default on). */
        autoAdvance: () => settings.autoAdvance !== false,
        /** Whether times are shown, in the solver and on the home page (default on). */
        showTimer: () => settings.showTimer !== false,
        /** Error Check Mode: wrong letters show red as they're typed. */
        errorCheck: () => !!settings.errorCheck,
        onSolverChange: (fn) => solverListeners.push(fn),
        /** Items for the solver's Settings sheet (not shown on the home page). */
        solverItems: () => [
            { section: 'Solving' },
            {
                indent: 1,
                label: 'Skip filled squares',
                control: 'switch',
                checked: settings.skipFilled !== false,
                action: () => {
                    settings.skipFilled = settings.skipFilled === false;
                    Store.writeJSON(FILE, settings);
                },
            },
            {
                indent: 1,
                label: 'Auto-advance to next clue',
                control: 'switch',
                checked: settings.autoAdvance !== false,
                action: () => {
                    settings.autoAdvance = settings.autoAdvance === false;
                    Store.writeJSON(FILE, settings);
                },
            },
            { section: 'Accessibility' },
            {
                indent: 1,
                label: 'Error Check Mode',
                control: 'switch',
                checked: !!settings.errorCheck,
                action: () => {
                    settings.errorCheck = !settings.errorCheck;
                    Store.writeJSON(FILE, settings);
                    for (const fn of solverListeners) fn();
                },
            },
            {
                indent: 1,
                label: 'Colorblind Mode',
                control: 'switch',
                checked: !!settings.colorblind,
                action: () => {
                    settings.colorblind = !settings.colorblind;
                    Store.writeJSON(FILE, settings);
                    document.documentElement.classList.toggle('colorblind', settings.colorblind);
                },
            },
            { section: 'Miscellaneous' },
            {
                indent: 1,
                label: 'Show timer',
                control: 'switch',
                checked: settings.showTimer !== false,
                action: () => {
                    settings.showTimer = settings.showTimer === false;
                    Store.writeJSON(FILE, settings);
                    document.documentElement.classList.toggle('timer-hidden', !settings.showTimer);
                    for (const fn of libraryListeners) fn();
                },
            },
            {
                indent: 1,
                label: 'Letter pop-up on key press',
                control: 'switch',
                checked: settings.keyPreview !== false,
                action: () => {
                    settings.keyPreview = settings.keyPreview === false;
                    Store.writeJSON(FILE, settings);
                },
            },
        ],
        onChange: (fn) => listeners.push(fn),
        /** The custom grid colours of 'light' or 'dark' (key → '#rrggbb'). */
        gridColors: (theme) => ({ ...gridColorsFor(theme) }),
        /** Sets one custom grid colour, or clears it (value null). */
        setGridColor(theme, key, value) {
            if (!settings.gridColors || typeof settings.gridColors !== 'object') settings.gridColors = {};
            const own = { ...gridColorsFor(theme) };
            if (value) own[key] = value;
            else delete own[key];
            settings.gridColors[theme] = own;
            saveGridColorsSoon();
            for (const fn of listeners) fn(isDark());
        },
        /** Clears all of a theme's custom grid colours. */
        resetGridColors(theme) {
            if (settings.gridColors) delete settings.gridColors[theme];
            saveGridColorsSoon();
            for (const fn of listeners) fn(isDark());
        },
        /** Shows the solver in 'light' or 'dark' for now, or as set (null). */
        previewTheme(theme) {
            previewTheme = theme || null;
            applySmoothly();
        },
        /** Called by the Android side when the phone's dark theme changes. */
        setSystemDark(dark) {
            systemDark = !!dark;
            if (settings.theme === 'system') applySmoothly();
        },
    };

    apply();
})(window);
