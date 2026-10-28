// Visual layer only: it never decides an outcome. main.ts asks the math what happened and calls hopSafe /
// hopBust / celebrate here to show it.
//
// Design reference: the original Chicken Road ("burning tiles") by InOut Games, measured from public
// screenshots: flat side-on view, indigo brick wall, dashed lane dividers, a steel manhole coin per lane
// carrying the multiplier, a barred arch under each, a doorway at the start and a golden egg at the finish.
// Coin states: steel (ahead), green (chicken is here), gold (passed), red with flame (hit). The hazard is
// fire from the grate, which leaves a roast chicken on a plate. All artwork here is drawn in code.
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import gsap from 'gsap';

export const H = 324;          // design height; the road band ends here
const LW = 124;                // lane width
const START_W = 150;           // doorway wall
const END_W = 230;             // egg arch
const CURB = 300;              // y where the chicken's feet rest
const COIN_Y = 116, COIN_R = 42;

const C = {
  wall: 0x353c55, wallStart: 0x2c314a, patch: 0x2b3150, patch2: 0x30365a, divider: 0x9fa5c5,
  steel: 0x474f8e, steelHi: 0x5a63a8, steelRim: 0x2f3560, steelRing: 0x7a82c4,
  green: 0x2da554, greenHi: 0x43d866, greenRim: 0x176d35,
  gold: 0xecbf41, goldHi: 0xf7d96a, goldRim: 0xb98a1c, goldEmboss: 0xc38d1e,
  red: 0xe5546a, redHi: 0xf59aa0, redRim: 0x9b2a44,
  grate: 0x20263b, grateBar: 0x3d456b, grateBase: 0x65678f,
  curb: 0x383a4c, road: 0x3b3c4e, slab: 0x434659, dark: 0x151921,
};

type CoinState = 'steel' | 'green' | 'gold' | 'red';

const font = 'Montserrat, system-ui, -apple-system, sans-serif';
const multStyle = (size: number, fill = 0xc9cff0) =>
  new TextStyle({ fontFamily: font, fontSize: size, fontWeight: '800', fill, stroke: { color: 0x20264a, width: Math.max(2, size / 9) }, dropShadow: { color: 0x14183a, alpha: 0.5, distance: 2, angle: Math.PI / 2, blur: 0 } });

/** Small deterministic PRNG so the wall looks the same every round. */
const prng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

interface Coin { box: Container; g: Graphics; label: Text; icon: Graphics; state: CoinState; x: number }

export class Scene {
  private world = new Container();
  private bg = new Container();
  private lanesLayer = new Container();
  private coinsLayer = new Container();
  private chickenLayer = new Container();
  private fxLayer = new Container();
  private chicken = new Container();
  private body = new Container();
  private glow = new Graphics();
  private coins: Coin[] = [];
  private laneMul: number[] = [];
  private lanes = 0;
  private lane = 0;
  private scale = 1;
  private fires: gsap.core.Tween[] = [];
  private roast: Container | null = null;
  private finale: { egg: Container; text: Text } | null = null;
  private idleTween: gsap.core.Tween | null = null;

  constructor(private app: Application) {
    this.world.addChild(this.bg, this.lanesLayer, this.coinsLayer, this.chickenLayer, this.fxLayer);
    app.stage.addChild(this.world);
    this.buildChicken();
    this.chickenLayer.addChild(this.glow, this.chicken);
    app.renderer.on('resize', () => this.layout(false));
  }

