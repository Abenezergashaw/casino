// Visual layer only. It never decides an outcome: main.ts asks the math (open-rgs Lua) what happened and
// calls hop / bust / celebrate here to show it. Top-down road, lanes are vertical strips, the chicken
// crosses left to right and the camera follows.
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import gsap from 'gsap';

const H = 520;            // design height of the road
const LW = 112;           // lane width
const SIDE = 170;         // start / finish pavement width
const CAR_COLORS = [0xe8453c, 0x3b82f6, 0xf5b324, 0x22b07d, 0x8b5cf6, 0xf97316, 0xe5e7eb];

const labelStyle = (size: number, fill = 0xffffff) =>
  new TextStyle({ fontFamily: 'Roboto, system-ui, sans-serif', fontSize: size, fontWeight: '900', fill, stroke: { color: 0x14161a, width: Math.max(3, size / 7) } });

interface Car { g: Graphics; dir: 1 | -1; speed: number; laneIdx: number }

export class Scene {
  private world = new Container();
  private road = new Container();
  private tags: Container[] = [];
  private cars: Car[] = [];
  private laneMul: number[] = [];
  private chicken = new Container();
  private chickenBody = new Container();
  private fx = new Container();
  private lanes = 0;
  private lane = 0;
  private scale = 1;

  constructor(private app: Application) {
    this.world.addChild(this.road, this.chicken, this.fx);
    app.stage.addChild(this.world);
    this.buildChicken();
    app.ticker.add((t) => this.tick(t.deltaTime));
    app.renderer.on('resize', () => this.layout(false));
  }

  // ---- world ------------------------------------------------------------
  /** Rebuild the road for a new round. `mult(n)` is only used to print the lane tags. */
  reset(lanes: number, mult: (n: number) => number) {
    this.lanes = lanes;
    this.lane = 0;
    this.road.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.tags = [];
    this.cars = [];
    this.laneMul = Array.from({ length: lanes + 1 }, (_, i) => (i === 0 ? 1 : mult(i)));
    const W = SIDE * 2 + lanes * LW;

    const ground = new Graphics().rect(-400, -200, W + 800, H + 400).fill(0x1d2a22);
    this.road.addChild(ground);
    this.pavement(0, SIDE, true);
    this.pavement(SIDE + lanes * LW, SIDE, false);

    for (let i = 1; i <= lanes; i++) {
      const x = SIDE + (i - 1) * LW;
      const lane = new Graphics().rect(x, 0, LW, H).fill(i % 2 ? 0x2b2e35 : 0x30343c);
      // dashed lane edge
      for (let y = 8; y < H; y += 44) lane.rect(x - 2, y, 4, 24).fill({ color: 0xe5e7eb, alpha: 0.55 });
      this.road.addChild(lane);
    }
    // tags after every lane is drawn (so a neighbouring lane never covers them), cars on top of the tags
    for (let i = 1; i <= lanes; i++) this.addTag(i, this.laneX(i));
    for (let i = 1; i <= lanes; i++) for (let k = 0; k < 2; k++) this.addCar(i, SIDE + (i - 1) * LW + LW / 2, k);
    // finish line
    const fin = new Graphics();
    for (let y = 0; y < H; y += 26) for (let c = 0; c < 2; c++) fin.rect(SIDE + lanes * LW + c * 13, y, 13, 26).fill((y / 26 + c) % 2 ? 0xf8fafc : 0x111418);
    this.road.addChild(fin);

    this.chicken.alpha = 1;
    this.chicken.scale.set(0.82);
    this.chicken.position.set(this.laneX(0), H / 2);
    this.chicken.visible = true;
    this.chickenBody.rotation = 0;
    this.chickenBody.scale.set(1);
    this.chickenBody.alpha = 1;
    this.fx.removeChildren();
    this.layout(false);
  }

  private pavement(x: number, w: number, start: boolean) {
    const g = new Graphics().rect(x, 0, w, H).fill(0x8a8f98);
    for (let y = 0; y < H; y += 52) for (let c = 0; c < Math.ceil(w / 52); c++)
      g.rect(x + c * 52 + 2, y + 2, 48, 48).fill({ color: (y / 52 + c) % 2 ? 0x9a9fa8 : 0x858a93, alpha: 1 });
    this.road.addChild(g);
    const sign = new Text({ text: start ? 'START' : 'SAFE', style: labelStyle(26, 0xfde68a) });
    sign.anchor.set(0.5);
    sign.position.set(x + w / 2, 44);
    this.road.addChild(sign);
  }

  private addTag(i: number, x: number) {
    const c = new Container();
    c.position.set(x, H / 2 + 74);
    const base = new Graphics().circle(0, 0, 34).fill(0x15171c).circle(0, 0, 34).stroke({ width: 4, color: 0x4b5160 }).circle(0, 0, 25).stroke({ width: 2, color: 0x2e323c });
    const t = new Text({ text: `${this.laneMul[i].toFixed(2)}x`, style: labelStyle(this.laneMul[i] >= 100 ? 15 : 18, 0xfbbf24) });
    t.anchor.set(0.5);
    c.addChild(base, t);
    c.label = 'tag';
    this.road.addChild(c);
    this.tags[i] = c;
  }

