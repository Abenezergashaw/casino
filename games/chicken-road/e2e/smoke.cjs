// node e2e/smoke.cjs [outDir] [WxH]   (serves ./dist, plays rounds in Chromium at phone size)
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const root = process.env.ROOT || path.join(__dirname, '../dist');
const outDir = process.argv[2] || path.join(__dirname, '../e2e-out');
const [W, H] = (process.argv[3] || '390x844').split('x').map(Number);
fs.mkdirSync(outDir, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(b); });
});
const num = (s) => parseFloat(String(s).replace(/[^\d.]/g, ''));
(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [], fails = []; globalThis.__errs = errors;
  page.on('console', (m) => { if (m.type() === 'warning' && !/GL Driver/.test(m.text())) errors.push('warn: ' + m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
  const shot = (n) => page.screenshot({ path: path.join(outDir, `${W}x${H}-${n}.png`) });
  const bal = async () => num(await page.textContent('#balance'));
  const check = (ok, msg) => { if (!ok) fails.push(msg); };

  // simulate a device/mode with no WebGL at all (iPhone Lockdown Mode, some in-app browsers)
  if (process.env.NO_WEBGL) await page.addInitScript(() => { for (const C of [HTMLCanvasElement, window.OffscreenCanvas].filter(Boolean)) { const g = C.prototype.getContext; C.prototype.getContext = function (t, ...a) { return /webgl|experimental/.test(t) ? null : g.call(this, t, ...a); }; } });
  if (process.env.NO_WASM) await page.route('**/glue.wasm', (r) => r.abort());
  await page.goto(base + '?seed=3');
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  const mathSrc = await page.textContent('#mathSrc');
  if (process.env.NO_WEBGL) check(await page.evaluate(() => document.documentElement.dataset.renderer) === 'canvas', 'did not fall back to canvas');
  check(process.env.NO_WASM ? /JS port/.test(mathSrc) : /Lua/.test(mathSrc), 'unexpected math source: ' + mathSrc);
  await page.waitForTimeout(600);
  await shot('1-idle');

  const rounds = [];
  for (let i = 0; i < 6; i++) {
    const diff = ['medium', 'hard', 'easy', 'hardcore', 'medium', 'hard'][i];
    await page.click(`#difficulty button[data-d="${diff}"]`);
    await page.fill('#betInput', '100');
    const before = await bal();
    await page.click('#play');
    await page.waitForSelector('#run:not([hidden])');
    check(Math.abs((await bal()) - (before - 100)) < 0.005, `round ${i}: stake not taken at open`);
    const target = 1 + (i % 4);                       // cross this many lanes, then cash out
    let lanes = 0, busted = false;
    while (lanes < target) {
      await page.click('#go');
      await page.waitForFunction(() => !document.querySelector('#go').disabled || document.querySelector('#run').hidden, null, { timeout: 15000 });
      if (await page.$eval('#run', (e) => e.hidden)) { busted = true; break; }
      lanes++;
      if (i === 0 && lanes === 1) await shot('2-after-first-hop');
    }
    const finished = await page.$eval('#run', (e) => e.hidden);
    if (!finished) {
      check(!(await page.$eval('#cash', (e) => e.disabled)), `round ${i}: cash out disabled after crossing`);
      if (i === 1) await shot('3-mid-run');
      const shown = num((await page.textContent('#cashAmt')).replace(/USD/, ''));
      await page.click('#cash');
      await page.waitForSelector('#play:not([hidden])');
      const after = await bal();
      check(Math.abs(after - (before - 100 + shown)) < 0.011, `round ${i}: cash out paid ${after - before + 100}, button promised ${shown}`);
      rounds.push({ diff, lanes, result: 'cash', net: +(after - before).toFixed(2) });
      if (i === 0) await shot('4-cashed');
    } else {
      const main = await page.textContent('#toast');
      const after = await bal();
      if (/Lost/i.test(main)) { check(Math.abs(after - (before - 100)) < 0.005, `round ${i}: bust should lose exactly the stake`); await shot(`5-bust-${i}`); rounds.push({ diff, lanes, result: 'bust', net: -100 }); }
      else rounds.push({ diff, lanes, result: main, net: +(after - before).toFixed(2) });
    }
    check(await page.$eval('#play', (e) => !e.hidden), `round ${i}: Play button not back`);
  }
  console.log(JSON.stringify({ mathSrc, rounds, balance: await bal(), fails, errors }, null, 1));
  await browser.close(); server.close();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message, '\nerrors so far:', JSON.stringify(globalThis.__errs || [])); process.exit(2); });
