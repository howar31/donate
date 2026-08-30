// Page checks against a fresh build. Builds src/ into a scratch dir with tools/build.py, serves it
// on a local port for the duration of the run, and exercises the page in Chromium, WebKit and
// Firefox. Needs Playwright with the three browsers installed (global install is fine).
//
//     SKIP_LINKS=1 NODE_PATH=$(npm root -g) node tests/verify.js
//
const { chromium, webkit, firefox } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

// Build into a scratch dir so the check never depends on a stale dist/.
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'donate-verify-'));
console.log(execFileSync('python3', [path.join(ROOT, 'tools', 'build.py'), '--out', SITE], { encoding: 'utf8' }).trim());

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let file = path.join(SITE, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!file.startsWith(SITE) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
let BASE = '';

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
];
// Skins are discovered from src/skins/*.css so new ones are verified without touching this file.
const SKINS = Object.fromEntries(fs.readdirSync(path.join(ROOT, 'src', 'skins')).filter((f) => f.endsWith('.css')).map((f) => [f.replace(/\.css$/, ''), true]));
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
  // Skins are inlined by the build: the page must not request any skin stylesheet.
  const skinSheets = info.sheets.filter((h) => h.startsWith('skins/'));
  if (skinSheets.length) problems.push(`[${tag}] skin stylesheet requested instead of inlined: ${JSON.stringify(info.sheets)}`);
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
  // The page must paint complete, in its skin, as soon as the HTML has arrived: no skin stylesheet
  // request at all, and a first paint that does not wait for Google Fonts (delayed here). Checked
  // in all three engines with JS; without JS the default skin must be complete too.
  const DELAY = 3000;
  for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit], ['firefox', firefox]]) {
    for (const js of [true, false]) {
      const tag = `paint:${engineName}:${js ? 'js' : 'nojs'}`;
      const browser = await engine.launch();
      const ctx = await browser.newContext({ colorScheme: 'dark', javaScriptEnabled: js });
      const page = await ctx.newPage();
      attach(page, tag);
      await page.route('**/fonts.googleapis.com/**', async (route) => { await new Promise((r) => setTimeout(r, DELAY)); await route.continue(); });
      await page.goto(`${BASE}?skin=${Object.keys(SKINS)[0]}`, { waitUntil: 'domcontentloaded' });
      // Sampled while the fonts stylesheet is still in flight: the page must already be complete.
      const early = await page.evaluate(() => ({
        skin: document.documentElement.getAttribute('data-skin'),
        bg: getComputedStyle(document.body).backgroundColor,
        bgToken: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
        textColor: getComputedStyle(document.querySelector('p')).color,
        h1Size: getComputedStyle(document.querySelector('h1')).fontSize,
      }));
      await page.waitForLoadState('load');
      await page.waitForTimeout(300);
      const t = await page.evaluate(() => ({
        fcp: (performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint') || {}).startTime,
        fontsEnd: (performance.getEntriesByType('resource').find((e) => /fonts\.googleapis/.test(e.name)) || {}).responseEnd,
        skinRequests: performance.getEntriesByType('resource').filter((e) => /skins\/[^/]+\.css/.test(e.name)).length,
        bg: getComputedStyle(document.body).backgroundColor,
        h1Size: getComputedStyle(document.querySelector('h1')).fontSize,
        media: Array.from(document.querySelectorAll('link[rel=stylesheet]')).map((l) => `${l.getAttribute('href').replace(/\?.*/, '').slice(0, 24)}:${l.media || 'all'}`).join(' '),
      }));
      if (!early.bgToken || early.bg === 'rgba(0, 0, 0, 0)') problems.push(`[${tag}] not styled on arrival: ${JSON.stringify(early)}`);
      if (early.textColor === 'rgba(0, 0, 0, 0)') problems.push(`[${tag}] text invisible on arrival`);
      if (early.bg !== t.bg || early.h1Size !== t.h1Size) problems.push(`[${tag}] page changed after the fonts arrived (layout shift): ${JSON.stringify({ early, t })}`);
      if (t.skinRequests) problems.push(`[${tag}] ${t.skinRequests} skin stylesheet request(s); skins must be inlined`);
      if (js) {
        if (!(t.fcp > 0) || !(t.fontsEnd > 0)) problems.push(`[${tag}] missing timing: ${JSON.stringify(t)}`);
        else if (t.fcp >= t.fontsEnd) problems.push(`[${tag}] first paint waited for fonts: ${JSON.stringify(t)}`);
        if (!/fonts\.googleapis[^ ]*:all/.test(t.media)) problems.push(`[${tag}] fonts stylesheet not activated: ${t.media}`);
        if (early.skin !== Object.keys(SKINS)[0]) problems.push(`[${tag}] skin param ignored: ${early.skin}`);
      } else if (early.skin !== 'nebula') problems.push(`[${tag}] no-JS default skin is ${early.skin}`);
      console.log(`${tag}: fcp=${Math.round(t.fcp)} fontsEnd=${Math.round(t.fontsEnd)} bg=${t.bg} skinRequests=${t.skinRequests} ${t.media}`);
      await browser.close();
    }
  }
}

function identifierScan() {
  // Adblock hygiene: identifiers must not carry fundraising words; hrefs are exempt.
  const html = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8').replace(/href="[^"]*"/g, '');
  const re = /(class|id|data-[\w-]+|aria-label)="[^"]*(sponsor|donat|donor|supporter|patron|tip-?jar)[^"]*"/gi;
  const hits = html.match(re) || [];
  for (const h of hits) problems.push(`[identifiers] ${h}`);
  console.log('identifier scan:', hits.length ? hits.join(' | ') : 'clean');
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}/`;
  console.log('serving', SITE, 'at', BASE);
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
  server.close();
  fs.rmSync(SITE, { recursive: true, force: true });
  console.log('\nPROBLEMS:', problems.length ? '\n' + problems.join('\n') : 'none');
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
