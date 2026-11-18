/*
 * Custom grid colours: Settings → Appearance → Customize… beside Light or
 * Dark (in a puzzle). Each theme keeps its own set in settings.json; only the
 * grid and the clue bar change, while the home page, header and keyboard keep
 * the theme's colours. The colours are CSS variables on <html>, each with a
 * class saying it is set (css/grid-colors.css); the Customize panel replaces
 * the keyboard while it is open, so the whole grid shows every change.
 */
(function (global) {
    'use strict';

    const root = document.documentElement;

    // Order, names and the theme's own colours. Shaded has none of its own:
    // by default each puzzle's shading colour is used.
    const KEYS = [
        { key: 'block', label: 'Black squares', name: 'Black squares', sub: 'The squares with no letter' },
        { key: 'cell', label: 'Background', name: 'Background', sub: 'The grid’s letter squares' },
        { key: 'line', label: 'Grid lines', name: 'Grid lines', sub: 'The lines between squares' },
        { key: 'letter', label: 'Letters', name: 'Letters', sub: 'Letters you type, and the clue numbers' },
        { key: 'pencil', label: 'Pencil', name: 'Pencil letters', sub: 'Letters typed with the pencil on' },
        { key: 'circle', label: 'Circles', name: 'Circles', sub: 'Circled squares' },
        { key: 'shaded', label: 'Shaded', name: 'Shaded squares', sub: 'Default: the puzzle’s own shading' },
        { key: 'cursor', label: 'Cursor', name: 'Cursor', sub: 'The square you’re typing in' },
        { key: 'highlight', label: 'Highlight', name: 'Highlighted entry', sub: 'The answer you’re in, and the clue bar' },
        { key: 'correct', label: 'Correct', name: 'Correct letters', sub: 'Letters a check finds right' },
        { key: 'wrong', label: 'Incorrect', name: 'Incorrect letters', sub: 'Letters a check (or Error Check Mode) finds wrong' },
        { key: 'revealed', label: 'Revealed', name: 'Revealed letters', sub: 'Letters filled in by Reveal' },
    ];

    const DEFAULTS = {
        light: {
            block: '#2a2a2a', cell: '#ffffff', letter: '#2a2a2a', line: '#797983', pencil: '#6b6b6b',
            circle: '#797983', shaded: null, cursor: '#ffd54f', highlight: '#cfe8ff',
            correct: '#2e7d32', wrong: '#c62828', revealed: '#6a1b9a',
        },
        dark: {
            block: '#000000', cell: '#303030', letter: '#dedede', line: '#000000', pencil: '#8a8a8a',
            circle: '#858585', shaded: null, cursor: '#c4a24f', highlight: '#2e4459',
            correct: '#6cc070', wrong: '#ff6b6b', revealed: '#c792ea',
        },
    };

    // Suggested colours for each kind of thing, after the theme's own.
    const PRESETS = {
        light: {
            pencil: ['#8a8a8a', '#9e9e9e', '#5c7da8', '#6f8f73', '#a07a5a', '#8a6fa8', '#4a4a4a', '#b0b0b0'],
            ink: ['#000000', '#444444', '#1d3d6e', '#2e5e3e', '#7a2e2e', '#5b3a7a', '#6b4e2e', '#797983'],
            block: ['#000000', '#444444', '#1d3d6e', '#2e3b4e', '#3e2e2e', '#2e3e2e', '#4a3a5a', '#797983'],
            line: ['#2a2a2a', '#000000', '#b0b0b8', '#9fb0c8', '#1d3d6e', '#c62828', '#2e7d32', '#d0d0d0'],
            cell: ['#fafafa', '#fdf8ee', '#f4f7fb', '#f3f9f1', '#fbf3f3', '#f6f4fb', '#fffbe6', '#eeeeee'],
            shaded: ['#d9d9d9', '#e3ecf7', '#e3f1df', '#f7e6d4', '#f3dbe8', '#e7e1f5', '#fff2b3', '#cfd8dc'],
            cursor: ['#ffb74d', '#81c784', '#64b5f6', '#f48fb1', '#ba68c8', '#4dd0e1', '#fff176', '#ff8a65'],
            highlight: ['#d8f0d2', '#fde2c8', '#f6d5e8', '#e3dcf7', '#fff3b0', '#d5f1f0', '#e8e8e8', '#bcd9ff'],
            correct: ['#388e3c', '#1b5e20', '#43a047', '#00796b', '#00838f', '#1565c0', '#558b2f', '#2e5e3e'],
            wrong: ['#e53935', '#b71c1c', '#ff5722', '#e91e63', '#f57c00', '#ad1457', '#8e0000', '#d84315'],
            revealed: ['#8e24aa', '#5e35b1', '#3949ab', '#1e88e5', '#00897b', '#6d4c41', '#ad1457', '#4527a0'],
        },
        dark: {
            pencil: ['#a8a8a8', '#6e6e6e', '#8fa9cf', '#94b897', '#c4a382', '#ad97c9', '#c8c8c8', '#5e5e5e'],
            ink: ['#ffffff', '#b0b0b0', '#bcd4f6', '#c8e6c9', '#ffccbc', '#e1bee7', '#ffe0a3', '#9e9e9e'],
            block: ['#161616', '#15181d', '#1b1916', '#0d1b2a', '#1a2a1a', '#2a1a1a', '#222222', '#2e2e2e'],
            line: ['#858585', '#1c1c1c', '#444444', '#5a6577', '#9e9e9e', '#2b323c', '#6b5b3e', '#3e5a3e'],
            cell: ['#2b2f36', '#33302c', '#2a2a2a', '#1e1e1e', '#2d3530', '#352d2d', '#2f2d36', '#3a3a3a'],
            shaded: ['#4a4a4a', '#3d4652', '#3e4a3c', '#4d4234', '#4b3a44', '#433d52', '#55502e', '#2f4a4a'],
            cursor: ['#b9824a', '#5e9e62', '#4f7fd9', '#b5617f', '#8e6bb5', '#3f9ea6', '#c9c05a', '#b85c4a'],
            highlight: ['#2e4a36', '#4a3a2a', '#4a2e40', '#3a3352', '#4a4626', '#264a4a', '#3a3a3a', '#1f3a5c'],
            correct: ['#81c784', '#a5d6a7', '#66bb6a', '#4db6ac', '#4dd0e1', '#64b5f6', '#aed581', '#c5e1a5'],
            wrong: ['#ff8a80', '#ef5350', '#ff7043', '#f06292', '#ffab40', '#ff5252', '#e57373', '#ffcdd2'],
            revealed: ['#ce93d8', '#b39ddb', '#9fa8da', '#90caf9', '#80cbc4', '#bcaaa4', '#f48fb1', '#e1bee7'],
        },
    };
    const PRESET_KIND = {
        block: 'block', cell: 'cell', letter: 'ink', line: 'line', pencil: 'pencil',
        circle: 'line', shaded: 'shaded', cursor: 'cursor', highlight: 'highlight',
        correct: 'correct', wrong: 'wrong', revealed: 'revealed',
    };

    // ----- Colour helpers -----

    function parseHex(text) {
        let t = String(text || '').trim().replace(/^#/, '');
        if (/^[0-9a-f]{3}$/i.test(t)) t = t.split('').map((ch) => ch + ch).join('');
        return /^[0-9a-f]{6}$/i.test(t) ? '#' + t.toLowerCase() : null;
    }

    function rgb(hex) {
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function luminance(hex) {
        const lin = (v) => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        const [r, g, b] = rgb(hex).map(lin);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    const isLight = (hex) => luminance(hex) > 0.36;
    // Text that reads on a colour: the theme's dark or light text.
    const textOn = (hex) => (isLight(hex) ? '#1a1a1a' : '#e6e6e6');

    function toHsl(hex) {
        const [r, g, b] = rgb(hex).map((v) => v / 255);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 2;
        let h = 0;
        let s = 0;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
            else if (max === g) h = ((b - r) / d + 2) * 60;
            else h = ((r - g) / d + 4) * 60;
        }
        return [h, s, l];
    }

    function fromHsl(h, s, l) {
        const f = (n) => {
            const k = (n + h / 30) % 12;
            const a = s * Math.min(l, 1 - l);
            const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
            return Math.round(v * 255).toString(16).padStart(2, '0');
        };
        return '#' + f(0) + f(8) + f(4);
    }

    // ----- Applying the colours -----

    function currentTheme() {
        return Settings.isDark() ? 'dark' : 'light';
    }

    function apply() {
        const theme = currentTheme();
        const custom = Settings.gridColors(theme);
        const eff = { ...DEFAULTS[theme], ...custom };
        for (const { key } of KEYS) {
            const on = !!custom[key];
            root.classList.toggle('cg-' + key, on);
            if (on) root.style.setProperty('--cg-' + key, custom[key]);
            else root.style.removeProperty('--cg-' + key);
        }
        // The clue bar takes a custom highlight colour, with text, press
        // shade and scroll bar that read on it.
        if (custom.highlight) {
            const light = isLight(custom.highlight);
            root.style.setProperty('--cg-hl-text', textOn(custom.highlight));
            root.style.setProperty('--cg-hl-press', light ? 'rgba(20, 60, 120, 0.1)' : 'rgba(255, 255, 255, 0.08)');
            root.style.setProperty('--cg-hl-track', light ? 'rgba(20, 60, 120, 0.12)' : 'rgba(255, 255, 255, 0.12)');
            root.style.setProperty('--cg-hl-thumb', light ? 'rgba(20, 50, 100, 0.42)' : 'rgba(255, 255, 255, 0.45)');
        }
        // The cursor square's letter, number and circle (numbers are in the
        // letters' colour): on a custom cursor,
        // whichever of dark or light text reads on it; otherwise as the theme
        // does it (light: the usual colours; dark: dark text on the gold).
        const sel = custom.cursor || custom.letter || custom.circle;
        root.classList.toggle('cg-sel', !!sel);
        if (sel) {
            let text;
            let num;
            let circle;
            if (custom.cursor) text = num = circle = textOn(custom.cursor);
            else if (theme === 'light') [text, num, circle] = [eff.letter, eff.letter, eff.circle];
            else text = num = circle = '#111111';
            root.style.setProperty('--cg-sel-text', text);
            root.style.setProperty('--cg-sel-num', num);
            root.style.setProperty('--cg-sel-circle', circle);
        }
    }

    // ----- The Customize panel -----

    let panel = null; // { el, theme, key (picker open) }

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    function swatch(color) {
        const s = el('span', 'gc-swatch' + (color ? '' : ' gc-own'));
        if (color) s.style.background = color;
        return s;
    }

    function button(cls, text, onClick) {
        const b = el('button', cls, text);
        b.type = 'button';
        b.addEventListener('click', onClick);
        return b;
    }

    function head(title, sub, leftAction, rightLabel, rightAction) {
        const h = el('div', 'gc-head');
        if (leftAction) h.appendChild(button('gc-back', '‹', leftAction));
        const t = el('div', 'gc-titles');
        t.appendChild(el('div', 'gc-title', title));
        if (sub) t.appendChild(el('div', 'gc-sub', sub));
        h.appendChild(t);
        h.appendChild(button('gc-link', rightLabel, rightAction));
        h.appendChild(button('gc-done', 'Done', close));
        return h;
    }

    function colorOf(theme, key) {
        return Settings.gridColors(theme)[key] || DEFAULTS[theme][key];
    }

    function renderList() {
        const { el: p, theme } = panel;
        panel.key = null;
        p.replaceChildren();
        p.appendChild(head('Customize ' + theme + ' colors', null, null, 'Reset', () => {
            UI.confirm({
                title: 'Reset ' + theme + ' colors?',
                message: 'The grid goes back to the ' + theme + ' theme’s own colors.',
                okLabel: 'Reset',
                danger: true,
            }).then((ok) => {
                if (!ok || !panel) return;
                Settings.resetGridColors(theme);
                renderList();
            });
        }));
        const grid = el('div', 'gc-chips');
        const custom = Settings.gridColors(theme);
        for (const k of KEYS) {
            const chip = button('gc-chip' + (custom[k.key] ? ' custom' : ''), '', () => renderPicker(k));
            chip.append(swatch(colorOf(theme, k.key)), el('span', 'gc-chip-label', k.label));
            grid.appendChild(chip);
        }
        p.appendChild(grid);
    }

    function renderPicker(k) {
        const { el: p, theme } = panel;
        panel.key = k.key;
        // fromSliders: leave the sliders where the finger has them (a
        // colour worked back from its code can lose its hue at the ends).
        const set = (value, fromSliders) => {
            Settings.setGridColor(theme, k.key, value);
            sync(fromSliders);
        };
        p.replaceChildren();
        p.appendChild(head(k.name, k.sub, renderList, 'Default', () => set(null)));

        // Suggestions: the theme's own colour first (for Shaded, the
        // puzzle's own), then a few others.
        const row = el('div', 'gc-presets');
        const options = [DEFAULTS[theme][k.key]].concat(PRESETS[theme][PRESET_KIND[k.key]]);
        const presetEls = options.map((c) => {
            const b = button('gc-preset', '', () => set(c === DEFAULTS[theme][k.key] ? null : c));
            b.appendChild(swatch(c));
            b.dataset.color = c || '';
            b.setAttribute('aria-label', c || 'Puzzle’s own');
            row.appendChild(b);
            return b;
        });
        p.appendChild(row);

        // Any colour: hue, saturation and lightness sliders, and a hex box.
        const controls = el('div', 'gc-controls');
        const sliders = el('div', 'gc-sliders');
        const range = (cls, max, label) => {
            const r = el('input', 'gc-range ' + cls);
            r.type = 'range';
            r.min = 0;
            r.max = max;
            r.setAttribute('aria-label', label);
            sliders.appendChild(r);
            return r;
        };
        const hue = range('gc-hue', 360, 'Hue');
        const saturation = range('gc-sat', 100, 'Saturation');
        const lightness = range('gc-light', 100, 'Lightness');
        const hex = el('input', 'gc-hex');
        hex.type = 'text';
        hex.autocomplete = 'off';
        hex.spellcheck = false;
        hex.maxLength = 7;
        hex.setAttribute('autocapitalize', 'characters');
        hex.setAttribute('aria-label', 'Color code');
        controls.append(sliders, hex);
        p.appendChild(controls);

        let hsl = [0, 0, 0];
        // The saturation track runs from grey to full colour at about the
        // current lightness; the lightness track through the current colour.
        function paintTracks() {
            const [h, sat, l] = hsl;
            const lMid = Math.min(0.75, Math.max(0.25, l));
            saturation.style.background = 'linear-gradient(90deg, ' + fromHsl(h, 0, lMid) + ', ' + fromHsl(h, 1, lMid) + ')';
            lightness.style.background = 'linear-gradient(90deg, #000, ' + fromHsl(h, Math.max(sat, 0.001), 0.5) + ', #fff)';
        }
        function sync(fromSliders) {
            const c = Settings.gridColors(theme)[k.key] || DEFAULTS[theme][k.key];
            const shown = c || '#d9d9d9';
            for (const b of presetEls) b.classList.toggle('on', (b.dataset.color || null) === c);
            if (document.activeElement !== hex) hex.value = c ? c.toUpperCase() : 'Puzzle';
            if (fromSliders) return;
            hsl = toHsl(shown);
            hue.value = Math.round(hsl[0]);
            saturation.value = Math.round(hsl[1] * 100);
            lightness.value = Math.round(hsl[2] * 100);
            paintTracks();
        }
        const fromSliders = () => {
            paintTracks();
            set(fromHsl(hsl[0], hsl[1], hsl[2]), true);
        };
        hue.addEventListener('input', () => {
            // A grey has no hue to turn; give it some colour first (the
            // saturation slider moves to show it; lightness never does).
            if (hsl[1] < 0.08) {
                hsl[1] = 0.55;
                saturation.value = 55;
            }
            hsl[0] = Number(hue.value);
            fromSliders();
        });
        saturation.addEventListener('input', () => {
            hsl[1] = Number(saturation.value) / 100;
            fromSliders();
        });
        lightness.addEventListener('input', () => {
            hsl[2] = Number(lightness.value) / 100;
            fromSliders();
        });
        hex.addEventListener('input', () => {
            const c = parseHex(hex.value);
            if (c) set(c);
        });
        hex.addEventListener('blur', () => sync());
        hex.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') hex.blur();
        });
        sync();
    }

    /** Opens the Customize panel for 'light' or 'dark', over the keyboard. */
    function open(theme) {
        close();
        const keyboard = document.querySelector('.solver-view .mobile-keyboard');
        if (!keyboard) return;
        Settings.previewTheme(theme);
        const p = el('div', 'gc-panel');
        p.setAttribute('role', 'dialog');
        const top = keyboard.getBoundingClientRect().top;
        p.style.minHeight = Math.max(200, window.innerHeight - top) + 'px';
        document.body.appendChild(p);
        panel = { el: p, theme, key: null };
        renderList();
        requestAnimationFrame(() => p.classList.add('show'));
    }

    function close() {
        if (!panel) return;
        const p = panel.el;
        panel = null;
        if (document.activeElement && p.contains(document.activeElement)) document.activeElement.blur();
        p.remove();
        Settings.previewTheme(null);
    }

    Settings.onChange(apply);
    apply();

    global.GridColors = {
        /** Whether Customize… is offered: only with a puzzle open. */
        available: () => document.body.classList.contains('solving'),
        open,
        close,
        /** Back: from a colour to the list, then closes. True if handled. */
        handleBack() {
            if (!panel) return false;
            if (panel.key) renderList();
            else close();
            return true;
        },
    };
})(window);