  private addCar(laneIdx: number, cx: number, k: number) {
    const color = CAR_COLORS[(laneIdx * 3 + k * 2) % CAR_COLORS.length];
    const g = this.carGraphic(color);
    const dir: 1 | -1 = laneIdx % 2 ? 1 : -1;
    g.position.set(cx, ((laneIdx * 83 + k * (H + 240) / 2) % (H + 240)) - 120);
    this.road.addChild(g);
    this.cars.push({ g, dir, speed: 2.1 + ((laneIdx * 7) % 9) * 0.28, laneIdx });
  }

  private carGraphic(color: number) {
    const g = new Graphics();
    g.roundRect(-26, -50, 52, 100, 11).fill(color);
    g.roundRect(-20, -30, 40, 20, 5).fill(0x1b2a3a);          // windshield
    g.roundRect(-20, 14, 40, 16, 5).fill(0x1b2a3a);           // rear window
    g.rect(-24, -48, 10, 5).fill(0xfff4c2).rect(14, -48, 10, 5).fill(0xfff4c2); // lights
    g.roundRect(-26, -50, 52, 100, 11).stroke({ width: 2, color: 0x000000, alpha: 0.35 });
    return g;
  }

  private buildChicken() {
    const b = this.chickenBody;
    const g = new Graphics();
    g.ellipse(0, 6, 30, 24).fill(0xffffff);                              // body
    g.ellipse(-8, 8, 16, 12).fill(0xf1f5f9);                             // wing
    g.circle(24, -12, 15).fill(0xffffff);                                // head
    g.poly([37, -14, 52, -9, 37, -4]).fill(0xf59e0b);                    // beak
    g.circle(28, -16, 3.2).fill(0x111418);                               // eye
    g.circle(18, -28, 6).fill(0xe11d48).circle(26, -30, 6).fill(0xe11d48); // comb
    g.poly([-30, 4, -46, -4, -40, 12]).fill(0xe2e8f0);                   // tail
    g.rect(-6, 28, 4, 12).fill(0xf59e0b).rect(8, 28, 4, 12).fill(0xf59e0b); // legs
    b.addChild(g);
    this.chicken.addChild(new Graphics().ellipse(0, 34, 30, 9).fill({ color: 0x000000, alpha: 0.28 }), b);
    this.chicken.visible = false;
  }

  // ---- camera -----------------------------------------------------------
  /** Where the chicken stands after crossing `i` lanes: start pavement, a lane divider, or the finish pavement. */
  private laneX(i: number) {
    if (i <= 0) return SIDE / 2;
    if (i >= this.lanes) return SIDE + this.lanes * LW + SIDE / 2;
    return SIDE + i * LW;
  }
  /** Centre line of lane `k` (1-based), where its cars drive. */
  private laneCenter(k: number) { return SIDE + (k - 1) * LW + LW / 2; }

  private layout(animate: boolean) {
    const { width, height } = this.app.screen;
    this.scale = height / H;
    this.world.scale.set(this.scale);
    const target = width * 0.3 - this.laneX(this.lane) * this.scale;
    const maxX = 0, minX = Math.min(0, width - (SIDE * 2 + this.lanes * LW) * this.scale);
    const x = Math.max(minX, Math.min(maxX, target));
    if (animate) gsap.to(this.world, { x, duration: 0.45, ease: 'power2.out' });
    else { gsap.killTweensOf(this.world); this.world.x = x; }
  }

  private tick(dt: number) {
    for (const c of this.cars) {
      const slow = (c.g as any).slow ?? 1;
      c.g.y += c.dir * c.speed * dt * 2 * slow;
      if (c.dir === 1 && c.g.y > H + 120) c.g.y = -120;
      if (c.dir === -1 && c.g.y < -120) c.g.y = H + 120;
      c.g.rotation = c.dir === 1 ? Math.PI : 0;
    }
  }

  // ---- actions ----------------------------------------------------------
  /** Chicken waits for a gap, hops to the next lane, tag lights up. */
  async hopSafe(lane: number) {
    const laneCars = this.cars.filter((c) => c.laneIdx === lane);
    await Promise.all(laneCars.map((c) => gsap.to(c.g as any, { slow: 0.12, duration: 0.25 })));
    await this.hop(this.laneX(lane));
    this.lane = lane;
    this.layout(true);
    this.lightTag(lane);
    laneCars.forEach((c) => gsap.to(c.g as any, { slow: 1, duration: 0.9, delay: 0.2 }));
  }

  private hop(x: number) {
    return new Promise<void>((done) => {
      const tl = gsap.timeline({ onComplete: done });
      tl.to(this.chickenBody.scale, { x: 1.12, y: 0.86, duration: 0.07 })
        .to(this.chickenBody.scale, { x: 0.94, y: 1.1, duration: 0.1 })
        .to(this.chicken, { x, duration: 0.34, ease: 'power1.inOut' }, '<')
        .to(this.chickenBody, { y: -46, duration: 0.17, ease: 'power2.out' }, '<')
        .to(this.chickenBody, { y: 0, duration: 0.17, ease: 'power2.in' })
        .to(this.chickenBody.scale, { x: 1.14, y: 0.84, duration: 0.06 })
        .to(this.chickenBody.scale, { x: 1, y: 1, duration: 0.12, ease: 'back.out(3)' });
    });
  }