  // ---- world --------------------------------------------------------------
  reset(lanes: number, mult: (n: number) => number) {
    this.stopFire();
    this.idleTween?.kill();
    [this.bg, this.lanesLayer, this.coinsLayer, this.fxLayer].forEach((l) => l.removeChildren().forEach((c) => c.destroy({ children: true })));
    this.roast = null;
    this.finale = null;
    this.lanes = lanes;
    this.lane = 0;
    this.coins = [];
    this.laneMul = Array.from({ length: lanes + 1 }, (_, i) => (i === 0 ? 1 : mult(i)));
    const W = START_W + lanes * LW + END_W;
    const rnd = prng(7);

    // wall: runs far above the road so a tall phone stage is still filled
    const wall = new Graphics().rect(-600, -1400, W + 1200, 1400 + H).fill(C.wall);
    wall.rect(-600, -1400, 600 + START_W, 1400 + H).fill(C.wallStart);
    this.bg.addChild(wall);

    // soft darker bricks scattered like the reference
    const patches = new Graphics();
    for (let i = 0; i < Math.ceil(W / 60) * 4; i++) {
      const x = (i % Math.ceil(W / 60)) * 60 + rnd() * 30 - 10, y = -320 + rnd() * 460, w = 30 + rnd() * 30, h = 18 + rnd() * 14;
      patches.roundRect(x, y, w, h, 4).fill({ color: rnd() > 0.5 ? C.patch : C.patch2, alpha: 0.9 });
    }
    for (let i = 0; i < lanes; i++) {
      const x = START_W + i * LW + 12 + rnd() * 30;
      patches.roundRect(x, 188 + rnd() * 14, 34 + rnd() * 14, 20, 4).fill({ color: C.patch, alpha: 0.9 });
    }
    this.bg.addChild(patches);

    this.doorway();
    for (let i = 1; i <= lanes; i++) this.laneColumn(i);
    this.finish(START_W + lanes * LW);
    this.road(W);

    this.chicken.visible = true;
    this.chicken.alpha = 1;
    this.chicken.rotation = 0;
    this.chicken.scale.set(0.92);
    this.body.scale.set(1);
    this.body.y = 0;
    this.chicken.position.set(START_W / 2, CURB);
    this.glow.clear();
    this.glow.alpha = 0;
    this.layout(false);
  }

