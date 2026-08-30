const { chromium, webkit, firefox } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://127.0.0.1:8765/';
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
];
// Skins are discovered from skins/*.css so new ones are verified without touching this file.
const SKINS = Object.fromEntries(fs.readdirSync(path.join(__dirname, '..', 'skins')).filter((f) => f.endsWith('.css')).map((f) => [f.replace(/\.css$/, ''), true]));
console.log('skins under test:', Object.keys(SKINS).join(', '));

const problems = [];

function attach(page, tag) {
  page.on('pageerror', (e) => problems.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${tag}] console.error: ${m.text()}`); });
}

async function snap(engine, engineName, vp, colorScheme, locale, skin, tag) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme, locale });
  const page = await ctx.newPage();
  attach(page, tag);
  await page.goto(`${BASE}?skin=${skin}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const info = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    title: document.title,
    skin: document.documentElement.getAttribute('data-skin'),
    search: location.search,
    sheets: Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => l.getAttribute('href')),
    bgToken: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    bg: getComputedStyle(document.body).backgroundColor,
    h1: document.querySelector('h1').textContent,
    h1Font: getComputedStyle(document.querySelector('h1')).fontFamily.split(',')[0],
  }));
  if (info.scrollWidth > info.innerWidth) problems.push(`[${tag}] horizontal overflow: scrollWidth ${info.scrollWidth} > innerWidth ${info.innerWidth}`);
  if (info.skin !== skin) problems.push(`[${tag}] skin param ignored: data-skin=${info.skin}`);
  if (info.search !== '') problems.push(`[${tag}] skin param not stripped from URL: ${info.search}`);
  const skinSheets = info.sheets.filter((h) => h.startsWith('skins/'));
  if (skinSheets.length !== 1 || skinSheets[0] !== `skins/${skin}.css`) problems.push(`[${tag}] skin stylesheet wrong: ${JSON.stringify(info.sheets)}`);
  if (!info.sheets.some((h) => h.startsWith('https://fonts.googleapis.com/'))) problems.push(`[${tag}] font stylesheet missing: ${JSON.stringify(info.sheets)}`);
  if (!info.bgToken) problems.push(`[${tag}] --bg token undefined (skin css not applied)`);
  await page.screenshot({ path: path.join(OUT, `${tag}.png`), fullPage: true });
  console.log(`${tag}: skin=${info.skin} lang=${info.lang} bg=${info.bg} h1font=${info.h1Font} ${vp.width}x${vp.height}`);
  await browser.close();
}

async function randomSkinTest() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  attach(page, 'random');
  // The picker excludes whatever localStorage.skin says was shown last. Seed that with the
  // first and the last skin (both ends of the list) and check the next load picks something
  // else: two loads, however many skins there are. Loading every skin is covered above.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const names = Object.keys(SKINS);
  const picks = [];
  for (const last of [names[0], names[names.length - 1]]) {
    await page.evaluate((s) => localStorage.setItem('skin', s), last);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const s = await page.evaluate(() => document.documentElement.getAttribute('data-skin'));
    picks.push(`${last}->${s}`);
    if (!SKINS[s]) problems.push(`[random] unknown skin selected: ${s}`);
    if (Object.keys(SKINS).length > 1 && s === last) problems.push(`[random] load after ${last} repeated it`);
  }
  console.log('random pick after each last-shown skin:', picks.join(' '));
  // A forced skin counts as the last one shown, so the next load avoids it.
  const forced = Object.keys(SKINS)[0];
  await page.goto(`${BASE}?skin=${forced}`, { waitUntil: 'domcontentloaded' });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const after = await page.evaluate(() => document.documentElement.getAttribute('data-skin'));
  if (Object.keys(SKINS).length > 1 && after === forced) problems.push(`[random] load after forced ${forced} repeated it`);
  console.log(`after forced ${forced}:`, after);
  // bogus param falls back to a valid skin and is still stripped
  await page.goto(`${BASE}?skin=bogus&x=1#top`, { waitUntil: 'domcontentloaded' });
  const fb = await page.evaluate(() => ({ skin: document.documentElement.getAttribute('data-skin'), url: location.search + location.hash }));
  if (!SKINS[fb.skin]) problems.push(`[random] bogus skin not rejected: ${fb.skin}`);
  if (fb.url !== '?x=1#top') problems.push(`[random] other params/hash not preserved: ${fb.url}`);
  console.log('bogus skin fallback:', JSON.stringify(fb));
  await browser.close();
}