  private lightTag(lane: number) {
    const tag = this.tags[lane];
    if (!tag) return;
    const glow = new Graphics().circle(0, 0, 42).fill({ color: 0x22c55e, alpha: 0.45 });
    tag.addChildAt(glow, 0);
    gsap.fromTo(glow.scale, { x: 0.6, y: 0.6 }, { x: 1.5, y: 1.5, duration: 0.5 });
    gsap.to(glow, { alpha: 0, duration: 0.5, onComplete: () => glow.destroy() });
  }

  /** Chicken steps into the lane and a car from off-screen hits it. */
  async hopBust(lane: number) {
    const x = this.laneCenter(lane);
    const laneCars = this.cars.filter((c) => c.laneIdx === lane);
    await this.halfHop(x - 40);
    const hit = this.carGraphic(0xdc2626);
    const dir = lane % 2 ? 1 : -1;
    hit.position.set(x, dir === 1 ? -160 : H + 160);
    hit.rotation = dir === 1 ? Math.PI : 0;
    this.road.addChild(hit);
    laneCars.forEach((c) => gsap.to(c.g as any, { slow: 0, duration: 0.2 }));
    this.lane = lane - 1;
    this.layout(true);
    await gsap.to(this.chicken, { x, duration: 0.12 });
    await gsap.to(hit, { y: H / 2 + 6, duration: 0.42, ease: 'power2.in' });
    this.feathers(x, H / 2);
    this.shake();
    gsap.to(this.chickenBody, { rotation: 1.9, alpha: 0.0, duration: 0.5, ease: 'power2.out' });
    gsap.to(this.chicken, { x: x + 90 * dir, y: H / 2 + 120 * dir, alpha: 0, duration: 0.5, ease: 'power2.out' });
    await gsap.to(hit, { y: dir === 1 ? H + 220 : -220, duration: 0.7, ease: 'power1.in' });
    hit.destroy();
    laneCars.forEach((c) => gsap.to(c.g as any, { slow: 1, duration: 0.6 }));
  }

  private halfHop(x: number) {
    return new Promise<void>((done) => {
      gsap.timeline({ onComplete: done })
        .to(this.chicken, { x, duration: 0.2, ease: 'power1.out' })
        .to(this.chickenBody, { y: -28, duration: 0.1 }, '<')
        .to(this.chickenBody, { y: 0, duration: 0.1 });
    });
  }

  private feathers(x: number, y: number) {
    for (let i = 0; i < 22; i++) {
      const f = new Graphics().ellipse(0, 0, 7, 3).fill(i % 3 ? 0xffffff : 0xfca5a5);
      f.position.set(x, y);
      f.rotation = Math.random() * 6;
      this.fx.addChild(f);
      const a = Math.random() * Math.PI * 2, d = 70 + Math.random() * 130;
      gsap.to(f, { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d - 40, rotation: f.rotation + 5, alpha: 0, duration: 0.9 + Math.random() * 0.5, ease: 'power2.out', onComplete: () => f.destroy() });
    }
  }

  private shake() {
    const x0 = this.world.x;
    gsap.fromTo(this.world, { x: x0 - 10 }, { x: x0, duration: 0.45, ease: 'elastic.out(1.4, 0.25)' });
  }

  /** Coins burst from the chicken and "+win" floats up. */
  celebrate(win: number, label: string) {
    const { x, y } = this.chicken.position;
    for (let i = 0; i < 26; i++) {
      const c = new Graphics().circle(0, 0, 8).fill(0xfbbf24).circle(0, 0, 8).stroke({ width: 2, color: 0xb45309 });
      c.position.set(x, y - 20);
      this.fx.addChild(c);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, d = 90 + Math.random() * 190;
      gsap.to(c, { x: x + Math.cos(a) * d, y: y - 20 + Math.sin(a) * d, duration: 0.55, ease: 'power2.out' });
      gsap.to(c, { y: '+=140', alpha: 0, duration: 0.6, delay: 0.55, ease: 'power2.in', onComplete: () => c.destroy() });
    }
    const t = new Text({ text: `${label}\n+${win.toFixed(2)}`, style: new TextStyle({ ...labelStyle(40, 0x86efac), align: 'center' }) });
    t.anchor.set(0.5);
    t.position.set(x, y - 110);
    this.fx.addChild(t);
    gsap.to(t, { y: y - 190, alpha: 0, duration: 1.4, delay: 0.5, ease: 'power1.out', onComplete: () => t.destroy() });
  }

  /** Idle bob so the chicken looks alive between taps. */
  idle(on: boolean) {
    gsap.killTweensOf(this.chickenBody, 'y');
    if (on) gsap.to(this.chickenBody, { y: -6, duration: 0.6, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    else this.chickenBody.y = 0;
  }
}
