const { chromium, webkit } = require('playwright');
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
  const seen = {};
  const sequence = [];
  for (let i = 0; i < 24; i++) {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const s = await page.evaluate(() => document.documentElement.getAttribute('data-skin'));
    seen[s] = (seen[s] || 0) + 1;
    sequence.push(s);
  }
  console.log('random skins over 24 loads:', JSON.stringify(seen), sequence.join(' '));
  // Consecutive loads must never repeat a skin (needs at least two skins).
  if (Object.keys(SKINS).length > 1) for (let i = 1; i < sequence.length; i++) if (sequence[i] === sequence[i - 1]) problems.push(`[random] skin repeated on consecutive loads at ${i}: ${sequence[i]}`);
  // A forced skin counts as the last one shown, so the next load avoids it.
  const forced = Object.keys(SKINS)[0];
  await page.goto(`${BASE}?skin=${forced}`, { waitUntil: 'domcontentloaded' });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const after = await page.evaluate(() => document.documentElement.getAttribute('data-skin'));
  if (Object.keys(SKINS).length > 1 && after === forced) problems.push(`[random] load after forced ${forced} repeated it`);
  console.log(`after forced ${forced}:`, after);
  for (const s of Object.keys(SKINS)) if (!seen[s]) problems.push(`[random] skin ${s} never selected in 24 loads`);
  for (const s of Object.keys(seen)) if (!SKINS[s]) problems.push(`[random] unknown skin selected: ${s}`);
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
  identifierScan();
  if (!process.env.SKIP_LINKS) await linkTest();
  console.log('\nPROBLEMS:', problems.length ? '\n' + problems.join('\n') : 'none');
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
