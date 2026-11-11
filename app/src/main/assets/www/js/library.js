/*
 * The home page: puzzles and folders, search, sort, import.
 *
 * library.json holds the folder tree and one entry per puzzle. The parsed
 * puzzle and the solver's progress are stored in their own files, so the
 * library itself stays small and quick to rewrite.
 */
(function (global) {
    'use strict';

    const LIBRARY_FILE = 'library.json';

    const view = document.getElementById('library-view');
    const q = (sel) => view.querySelector(sel);
    const E = {
        back: q('.lib-back-btn'),
        title: q('.lib-title'),
        path: q('.lib-path'),
        sort: q('.lib-sort-btn'),
        newFolder: q('.lib-folder-btn'),
        add: q('.lib-add-btn'),
        topbar: q('.lib-topbar'),
        searchBtn: q('.lib-search-btn'),
        searchClose: q('.lib-search-close'),
        search: q('.lib-search'),
        searchClear: q('.lib-search-clear'),
        list: q('.lib-list'),
    };

    const SORTS = {
        'added-desc': 'Date added (newest first)',
        'added-asc': 'Date added (oldest first)',
        'title-asc': 'Title (A to Z)',
        'title-desc': 'Title (Z to A)',
        'size-asc': 'Size (smallest first)',
        'size-desc': 'Size (biggest first)',
    };

    // The size sorts order puzzles of the same size by the date or title
    // sort in use before switching to size (lib.sortThen).
    const BASE_SORTS = ['added-desc', 'added-asc', 'title-asc', 'title-desc'];

    const isSizeSort = (key) => key === 'size-asc' || key === 'size-desc';

    const ICONS = {
        folder: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M2.5 6.5A1.5 1.5 0 0 1 4 5h5l2.2 2.4H20a1.5 1.5 0 0 1 1.5 1.5v9.6A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5z" fill="currentColor"/></svg>',
        more: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="5.5" r="1.9" fill="currentColor"/><circle cx="12" cy="12" r="1.9" fill="currentColor"/><circle cx="12" cy="18.5" r="1.9" fill="currentColor"/></svg>',
        chevron: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    };

    let lib = null;
    let currentFolder = null; // folder id, or null for the top level
    let query = '';
    let searching = false; // the search box is open
    let callbacks = null;

    // ---------- Persistence ----------

    function load() {
        const data = Store.readJSON(LIBRARY_FILE);
        lib = {
            version: 1,
            folders: [],
            puzzles: [],
            sort: 'added-desc',
            sortThen: 'added-desc',
            ...(data || {}),
        };
        if (!SORTS[lib.sort]) lib.sort = 'added-desc';
        if (!BASE_SORTS.includes(lib.sortThen)) lib.sortThen = 'added-desc';
        const ids = new Set(lib.folders.map((f) => f.id));
        for (const p of lib.puzzles) if (p.folderId && !ids.has(p.folderId)) p.folderId = null;
    }

    let dirty = false;

    function save() {
        Store.writeJSON(LIBRARY_FILE, lib);
        dirty = false;
    }

    // ---------- Helpers ----------

    function uid(prefix) {
        return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    // cyrb53: a fast 53-bit hash, used to spot the same file imported twice.
    function hashBytes(bytes) {
        let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
        for (let i = 0; i < bytes.length; i++) {
            const ch = bytes[i];
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
    }

    const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

    const folderById = (id) => lib.folders.find((f) => f.id === id) || null;
    const puzzleById = (id) => lib.puzzles.find((p) => p.id === id) || null;

    function ancestors(folderId) {
        const out = [];
        let f = folderById(folderId);
        while (f) {
            out.unshift(f);
            f = folderById(f.parentId);
        }
        return out;
    }

    function descendantIds(folderId) {
        const out = new Set([folderId]);
        let grew = true;
        while (grew) {
            grew = false;
            for (const f of lib.folders) {
                if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
                    out.add(f.id);
                    grew = true;
                }
            }
        }
        return out;
    }

    function folderStats(folderId) {
        const ids = descendantIds(folderId);
        const inside = lib.puzzles.filter((p) => p.folderId && ids.has(p.folderId));
        return { total: inside.length, done: inside.filter((p) => p.status === 'done').length };
    }

    function displayTitle(p) {
        return p.title || (p.fileName || 'Untitled').replace(/\.[^.]+$/, '');
    }

    function compareText(a, b) {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    }

    /** The date or title order: the sort itself, or the tie-break under a size sort. */
    function baseSort() {
        return isSizeSort(lib.sort) ? lib.sortThen : lib.sort;
    }

    // Folders have no size, so a size sort orders them by its tie-break.
    function sortFolders(list) {
        const s = baseSort();
        return list.slice().sort((a, b) => {
            if (s === 'title-asc') return compareText(a.name, b.name);
            if (s === 'title-desc') return compareText(b.name, a.name);
            if (s === 'added-asc') return a.created - b.created;
            return b.created - a.created;
        });
    }

    /** A puzzle's size: the number of squares in its grid. */
    const sizeOf = (p) => (p.width || 0) * (p.height || 0);

    function sortPuzzles(list) {
        const s = baseSort();
        const byBase = (a, b) => {
            if (s === 'title-asc') return compareText(displayTitle(a), displayTitle(b)) || b.added - a.added;
            if (s === 'title-desc') return compareText(displayTitle(b), displayTitle(a)) || b.added - a.added;
            if (s === 'added-asc') return a.added - b.added;
            return b.added - a.added;
        };
        const sizeDir = lib.sort === 'size-asc' ? 1 : lib.sort === 'size-desc' ? -1 : 0;
        return list.slice().sort((a, b) => (sizeDir && sizeDir * (sizeOf(a) - sizeOf(b))) || byBase(a, b));
    }

    function formatDate(ms) {
        try {
            return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        } catch (e) {
            return new Date(ms).toDateString();
        }
    }

    // Same format as the solver's timer: minutes keep counting past an hour.
    function formatTime(ms) {
        const total = Math.floor(ms / 1000);
        return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
    }

    function plural(n, word) {
        return n + ' ' + word + (n === 1 ? '' : 's');
    }

    // ---------- Rendering ----------

    function statusIcon(p) {
        if (p.status === 'done') {
            return '<svg viewBox="0 0 36 36" width="34" height="34" aria-hidden="true"><circle cx="18" cy="18" r="16" fill="#2e7d32"/><path d="m11 18.5 4.6 4.6L25.5 13" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        }
        if (p.status === 'progress') {
            const circumference = 2 * Math.PI * 14;
            const pct = Math.max(4, Math.min(100, p.percent || 0));
            const dash = (pct / 100) * circumference;
            return '<svg viewBox="0 0 36 36" width="34" height="34" aria-hidden="true">' +
                '<circle class="ring-track" cx="18" cy="18" r="14" fill="none" stroke="#d5dde8" stroke-width="4.5"/>' +
                '<circle cx="18" cy="18" r="14" fill="none" stroke="#2f5ea8" stroke-width="4.5" stroke-linecap="round" ' +
                'stroke-dasharray="' + dash.toFixed(1) + ' 100" transform="rotate(-90 18 18)"/></svg>';
        }
        return '<svg viewBox="0 0 36 36" width="34" height="34" aria-hidden="true"><circle class="ring-new" cx="18" cy="18" r="14" fill="#fff" stroke="#b9c3d1" stroke-width="2.5"/><circle cx="18" cy="18" r="4.5" fill="#2f5ea8"/></svg>';
    }

    function statusLabel(p) {
        if (p.status === 'done') {
            return '<span class="lib-state done">Solved</span>' +
                (p.elapsed ? '<span class="lib-state-sub">' + formatTime(p.elapsed) + '</span>' : '');
        }
        if (p.status === 'progress') {
            return '<span class="lib-state progress">' + (p.percent || 0) + '%</span>' +
                (p.elapsed ? '<span class="lib-state-sub">' + formatTime(p.elapsed) + '</span>' : '');
        }
        return '<span class="lib-state new">New</span>';
    }

    function puzzleRow(p, showFolder) {
        const row = document.createElement('div');
        row.className = 'lib-row lib-puzzle status-' + (p.status || 'new');
        row.dataset.puzzle = p.id;
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        const esc = Parsers.escapeHtml;
        const metaBits = [];
        if (showFolder) {
            const path = ancestors(p.folderId).map((f) => f.name).join(' / ');
            metaBits.push(path ? '📁 ' + path : 'Top level');
        }
        metaBits.push('Added ' + formatDate(p.added));
        if (p.width && p.height) metaBits.push(p.width + '×' + p.height);
        row.innerHTML =
            '<span class="lib-status">' + statusIcon(p) + '</span>' +
            '<span class="lib-row-body">' +
            '<span class="lib-row-title">' + esc(displayTitle(p)) + '</span>' +
            (p.author ? '<span class="lib-row-sub">' + esc(p.author) + '</span>' : '') +
            '<span class="lib-row-meta">' + esc(metaBits.join(' · ')) + '</span>' +
            '</span>' +
            '<span class="lib-row-side">' + statusLabel(p) + '</span>';
        return row;
    }

    function folderRow(f) {
        const stats = folderStats(f.id);
        const subs = lib.folders.filter((x) => x.parentId === f.id).length;
        const bits = [];
        if (subs) bits.push(plural(subs, 'folder'));
        bits.push(plural(stats.total, 'puzzle'));
        if (stats.total) bits.push(stats.done + ' solved');
        const row = document.createElement('div');
        row.className = 'lib-row lib-folder';
        row.dataset.folder = f.id;
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        row.innerHTML =
            '<span class="lib-status lib-folder-icon">' + ICONS.folder + '</span>' +
            '<span class="lib-row-body">' +
            '<span class="lib-row-title">' + Parsers.escapeHtml(f.name) + '</span>' +
            '<span class="lib-row-meta">' + Parsers.escapeHtml(bits.join(' · ')) + '</span>' +
            '</span>' +
            '<span class="lib-row-side lib-chevron">' + ICONS.chevron + '</span>';
        return row;
    }

    function emptyState(title, text, withButton) {
        const box = document.createElement('div');
        box.className = 'lib-empty';
        box.innerHTML =
            '<div class="lib-empty-art" aria-hidden="true">' +
            '<svg viewBox="0 0 64 64" width="72" height="72"><rect x="6" y="6" width="52" height="52" rx="3" fill="#fff" stroke="#9fb0c8" stroke-width="3"/>' +
            '<path d="M23.3 6v52M40.7 6v52M6 23.3h52M6 40.7h52" stroke="#9fb0c8" stroke-width="2"/>' +
            '<rect x="40.7" y="6" width="17.3" height="17.3" fill="#9fb0c8"/><rect x="6" y="40.7" width="17.3" height="17.3" fill="#9fb0c8"/></svg></div>' +
            '<p class="lib-empty-title"></p><p class="lib-empty-text"></p>';
        box.querySelector('.lib-empty-title').textContent = title;
        box.querySelector('.lib-empty-text').textContent = text;
        if (withButton) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'lib-empty-btn';
            b.textContent = 'Add puzzles';
            b.addEventListener('click', () => callbacks.pickFiles());
            box.appendChild(b);
        }
        return box;
    }

    function sectionLabel(text) {
        const h = document.createElement('div');
        h.className = 'lib-section';
        h.textContent = text;
        return h;
    }

    function render() {
        if (!lib) return;
        if (currentFolder && !folderById(currentFolder)) currentFolder = null;

        // Header
        const folder = folderById(currentFolder);
        E.back.hidden = !folder;
        E.title.textContent = folder ? folder.name : 'Puzzles';
        const up = folder ? ancestors(folder.parentId).map((f) => f.name) : [];
        E.path.hidden = !folder;
        E.path.textContent = ['Puzzles', ...up].join(' / ');
        E.searchClear.hidden = !query;

        const list = E.list;
        list.innerHTML = '';
        const frag = document.createDocumentFragment();

        if (query) {
            const needle = fold(query.trim());
            const folders = sortFolders(lib.folders.filter((f) => fold(f.name).includes(needle)));
            const puzzles = sortPuzzles(lib.puzzles.filter((p) =>
                fold(displayTitle(p)).includes(needle) || fold(p.author).includes(needle)));
            if (!folders.length && !puzzles.length) {
                frag.appendChild(emptyState('No matches', 'No puzzle has “' + query.trim() + '” in its title or author.', false));
            } else {
                if (folders.length) {
                    frag.appendChild(sectionLabel('Folders'));
                    for (const f of folders) frag.appendChild(folderRow(f));
                }
                if (puzzles.length) {
                    frag.appendChild(sectionLabel(plural(puzzles.length, 'puzzle')));
                    for (const p of puzzles) frag.appendChild(puzzleRow(p, true));
                }
            }
        } else {
            const folders = sortFolders(lib.folders.filter((f) => (f.parentId || null) === currentFolder));
            const puzzles = sortPuzzles(lib.puzzles.filter((p) => (p.folderId || null) === currentFolder));
            for (const f of folders) frag.appendChild(folderRow(f));
            if (folders.length && puzzles.length) frag.appendChild(sectionLabel(plural(puzzles.length, 'puzzle')));
            for (const p of puzzles) frag.appendChild(puzzleRow(p, false));
            if (!folders.length && !puzzles.length) {
                if (folder) {
                    frag.appendChild(emptyState('This folder is empty', 'Tap + to add puzzles here, or long-press a puzzle to move it in.', true));
                } else {
                    frag.appendChild(emptyState('No puzzles yet', 'Add .puz, .ipuz or .jpz files from your phone to start solving.', true));
                }
            }
        }
        list.appendChild(frag);
    }

    // ---------- Navigation ----------

    function openSearch() {
        searching = true;
        E.topbar.classList.add('searching');
        E.search.focus();
    }

    function closeSearch() {
        searching = false;
        query = '';
        E.search.value = '';
        E.search.blur();
        E.topbar.classList.remove('searching');
        render();
    }

    function openFolder(id) {
        currentFolder = id;
        if (searching) {
            searching = false;
            E.search.blur();
            E.topbar.classList.remove('searching');
        }
        query = '';
        E.search.value = '';
        render();
        E.list.scrollTop = 0;
    }

    function goUp() {
        const f = folderById(currentFolder);
        openFolder(f ? f.parentId || null : null);
    }

    // ---------- Actions ----------

    async function createFolder(parentId) {
        const name = await UI.prompt({ title: 'New folder', placeholder: 'Folder name', okLabel: 'Create' });
        if (!name) return null;
        const f = { id: uid('f'), name, parentId: parentId || null, created: Date.now() };
        lib.folders.push(f);
        save();
        render();
        return f;
    }

    async function renameFolder(f) {
        const name = await UI.prompt({ title: 'Rename folder', value: f.name, okLabel: 'Rename' });
        if (!name) return;
        f.name = name;
        save();
        render();
    }

    async function renamePuzzle(p) {
        const title = await UI.prompt({ title: 'Rename puzzle', value: displayTitle(p), okLabel: 'Rename' });
        if (!title) return;
        p.title = title;
        save();
        render();
    }

    function deleteFolder(f) {
        const stats = folderStats(f.id);
        const parent = folderById(f.parentId);
        const parentName = parent ? parent.name : 'the top level';
        const ids = descendantIds(f.id);
        UI.sheet({
            title: 'Delete “' + f.name + '”?',
            subtitle: stats.total ? 'It holds ' + plural(stats.total, 'puzzle') + '.' : 'It is empty.',
            items: [
                {
                    label: stats.total ? 'Delete folder, keep puzzles' : 'Delete folder',
                    sub: stats.total ? 'Its contents move to ' + parentName : null,
                    action: () => {
                        for (const x of lib.folders) if (x.parentId === f.id) x.parentId = f.parentId || null;
                        for (const p of lib.puzzles) if (p.folderId === f.id) p.folderId = f.parentId || null;
                        lib.folders = lib.folders.filter((x) => x.id !== f.id);
                        save();
                        render();
                    },
                },
                stats.total ? {
                    label: 'Delete folder and its ' + plural(stats.total, 'puzzle'),
                    sub: 'Your progress in them is lost too',
                    danger: true,
                    action: async () => {
                        const ok = await UI.confirm({
                            title: 'Delete ' + plural(stats.total, 'puzzle') + '?',
                            message: 'This can’t be undone.',
                            okLabel: 'Delete',
                            danger: true,
                        });
                        if (!ok) return;
                        for (const p of lib.puzzles.filter((p) => p.folderId && ids.has(p.folderId))) removePuzzleFiles(p);
                        lib.puzzles = lib.puzzles.filter((p) => !(p.folderId && ids.has(p.folderId)));
                        lib.folders = lib.folders.filter((x) => !ids.has(x.id));
                        save();
                        render();
                    },
                } : null,
            ].filter(Boolean),
        });
    }

    function removePuzzleFiles(p) {
        Store.remove(Store.puzzleFile(p.id));
        Store.remove(Store.progressFile(p.id));
        Store.remove(Store.notesFile(p.id));
    }

    async function deletePuzzle(p) {
        const ok = await UI.confirm({
            title: 'Delete “' + displayTitle(p) + '”?',
            message: 'The puzzle and your progress in it will be removed from the app. The original file is not affected.',
            okLabel: 'Delete',
            danger: true,
        });
        if (!ok) return;
        removePuzzleFiles(p);
        lib.puzzles = lib.puzzles.filter((x) => x.id !== p.id);
        save();
        render();
    }

    async function resetProgress(p) {
        const hasNotes = !!Store.readNotes(p.id).trim();
        const ok = await UI.confirm({
            title: 'Reset progress?',
            message: 'All your answers in “' + displayTitle(p) + '” and its timer will be cleared' +
                (hasNotes ? ', and your notes deleted.' : '.'),
            okLabel: 'Reset',
            danger: true,
        });
        if (!ok) return;
        Store.remove(Store.progressFile(p.id));
        Store.remove(Store.notesFile(p.id));
        Object.assign(p, { status: 'new', percent: 0, elapsed: 0 });
        save();
        render();
    }

    /** Sheet for choosing a destination folder. `exclude` is a set of folder ids. */
    function chooseFolder(title, currentId, exclude, onPick) {
        const items = [{
            label: 'Puzzles (top level)',
            checked: !currentId,
            action: () => onPick(null),
        }];
        const walk = (parentId, depth) => {
            for (const f of sortFolders(lib.folders.filter((x) => (x.parentId || null) === parentId))) {
                if (exclude && exclude.has(f.id)) continue;
                items.push({ label: f.name, indent: depth, checked: f.id === currentId, action: () => onPick(f.id) });
                walk(f.id, depth + 1);
            }
        };
        walk(null, 1);
        items.push({
            label: '+ New folder…',
            action: async () => {
                const f = await createFolder(null);
                if (f) onPick(f.id);
            },
        });
        UI.sheet({ title, items });
    }

    function movePuzzle(p) {
        chooseFolder('Move “' + displayTitle(p) + '” to', p.folderId, null, (folderId) => {
            p.folderId = folderId;
            save();
            render();
            const f = folderById(folderId);
            UI.toast('Moved to ' + (f ? f.name : 'the top level'));
        });
    }

    function moveFolder(f) {
        chooseFolder('Move “' + f.name + '” to', f.parentId, descendantIds(f.id), (parentId) => {
            f.parentId = parentId;
            save();
            render();
        });
    }

    function puzzleActions(p) {
        const items = [
            { label: 'Open', action: () => callbacks.openPuzzle(p) },
            { label: 'Move to folder…', action: () => movePuzzle(p) },
            { label: 'Rename…', action: () => renamePuzzle(p) },
        ];
        if ((p.status && p.status !== 'new') || Store.readNotes(p.id).trim()) {
            items.push({ label: 'Reset progress', action: () => resetProgress(p) });
        }
        items.push({ label: 'Delete', danger: true, action: () => deletePuzzle(p) });
        UI.sheet({ title: displayTitle(p), subtitle: p.author || null, items });
    }

    function folderActions(f) {
        UI.sheet({
            title: f.name,
            items: [
                { label: 'Open', action: () => openFolder(f.id) },
                { label: 'Rename…', action: () => renameFolder(f) },
                { label: 'Move to folder…', action: () => moveFolder(f) },
                { label: 'Delete folder…', danger: true, action: () => deleteFolder(f) },
            ],
        });
    }

    function chooseSort() {
        UI.sheet({
            title: 'Sort by',
            items: Object.keys(SORTS).map((key) => ({
                label: SORTS[key],
                checked: lib.sort === key,
                action: () => {
                    // Leaving a date or title sort for size: it becomes the tie-break.
                    if (isSizeSort(key) && !isSizeSort(lib.sort)) lib.sortThen = lib.sort;
                    lib.sort = key;
                    save();
                    render();
                },
            })),
        });
    }

    // ---------- Import ----------

    /**
     * Adds files to the library. Resolves to the ids of the puzzles they
     * hold, in order, including ones that were already in the library.
     */
    async function importFiles(files) {
        const ids = [];
        let added = 0;
        let duplicates = 0;
        const failures = [];
        let lastAdded = null;
        for (const file of files) {
            const name = file.name || 'puzzle';
            if (file.error || !file.bytes) {
                failures.push(name + ': ' + (file.error || 'could not be read'));
                continue;
            }
            try {
                const id = hashBytes(file.bytes);
                if (puzzleById(id)) {
                    duplicates++;
                    ids.push(id);
                    continue;
                }
                const puzzle = await Parsers.parse(file.bytes, name);
                if (!Store.writeJSON(Store.puzzleFile(id), puzzle)) throw new Error('could not be saved');
                const entry = {
                    id,
                    title: puzzle.title,
                    author: puzzle.author,
                    format: puzzle.format,
                    fileName: name,
                    folderId: query ? null : currentFolder,
                    added: Date.now() + added, // keeps a multi-file import in pick order
                    width: puzzle.width,
                    height: puzzle.height,
                    status: 'new',
                    percent: 0,
                    elapsed: 0,
                };
                lib.puzzles.push(entry);
                ids.push(id);
                lastAdded = entry;
                added++;
            } catch (e) {
                console.warn('Import failed', name, e);
                failures.push(name + ': ' + (e && e.message ? e.message : 'unreadable'));
            }
        }
        if (added) save();
        render();

        const parts = [];
        if (added) parts.push(added === 1 ? 'Added “' + displayTitle(lastAdded) + '”' : 'Added ' + plural(added, 'puzzle'));
        if (duplicates) parts.push(duplicates === 1 ? 'that puzzle is already in your library' : plural(duplicates, 'puzzle') + ' already in your library');
        if (failures.length && !added && !duplicates && failures.length === 1) {
            UI.alert({ title: 'Couldn’t open that file', message: failures[0] });
        } else if (failures.length) {
            UI.alert({
                title: plural(failures.length, 'file') + ' couldn’t be opened',
                message: (parts.length ? parts.join('; ') + '.\n\n' : '') + failures.join('\n'),
            });
        } else if (parts.length) {
            const msg = parts.join('; ');
            UI.toast(msg.charAt(0).toUpperCase() + msg.slice(1));
        }
        return ids;
    }

    // ---------- Events ----------

    // Long-press a puzzle or folder for its menu.
    let pressTimer = null;
    let pressStart = null;
    let longPressed = false;

    E.list.addEventListener('pointerdown', (e) => {
        const row = e.target.closest('.lib-row');
        if (!row || e.target.closest('.lib-more')) return;
        longPressed = false;
        pressStart = { x: e.clientX, y: e.clientY };
        clearTimeout(pressTimer);
        row.classList.add('pressing');
        pressTimer = setTimeout(() => {
            longPressed = true;
            swallowNextClick = true;
            row.classList.remove('pressing');
            showRowActions(row);
        }, 520);
    });

    // Lifting the finger after a long-press can produce a click on whatever
    // is under it, which by then is the menu's backdrop, closing the menu at
    // once. That one click is dropped.
    let swallowNextClick = false;
    document.addEventListener('click', (e) => {
        if (!swallowNextClick) return;
        swallowNextClick = false;
        e.stopPropagation();
        e.preventDefault();
    }, true);
    // That click comes straight after the finger lifts; a deliberate tap on
    // the menu comes much later and must not be lost.
    document.addEventListener('pointerup', () => {
        if (swallowNextClick) setTimeout(() => { swallowNextClick = false; }, 50);
    }, true);

    function cancelPress() {
        clearTimeout(pressTimer);
        pressTimer = null;
        for (const r of E.list.querySelectorAll('.pressing')) r.classList.remove('pressing');
    }

    E.list.addEventListener('pointermove', (e) => {
        if (pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10) cancelPress();
    });
    E.list.addEventListener('pointerup', cancelPress);
    E.list.addEventListener('pointercancel', cancelPress);
    E.list.addEventListener('scroll', cancelPress, { passive: true });
    E.list.addEventListener('contextmenu', (e) => e.preventDefault());

    function showRowActions(row) {
        if (row.dataset.puzzle) {
            const p = puzzleById(row.dataset.puzzle);
            if (p) puzzleActions(p);
        } else if (row.dataset.folder) {
            const f = folderById(row.dataset.folder);
            if (f) folderActions(f);
        }
    }

    E.list.addEventListener('click', (e) => {
        const row = e.target.closest('.lib-row');
        if (!row) return;
        if (longPressed) {
            longPressed = false;
            return;
        }
        if (e.target.closest('.lib-more')) {
            showRowActions(row);
            return;
        }
        if (row.dataset.folder) {
            openFolder(row.dataset.folder);
        } else if (row.dataset.puzzle) {
            const p = puzzleById(row.dataset.puzzle);
            if (p) callbacks.openPuzzle(p);
        }
    });

    E.back.addEventListener('click', goUp);
    E.sort.addEventListener('click', chooseSort);
    E.newFolder.addEventListener('click', () => createFolder(query ? null : currentFolder));
    E.add.addEventListener('click', () => callbacks.pickFiles());

    E.searchBtn.addEventListener('click', openSearch);
    E.searchClose.addEventListener('click', closeSearch);

    E.search.addEventListener('input', () => {
        query = E.search.value;
        render();
        E.list.scrollTop = 0;
    });
    E.search.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') E.search.blur();
    });
    E.searchClear.addEventListener('click', () => {
        E.search.value = '';
        query = '';
        render();
        E.search.focus();
    });

    // ---------- Public API ----------

    global.Library = {
        init(cb) {
            callbacks = cb;
            load();
            render();
        },
        render,
        importFiles,
        puzzleById,
        displayTitle,

        /**
         * Called whenever the solver saves (every second while the clock runs).
         * The library file is rewritten only when the status or percentage
         * changes; the time is written by flush().
         */
        updateProgress(id, summary) {
            const p = puzzleById(id);
            if (!p) return;
            const changed = p.status !== summary.status || p.percent !== summary.percent;
            Object.assign(p, summary);
            dirty = true;
            if (changed) save();
        },

        /** Writes any unsaved progress summaries. */
        flush() {
            if (dirty) save();
        },

        handleBack() {
            if (searching) {
                closeSearch();
                return true;
            }
            if (currentFolder) {
                goUp();
                return true;
            }
            return false;
        },
    };
})(window);
