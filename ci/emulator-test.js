// Drives the app's WebView on the emulator over Chrome DevTools.
// phase1: import puzzles, solve part of one, go back to the library.
// phase2: after the app was killed and relaunched, check everything is still there.
const { chromium } = require('playwright-core');
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
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const page = browser.contexts()[0].pages()[0];
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
        await page.waitForTimeout(2500);
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
    await browser.close().catch(() => {});
    process.exit(0);
})().catch((e) => fail(e.stack || String(e)));
