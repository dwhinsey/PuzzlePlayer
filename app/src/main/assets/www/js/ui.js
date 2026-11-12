/*
 * Small shared widgets: bottom action sheets, prompt/confirm dialogs, toasts.
 */
(function (global) {
    'use strict';

    const backdrop = document.querySelector('.sheet-backdrop');
    const toastEl = document.querySelector('.toast');
    const stack = []; // open dialogs, topmost last: { el, cancel }
    let toastTimer = null;

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    function open(dialogEl, cancel) {
        document.body.appendChild(dialogEl);
        const entry = { el: dialogEl, cancel };
        stack.push(entry);
        backdrop.hidden = false;
        requestAnimationFrame(() => {
            backdrop.classList.add('show');
            dialogEl.classList.add('show');
        });
        return entry;
    }

    function close(entry) {
        const i = stack.indexOf(entry);
        if (i < 0) return;
        stack.splice(i, 1);
        entry.el.remove();
        if (!stack.length) {
            backdrop.classList.remove('show');
            backdrop.hidden = true;
        }
    }

    backdrop.addEventListener('click', () => {
        const top = stack[stack.length - 1];
        if (top) top.cancel();
    });

    const UI = {
        /** Closes the topmost dialog, if any. Returns whether one was open. */
        closeTop() {
            const top = stack[stack.length - 1];
            if (!top) return false;
            top.cancel();
            return true;
        },

        isOpen: () => stack.length > 0,

        /**
         * Bottom sheet of choices.
         * items: [{ label, sub?, checked?, danger?, disabled?, action }],
         *        or { section } for a group heading
         */
        /**
         * A bottom sheet of items. `items` is an array, or a function that
         * returns one: then an item with `keepOpen` (a setting) runs its
         * action and the list is rebuilt in place, so its tick updates and
         * the sheet stays open. Other items close the sheet first.
         * `closeLabel` names the bottom button (default "Cancel").
         */
        sheet({ title, subtitle, items, closeLabel }) {
            const sheet = el('div', 'sheet');
            sheet.setAttribute('role', 'dialog');
            if (title) {
                const head = el('div', 'sheet-head');
                head.appendChild(el('div', 'sheet-title', title));
                if (subtitle) head.appendChild(el('div', 'sheet-subtitle', subtitle));
                sheet.appendChild(head);
            }
            const list = el('div', 'sheet-items');
            let entry;
            const render = () => {
                const scroll = list.scrollTop;
                list.replaceChildren();
                for (const item of (typeof items === 'function' ? items() : items)) {
                    if (item.section) {
                        list.appendChild(el('div', 'sheet-section', item.section));
                        continue;
                    }
                    const b = el('button', 'sheet-item' + (item.danger ? ' danger' : '') + (item.checked ? ' checked' : ''));
                    b.type = 'button';
                    b.disabled = !!item.disabled;
                    if (item.indent) b.style.paddingLeft = (20 + item.indent * 18) + 'px';
                    const label = el('span', 'sheet-item-label', item.label);
                    b.appendChild(label);
                    if (item.sub) b.appendChild(el('span', 'sheet-item-sub', item.sub));
                    if (item.checked) b.appendChild(el('span', 'sheet-item-check', '✓'));
                    b.addEventListener('click', () => {
                        if (item.keepOpen && typeof items === 'function') {
                            if (item.action) item.action();
                            render();
                            return;
                        }
                        close(entry);
                        if (item.action) item.action();
                    });
                    list.appendChild(b);
                }
                list.scrollTop = scroll;
            };
            render();
            sheet.appendChild(list);
            const cancel = el('button', 'sheet-item sheet-cancel', closeLabel || 'Cancel');
            cancel.type = 'button';
            cancel.addEventListener('click', () => close(entry));
            sheet.appendChild(cancel);
            entry = open(sheet, () => close(entry));
        },

        /** Resolves to the entered text, or null if cancelled. */
        prompt({ title, value, placeholder, okLabel }) {
            return new Promise((resolve) => {
                const dlg = el('div', 'dialog');
                dlg.setAttribute('role', 'dialog');
                dlg.appendChild(el('div', 'dialog-title', title));
                const form = el('form', 'dialog-form');
                const input = el('input', 'dialog-input');
                input.type = 'text';
                input.value = value || '';
                input.placeholder = placeholder || '';
                input.autocomplete = 'off';
                input.setAttribute('autocapitalize', 'words');
                form.appendChild(input);
                const actions = el('div', 'dialog-actions');
                const cancelBtn = el('button', 'dialog-btn', 'Cancel');
                cancelBtn.type = 'button';
                const okBtn = el('button', 'dialog-btn primary', okLabel || 'OK');
                okBtn.type = 'submit';
                actions.append(cancelBtn, okBtn);
                form.appendChild(actions);
                dlg.appendChild(form);

                let entry;
                const done = (result) => {
                    input.blur();
                    close(entry);
                    resolve(result);
                };
                const update = () => { okBtn.disabled = !input.value.trim(); };
                input.addEventListener('input', update);
                update();
                cancelBtn.addEventListener('click', () => done(null));
                form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    if (input.value.trim()) done(input.value.trim());
                });
                entry = open(dlg, () => done(null));
                setTimeout(() => {
                    input.focus();
                    input.select();
                }, 60);
            });
        },

        /**
         * A dialog with a large text box. onInput gets the text as it is
         * typed; resolves with the final text when the dialog closes.
         * centreY and height (px) fix its position and size.
         */
        notes({ title, value, placeholder, onInput, centreY, height }) {
            return new Promise((resolve) => {
                const dlg = el('div', 'dialog notes-dialog');
                dlg.setAttribute('role', 'dialog');
                // A fixed place and size, so the phone's keyboard coming up
                // doesn't move it (otherwise it centres in the space left).
                if (centreY != null && height) {
                    dlg.classList.add('placed');
                    dlg.style.top = Math.round(centreY) + 'px';
                    dlg.style.height = Math.round(height) + 'px';
                }
                dlg.appendChild(el('div', 'dialog-title', title));
                const area = el('textarea', 'notes-text');
                area.value = value || '';
                area.placeholder = placeholder || '';
                area.setAttribute('autocapitalize', 'sentences');
                dlg.appendChild(area);
                const actions = el('div', 'dialog-actions');
                const done = el('button', 'dialog-btn primary', 'Done');
                done.type = 'button';
                actions.appendChild(done);
                dlg.appendChild(actions);
                let entry;
                const finish = () => {
                    area.blur();
                    close(entry);
                    resolve(area.value);
                };
                area.addEventListener('input', () => onInput && onInput(area.value));
                done.addEventListener('click', finish);
                entry = open(dlg, finish);
                // Ready to type, at the end of what's there.
                setTimeout(() => {
                    area.focus();
                    area.setSelectionRange(area.value.length, area.value.length);
                    area.scrollTop = area.scrollHeight;
                }, 60);
            });
        },

        /** A message with a single OK button. */
        alert({ title, message }) {
            return UI.confirm({ title, message, okLabel: 'OK', alertOnly: true });
        },

        /** Resolves to true if confirmed. */
        confirm({ title, message, okLabel, danger, alertOnly }) {
            return new Promise((resolve) => {
                const dlg = el('div', 'dialog');
                dlg.setAttribute('role', 'alertdialog');
                dlg.appendChild(el('div', 'dialog-title', title));
                if (message) dlg.appendChild(el('p', 'dialog-message', message));
                const actions = el('div', 'dialog-actions');
                const cancelBtn = el('button', 'dialog-btn', 'Cancel');
                cancelBtn.type = 'button';
                const okBtn = el('button', 'dialog-btn ' + (danger ? 'danger' : 'primary'), okLabel || 'OK');
                okBtn.type = 'button';
                if (alertOnly) actions.append(okBtn);
                else actions.append(cancelBtn, okBtn);
                dlg.appendChild(actions);
                let entry;
                const done = (result) => {
                    close(entry);
                    resolve(result);
                };
                cancelBtn.addEventListener('click', () => done(false));
                okBtn.addEventListener('click', () => done(true));
                entry = open(dlg, () => done(false));
            });
        },

        toast(message, ms) {
            toastEl.textContent = message;
            // In the solver, sit just above the clue bar, clear of the timer
            // row and the keyboard.
            const clueBar = document.body.classList.contains('solving')
                ? document.querySelector('.solver-host > .mobile-clue-bar') : null;
            toastEl.style.bottom = clueBar ? (window.innerHeight - clueBar.getBoundingClientRect().top + 12) + 'px' : '';
            toastEl.hidden = false;
            requestAnimationFrame(() => toastEl.classList.add('show'));
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => {
                toastEl.classList.remove('show');
                toastTimer = setTimeout(() => { toastEl.hidden = true; }, 250);
            }, ms || 2600);
        },

        el,
    };

    global.UI = UI;
})(window);
