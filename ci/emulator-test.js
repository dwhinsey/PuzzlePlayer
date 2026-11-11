// Drives the app's WebView on the emulator over Chrome DevTools.
// phase1: import puzzles, solve part of one, go back to the library.
// phase2: after the app was killed and relaunched, check everything is still there.
const { _android } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const phase = process.argv[2];
const OUT = 'emulator-output';

function fail(msg) {
    console.error('FAIL: ' + msg);
    process.exit(1);
}

async function shot(page, name) {
    // Saved for the emulator-output artifact.
    fs.writeFileSync(path.join(OUT, name + '.png'), await page.screenshot());
}

(async () => {
    // Playwright's Android support finds the app's WebView through adb.
    const [device] = await _android.devices({ omitDriverInstall: true });
    if (!device) fail('no Android device');
    const webview = await device.webView({ pkg: 'com.hinseypuzzles.puzzleplayer' }, { timeout: 30000 });
    const page = await webview.page();
    if (!page) fail('no WebView page');
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => console.log('console.' + m.type() + ': ' + m.text()));
    await page.waitForFunction(() => window.App && window.Library, null, { timeout: 15000 });
    console.log('viewport', JSON.stringify(await page.evaluate(() => ({
        w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
        insets: getComputedStyle(document.documentElement).getPropertyValue('--inset-top') + ' / ' +
            getComputedStyle(document.documentElement).getPropertyValue('--inset-bottom'),
        ua: navigator.userAgent,
    }))));

    const key = (k) => page.locator('.mobile-keyboard .kb-key', { hasText: new RegExp('^' + k + '$') }).click();

    if (phase === 'phase1') {
        await shot(page, 'library-empty');
        const files = ['tiny.ipuz', 'big-sample.puz'].map((f) => ({
            name: f,
            data: fs.readFileSync(path.join(__dirname, 'fixtures', f)).toString('base64'),
        }));
        await page.evaluate((json) => App.onFilesPicked(json), JSON.stringify(files));
        await page.waitForTimeout(800);
        const titles = await page.locator('.lib-row-title').allInnerTexts();
        console.log('library:', titles);
        if (titles.length !== 2) fail('expected 2 puzzles, got ' + titles.length);
        await shot(page, 'library');

        await page.locator('.lib-row', { hasText: 'Big Grid' }).click();
        await page.waitForTimeout(800);
        await shot(page, 'start-card');
        await page.locator('.solver-overlay:not([hidden]) .overlay-start-btn').click();
        for (const k of 'HELLO') await key(k);
        await page.waitForTimeout(1000);

        // Real taps on the screen, through Android's own touch input.
        const filled = async () => (await page.locator('.solver-grid .cell-letter').allInnerTexts()).filter(Boolean).length;
        const before = await filled();
        const dpr = await page.evaluate(() => devicePixelRatio);
        await page.evaluate(() => {
            window.__touchLog = [];
            for (const t of ['pointerdown', 'pointerup', 'pointercancel']) {
                document.addEventListener(t, (e) => __touchLog.push(t + '@' + Math.round(e.clientX) + ',' + Math.round(e.clientY) +
                    ':' + ((e.target.closest && e.target.closest('.kb-key')) ? e.target.closest('.kb-key').textContent.trim() : e.target.className)), true);
            }
        });
        for (const k of 'WORLD') {
            const bb = await page.locator('.mobile-keyboard .kb-key', { hasText: new RegExp('^' + k + '$') }).boundingBox();
            await device.shell(`input tap ${Math.round((bb.x + bb.width / 2) * dpr)} ${Math.round((bb.y + bb.height / 2) * dpr)}`);
        }
        await page.waitForTimeout(1000);
        const typed = (await filled()) - before;
        console.log('letters from 5 screen taps:', typed);
        if (typed !== 5) {
            console.log('touch events the page saw:', JSON.stringify(await page.evaluate(() => __touchLog)));
            console.log('focused window:', await device.shell('dumpsys window | grep -E "mCurrentFocus|mFocusedApp"').then(String));
            await shot(page, 'taps-failed');
            fail('expected 5 letters from 5 taps, got ' + typed);
        }
        if (await page.locator('.kb-preview').count()) fail('key preview left on screen');
        await page.waitForTimeout(1500);
        await shot(page, 'solving');
        const grid = await page.locator('.solver-grid').boundingBox();
        const vp = page.viewportSize() || await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        console.log('grid box', JSON.stringify(grid), 'viewport', JSON.stringify(vp));
        if (!grid || grid.width < 200) fail('grid not laid out');
        await page.evaluate(() => App.handleBack());
        await page.waitForTimeout(500);
        const states = await page.locator('.lib-state').allInnerTexts();
        console.log('states:', states);
        if (!states.some((s) => /%/.test(s))) fail('no puzzle shows progress');
    } else if (phase === 'open-with') {
        // A file sent from "another app": it should be imported and open.
        const expected = process.argv[3];
        await page.waitForFunction(() => window.App && App.openPuzzleId(), null, { timeout: 15000 })
            .catch(async () => {
                const dialog = await page.locator('.dialog').innerText().catch(() => '(no dialog)');
                fail('no puzzle opened; dialog: ' + dialog);
            });
        await page.waitForTimeout(500);
        const title = await page.locator('.solver-overlay:not([hidden]) .overlay-title').first().innerText();
        console.log('opened from another app:', title);
        await shot(page, 'open-with-' + expected.replace(/\W+/g, '-'));
        if (title !== expected) fail('expected "' + expected + '", got "' + title + '"');
        await page.evaluate(() => App.handleBack());
        await page.waitForTimeout(300);
        const titles = await page.locator('.lib-row-title').allInnerTexts();
        console.log('library:', titles);
        if (titles.length !== 3) fail('expected 3 puzzles in the library, got ' + titles.length);
    } else {
        const states = await page.locator('.lib-state').allInnerTexts();
        console.log('states after relaunch:', states);
        await shot(page, 'library-after-relaunch');
        if (!states.some((s) => /%/.test(s))) fail('progress lost after relaunch');
        await page.locator('.lib-row', { hasText: 'Big Grid' }).click();
        await page.waitForTimeout(800);
        const letters = (await page.locator('.cell-letter').allInnerTexts()).filter(Boolean).join('');
        console.log('letters after relaunch:', letters);
        if (!letters.startsWith('HELLO')) fail('letters lost after relaunch');
        const btn = await page.locator('.solver-overlay:not([hidden]) .overlay-start-btn').innerText();
        console.log('overlay button:', btn);
        await shot(page, 'reopened');
    }
    if (errors.length) fail('page errors: ' + errors.join(' | '));
    console.log(phase + ' OK');
    await device.close().catch(() => {});
    process.exit(0);
})().catch((e) => fail(e.stack || String(e)));