  private doorway() {
    const g = new Graphics();
    const cx = START_W / 2, w = 74;
    g.roundRect(cx - w / 2 - 6, 118, w + 12, CURB - 118 + 2, 36).fill(0x23283f);
    g.roundRect(cx - w / 2, 126, w, CURB - 126 + 2, 32).fill(C.dark);
    g.rect(cx - w / 2 - 6, CURB - 12, w + 12, 14).fill(C.dark);
    // stone courses on the start wall
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) g.roundRect(8 + c * 74 + (r % 2) * 22, 20 + r * 20, 56, 12, 3).fill({ color: 0x252a42, alpha: 0.9 });
    this.lanesLayer.addChild(g);
  }

  private laneColumn(i: number) {
    const x0 = START_W + (i - 1) * LW, cx = x0 + LW / 2;
    const g = new Graphics();
    // dashed divider on the left edge
    for (let y = -1400; y < CURB; y += 36) g.roundRect(x0 - 2, y, 4, 22, 2).fill({ color: C.divider, alpha: 0.95 });
    // sewer arch with bars
    const gx = cx - 31, gy = 244, gw = 62, gh = 56;
    g.roundRect(gx, gy, gw, gh + 4, 24).fill(C.grate);
    g.rect(gx, gy + 30, gw, gh - 26).fill(C.grate);
    for (let b = 0; b < 7; b++) g.roundRect(gx + 8 + b * 7.4, gy + 14, 3.2, gh - 12, 1.5).fill(C.grateBar);
    g.roundRect(gx - 6, CURB - 6, gw + 12, 8, 3).fill(C.grateBase);
    this.lanesLayer.addChild(g);

    const box = new Container();
    box.position.set(cx, COIN_Y);
    const cg = new Graphics(), icon = new Graphics();
    const label = new Text({ text: `${this.laneMul[i].toFixed(2)}x`, style: multStyle(this.laneMul[i] >= 1000 ? 17 : this.laneMul[i] >= 100 ? 20 : 23) });
    label.anchor.set(0.5);
    box.addChild(cg, icon, label);
    this.coinsLayer.addChild(box);
    const coin: Coin = { box, g: cg, label, icon, state: 'steel', x: cx };
    this.coins[i] = coin;
    this.paintCoin(coin, 'steel');
  }

  private paintCoin(c: Coin, state: CoinState) {
    c.state = state;
    const g = c.g, R = COIN_R;
    const pal = {
      steel: [C.steelRim, C.steel, C.steelHi, C.steelRing],
      green: [C.greenRim, C.green, C.greenHi, 0x7be89b],
      gold: [C.goldRim, C.gold, C.goldHi, 0xfff0a8],
      red: [C.redRim, C.red, C.redHi, 0xffc2c6],
    }[state];
    g.clear();
    g.circle(0, 3, R + 4).fill({ color: 0x000000, alpha: 0.28 });            // drop shadow
    g.circle(0, 0, R + 3).fill(pal[0]);                                        // outer rim
    g.circle(0, 0, R).fill(pal[1]);                                            // body
    g.circle(0, -R * 0.28, R * 0.78).fill({ color: pal[2], alpha: 0.45 });     // upper sheen
    g.circle(0, 0, R * 0.8).stroke({ width: 3, color: pal[3], alpha: 0.55 });   // inner ring
    // notches on the rim like a manhole cover
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.circle(Math.cos(a) * (R - 2), Math.sin(a) * (R - 2), 2.4).fill({ color: pal[0], alpha: 0.7 });
    }
    c.icon.clear();
    c.label.visible = state === 'steel' || state === 'green';
    if (state === 'green') { c.label.style.fill = 0xffffff; c.label.style.stroke = { color: 0x0d4a22, width: 3 }; }
    if (state === 'steel') { c.label.style.fill = 0xc9cff0; c.label.style.stroke = { color: 0x20264a, width: 3 }; }
    if (state === 'gold') this.roastEmblem(c.icon);
    if (state === 'red') this.flameEmblem(c.icon);
  }

  /** Embossed roast-chicken glyph on a passed (gold) coin. */
  private roastEmblem(g: Graphics) {
    const e = C.goldEmboss;
    g.ellipse(2, 3, 19, 14).fill(e);
    g.ellipse(-8, -6, 8, 6).fill(e);                          // drumstick knuckle
    g.roundRect(-24, -10, 12, 6, 3).fill(e);
    g.circle(-6, 4, 2.2).fill(C.gold).circle(8, 4, 2.2).fill(C.gold);
    g.moveTo(-9, 1).lineTo(-3, 7).stroke({ width: 1.6, color: C.gold });
    g.moveTo(-3, 1).lineTo(-9, 7).stroke({ width: 1.6, color: C.gold });
    g.moveTo(5, 1).lineTo(11, 7).stroke({ width: 1.6, color: C.gold });
    g.moveTo(11, 1).lineTo(5, 7).stroke({ width: 1.6, color: C.gold });
  }

  private flameEmblem(g: Graphics) {
    this.flamePath(g, 0, 22, 17, 40).fill(0xff7a1f);
    this.flamePath(g, 0, 22, 10, 26).fill(0xffd23f);
    g.circle(-2, 8, 5).fill({ color: 0xfff3b0, alpha: 0.9 });
  }

  /** Teardrop flame with its tip at (x, y - h). */
  private flamePath(g: Graphics, x: number, y: number, w: number, h: number) {
    return g.moveTo(x, y)
      .bezierCurveTo(x - w * 1.25, y - h * 0.18, x - w * 0.9, y - h * 0.62, x - w * 0.08, y - h)
      .bezierCurveTo(x + w * 0.02, y - h * 0.62, x + w * 0.34, y - h * 0.5, x + w * 0.5, y - h * 0.62)
      .bezierCurveTo(x + w * 1.25, y - h * 0.42, x + w * 1.1, y - h * 0.1, x, y);
  }

  private finish(x0: number) {
    const cx = x0 + END_W / 2;
    const g = new Graphics();
    g.rect(x0, -1400, END_W + 600, 1400 + CURB).fill(0x30365a);
    for (let r = 0; r < 12; r++) for (let c = 0; c < 4; c++) g.roundRect(x0 + 12 + c * 54 + (r % 2) * 26, 10 + r * 24, 46, 14, 3).fill({ color: 0x2a3050, alpha: 0.9 });
    // arch + light cone
    g.roundRect(cx - 48, 70, 96, CURB - 68, 48).fill(0x1d2238);
    g.poly([cx - 16, 130, cx + 16, 130, cx + 46, CURB, cx - 46, CURB]).fill({ color: 0xf6d777, alpha: 0.24 });
    g.ellipse(cx, CURB - 8, 22, 6).fill(0xd9d6c8).roundRect(cx - 14, CURB - 26, 28, 18, 4).fill(0xe8e5d9);
    this.lanesLayer.addChild(g);

    const egg = new Container();
    egg.position.set(cx, 170);
    const eg = new Graphics();
    eg.moveTo(0, -42).bezierCurveTo(30, -42, 36, 8, 0, 26).bezierCurveTo(-36, 8, -30, -42, 0, -42).fill(0xf5c518);
    eg.ellipse(-10, -16, 8, 14).fill({ color: 0xfff3a8, alpha: 0.75 });
    eg.moveTo(0, -42).bezierCurveTo(30, -42, 36, 8, 0, 26).bezierCurveTo(-36, 8, -30, -42, 0, -42).stroke({ width: 3, color: 0xc7860b, alpha: 0.7 });
    const text = new Text({ text: `${this.laneMul[this.lanes].toFixed(2)}x`, style: new TextStyle({ fontFamily: font, fontSize: 21, fontWeight: '800', fill: 0xfff3a8, stroke: { color: 0x6b4300, width: 4 } }) });
    text.anchor.set(0.5);
    text.y = -6;
    egg.addChild(eg, text);
    this.coinsLayer.addChild(egg);
    this.finale = { egg, text };
  }

  private road(W: number) {
    const g = new Graphics();
    g.rect(-600, CURB, W + 1200, 3).fill(C.curb);
    g.rect(-600, CURB + 3, W + 1200, H - CURB - 3).fill(C.road);
    for (let i = 0; i < this.lanes + 2; i++) {
      const x = i === 0 ? 0 : START_W + (i - 1) * LW;
      g.roundRect(x + 3, CURB + 6, (i === 0 ? START_W : LW) - 6, H - CURB - 9, 3).fill({ color: C.slab, alpha: 0.9 });
    }
    this.lanesLayer.addChild(g);
  }

  // ---- camera ---------------------------------------------------------------
  private posX(i: number) {
    if (i <= 0) return START_W / 2;
    return START_W + (i - 1) * LW + LW / 2;
  }

  private layout(animate: boolean) {
    const { width, height } = this.app.screen;
    // show about three lanes on a phone, more on a wide stage; never smaller than the road's own height
    this.scale = Math.min(height / H, width / (LW * 3.1));
    this.world.scale.set(this.scale);
    this.world.y = height - H * this.scale;
    const W = START_W + this.lanes * LW + END_W;
    const target = width * 0.36 - this.posX(this.lane) * this.scale;
    const minX = Math.min(0, width - W * this.scale);
    const x = Math.max(minX, Math.min(0, target));
    if (animate) gsap.to(this.world, { x, duration: 0.5, ease: 'power2.out' });
    else { gsap.killTweensOf(this.world); this.world.x = x; }
  }

  // ---- chicken ------------------------------------------------------------------
  private buildChicken() {
    const b = this.body;
    const sh = new Graphics().ellipse(0, 1, 36, 7).fill({ color: 0x000000, alpha: 0.32 });
    const legs = new Graphics();
    for (const lx of [-13, 13]) {
      legs.roundRect(lx - 2.5, -22, 5, 22, 2).fill(0xf59e0b);
      legs.poly([lx - 11, 0, lx + 11, 0, lx + 7, -5, lx - 7, -5]).fill(0xf59e0b);
    }
    // three short tail feathers fanned up and back, mostly hidden behind the body
    const tail = new Graphics();
    for (const [dx, dy, rot, len] of [[-34, -70, -0.35, 20], [-38, -62, -0.75, 18], [-30, -76, 0.0, 17]] as const) {
      const f = new Graphics().ellipse(0, 0, 7, len).fill(rot === 0 ? 0xe9ecf4 : 0xd3d8e6);
      f.position.set(dx, dy); f.rotation = rot; tail.addChild(f);
    }
    const g = new Graphics();
    g.ellipse(0, -48, 43, 39).fill(0xdde1ec);                       // body shade
    g.ellipse(-2, -52, 40, 36).fill(0xf6f8fc);                      // body
    g.ellipse(-6, -60, 26, 18).fill({ color: 0xffffff, alpha: 0.8 }); // highlight
    g.ellipse(-16, -46, 22, 16).fill(0xe3e7f2);                     // wing
    g.moveTo(-32, -44).quadraticCurveTo(-16, -34, 2, -44).stroke({ width: 2, color: 0xc4cadb });
    g.moveTo(-30, -52).quadraticCurveTo(-16, -43, 0, -52).stroke({ width: 2, color: 0xc4cadb });
    // head
    g.circle(24, -84, 25).fill(0xf6f8fc);
    g.ellipse(32, -64, 6, 9).fill(0xe53944);                         // wattle
    g.circle(12, -107, 8.5).fill(0xe53944).circle(24, -112, 9.5).fill(0xe53944).circle(36, -107, 8.5).fill(0xe53944);
    g.circle(24, -103, 14).fill(0xe53944);
    // beak
    g.poly([44, -87, 67, -80, 44, -73]).fill(0xf8b52b);
    g.poly([44, -78, 63, -80, 44, -73]).fill(0xe08e12);
    // googly eyes
    for (const ex of [11, 33]) {
      g.circle(ex, -88, 12).fill(0xffffff).circle(ex, -88, 12).stroke({ width: 2.6, color: 0x23232d });
      g.circle(ex + 2.5, -87, 5.2).fill(0x14141b).circle(ex + 4, -89, 1.8).fill(0xffffff);
    }
    b.addChild(tail, legs, g);
    this.chicken.addChild(sh, b);
    this.chicken.visible = false;
  }

  // ---- states ---------------------------------------------------------------------
  private setCurrent(lane: number) {
    for (let i = 1; i < this.coins.length; i++) {
      const c = this.coins[i];
      const want: CoinState = i < lane ? 'gold' : i === lane ? 'green' : 'steel';
      if (c.state !== want && c.state !== 'red') this.paintCoin(c, want);
    }
    this.drawGlow(lane);
  }

  private drawGlow(lane: number) {
    this.glow.clear();
    if (lane < 1) { this.glow.alpha = 0; return; }
    const x0 = START_W + (lane - 1) * LW;
    this.glow.roundRect(x0 + 4, 206, LW - 8, CURB - 206, 6).fill({ color: 0xffe9a0, alpha: 0.1 });
    this.glow.alpha = 0;
    gsap.to(this.glow, { alpha: 1, duration: 0.35 });
  }

  idle(on: boolean) {
    this.idleTween?.kill();
    this.body.y = 0;
    if (on && this.chicken.visible) this.idleTween = gsap.to(this.body, { y: -4, duration: 0.7, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  }

  // ---- actions --------------------------------------------------------------------
  /** The chicken hops into the next lane and its coin turns green; the one behind turns gold. */
  async hopSafe(lane: number) {
    await this.hop(this.posX(lane));
    this.lane = lane;
    this.setCurrent(lane);
    this.layout(true);
    this.pulseCoin(lane);
  }

  private hop(x: number) {
    return new Promise<void>((done) => {
      const tl = gsap.timeline({ onComplete: done });
      const dx = x - this.chicken.x;
      tl.to(this.body.scale, { x: 1.12, y: 0.84, duration: 0.09, ease: 'power1.out' })
        .to(this.body.scale, { x: 0.92, y: 1.12, duration: 0.12 })
        .to(this.chicken, { x: this.chicken.x + dx * 0.5, duration: 0.2, ease: 'sine.out' }, '<')
        .to(this.body, { y: -58, duration: 0.2, ease: 'power2.out' }, '<')
        .to(this.body, { rotation: 0.12, duration: 0.2 }, '<')
        .to(this.chicken, { x, duration: 0.2, ease: 'sine.in' })
        .to(this.body, { y: 0, rotation: 0, duration: 0.2, ease: 'power2.in' }, '<')
        .to(this.body.scale, { x: 1.16, y: 0.8, duration: 0.07 })
        .call(() => this.dust(x))
        .to(this.body.scale, { x: 1, y: 1, duration: 0.18, ease: 'back.out(3)' });
    });
  }

  private dust(x: number) {
    for (let i = 0; i < 8; i++) {
      const p = new Graphics().circle(0, 0, 3 + Math.random() * 3).fill({ color: 0xcfd3e6, alpha: 0.7 });
      p.position.set(x + (Math.random() - 0.5) * 30, CURB - 2);
      this.fxLayer.addChild(p);
      gsap.to(p, { x: p.x + (i % 2 ? 1 : -1) * (14 + Math.random() * 22), y: CURB - 14 - Math.random() * 14, alpha: 0, duration: 0.45, ease: 'power2.out', onComplete: () => p.destroy() });
    }
  }

  private pulseCoin(lane: number) {
    const c = this.coins[lane];
    if (!c) return;
    gsap.fromTo(c.box.scale, { x: 1, y: 1 }, { x: 1.14, y: 1.14, duration: 0.14, yoyo: true, repeat: 1, ease: 'power2.out' });
  }

  /** Chicken steps into the lane, fire bursts from the grate, a roast chicken is left on a plate. */
  async hopBust(lane: number) {
    await this.hop(this.posX(lane));
    this.lane = lane;
    this.layout(true);
    this.drawGlow(0);
    const coin = this.coins[lane];
    const x = this.posX(lane);
    this.idle(false);
    // the grate rumbles, then fire
    await gsap.to(this.chicken, { x: x + 2, duration: 0.05, yoyo: true, repeat: 5 });
    if (coin) this.paintCoin(coin, 'red');
    this.fire(x);
    this.shake();
    gsap.to(this.chicken, { alpha: 0, duration: 0.12 });
    this.plate(x);
    await new Promise((r) => setTimeout(r, 650));
  }

  private fire(x: number) {
    const holder = new Container();
    this.fxLayer.addChild(holder);
    // heat glow
    const heat = new Graphics().rect(x - LW / 2, -400, LW, CURB + 400).fill({ color: 0xff5a1f, alpha: 0.07 });
    holder.addChild(heat);
    gsap.fromTo(heat, { alpha: 0 }, { alpha: 1, duration: 0.2 });
    const specs = [[-34, 0.8], [-14, 1.0], [12, 0.95], [34, 0.75], [0, 1.2], [-24, 0.6], [24, 0.65]];
    specs.forEach(([dx, s], i) => {
      const f = new Container();
      f.position.set(x + dx, CURB - 20);
      const outer = this.flamePath(new Graphics(), 0, 0, 22, 150).fill(0xff3b1f);
      const mid = this.flamePath(new Graphics(), 0, 0, 14, 112).fill(0xff8a1f);
      const core = this.flamePath(new Graphics(), 0, 0, 8, 70).fill(0xffd23f);
      f.addChild(outer, mid, core);
      f.scale.set(0.2);
      holder.addChild(f);
      const h = s * 0.95 + 0.25;
      gsap.to(f.scale, { x: s * 1.0, y: h, duration: 0.28, ease: 'power2.out', delay: i * 0.025 });
      this.fires.push(gsap.to(f.scale, { y: h * 1.14, x: s * 0.92, duration: 0.22 + (i % 3) * 0.06, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 0.3 }));
      this.fires.push(gsap.to(f, { rotation: (i % 2 ? 1 : -1) * 0.08, duration: 0.3 + i * 0.03, yoyo: true, repeat: -1, ease: 'sine.inOut' }));
    });
    // embers
    for (let i = 0; i < 18; i++) {
      const e = new Graphics().circle(0, 0, 2 + Math.random() * 2.5).fill(i % 2 ? 0xffd23f : 0xff7a1f);
      e.position.set(x + (Math.random() - 0.5) * 70, CURB - 30);
      holder.addChild(e);
      this.fires.push(gsap.to(e, { y: -80 - Math.random() * 220, x: e.x + (Math.random() - 0.5) * 80, alpha: 0, duration: 0.9 + Math.random() * 0.9, repeat: -1, delay: Math.random() * 0.8, ease: 'power1.out' }));
    }
  }

  private plate(x: number) {
    const r = new Container();
    r.position.set(x, CURB);
    const g = new Graphics();
    g.ellipse(0, -3, 50, 10).fill(0xdadbe6).ellipse(0, -6, 46, 8).fill(0xf5f5fa);
    g.ellipse(0, -26, 36, 24).fill(0xb4601a);
    g.ellipse(-4, -33, 26, 13).fill({ color: 0xe2933a, alpha: 0.95 });
    g.ellipse(8, -22, 22, 12).fill({ color: 0x8f4710, alpha: 0.55 });
    g.roundRect(-52, -38, 24, 11, 5).fill(0xc9772a);                 // drumstick
    g.circle(-54, -34, 6).fill(0xf3ead9);
    g.moveTo(-8, -32).lineTo(0, -24).stroke({ width: 3, color: 0x3a1b05 });
    g.moveTo(0, -32).lineTo(-8, -24).stroke({ width: 3, color: 0x3a1b05 });
    g.moveTo(12, -32).lineTo(20, -24).stroke({ width: 3, color: 0x3a1b05 });
    g.moveTo(20, -32).lineTo(12, -24).stroke({ width: 3, color: 0x3a1b05 });
    r.addChild(g);
    r.scale.set(0.2);
    this.fxLayer.addChild(r);
    gsap.to(r.scale, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2.2)' });
    this.roast = r;
  }

  private shake() {
    const x0 = this.world.x;
    gsap.fromTo(this.world, { x: x0 - 9 }, { x: x0, duration: 0.5, ease: 'elastic.out(1.6, 0.3)' });
  }

  private stopFire() {
    this.fires.forEach((t) => t.kill());
    this.fires = [];
  }

  /** The chicken reaches the golden egg. */
  async finishRun() {
    const f = this.finale;
    if (!f) return;
    const cx = f.egg.x;
    this.drawGlow(0);
    await this.hop(cx - 66);
    this.lane = this.lanes;
    this.layout(true);
    gsap.fromTo(f.egg.scale, { x: 1, y: 1 }, { x: 1.25, y: 1.25, duration: 0.25, yoyo: true, repeat: 1, ease: 'power2.out' });
  }

  /** Coins burst from the chicken and the payout floats up. */
  celebrate(win: number, label: string) {
    const { x } = this.chicken.position;
    const y = CURB - 60;
    for (let i = 0; i < 26; i++) {
      const c = new Graphics().circle(0, 0, 7).fill(0xf8c61c).circle(0, 0, 7).stroke({ width: 2, color: 0xb98a1c });
      c.position.set(x, y);
      this.fxLayer.addChild(c);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, d = 70 + Math.random() * 150;
      gsap.to(c, { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, duration: 0.5, ease: 'power2.out' });
      gsap.to(c, { y: '+=120', alpha: 0, duration: 0.55, delay: 0.5, ease: 'power2.in', onComplete: () => c.destroy() });
    }
    const t = new Text({ text: `${label}\n+${win.toFixed(2)}`, style: new TextStyle({ fontFamily: font, fontSize: 30, fontWeight: '800', fill: 0xffffff, align: 'center', stroke: { color: 0x1a6b34, width: 6 } }) });
    t.anchor.set(0.5);
    t.position.set(x, y - 150);
    this.fxLayer.addChild(t);
    gsap.fromTo(t.scale, { x: 0.4, y: 0.4 }, { x: 1, y: 1, duration: 0.25, ease: 'back.out(2)' });
    gsap.to(t, { y: y - 210, alpha: 0, duration: 1.2, delay: 0.7, ease: 'power1.out', onComplete: () => t.destroy() });
  }
}