async function interactionTest(skin) {
  const tag = `interaction:${skin}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', locale: 'zh-TW' });
  const page = await ctx.newPage();
  attach(page, tag);
  await page.goto(`${BASE}?skin=${skin}`, { waitUntil: 'networkidle' });

  // language toggle
  await page.getByRole('button', { name: 'EN' }).click();
  let state = await page.evaluate(() => ({ lang: document.documentElement.lang, h1: document.querySelector('h1').textContent, stored: localStorage.getItem('lang'), pressed: document.querySelector('[data-lang="en"]').getAttribute('aria-pressed'), aria: document.getElementById('theme-switch').getAttribute('aria-label') }));
  if (state.lang !== 'en' || state.h1 !== 'Sponsor Howar31' || state.stored !== 'en' || state.pressed !== 'true') problems.push(`[${tag}] EN toggle failed: ${JSON.stringify(state)}`);
  console.log(`${tag} after EN click:`, JSON.stringify(state));

  // theme toggle
  await page.locator('#theme-switch').click();
  state = await page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), stored: localStorage.getItem('theme'), bg: getComputedStyle(document.body).backgroundColor, sunVisible: getComputedStyle(document.querySelector('.icon-sun')).display, moonVisible: getComputedStyle(document.querySelector('.icon-moon')).display, themeColor: Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((m) => m.content).join(',') }));
  if (state.theme !== 'dark' || state.stored !== 'dark' || state.sunVisible === 'none' || state.moonVisible !== 'none') problems.push(`[${tag}] dark toggle failed: ${JSON.stringify(state)}`);
  console.log(`${tag} after theme click:`, JSON.stringify(state));
  await page.screenshot({ path: path.join(OUT, `${skin}-desktop-en-dark-toggled.png`), fullPage: true });

  // persistence across reload (skin changes after reload; theme and lang must survive)
  await page.reload({ waitUntil: 'networkidle' });
  state = await page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), lang: document.documentElement.lang, h1: document.querySelector('h1').textContent, skin: document.documentElement.getAttribute('data-skin') }));
  if (state.theme !== 'dark' || state.lang !== 'en') problems.push(`[${tag}] persistence failed: ${JSON.stringify(state)}`);
  const storedSkin = await page.evaluate(() => localStorage.getItem('skin'));
  if (storedSkin !== state.skin) problems.push(`[${tag}] stored skin ${storedSkin} != shown ${state.skin}`);
  console.log(`${tag} after reload:`, JSON.stringify(state));

  // toggle back to light + zh
  await page.locator('#theme-switch').click();
  await page.getByRole('button', { name: '中文' }).click();
  state = await page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), lang: document.documentElement.lang, h1: document.querySelector('h1').textContent }));
  if (state.theme !== 'light' || state.lang !== 'zh-Hant-TW') problems.push(`[${tag}] toggle back failed: ${JSON.stringify(state)}`);
  console.log(`${tag} after toggle back:`, JSON.stringify(state));

  // tap target sizes on mobile
  await page.setViewportSize({ width: 390, height: 844 });
  const sizes = await page.evaluate(() => Array.from(document.querySelectorAll('a, button')).map((el) => { const r = el.getBoundingClientRect(); return { label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) }; }));
  for (const s of sizes) if (s.h < 32) problems.push(`[${tag}] small tap target: ${JSON.stringify(s)}`);
  console.log(`${tag} tap targets (390px):`, JSON.stringify(sizes));
  await browser.close();
}

async function linkTest() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  for (const href of ['https://ko-fi.com/howar31', 'https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=MLVT3HDZKUZCW']) {
    const p = await ctx.newPage();
    try {
      const resp = await p.goto(href, { waitUntil: 'domcontentloaded', timeout: 30000 });
      console.log(`link ${href}: status=${resp && resp.status()} final=${p.url()} title="${await p.title()}"`);
    } catch (e) { problems.push(`[links] ${href}: ${e.message}`); }
    await p.close();
  }
  await browser.close();
}

async function paintTest() {
  // The first paint must not wait for the skin stylesheet or for Google Fonts, and while the
  // sheet is in flight the page must be a clean canvas in the skin's own background colour
  // with transparent text (never white, never unstyled). Checked in all three engines with
  // JS; without JS the noscript path just has to end up styled.
  const DELAY = 1500;
  for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit], ['firefox', firefox]]) {
    for (const js of [true, false]) {
      const tag = `paint:${engineName}:${js ? 'js' : 'nojs'}`;
      const browser = await engine.launch();
      const ctx = await browser.newContext({ colorScheme: 'dark', javaScriptEnabled: js });
      const page = await ctx.newPage();
      attach(page, tag);
      await page.route('**/skins/*.css', async (route) => { await new Promise((r) => setTimeout(r, DELAY)); await route.continue(); });
      await page.route('**/fonts.googleapis.com/**', async (route) => { await new Promise((r) => setTimeout(r, DELAY * 3)); await route.continue(); });
      await page.goto(`${BASE}?skin=${Object.keys(SKINS)[0]}`, { waitUntil: 'domcontentloaded' });
      // In flight: sampled well before the sheet can have arrived.
      const mid = js ? await page.evaluate(() => ({
        loading: document.documentElement.hasAttribute('data-skin-loading'),
        htmlBg: getComputedStyle(document.documentElement).backgroundColor,
        inlineBg: document.documentElement.style.backgroundColor,
        h1Color: getComputedStyle(document.querySelector('h1')).color,
        buttonColor: getComputedStyle(document.querySelector('button')).color,
        borderColor: getComputedStyle(document.querySelector('a')).borderTopColor,
      })) : null;
      await page.waitForLoadState('load');
      await page.waitForTimeout(300);
      const t = await page.evaluate(() => ({
        fcp: (performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint') || {}).startTime,
        cssEnd: (performance.getEntriesByType('resource').find((e) => /skins\/[^/]+\.css/.test(e.name)) || {}).responseEnd,
        loading: document.documentElement.hasAttribute('data-skin-loading'),
        inlineBg: document.documentElement.style.backgroundColor,
        bg: getComputedStyle(document.body).backgroundColor,
        // The lede, not the h1: a skin may legitimately set the h1 transparent for gradient text.
        textColor: getComputedStyle(document.querySelector('p')).color,
        media: Array.from(document.querySelectorAll('link[rel=stylesheet]')).map((l) => `${l.getAttribute('href').replace(/\?.*/, '').slice(0, 24)}:${l.media || 'all'}`).join(' '),
      }));
      if (js) {
        if (!mid.loading || !mid.inlineBg) problems.push(`[${tag}] not in loading state while the sheet was in flight: ${JSON.stringify(mid)}`);
        if (mid.htmlBg !== t.bg) problems.push(`[${tag}] in-flight canvas ${mid.htmlBg} differs from the skin background ${t.bg}`);
        for (const k of ['h1Color', 'buttonColor', 'borderColor']) if (mid[k] !== 'rgba(0, 0, 0, 0)') problems.push(`[${tag}] in-flight ${k} visible: ${mid[k]}`);
        if (!(t.fcp > 0) || !(t.cssEnd > 0)) problems.push(`[${tag}] missing timing: ${JSON.stringify(t)}`);
        else if (t.fcp >= t.cssEnd) problems.push(`[${tag}] first paint waited for the skin stylesheet: ${JSON.stringify(t)}`);
        if (!/skins\/[^ ]*:all/.test(t.media) || !/fonts\.googleapis[^ ]*:all/.test(t.media)) problems.push(`[${tag}] a stylesheet was not activated: ${t.media}`);
      }
      if (t.loading || t.inlineBg) problems.push(`[${tag}] loading state not cleared: ${JSON.stringify(t)}`);
      if (t.bg === 'rgba(0, 0, 0, 0)') problems.push(`[${tag}] body has no background`);
      if (t.textColor === 'rgba(0, 0, 0, 0)') problems.push(`[${tag}] text still transparent after load`);
      console.log(`${tag}: fcp=${Math.round(t.fcp)} cssEnd=${Math.round(t.cssEnd)} bg=${t.bg}${mid ? ` inflight=${mid.htmlBg}/${mid.h1Color}` : ''} ${t.media}`);
      await browser.close();
    }
  }
}

function identifierScan() {
  // Adblock hygiene: identifiers must not carry fundraising words; hrefs are exempt.
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/href="[^"]*"/g, '');
  const re = /(class|id|data-[\w-]+|aria-label)="[^"]*(sponsor|donat|donor|supporter|patron|tip-?jar)[^"]*"/gi;
  const hits = html.match(re) || [];
  for (const h of hits) problems.push(`[identifiers] ${h}`);
  console.log('identifier scan:', hits.length ? hits.join(' | ') : 'clean');
}

(async () => {
  for (const skin of Object.keys(SKINS)) {
    for (const vp of VIEWPORTS) {
      await snap(chromium, 'chromium', vp, 'light', 'zh-TW', skin, `${skin}-${vp.name}-zh-light`);
      await snap(chromium, 'chromium', vp, 'dark', 'en-US', skin, `${skin}-${vp.name}-en-dark`);
    }
    await snap(webkit, 'webkit', VIEWPORTS[0], 'light', 'zh-TW', skin, `${skin}-webkit-mobile-zh-light`);
    await snap(webkit, 'webkit', VIEWPORTS[2], 'dark', 'en-US', skin, `${skin}-webkit-desktop-en-dark`);
    await interactionTest(skin);
  }
  await randomSkinTest();
  await paintTest();
  identifierScan();
  if (!process.env.SKIP_LINKS) await linkTest();
  console.log('\nPROBLEMS:', problems.length ? '\n' + problems.join('\n') : 'none');
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
