/*
 * Durable storage. In the app this is window.AndroidBridge, which keeps small
 * files in the app's private storage. Opened in an ordinary browser (handy for
 * development) it falls back to localStorage.
 */
(function (global) {
    'use strict';

    const bridge = global.AndroidBridge || null;
    const PREFIX = 'puzplayer:';

    function readRaw(name) {
        if (bridge) return bridge.read(name);
        try {
            return global.localStorage.getItem(PREFIX + name);
        } catch (e) {
            return null;
        }
    }

    function writeRaw(name, text) {
        if (bridge) return bridge.write(name, text);
        try {
            global.localStorage.setItem(PREFIX + name, text);
            return true;
        } catch (e) {
            return false;
        }
    }

    const Store = {
        isNative: !!bridge,

        readJSON(name) {
            const text = readRaw(name);
            if (text == null || text === '') return null;
            try {
                return JSON.parse(text);
            } catch (e) {
                console.warn('Unreadable stored file', name, e);
                return null;
            }
        },

        writeJSON(name, value) {
            const ok = writeRaw(name, JSON.stringify(value));
            if (!ok) console.warn('Could not save', name);
            return ok;
        },

        remove(name) {
            if (bridge) return bridge.remove(name);
            try {
                global.localStorage.removeItem(PREFIX + name);
            } catch (e) { /* ignore */ }
            return true;
        },

        puzzleFile: (id) => 'puzzle-' + id + '.json',
        progressFile: (id) => 'progress-' + id + '.json',
        notesFile: (id) => 'notes-' + id + '.json',

        /** The solver's free-text notes for a puzzle ('' if none). */
        readNotes(id) {
            const data = Store.readJSON(Store.notesFile(id));
            return data && typeof data.text === 'string' ? data.text : '';
        },

        writeNotes(id, text) {
            if (text.trim()) Store.writeJSON(Store.notesFile(id), { text, updated: Date.now() });
            else Store.remove(Store.notesFile(id));
        },
    };

    global.Store = Store;
})(window);
