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

    function isDark() {
        return settings.theme === 'dark' || (settings.theme === 'system' && systemDark);
    }

    function apply() {
        const dark = isDark();
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        if (bridge && bridge.setThemeDark) bridge.setThemeDark(dark);
        for (const fn of listeners) fn(dark);
    }

    function setTheme(theme) {
        settings.theme = theme;
        Store.writeJSON(FILE, settings);
        // Android's launch screen, shown before the page loads, follows too.
        if (bridge && bridge.setThemeMode) bridge.setThemeMode(theme);
        apply();
    }

    /** Home page option: leave solved puzzles out of the library list. */
    function setHideSolved(hide) {
        settings.hideSolved = !!hide;
        Store.writeJSON(FILE, settings);
        for (const fn of libraryListeners) fn();
    }

    const libraryListeners = [];
    const solverListeners = [];

    /** extraItems: more sheet items, e.g. the open puzzle's Clear and Reset. */
    function open(extraItems) {
        const t = settings.theme;
        UI.sheet({
            title: 'Settings',
            items: [
                { section: 'Appearance' },
                { indent: 1, label: 'Light', checked: t === 'light', action: () => setTheme('light') },
                { indent: 1, label: 'Dark', checked: t === 'dark', action: () => setTheme('dark') },
                {
                    indent: 1,
                    label: 'Match phone setting',
                    sub: 'Light or dark, following the phone’s dark theme',
                    checked: t === 'system',
                    action: () => setTheme('system'),
                },
                ...(extraItems || []),
            ],
        });
    }

    if (!bridge && media && media.addEventListener) {
        media.addEventListener('change', (e) => {
            systemDark = e.matches;
            apply();
        });
    }

    global.Settings = {
        isDark,
        open,
        hideSolved: () => !!settings.hideSolved,
        /** Items for the home page's Settings sheet (not shown in a puzzle). */
        libraryItems: () => [
            { section: 'Library' },
            {
                indent: 1,
                label: 'Hide solved puzzles',
                checked: !!settings.hideSolved,
                action: () => setHideSolved(!settings.hideSolved),
            },
        ],
        onLibraryChange: (fn) => libraryListeners.push(fn),
        /** Whether a pressed key shows its letter above it (default on). */
        keyPreview: () => settings.keyPreview !== false,
        /** Typing skips squares that are already filled (default on). */
        skipFilled: () => settings.skipFilled !== false,
        /** The end of an answer moves on to the next clue (default on). */
        autoAdvance: () => settings.autoAdvance !== false,
        /** Error Check Mode: wrong letters show red as they're typed. */
        errorCheck: () => !!settings.errorCheck,
        onSolverChange: (fn) => solverListeners.push(fn),
        /** Items for the solver's Settings sheet (not shown on the home page). */
        solverItems: () => [
            { section: 'Keyboard' },
            {
                indent: 1,
                label: 'Letter pop-up on key press',
                checked: settings.keyPreview !== false,
                action: () => {
                    settings.keyPreview = settings.keyPreview === false;
                    Store.writeJSON(FILE, settings);
                },
            },
            { section: 'Solving' },
            {
                indent: 1,
                label: 'Skip filled squares',
                sub: 'Typing jumps over squares that already have a letter',
                checked: settings.skipFilled !== false,
                action: () => {
                    settings.skipFilled = settings.skipFilled === false;
                    Store.writeJSON(FILE, settings);
                },
            },
            {
                indent: 1,
                label: 'Auto-advance to next clue',
                sub: 'At the end of an answer, move on to the next clue',
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
                sub: 'Wrong letters turn red as you type them',
                checked: !!settings.errorCheck,
                action: () => {
                    settings.errorCheck = !settings.errorCheck;
                    Store.writeJSON(FILE, settings);
                    for (const fn of solverListeners) fn();
                },
            },
        ],
        onChange: (fn) => listeners.push(fn),
        /** Called by the Android side when the phone's dark theme changes. */
        setSystemDark(dark) {
            systemDark = !!dark;
            if (settings.theme === 'system') apply();
        },
    };

    apply();
})(window);
