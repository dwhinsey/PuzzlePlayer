/*
 * Reads .puz (Across Lite), .ipuz and .jpz (Crossword Compiler) files into one
 * shape the solver understands:
 *
 *   {
 *     title, author, copyright, notes,        plain text
 *     width, height,
 *     cells: [{ block, void, solution, number, circle, shade, given }]  row-major
 *     clues: { across: [{ num, html, cells: [index...] }], down: [...] },
 *     hasSolution                             false for scrambled .puz files
 *   }
 *
 * Clue text is kept as a small, sanitised HTML string so italics survive.
 */
(function (global) {
    'use strict';

    // ---------- Text helpers ----------

    const INLINE_TAGS = new Set(['b', 'i', 'em', 'strong', 'u', 's', 'sub', 'sup']);

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Keeps text and a handful of inline formatting tags; drops everything else.
    function serializeNodes(nodes) {
        let out = '';
        for (const n of nodes) {
            if (n.nodeType === 3 || n.nodeType === 4) {
                out += escapeHtml(n.nodeValue);
            } else if (n.nodeType === 1) {
                const tag = (n.localName || '').toLowerCase();
                const inner = serializeNodes(n.childNodes);
                if (tag === 'br') out += ' ';
                else if (INLINE_TAGS.has(tag)) out += '<' + tag + '>' + inner + '</' + tag + '>';
                else out += inner;
            }
        }
        return out;
    }

    function sanitizeHtml(html) {
        const s = String(html == null ? '' : html);
        if (!/[<&]/.test(s)) return escapeHtml(s);
        const doc = new DOMParser().parseFromString('<div>' + s + '</div>', 'text/html');
        return serializeNodes(doc.body.firstChild ? doc.body.firstChild.childNodes : []).trim();
    }

    function htmlToText(html) {
        const s = String(html == null ? '' : html);
        if (!/[<&]/.test(s)) return s.trim();
        const doc = new DOMParser().parseFromString('<div>' + s + '</div>', 'text/html');
        return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function latin1(bytes) {
        let s = '';
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return s;
    }

    function decodeText(bytes) {
        // XML may declare its own encoding; JSON is UTF-8.
        const head = latin1(bytes.subarray(0, Math.min(bytes.length, 300)));
        let encoding = 'utf-8';
        const m = /^\s*<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(head);
        if (m) encoding = m[1].toLowerCase();
        let text;
        try {
            text = new TextDecoder(encoding).decode(bytes);
        } catch (e) {
            text = new TextDecoder('utf-8').decode(bytes);
        }
        return text.replace(/^﻿/, '');
    }

    function normalizeSolution(v) {
        if (v == null) return null;
        const s = String(v).trim().toUpperCase();
        return s === '' ? null : s;
    }

    // Opaque colours would hide the selection highlight under the shading
    // (which is drawn as an inset shadow), so shading is made translucent.
    function translucent(color) {
        if (!color) return null;
        let c = String(color).trim();
        if (/^[0-9a-f]{6}$/i.test(c) || /^[0-9a-f]{3}$/i.test(c)) c = '#' + c;
        let m = /^#([0-9a-f]{3})$/i.exec(c);
        if (m) c = '#' + m[1].split('').map((x) => x + x).join('');
        m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
        if (m) {
            const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
            if (r > 245 && g > 245 && b > 245) return null; // white: no shading
            return 'rgba(' + r + ',' + g + ',' + b + ',0.45)';
        }
        return c;
    }

    function blankCell() {
        return { block: false, void: false, solution: null, number: null, circle: false, shade: null, given: null };
    }

    // ---------- Grid geometry shared by the formats ----------

    function isOpen(p, r, c) {
        if (r < 0 || c < 0 || r >= p.height || c >= p.width) return false;
        const cell = p.cells[r * p.width + c];
        return !cell.block && !cell.void;
    }

    // Standard crossword numbering: a square starts an entry when the square
    // before it is a block or the edge and the square after it is open.
    function standardNumbering(p) {
        const starts = [];
        let n = 0;
        for (let r = 0; r < p.height; r++) {
            for (let c = 0; c < p.width; c++) {
                if (!isOpen(p, r, c)) continue;
                const across = !isOpen(p, r, c - 1) && isOpen(p, r, c + 1);
                const down = !isOpen(p, r - 1, c) && isOpen(p, r + 1, c);
                if (across || down) {
                    n++;
                    starts.push({ index: r * p.width + c, number: n, across, down });
                }
            }
        }
        return starts;
    }

    function runFrom(p, index, dir) {
        const cells = [];
        let r = Math.floor(index / p.width);
        let c = index % p.width;
        while (isOpen(p, r, c)) {
            cells.push(r * p.width + c);
            if (dir === 'across') c++;
            else r++;
        }
        return cells;
    }

    // Fills in clue.cells for clues that only have a number, by finding the
    // square with that label and running across or down from it.
    function resolveClueCells(p) {
        const byLabel = new Map();
        p.cells.forEach((cell, i) => {
            if (cell.number != null && !byLabel.has(String(cell.number))) byLabel.set(String(cell.number), i);
        });
        for (const dir of ['across', 'down']) {
            p.clues[dir] = p.clues[dir].filter((clue) => {
                if (!clue.cells || !clue.cells.length) {
                    const start = byLabel.get(String(clue.num));
                    clue.cells = start == null ? [] : runFrom(p, start, dir);
                }
                return clue.cells.length > 0;
            });
        }
    }

    function finish(p) {
        p.title = (p.title || '').trim();
        p.author = (p.author || '').trim().replace(/^by\s+/i, '');
        p.copyright = (p.copyright || '').trim();
        p.notes = (p.notes || '').trim();
        resolveClueCells(p);
        p.hasSolution = p.hasSolution !== false &&
            p.cells.every((c) => c.block || c.void || c.solution);
        if (!p.clues.across.length && !p.clues.down.length) {
            throw new Error('No clues found in this file');
        }
        return p;
    }

    // ---------- .puz ----------

    const PUZ_MAGIC = 'ACROSS&DOWN\0';

    function findPuzMagic(bytes) {
        const limit = Math.min(bytes.length - PUZ_MAGIC.length, 4096);
        outer: for (let i = 0; i <= limit; i++) {
            for (let j = 0; j < PUZ_MAGIC.length; j++) {
                if (bytes[i + j] !== PUZ_MAGIC.charCodeAt(j)) continue outer;
            }
            return i;
        }
        return -1;
    }

    function parsePuz(bytes) {
        const magicAt = findPuzMagic(bytes);
        if (magicAt < 2) throw new Error('Not a valid .puz file');
        const base = magicAt - 2;
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

        const version = latin1(bytes.subarray(base + 0x18, base + 0x1c)).replace(/\0.*$/, '');
        const width = bytes[base + 0x2c];
        const height = bytes[base + 0x2d];
        const numClues = dv.getUint16(base + 0x2e, true);
        const scrambled = dv.getUint16(base + 0x32, true) !== 0;
        const size = width * height;
        if (!width || !height || base + 0x34 + size * 2 > bytes.length) {
            throw new Error('This .puz file is damaged');
        }

        let pos = base + 0x34;
        const solution = bytes.subarray(pos, pos + size);
        pos += size * 2; // skip the saved fill as well

        const decoder = new TextDecoder(parseFloat(version) >= 2 ? 'utf-8' : 'windows-1252');
        function readString() {
            let end = pos;
            while (end < bytes.length && bytes[end] !== 0) end++;
            const s = decoder.decode(bytes.subarray(pos, end));
            pos = Math.min(end + 1, bytes.length);
            return s;
        }

        const title = readString();
        const author = readString();
        const copyright = readString();
        const clueTexts = [];
        for (let i = 0; i < numClues; i++) clueTexts.push(readString());
        const notes = readString();

        // Extra sections: rebus squares, circles.
        const extras = {};
        while (pos + 8 <= bytes.length) {
            const name = latin1(bytes.subarray(pos, pos + 4));
            const len = dv.getUint16(pos + 4, true);
            if (!/^[A-Z]{4}$/.test(name) || pos + 8 + len > bytes.length) break;
            extras[name] = bytes.subarray(pos + 8, pos + 8 + len);
            pos += 8 + len + 1;
        }

        const rebusTable = {};
        if (extras.RTBL) {
            for (const part of latin1(extras.RTBL).split(';')) {
                const m = /^\s*(\d+)\s*:(.*)$/.exec(part);
                if (m) rebusTable[parseInt(m[1], 10)] = m[2].trim();
            }
        }

        const p = { title, author, copyright, notes, width, height, cells: [], clues: { across: [], down: [] } };
        for (let i = 0; i < size; i++) {
            const cell = blankCell();
            const ch = String.fromCharCode(solution[i]);
            if (ch === '.' || ch === ':') {
                cell.block = true;
            } else {
                cell.solution = normalizeSolution(ch);
                if (extras.GRBS && extras.GRBS[i]) {
                    const rebus = rebusTable[extras.GRBS[i] - 1];
                    if (rebus) cell.solution = normalizeSolution(rebus);
                }
            }
            if (extras.GEXT && extras.GEXT[i] & 0x80) cell.circle = true;
            p.cells.push(cell);
        }

        // Clues are stored in order: for each numbered square, across then down.
        let k = 0;
        for (const start of standardNumbering(p)) {
            p.cells[start.index].number = start.number;
            if (start.across) {
                p.clues.across.push({ num: start.number, html: escapeHtml(clueTexts[k++] || ''), cells: runFrom(p, start.index, 'across') });
            }
            if (start.down) {
                p.clues.down.push({ num: start.number, html: escapeHtml(clueTexts[k++] || ''), cells: runFrom(p, start.index, 'down') });
            }
        }

        if (scrambled) p.hasSolution = false;
        return finish(p);
    }

    // ---------- .ipuz ----------

    function parseIpuz(text) {
        let t = text.trim();
        const wrapped = /^ipuz\s*\(([\s\S]*)\)\s*;?\s*$/.exec(t);
        if (wrapped) t = wrapped[1];
        let j;
        try {
            j = JSON.parse(t);
        } catch (e) {
            throw new Error('This .ipuz file is not valid JSON');
        }
        if (!j || !j.dimensions || !Array.isArray(j.puzzle)) throw new Error('Not an ipuz crossword');

        const width = parseInt(j.dimensions.width, 10);
        const height = parseInt(j.dimensions.height, 10);
        const BLOCK = j.block != null ? String(j.block) : '#';
        const EMPTY = j.empty != null ? String(j.empty) : '0';
        const styles = j.styles || {};

        const p = {
            title: htmlToText(j.title),
            author: htmlToText(j.author),
            copyright: htmlToText(j.copyright),
            notes: htmlToText(j.notes || j.intro || j.explanation || ''),
            width, height, cells: [], clues: { across: [], down: [] },
        };

        for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
                const cell = blankCell();
                const raw = (j.puzzle[r] || [])[c];
                let label = raw;
                let style = null;
                if (raw && typeof raw === 'object') {
                    label = raw.cell;
                    style = raw.style;
                    if (raw.value != null && String(raw.value) !== BLOCK) cell.given = normalizeSolution(raw.value);
                }
                if (typeof style === 'string') style = styles[style] || null;

                if (raw === null || raw === undefined) {
                    cell.void = true;
                } else if (label != null && String(label) === BLOCK) {
                    cell.block = true;
                } else if (label != null && String(label) !== EMPTY && String(label) !== '' && String(label) !== 'null') {
                    cell.number = String(label);
                }

                if (style) {
                    if (style.shapebg === 'circle') cell.circle = true;
                    if (style.color) cell.shade = translucent(style.color);
                    else if (style.highlight) cell.shade = 'rgba(0,0,0,0.15)';
                }

                if (!cell.block && !cell.void && Array.isArray(j.solution)) {
                    let s = (j.solution[r] || [])[c];
                    if (s && typeof s === 'object') s = s.value != null ? s.value : s.cell;
                    if (s != null && String(s) !== BLOCK) cell.solution = normalizeSolution(s);
                }
                if (cell.given && !cell.solution) cell.solution = cell.given;
                p.cells.push(cell);
            }
        }

        const toIndex = (pt) => {
            if (!Array.isArray(pt) || pt.length < 2) return -1;
            const x = parseInt(pt[0], 10) - 1;
            const y = parseInt(pt[1], 10) - 1;
            return x >= 0 && y >= 0 && x < width && y < height ? y * width + x : -1;
        };

        for (const key of Object.keys(j.clues || {})) {
            const dir = key.split(':')[0].trim().toLowerCase();
            if (dir !== 'across' && dir !== 'down') continue;
            for (const entry of j.clues[key] || []) {
                let num, html, cells = null;
                if (Array.isArray(entry)) {
                    num = entry[0];
                    html = entry[1];
                } else if (entry && typeof entry === 'object') {
                    num = entry.number != null ? entry.number : entry.label;
                    html = entry.clue;
                    if (Array.isArray(entry.cells)) cells = entry.cells.map(toIndex).filter((i) => i >= 0);
                } else if (typeof entry === 'string') {
                    const m = /^\s*(\d+)\s*[.:)-]?\s*(.*)$/.exec(entry);
                    if (!m) continue;
                    num = m[1];
                    html = m[2];
                } else {
                    continue;
                }
                if (Array.isArray(num)) num = num[0];
                p.clues[dir].push({ num: String(num), html: sanitizeHtml(html), cells });
            }
        }

        return finish(p);
    }

    // ---------- .jpz ----------

    function els(root, name) {
        return Array.from(root.getElementsByTagNameNS('*', name));
    }

    function firstEl(root, name) {
        return root.getElementsByTagNameNS('*', name)[0] || null;
    }

    function expandRange(spec) {
        const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(String(spec || ''));
        if (!m) return [];
        const a = parseInt(m[1], 10);
        const b = m[2] != null ? parseInt(m[2], 10) : a;
        const out = [];
        if (a <= b) for (let i = a; i <= b; i++) out.push(i);
        else for (let i = a; i >= b; i--) out.push(i);
        return out;
    }

    function parseJpz(text) {
        const doc = new DOMParser().parseFromString(text, 'application/xml');
        if (doc.getElementsByTagName('parsererror').length) throw new Error('This .jpz file is not valid XML');
        const grid = firstEl(doc, 'grid');
        if (!grid) throw new Error('No crossword grid found in this .jpz file');

        const width = parseInt(grid.getAttribute('width'), 10);
        const height = parseInt(grid.getAttribute('height'), 10);
        if (!width || !height) throw new Error('This .jpz file has no grid size');

        const meta = firstEl(doc, 'metadata');
        const metaText = (name) => {
            const e = meta && firstEl(meta, name);
            return e ? htmlToText(serializeNodes(e.childNodes)) : '';
        };
        const p = {
            title: metaText('title'),
            author: metaText('creator'),
            copyright: metaText('copyright'),
            notes: metaText('description'),
            width, height, cells: [], clues: { across: [], down: [] },
        };
        const instructions = firstEl(doc, 'instructions');
        if (!p.notes && instructions) p.notes = htmlToText(serializeNodes(instructions.childNodes));

        for (let i = 0; i < width * height; i++) p.cells.push(blankCell());

        for (const e of els(grid, 'cell')) {
            const x = parseInt(e.getAttribute('x'), 10) - 1;
            const y = parseInt(e.getAttribute('y'), 10) - 1;
            if (!(x >= 0 && y >= 0 && x < width && y < height)) continue;
            const cell = p.cells[y * width + x];
            const type = (e.getAttribute('type') || '').toLowerCase();
            if (type === 'block') cell.block = true;
            else if (type === 'void') cell.void = true;
            else {
                cell.solution = normalizeSolution(e.getAttribute('solution'));
                const num = e.getAttribute('number');
                if (num) cell.number = num;
                if ((e.getAttribute('background-shape') || '').toLowerCase() === 'circle') cell.circle = true;
                const bg = e.getAttribute('background-color');
                if (bg) cell.shade = translucent(bg);
                if (e.getAttribute('hint') === 'true' && cell.solution) cell.given = cell.solution;
            }
        }

        // Words: either x/y ranges on the word itself, or child <cells>.
        const words = new Map();
        for (const w of els(doc, 'word')) {
            const id = w.getAttribute('id');
            const cells = [];
            const add = (xs, ys) => {
                const X = expandRange(xs), Y = expandRange(ys);
                if (X.length > 1) for (const x of X) cells.push((Y[0] - 1) * width + (x - 1));
                else for (const y of Y) cells.push((y - 1) * width + (X[0] - 1));
            };
            if (w.getAttribute('x') && w.getAttribute('y')) add(w.getAttribute('x'), w.getAttribute('y'));
            for (const c of els(w, 'cells')) add(c.getAttribute('x'), c.getAttribute('y'));
            words.set(id, cells.filter((i) => i >= 0 && i < width * height));
        }

        const clueLists = els(doc, 'clues');
        clueLists.forEach((list, n) => {
            const titleEl = firstEl(list, 'title');
            const heading = titleEl ? (titleEl.textContent || '').toLowerCase() : '';
            let dir = heading.includes('down') ? 'down' : heading.includes('across') ? 'across' : null;
            if (!dir) dir = n === 0 ? 'across' : n === 1 ? 'down' : null;
            if (!dir) return;
            for (const c of els(list, 'clue')) {
                const cells = words.get(c.getAttribute('word')) || [];
                let num = c.getAttribute('number');
                if (!num && cells.length) num = p.cells[cells[0]].number;
                p.clues[dir].push({ num: String(num || ''), html: serializeNodes(c.childNodes).trim(), cells: cells.slice() });
            }
        });

        return finish(p);
    }

    // ---------- Zip (compressed .jpz) ----------

    async function inflateRaw(data) {
        if (typeof DecompressionStream === 'undefined') {
            throw new Error('This compressed file needs a newer Android System WebView');
        }
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    async function unzipFirstFile(bytes) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let eocd = -1;
        for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
            if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('This zip file is damaged');
        const count = dv.getUint16(eocd + 10, true);
        let p = dv.getUint32(eocd + 16, true);
        const entries = [];
        for (let i = 0; i < count && p + 46 <= bytes.length; i++) {
            if (dv.getUint32(p, true) !== 0x02014b50) break;
            const method = dv.getUint16(p + 10, true);
            const compSize = dv.getUint32(p + 20, true);
            const nameLen = dv.getUint16(p + 28, true);
            const extraLen = dv.getUint16(p + 30, true);
            const commentLen = dv.getUint16(p + 32, true);
            const localOffset = dv.getUint32(p + 42, true);
            const name = latin1(bytes.subarray(p + 46, p + 46 + nameLen));
            entries.push({ method, compSize, localOffset, name });
            p += 46 + nameLen + extraLen + commentLen;
        }
        const files = entries.filter((e) => !e.name.endsWith('/') && !/(^|\/)(__MACOSX|\.)/.test(e.name));
        const entry = files.find((e) => /\.(jpz|xml|puz|ipuz)$/i.test(e.name)) || files[0];
        if (!entry) throw new Error('This zip file is empty');
        const lo = entry.localOffset;
        const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
        const data = bytes.subarray(start, start + entry.compSize);
        if (entry.method === 0) return data;
        if (entry.method === 8) return inflateRaw(data);
        throw new Error('Unsupported compression in this zip file');
    }

    // ---------- Entry point ----------

    function startsWith(bytes, s) {
        if (bytes.length < s.length) return false;
        for (let i = 0; i < s.length; i++) if (bytes[i] !== s.charCodeAt(i)) return false;
        return true;
    }

    async function parse(bytes, fileName, depth) {
        depth = depth || 0;
        const ext = (/\.([a-z0-9]+)$/i.exec(fileName || '') || [])[1];
        const lower = (ext || '').toLowerCase();

        if (startsWith(bytes, 'PK\x03\x04') && depth < 2) {
            const inner = await unzipFirstFile(bytes);
            return parse(inner, lower === 'jpz' ? 'inner.jpz' : 'inner', depth + 1);
        }
        if (findPuzMagic(bytes) >= 2) {
            return Object.assign(parsePuz(bytes), { format: 'puz' });
        }
        const text = decodeText(bytes);
        const lead = text.trimStart();
        if (lead.startsWith('{') || /^ipuz\s*\(/.test(lead)) {
            return Object.assign(parseIpuz(text), { format: 'ipuz' });
        }
        if (lead.startsWith('<')) {
            return Object.assign(parseJpz(text), { format: 'jpz' });
        }
        if (lower === 'puz') throw new Error('This doesn\u2019t look like a .puz crossword');
        throw new Error('Not a .puz, .ipuz or .jpz crossword');
    }

    global.Parsers = { parse, sanitizeHtml, htmlToText, escapeHtml };
})(window);
