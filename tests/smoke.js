// Quick deploy gate, run by CI before publishing (about a minute): in Chromium, Firefox and WebKit
// (as an iPhone), every skin loads styled with no script error and no skin stylesheet request, the
// random picker and the two toggles work, and the page is complete without JS. Google Fonts is
// answered with an empty stylesheet so the run is hermetic. WebKit here is Safari's engine on
// Linux, not iOS Safari itself. The full check with screenshots is tests/verify.js.
//
//     node tests/smoke.js        (needs the playwright package + chromium, firefox, webkit)
//
const { chromium, firefox, webkit, devices } = require('playwright');
const { skinNames, startSite } = require('./site');

const ENGINES = [
  ['chromium', chromium, { viewport: { width: 1440, height: 900 } }],
  ['firefox', firefox, { viewport: { width: 1280, height: 800 } }],
  ['webkit-iphone', webkit, devices['iPhone 14']],
];

const problems = [];
const skins = skinNames();

async function newPage(ctx, tag) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${tag}] console.error: ${m.text()}`); });
  await page.route('**/fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  return page;
}

const styledState = () => ({
  skin: document.documentElement.getAttribute('data-skin'),
  bgToken: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
  bg: getComputedStyle(document.body).backgroundColor,
  textColor: getComputedStyle(document.querySelector('p')).color,
  h1: document.querySelector('h1').textContent,
  skinRequests: performance.getEntriesByType('resource').filter((e) => /skins\/[^/]+\.css/.test(e.name)).length,
  overflow: document.documentElement.scrollWidth > window.innerWidth,
});

function checkStyled(tag, s, skin) {
  if (skin && s.skin !== skin) problems.push(`[${tag}] data-skin is ${s.skin}, expected ${skin}`);
  if (!s.bgToken || s.bg === 'rgba(0, 0, 0, 0)') problems.push(`[${tag}] not styled: ${JSON.stringify(s)}`);
  if (s.textColor === 'rgba(0, 0, 0, 0)') problems.push(`[${tag}] text invisible`);
  if (s.skinRequests) problems.push(`[${tag}] ${s.skinRequests} skin stylesheet request(s); skins must be inlined`);
  if (s.overflow) problems.push(`[${tag}] horizontal overflow`);
}

(async () => {
  const site = await startSite('donate-smoke');
  for (const [engineName, engine, device] of ENGINES) {
    const browser = await engine.launch();

    // every skin, forced, light and dark
    for (const skin of skins) {
      for (const colorScheme of ['light', 'dark']) {
        const tag = `${engineName}:${skin}:${colorScheme}`;
        const ctx = await browser.newContext({ ...device, colorScheme });
        const page = await newPage(ctx, tag);
        await page.goto(`${site.base}?skin=${skin}`, { waitUntil: 'load' });
        const s = await page.evaluate(styledState);
        checkStyled(tag, s, skin);
        if (await page.evaluate(() => location.search) !== '') problems.push(`[${tag}] skin param not stripped`);
        console.log(`${tag}: bg=${s.bg}`);
        await ctx.close();
      }
    }

    // random picker never repeats the last shown skin; toggles work and persist
    {
      const tag = `${engineName}:interaction`;
      const ctx = await browser.newContext({ ...device, colorScheme: 'light', locale: 'zh-TW' });
      const page = await newPage(ctx, tag);
      await page.goto(site.base, { waitUntil: 'load' });
      const first = await page.evaluate(() => document.documentElement.getAttribute('data-skin'));
      await page.goto(site.base, { waitUntil: 'load' });
      const second = await page.evaluate(() => document.documentElement.getAttribute('data-skin'));
      if (!skins.includes(first) || !skins.includes(second)) problems.push(`[${tag}] unknown skin picked: ${first}, ${second}`);
      if (skins.length > 1 && first === second) problems.push(`[${tag}] two loads in a row showed ${first}`);
      await page.getByRole('button', { name: 'EN' }).click();
      await page.locator('#theme-switch').click();
      await page.reload({ waitUntil: 'load' });
      const st = await page.evaluate(() => ({ lang: document.documentElement.lang, theme: document.documentElement.getAttribute('data-theme'), h1: document.querySelector('h1').textContent }));
      if (st.lang !== 'en' || st.theme !== 'dark' || st.h1 !== 'Sponsor Howar31') problems.push(`[${tag}] toggles did not persist: ${JSON.stringify(st)}`);
      console.log(`${tag}: picks=${first},${second} after toggles+reload=${JSON.stringify(st)}`);
      await ctx.close();
    }

    // without JS: the default skin, complete
    {
      const tag = `${engineName}:nojs`;
      const ctx = await browser.newContext({ ...device, javaScriptEnabled: false, colorScheme: 'dark' });
      const page = await newPage(ctx, tag);
      await page.goto(site.base, { waitUntil: 'load' });
      const s = await page.evaluate(styledState);
      checkStyled(tag, s, 'nebula');
      console.log(`${tag}: skin=${s.skin} bg=${s.bg}`);
      await ctx.close();
    }

    await browser.close();
  }
  site.close();
  console.log('\nPROBLEMS:', problems.length ? '\n' + problems.join('\n') : 'none');
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
