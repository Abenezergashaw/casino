// Generates original placeholder art + sounds into public/assets. Run: node scripts/gen-art.cjs
// Uses Playwright's Chromium canvas for drawing; WAV files are synthesized in plain Node.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const out = path.join(__dirname, '../public/assets');
const png = path.join(out, 'png');
const snd = path.join(out, 'general/sound');
fs.mkdirSync(png, { recursive: true });
fs.mkdirSync(snd, { recursive: true });

// ---------- sounds ----------
function wav(file, seconds, fn, rate = 22050) {
  const n = Math.floor(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const v = Math.max(-1, Math.min(1, fn(t, seconds)));
    buf.writeInt16LE(Math.round(v * 32000), 44 + i * 2);
  }
  fs.writeFileSync(path.join(snd, file), buf);
}
const env = (t, d, a = 0.02) => Math.min(1, t / a) * Math.max(0, 1 - t / d);
wav('take.wav', 0.9, (t, d) => 0.5 * env(t, d) * (Math.sin(2 * Math.PI * (180 * t + 260 * t * t)) + 0.4 * (Math.random() * 2 - 1) * (1 - t / d)));
wav('flew.wav', 1.0, (t, d) => 0.55 * env(t, d, 0.01) * Math.sin(2 * Math.PI * (520 * t - 380 * t * t)));
wav('win.wav', 0.7, (t) => {
  const notes = [659, 784, 1047, 1319];
  const k = Math.min(3, Math.floor(t / 0.11));
  const lt = t - k * 0.11;
  return 0.45 * Math.exp(-lt * 6) * Math.sin(2 * Math.PI * notes[k] * t);
});
wav('bg-sound.wav', 8, (t) => {
  const chord = [110, 138.6, 164.8];
  return 0.12 * chord.reduce((s, f, i) => s + Math.sin(2 * Math.PI * f * t) * (0.7 + 0.3 * Math.sin(2 * Math.PI * (0.125 + i * 0.03) * t)), 0) / 3;
});

