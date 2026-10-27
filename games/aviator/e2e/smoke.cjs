// Real-browser smoke test: node e2e/smoke.cjs [outDir] [WxH]
// Serves ./build, plays one round at phone size, fails on console/page errors.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = process.env.ROOT || path.join(__dirname, '../build');
const outDir = process.argv[2] || path.join(__dirname, '../e2e-out');
const [W, H] = (process.argv[3] || '390x844').split('x').map(Number);
fs.mkdirSync(outDir, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wav': 'audio/wav', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(buf);
  });
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  const shot = (n) => page.screenshot({ path: path.join(outDir, `${W}x${H}-${n}.png`) });

  await page.goto(url);
  await page.waitForSelector('text=Start', { timeout: 20000 });
  await shot('1-splash');
  await page.click('text=Start');
  await page.waitForSelector('canvas', { timeout: 10000 });
  await page.waitForTimeout(1500);
  await shot('2-board');

  const bal = () => page.evaluate(() => parseFloat(localStorage.getItem('playBalance') || '10000'));
  const betBtn = page.locator('button:has(h4)', { hasText: /^bet/i });
  const cashBtn = page.locator('button:has(h4)', { hasText: /cash out/i });
  let cashed = false, before = 0, after = 0, attempts = 0;
  while (!cashed && attempts < 8) {
    attempts++;
    // betting opens 2s after GAME_ALLOW_BET on the client
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.querySelector('h4') && /^bet/i.test(b.innerText) && !b.disabled), null, { timeout: 40000 });
    await page.waitForTimeout(2500);
    before = await bal();
    await betBtn.first().click();
    if (attempts === 1) { await page.waitForTimeout(400); await shot('3-bet-placed'); }
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /cash out/i.test(b.innerText)), null, { timeout: 30000 });
    // let the multiplier climb a bit, but cash out before most crashes
    await page.waitForTimeout(700);
    if (attempts === 1) await shot('4-flying');
    if (await cashBtn.count()) {
      await cashBtn.first().click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(900);
      after = await bal();
      cashed = after > before - 100;
      if (cashed) await shot('5-cashed');
    }
    await page.waitForFunction(() => /flew away/i.test(document.body.innerText), null, { timeout: 60000 });
    if (attempts === 1) await shot('6-crashed');
    after = await bal();
    cashed = after > before - 100 && after !== before - 100;
  }
  const profit = after - before;
  const balance = await page.evaluate(() => localStorage.getItem('playBalance'));
  console.log(JSON.stringify({ cashed, attempts, before, after, profit, balance, errors }, null, 1));
  if (!cashed) errors.push('cash-out never paid out');
  await browser.close(); server.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(2); });