// ---------- images (drawn in a page canvas) ----------
const drawers = String.raw`
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };

function plane(ctx, ox, oy, frame) {
  ctx.save(); ctx.translate(ox, oy);
  // tail
  ctx.fillStyle = '#b3141f';
  ctx.beginPath(); ctx.moveTo(30, 90); ctx.lineTo(8, 40); ctx.lineTo(70, 82); ctx.closePath(); ctx.fill();
  // rear wing
  ctx.fillStyle = '#8f0f19';
  ctx.beginPath(); ctx.moveTo(70, 110); ctx.lineTo(40, 140); ctx.lineTo(110, 118); ctx.closePath(); ctx.fill();
  // fuselage
  const g = ctx.createLinearGradient(0, 70, 0, 130);
  g.addColorStop(0, '#ff5a4d'); g.addColorStop(1, '#c4162a');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(20, 96); ctx.bezierCurveTo(60, 66, 260, 66, 370, 90); ctx.bezierCurveTo(385, 96, 385, 108, 370, 114); ctx.bezierCurveTo(260, 138, 60, 132, 20, 104); ctx.closePath(); ctx.fill();
  // stripe
  ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.moveTo(110, 100); ctx.bezierCurveTo(200, 92, 280, 96, 360, 101); ctx.lineTo(360, 107); ctx.bezierCurveTo(280, 112, 200, 112, 110, 108); ctx.closePath(); ctx.fill();
  // cockpit
  ctx.fillStyle = '#bfe9ff'; ctx.beginPath(); ctx.ellipse(215, 82, 38, 18, -0.08, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(205, 76, 16, 6, -0.1, 0, Math.PI * 2); ctx.fill();
  // main wing
  ctx.fillStyle = '#e8262f';
  ctx.beginPath(); ctx.moveTo(190, 104); ctx.lineTo(150, 186); ctx.lineTo(230, 186); ctx.lineTo(290, 108); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ff7a6a'; ctx.beginPath(); ctx.moveTo(190, 104); ctx.lineTo(150, 186); ctx.lineTo(168, 186); ctx.lineTo(212, 106); ctx.closePath(); ctx.fill();
  // nose + propeller
  ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.ellipse(380, 102, 14, 13, 0, 0, Math.PI * 2); ctx.fill();
  const a = frame / 15 * Math.PI * 2 * 2;
  ctx.save(); ctx.translate(392, 102);
  ctx.fillStyle = 'rgba(30,30,40,0.55)';
  for (let k = 0; k < 2; k++) { ctx.save(); ctx.rotate(a + k * Math.PI); ctx.fillRect(-4, -46, 8, 92); ctx.restore(); }
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.ellipse(0, 0, 8, 48, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.restore();
}

function chute(ctx, ox, oy, t, color) {
  const ease = 1 - Math.pow(1 - t, 3);
  const cw = 18 + 100 * ease, ch = 10 + 50 * ease;
  const cx = ox + 70, top = oy + 20 + 20 * t;
  const man = { x: cx, y: top + ch + 60 * (0.3 + 0.7 * ease) };
  // lines
  ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2;
  for (const f of [-1, -0.4, 0.4, 1]) { ctx.beginPath(); ctx.moveTo(cx + f * cw / 2, top + ch * 0.55); ctx.lineTo(man.x, man.y - 8); ctx.stroke(); }
  // canopy
  const g = ctx.createLinearGradient(0, top, 0, top + ch);
  g.addColorStop(0, color[0]); g.addColorStop(1, color[1]);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(cx - cw / 2, top + ch * 0.6); ctx.quadraticCurveTo(cx, top - ch * 0.5, cx + cw / 2, top + ch * 0.6);
  ctx.quadraticCurveTo(cx + cw / 4, top + ch * 0.85, cx, top + ch * 0.6); ctx.quadraticCurveTo(cx - cw / 4, top + ch * 0.85, cx - cw / 2, top + ch * 0.6); ctx.fill();
  // rider
  ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.arc(man.x, man.y - 4, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color[0]; ctx.fillRect(man.x - 5, man.y + 2, 10, 14);
  ctx.fillStyle = '#222'; ctx.fillRect(man.x - 5, man.y + 16, 4, 8); ctx.fillRect(man.x + 1, man.y + 16, 4, 8);
}

window.render = (name) => {
  if (name === 'plane-anim') {
    const [c, ctx] = mk(440 * 5, 200 * 3);
    for (let i = 0; i < 15; i++) plane(ctx, (i % 5) * 440 + 10, Math.floor(i / 5) * 200, i);
    return c.toDataURL('image/png');
  }
  if (name === 'parachute-red-anim' || name === 'parachute-gray-anim') {
    const colors = name.includes('red') ? ['#ff4d4d', '#a30f1f'] : ['#c9ced6', '#6b7280'];
    const [c, ctx] = mk(140 * 8, 180 * 8);
    for (let i = 0; i < 61; i++) chute(ctx, (i % 8) * 140, Math.floor(i / 8) * 180, i / 60, colors);
    return c.toDataURL('image/png');
  }
  if (name === 'sun-like-bg') {
    const [c, ctx] = mk(900, 900); ctx.translate(450, 450);
    for (let i = 0; i < 18; i++) { ctx.save(); ctx.rotate(i / 18 * Math.PI * 2);
      const g = ctx.createLinearGradient(0, 0, 440, 0); g.addColorStop(0, 'rgba(229,148,7,.34)'); g.addColorStop(1, 'rgba(229,148,7,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(440, -34); ctx.lineTo(440, 34); ctx.closePath(); ctx.fill(); ctx.restore(); }
    return c.toDataURL('image/png');
  }
  if (name === 'propeller') {
    const [c, ctx] = mk(300, 300); ctx.translate(150, 150);
    for (let i = 0; i < 3; i++) { ctx.save(); ctx.rotate(i * Math.PI * 2 / 3);
      const g = ctx.createLinearGradient(0, 0, 0, -130); g.addColorStop(0, '#E59407'); g.addColorStop(1, '#7a4a00');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-14, 0); ctx.quadraticCurveTo(-34, -90, 0, -135); ctx.quadraticCurveTo(34, -90, 14, 0); ctx.fill(); ctx.restore(); }
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#E59407'; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
    return c.toDataURL('image/png');
  }
  if (name === 'dot') {
    const [c, ctx] = mk(24, 24); const g = ctx.createRadialGradient(12, 12, 1, 12, 12, 11);
    g.addColorStop(0, 'rgba(255,210,120,.95)'); g.addColorStop(1, 'rgba(255,210,120,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 24, 24); return c.toDataURL('image/png');
  }
  if (name === 'aviator-text') {
    const [c, ctx] = mk(600, 130); ctx.font = 'italic 900 96px Roboto, Arial Black, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 10; ctx.strokeStyle = '#3b0508'; ctx.strokeText('SKYBOUND', 300, 68);
    const g = ctx.createLinearGradient(0, 20, 0, 110); g.addColorStop(0, '#ff6b5e'); g.addColorStop(1, '#d4152c');
    ctx.fillStyle = g; ctx.fillText('SKYBOUND', 300, 68); return c.toDataURL('image/png');
  }
  if (name.startsWith('info-')) {
    const [c, ctx] = mk(240, 140); const k = +name.slice(5);
    const g = ctx.createLinearGradient(0, 0, 0, 140); g.addColorStop(0, '#2b2b30'); g.addColorStop(1, '#141416');
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(0, 0, 240, 140, 14); ctx.fill();
    ctx.fillStyle = '#E59407'; ctx.font = '900 64px Roboto, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(['1', '2', '3'][k - 1], 120, 52);
    ctx.font = '700 26px Roboto, Arial'; ctx.fillStyle = '#fff'; ctx.fillText(['BET', 'WATCH', 'CASH OUT'][k - 1], 120, 108);
    return c.toDataURL('image/png');
  }
  if (name === 'bg-access-denied') { const [c, ctx] = mk(8, 8); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 8, 8); return c.toDataURL('image/png'); }
};
`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<body></body>');
  await page.addScriptTag({ content: drawers });
  const names = ['plane-anim', 'parachute-red-anim', 'parachute-gray-anim', 'sun-like-bg', 'propeller', 'dot', 'aviator-text', 'info-1', 'info-2', 'info-3', 'bg-access-denied'];
  for (const n of names) {
    const url = await page.evaluate((n) => window.render(n), n);
    fs.writeFileSync(path.join(png, n + '.png'), Buffer.from(url.split(',')[1], 'base64'));
  }
  await browser.close();

  // Pixi spritesheet descriptors for the three animated sets
  const sheet = (name, count, cols, fw, fh) => {
    const frames = {};
    for (let i = 0; i < count; i++) {
      frames[`${name}-${i + 1}.png`] = {
        frame: { x: (i % cols) * fw, y: Math.floor(i / cols) * fh, w: fw, h: fh },
        spriteSourceSize: { x: 0, y: 0, w: fw, h: fh }, sourceSize: { w: fw, h: fh }, rotated: false, trimmed: false,
      };
    }
    const rows = Math.ceil(count / cols);
    fs.writeFileSync(path.join(png, name + '.json'), JSON.stringify({ frames, meta: { image: name + '.png', format: 'RGBA8888', size: { w: cols * fw, h: rows * fh }, scale: '1' } }));
  };
  sheet('plane-anim', 15, 5, 440, 200);
  sheet('parachute-red-anim', 61, 8, 140, 180);
  sheet('parachute-gray-anim', 61, 8, 140, 180);
  console.log('art + sounds written to', out);
})();
