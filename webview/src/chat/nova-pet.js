// @ts-nocheck: plain JavaScript, typed in nova-pet.d.ts.
// Copied from ext/nova-pet/nova.js (the Nova pet web component). Update by copying it again.
/*!
 * Nova — glazen AI-companion als web component.
 *
 *   <script src="nova.js" defer><\/script>
 *   <nova-pet state="idle" size="160"></nova-pet>
 *
 * Geen dependencies. Eén bestand. Werkt in moderne browsers
 * (Chrome/Edge 105+, Safari 16+, Firefox 110+).
 *
 * Attributen : state, size, theme, autonomy, track, interactive, sleep-after, sound, volume
 * Properties : state, level (0–1), NovaPet.muted (globaal)
 * Methodes   : react(name), lookAt(target), wake(), sleep()
 * Events     : nova-statechange, nova-poke, nova-pet, nova-hug, nova-sleep, nova-wake
 *
 * Geluid staat standaard uit. Zet sound="on"; het speelt na de eerste tik of toets (browserregel).
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.customElements || customElements.get('nova-pet')) return;

  /* ------------------------------------------------------------------ utils */
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
  const rand = (a, b) => a + Math.random() * (b - a);
  const chance = (p) => Math.random() < p;
  const f2 = (n) => Math.round(n * 100) / 100;
  // Beelden per seconde zodra Nova slaapt en stil ligt: spaart energie, slapen hoeft niet vloeiend.
  const DOZE_FPS = 10;

  class Spring {
    constructor(x, k, c) { this.x = x; this.v = 0; this.target = x; this.k = k; this.c = c; }
    step(h) { this.v += (this.k * (this.target - this.x) - this.c * this.v) * h; this.x += this.v * h; }
  }

  /* --------------------------------------------------------------- shapes */
  // Vierpuntige supernova-kern (orb-ruimte: straal 100, middelpunt 0,0)
  const STAR = 'M0,-59C10,-22 32,4 76,10C32,16 8,40 0,79C-8,40 -32,16 -76,10C-32,4 -10,-22 0,-59Z';
  const SPARK = 'M0,-10C1.2,-3 3,-1.2 10,0C3,1.2 1.2,3 0,10C-1.2,3 -3,1.2 -10,0C-3,-1.2 -1.2,-3 0,-10Z';
  const SPARK_COLORS = ['#3B82F6', '#8B5CF6', '#7FA6FF', '#B49BFF', '#5B8CFF'];

  // Oog = twee bogen tussen (-w,0) en (w,0). T = bovenrand, B = onderrand (negatief = omhoog).
  // Ellips: T=-h,B=+h · blije boog ∩: T=-h,B=-h/3 · gesloten ‿: T>0,B>0
  const FACES = {
    content: { w: 14, T: -11.5, B: -4.4, y: 18, sx: 25, rot: 0 },
    open:    { w: 7.6, T: -10.5, B: 10.5, y: 15, sx: 23, rot: 0 },
    tall:    { w: 7.2, T: -13, B: 13, y: 14, sx: 23, rot: 0 },
    wide:    { w: 10, T: -13.5, B: 13.5, y: 14, sx: 25, rot: 0 },
    dot:     { w: 5.4, T: -5.4, B: 5.4, y: 13, sx: 21, rot: 0 },
    sleepy:  { w: 8.6, T: -1.6, B: 8, y: 17, sx: 23, rot: 0 },
    closed:  { w: 12, T: 1.8, B: 6.4, y: 21, sx: 24, rot: 0 },
    worried: { w: 8, T: -7.5, B: 10, y: 16, sx: 23, rot: 22 },
    squeeze: { w: 9, T: -0.6, B: 0.6, y: 17, sx: 24, rot: 0 },
  };

  const STATES = {
    idle:       { face: 'content', rgb: [59, 130, 246],  glow: .55, ring: 1,   orbit: .55, tilt: -12, ry: 22, float: 1,   fs: 1,    lean: 1,     rim: .35, rimSpd: 18,  core: .55 },
    listening:  { face: 'tall',    rgb: [59, 130, 246],  glow: .9,  ring: 1,   orbit: .9,  tilt: -5,  ry: 18, float: .55, fs: 1.15, lean: 1.045, rim: .55, rimSpd: 30,  core: .8 },
    thinking:   { face: 'dot',     rgb: [139, 92, 246],  glow: .85, ring: 1,   orbit: 3.2, tilt: 18,  ry: 26, float: .45, fs: .7,   lean: 1,     rim: 1,   rimSpd: 160, core: .75 },
    responding: { face: 'content', rgb: [99, 102, 241],  glow: .85, ring: 1,   orbit: 1.4, tilt: -20, ry: 24, float: .9,  fs: 1.25, lean: 1.02,  rim: .7,  rimSpd: 70,  core: .8 },
    success:    { face: 'content', rgb: [124, 92, 246],  glow: 1,   ring: 0,   orbit: .6,  tilt: -12, ry: 22, float: 1.1, fs: 1.2,  lean: 1.03,  rim: .8,  rimSpd: 40,  core: 1 },
    error:      { face: 'worried', rgb: [236, 112, 160], glow: .6,  ring: .55, orbit: .25, tilt: -4,  ry: 20, float: .35, fs: .6,   lean: .985,  rim: .3,  rimSpd: 10,  core: .45 },
    resting:    { face: 'closed',  rgb: [129, 140, 248], glow: .32, ring: 0,   orbit: .12, tilt: -12, ry: 22, float: .6,  fs: .45,  lean: 1,     rim: .15, rimSpd: 6,   core: .3 },
  };

  /* ---------------------------------------------------------------- acts */
  // Eenmalige gedragingen. frame() zet per frame overrides (n.ov) en spring-targets.
  const ACTS = {
    joy:       { dur: 1.5, start(n) { n._jump(48); n._burst(7); }, frame(n, a, p) { n.ov.face = 'content'; n.ov.blush = 1; n.rot.target = Math.sin(a.t * 15) * 7 * (1 - p); } },
    love:      { dur: 2.8, start(n) { n._burst(3); }, frame(n, a, p, dt) { n.ov.face = 'content'; n.ov.blush = 1; n.ov.purr = 1; n.ov.glow = .2; if (chance(dt * 2.4)) n._spark(); } },
    surprise:  { dur: 1.2, start(n) { n.sq.v += 3.4; n._jump(28); }, frame(n, a) { n.ov.face = a.t < .75 ? 'wide' : 'open'; n.ov.noBlink = a.t < .75; } },
    hop:       { dur: 1.1, frame(n, a) { n.ov.face = 'content'; if (a.t < .16) n.sq.target = -.13; else if (!a.f) { a.f = 1; n.sq.v += 2.6; n._jump(58); n._sfx('boing'); } } },
    wiggle:    { dur: 1.3, frame(n, a, p) { n.ov.face = 'content'; const s = Math.sin(a.t * 14) * (1 - p); n.rot.target = s * 10; n.bx.target = s * 1.2; } },
    nod:       { dur: 1.2, frame(n, a, p) { n.ov.face = 'content'; const s = Math.max(0, Math.sin(a.t * TAU * 1.7)); n.ov.dy = s * 2.6 * (1 - p * .5); n.ov.gx = 0; n.ov.gy = .35 * s; } },
    shake:     { dur: 1.1, frame(n, a, p) { n.ov.face = a.o.face || 'open'; const s = Math.sin(a.t * TAU * 2.6) * (1 - p); n.bx.target = s * 2.6; n.rot.target = -s * 5; n.ov.gx = -s * .8; n.ov.gy = .1; } },
    yawn:      { dur: 2.6, frame(n, a) { const t = a.t; n.ov.noBlink = true; if (t < .5) n.ov.face = 'sleepy'; else if (t < 1.7) { n.ov.face = 'closed'; n.sq.target = .11; n.rot.target = -4; } else n.ov.face = 'sleepy'; }, end(n, a) { if (a.o.nap) n._setNap(true); } },
    dizzy:     { dur: 2.8, start(n) { n._burst(4); }, frame(n, a, p) { n.ov.face = 'squeeze'; const w = a.t * 8; n.rot.target = Math.sin(w) * 11 * (1 - p * .6); n.bx.target = Math.cos(w) * 1.6 * (1 - p); n.ov.orbit = 7 * (1 - p) + .6; } },
    poke:      { dur: 1.0, start(n, a) { const d = a.o.dir || { x: 0, y: -1 }; n.bx.v -= d.x * 42 * n._mo; n.by.v -= d.y * 26 * n._mo; n.sq.v -= 3.4 * n._mo; }, frame(n, a, p) { if (a.t < .24) { n.ov.face = 'wide'; n.ov.noBlink = true; } else { if (!a.g) { a.g = 1; n._sfx('giggle'); } n.ov.face = 'squeeze'; n.rot.target = Math.sin(a.t * 28) * 4.5 * (1 - p); n.ov.blush = .6; } } },
    celebrate: { dur: 2.0, frame(n, a, p) { n.ov.face = 'content'; n.ov.blush = .7; n.ov.glow = .25; if (a.t < .18) n.sq.target = -.15; else if (!a.f) { a.f = 1; n.sq.v += 3.2; n._jump(78); n._burst(12); n._sfx('celebrate'); } else n.rot.target = Math.sin(a.t * 12) * 6 * (1 - p); } },
    startle:   { dur: 1.0, start(n) { n.sq.v += 2.6; n._jump(34); }, frame(n, a) { n.ov.face = a.t < .5 ? 'wide' : 'open'; n.ov.noBlink = a.t < .5; } },
    perk:      { dur: .7, start(n) { n.sq.v += 2.2; }, frame(n, a) { n.ov.face = a.t < .3 ? 'wide' : 'tall'; } },
    stretch:   { dur: 1.8, frame(n, a) { if (a.t < .8) { n.sq.target = .14; n.ov.face = 'closed'; } else n.ov.face = 'content'; } },
    lookaround:{ dur: 2.6, frame(n, a) { n.ov.face = 'open'; n.ov.gx = a.t < .9 ? -.9 : a.t < 1.9 ? .9 : 0; n.ov.gy = -.1; n.rot.target = n.ov.gx * 5; } },
    moonwatch: { dur: 3.2, frame(n) { n.ov.face = 'open'; n.ov.orbit = 2.2; n.ov.gx = n.moonX; n.ov.gy = n.moonY; } },
    sparklook: { dur: 2.2, start(n, a) { const s = chance(.5) ? 1 : -1; a.px = s * rand(30, 40); a.py = rand(-34, -22); n._spark(a.px, a.py, { vx: 0, vy: -2, life: 1.6, size: 6 }); },
                 frame(n, a) { if (a.t < 1.4) { n.ov.face = 'open'; n.ov.gx = clamp(a.px / 32, -1, 1); n.ov.gy = clamp(a.py / 32, -1, 1); n.rot.target = n.ov.gx * 5; } else { n.ov.face = 'content'; n.ov.blush = .5; if (!a.f) { a.f = 1; n._jump(30); n._sfx('perk'); } } } },
    hug:       { dur: Infinity, frame(n) { n.ov.face = 'content'; n.ov.blush = 1; n.ov.glow = .3; n.sq.target = -.09; n.ov.purr = .6; } },
  };
  const PUBLIC_REACTIONS = ['joy', 'love', 'surprise', 'hop', 'wiggle', 'nod', 'shake', 'yawn', 'dizzy', 'celebrate', 'stretch', 'lookaround'];

  /* --------------------------------------------------------------- audio */
  // Alle geluiden worden live gesynthetiseerd met Web Audio: geen bestanden, geen downloads.
  const ACT_SFX = {
    joy: 'joy', love: 'coo', surprise: 'whoop', wiggle: 'trill', nod: 'mmhm', yawn: 'yawn', dizzy: 'dizzy',
    poke: 'boop', startle: 'huh', perk: 'perk', stretch: 'stretch', lookaround: 'hm', moonwatch: 'ooh',
    sparklook: 'tinkle', hug: 'aww', shake: (o) => (o.face === 'worried' ? 'uhoh' : 'nuhuh'),
  };
  let globalMuted = false;

  const NovaAudio = (() => {
    let ctx = null, master = null, rev = null, noiseBuf = null, wanted = false;
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const PENTA = [0, 2, 4, 7, 9];
    const penta = (base, i) => base + PENTA[i % 5] + 12 * Math.floor(i / 5);

    function impulse(c, dur, decay) {
      const len = Math.floor(c.sampleRate * dur), b = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
      return b;
    }
    function init() {
      if (ctx) return ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (_) { return null; }
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = .002; comp.release.value = .18;
      master = ctx.createGain(); master.gain.value = .9;
      master.connect(comp); comp.connect(ctx.destination);
      const conv = ctx.createConvolver(); conv.buffer = impulse(ctx, 1.8, 3.2);
      rev = ctx.createGain(); rev.gain.value = .32; rev.connect(conv); conv.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      return ctx;
    }
    // Browsers starten audio pas na een gebaar van de gebruiker; elke tik of toets ontgrendelt.
    function unlock() { if (!wanted) return; const c = init(); if (c && c.state !== 'running') { const r = c.resume(); r && r.catch && r.catch(() => {}); } }
    ['pointerdown', 'keydown', 'touchend'].forEach((e) => window.addEventListener(e, unlock, { capture: true, passive: true }));
    const ready = () => !!ctx && ctx.state === 'running';

    function out(node, pan, wet) {
      let n = node;
      if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); n.connect(p); n = p; }
      n.connect(master);
      if (wet > 0) { const s = ctx.createGain(); s.gain.value = wet; n.connect(s); s.connect(rev); }
    }
    // Eén stem: glijdende toonhoogte (f → f2 → f3), vibrato, filter en envelope
    function tone(o, vol) {
      const t0 = ctx.currentTime + .01 + (o.at || 0), d = o.d || .15;
      const osc = ctx.createOscillator(); osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f, t0);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t0 + (o.g || d));
      if (o.f3) osc.frequency.exponentialRampToValueAtTime(o.f3, t0 + d);
      if (o.vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = o.vib[0]; lg.gain.value = o.vib[1]; l.connect(lg); lg.connect(osc.frequency); l.start(t0); l.stop(t0 + d + .05); }
      const g = ctx.createGain(), a = o.a || .006, v = Math.max(.0003, (o.v || .15) * vol);
      g.gain.setValueAtTime(.0001, t0);
      g.gain.exponentialRampToValueAtTime(v, t0 + a);
      g.gain.exponentialRampToValueAtTime(.0001, t0 + d);
      let n = osc;
      if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = o.q || 1; n.connect(f); n = f; }
      n.connect(g); out(g, o.pan, o.wet == null ? .35 : o.wet);
      osc.start(t0); osc.stop(t0 + d + .05);
    }
    // Glazen klokje: grondtoon plus inharmonische boventonen, zoals een tik tegen een glas
    function bell(f, at, vol, v, d, pan) {
      v = v || .12; d = d || .9;
      tone({ f, d, v, at, pan, wet: .6, a: .003 }, vol);
      tone({ f: f * 2.76, d: d * .55, v: v * .35, at, pan, wet: .6, a: .002 }, vol);
      tone({ f: f * 5.4, d: d * .3, v: v * .15, at, pan, wet: .7, a: .002 }, vol);
    }
    function noise(o, vol) {
      const t0 = ctx.currentTime + .01 + (o.at || 0), d = o.d || .3;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = o.ft || 'bandpass'; f.frequency.setValueAtTime(o.f || 800, t0);
      if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t0 + d);
      f.Q.value = o.q || 1;
      const g = ctx.createGain(), v = Math.max(.0003, (o.v || .05) * vol);
      g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(v, t0 + (o.a || d * .4)); g.gain.exponentialRampToValueAtTime(.0001, t0 + d);
      src.connect(f); f.connect(g); out(g, o.pan, o.wet || .2);
      src.start(t0, Math.random()); src.stop(t0 + d + .05);
    }
    // Spinnen: zachte ruis en een lage brom, 23 keer per seconde gemoduleerd
    function purr(vol) {
      const t0 = ctx.currentTime + .01;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380; f.Q.value = 2;
      const hum = ctx.createOscillator(); hum.type = 'triangle'; hum.frequency.value = 58;
      const humG = ctx.createGain(); humG.gain.value = .6;
      const am = ctx.createGain(); am.gain.value = .5;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 23;
      const lfoG = ctx.createGain(); lfoG.gain.value = .5;
      lfo.connect(lfoG); lfoG.connect(am.gain);
      const g = ctx.createGain(); g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(.0003, .1 * vol), t0 + .35);
      src.connect(f); f.connect(am); hum.connect(humG); humG.connect(am); am.connect(g); out(g, 0, .1);
      src.start(t0); hum.start(t0); lfo.start(t0);
      return {
        stop() {
          const t = ctx.currentTime;
          g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(Math.max(.0001, g.gain.value), t); g.gain.exponentialRampToValueAtTime(.0001, t + .45);
          [src, hum, lfo].forEach((n) => { try { n.stop(t + .5); } catch (_) { /* al gestopt */ } });
        },
      };
    }

    const SFX = {
      boop(v, p) { tone({ f: 880 * p, f2: 520 * p, d: .12, v: .2 }, v); tone({ f: 1760 * p, f2: 1040 * p, d: .06, v: .04 }, v); },
      giggle(v, p) { [0, .085, .17].forEach((at, i) => tone({ f: (980 + i * 120) * p, f2: (1250 + i * 140) * p, d: .07, v: .11, at, type: 'triangle', lp: 3200 }, v)); },
      boing(v, p) { tone({ f: 260 * p, f2: 620 * p, d: .32, g: .09, v: .17, vib: [18, 30] }, v); },
      whoop(v, p) { tone({ f: 420 * p, f2: 1320 * p, d: .2, g: .14, v: .16, type: 'triangle', lp: 4000 }, v); bell(1568 * p, .12, v, .06, .5); },
      huh(v, p) { tone({ f: 520 * p, f2: 780 * p, d: .22, g: .2, v: .13, type: 'triangle', lp: 2600, vib: [7, 12] }, v); },
      perk(v, p) { tone({ f: 660 * p, f2: 990 * p, d: .13, v: .1 }, v); },
      joy(v, p) {
        [72, 76, 79, 84].forEach((m, i) => bell(mtof(m) * p, i * .07, v, .11, .7, (i - 1.5) * .25));
        tone({ f: 700 * p, f2: 1100 * p, f3: 950 * p, d: .3, v: .08, type: 'triangle', lp: 3000, at: .05 }, v);
      },
      celebrate(v, p) {
        [72, 76, 79, 84, 88].forEach((m, i) => bell(mtof(m) * p, i * .06, v, .12, 1, (i - 2) * .3));
        for (let i = 0; i < 6; i++) bell(mtof(penta(96, (Math.random() * 8) | 0)), .3 + i * .07 + Math.random() * .04, v, .05, .5, rand(-.8, .8));
      },
      coo(v, p) { tone({ f: 560 * p, f2: 760 * p, f3: 680 * p, d: .45, a: .06, v: .1, vib: [6, 10] }, v); tone({ f: 840 * p, f2: 1140 * p, f3: 1020 * p, d: .45, a: .06, v: .03 }, v); },
      aww(v, p) {
        tone({ f: 523 * p, f2: 600 * p, f3: 480 * p, d: .7, a: .12, v: .1, type: 'triangle', lp: 1800, vib: [5, 8] }, v);
        tone({ f: 659 * p, f2: 740 * p, f3: 600 * p, d: .7, a: .12, v: .06, type: 'triangle', lp: 1800 }, v);
      },
      trill(v, p) { for (let i = 0; i < 6; i++) tone({ f: (i % 2 ? 1180 : 940) * p, d: .07, v: .07, at: i * .065, type: 'triangle', lp: 3500, pan: i % 2 ? .3 : -.3 }, v); },
      mmhm(v, p) {
        tone({ f: 620 * p, f2: 560 * p, d: .16, a: .02, v: .1, type: 'triangle', lp: 1600 }, v);
        tone({ f: 560 * p, f2: 700 * p, d: .2, a: .02, v: .1, at: .21, type: 'triangle', lp: 1600 }, v);
      },
      uhoh(v, p) {
        tone({ f: 659 * p, d: .17, a: .015, v: .12, type: 'triangle', lp: 1800 }, v);
        tone({ f: 523 * p, f2: 494 * p, d: .34, a: .015, v: .12, at: .2, type: 'triangle', lp: 1500, vib: [6, 8] }, v);
      },
      nuhuh(v, p) { [0, .14].forEach((at) => tone({ f: 520 * p, f2: 470 * p, d: .11, v: .09, at, type: 'triangle', lp: 1800 }, v)); },
      yawn(v, p) { tone({ f: 480 * p, f2: 640 * p, f3: 300 * p, d: 1.3, g: .35, a: .2, v: .08, type: 'sawtooth', lp: 900, q: 3 }, v); noise({ f: 900, f2: 400, d: 1.2, v: .025, q: .8 }, v); },
      dizzy(v, p) { tone({ f: 1100 * p, f2: 300 * p, d: 1.2, v: .1, vib: [9, 60] }, v); [0, .35, .7].forEach((at, i) => bell(mtof(91 - i * 3) * p, at, v, .04, .4)); },
      hm(v, p) { tone({ f: 600 * p, f2: 720 * p, d: .18, a: .02, v: .055, type: 'triangle', lp: 1500 }, v); },
      ooh(v, p) { tone({ f: 500 * p, f2: 820 * p, d: .5, g: .4, a: .05, v: .07, vib: [5, 9] }, v); },
      tinkle(v, p) { bell(mtof(penta(91, (Math.random() * 6) | 0)) * p, 0, v, .06, .7, rand(-.6, .6)); },
      stretch(v, p) { tone({ f: 380 * p, f2: 720 * p, d: .7, a: .1, v: .06, type: 'triangle', lp: 1400, vib: [5, 6] }, v); },
      bubble(v, p) { const f = rand(700, 1300) * p; tone({ f, f2: f * 1.6, d: .07, v: .035, wet: .5 }, v); },
      snore(v) { noise({ f: 300, f2: 180, d: .9, a: .45, v: .035, q: .7, ft: 'lowpass' }, v); },
      syllable(v, p) { const f = mtof(penta(67, (Math.random() * 7) | 0)) * p; tone({ f, f2: f * rand(.9, 1.15), d: rand(.05, .09), a: .004, v: .07, type: 'triangle', lp: 2400, wet: .15 }, v); },
    };

    return {
      want() { wanted = true; },
      unlock,
      get ready() { return ready(); },
      play(name, vol, pitch) { if (!ready() || !SFX[name] || document.hidden) return; try { SFX[name](vol, pitch || 1); } catch (_) { /* audio is best-effort */ } },
      purr(vol) { if (!ready()) return null; try { return purr(vol); } catch (_) { return null; } },
      names: Object.keys(SFX),
    };
  })();

  /* ----------------------------------------------------------------- CSS */
  const CSS = `
:host{display:inline-block;position:relative;width:var(--nova-size,160px);aspect-ratio:1/1;vertical-align:middle;
  -webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;outline:none;
  --fill-a:1;--sh:11,16,38;--sh-a:.30;--edge:rgba(170,190,255,.45)}
:host([hidden]){display:none}
:host([theme="dark"]){--fill-a:.3;--sh:40,90,220;--sh-a:.42;--edge:rgba(200,215,255,.35)}
@media (prefers-color-scheme:dark){:host(:not([theme="light"])){--fill-a:.3;--sh:40,90,220;--sh-a:.42;--edge:rgba(200,215,255,.35)}}
.stage{position:absolute;inset:0;container-type:inline-size;--g:59,130,246}
.body,.fx{position:absolute;inset:0;pointer-events:none}
.body{transform-origin:50% 70%;will-change:transform}
.shadow{position:absolute;left:50%;top:90%;width:44cqw;height:7cqw;border-radius:50%;transform:translate(-50%,-50%);
  background:radial-gradient(closest-side,rgba(var(--sh),var(--sh-a)),rgba(var(--g),.12) 62%,rgba(var(--g),0))}
.glow{position:absolute;left:50%;top:46%;width:104cqw;height:104cqw;border-radius:50%;transform:translate(-50%,-50%);
  background:radial-gradient(closest-side,rgba(var(--g),.5),rgba(var(--g),.17) 45%,rgba(var(--g),0) 100%);opacity:.55}
.ripple{position:absolute;left:19cqw;top:15cqw;width:62cqw;height:62cqw;border-radius:50%;box-sizing:border-box;
  border:.55cqw solid rgba(var(--g),.6);opacity:0}
.listening .ripple{animation:nova-ripple 2.2s cubic-bezier(.2,.6,.3,1) infinite}
.listening .r2{animation-delay:1.1s}
@keyframes nova-ripple{0%{transform:scale(1);opacity:.6}100%{transform:scale(1.45);opacity:0}}
.ring{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.ring-glow{fill:none;stroke:rgb(var(--g));stroke-opacity:.32;stroke-linecap:round}
.ring-edge{fill:none;stroke:rgba(70,100,210,.28);stroke-linecap:round}
.ring-line{fill:none;stroke-linecap:round}
.moon-glow{fill:rgb(var(--g));opacity:.5}
.orb{position:absolute;left:19cqw;top:15cqw;width:62cqw;height:62cqw;border-radius:50%;overflow:hidden;pointer-events:auto;
  cursor:grab;touch-action:pan-y;box-shadow:0 1.6cqw 4cqw rgba(var(--g),.2),0 0 0 .25cqw var(--edge)}
:host([interactive="false"]) .orb{pointer-events:none}
:host(:focus-visible) .orb{box-shadow:0 0 0 1cqw rgba(var(--g),.55)}
.glass-back{position:absolute;inset:0;border-radius:50%;
  background:radial-gradient(130% 130% at 28% 18%,rgba(255,255,255,calc(.8*var(--fill-a))) 0%,rgba(238,243,255,calc(.52*var(--fill-a))) 28%,
    rgba(205,216,255,calc(.38*var(--fill-a))) 55%,rgba(170,185,255,calc(.44*var(--fill-a))) 78%,rgba(150,120,250,calc(.46*var(--fill-a))) 100%);
  -webkit-backdrop-filter:blur(1.6cqw) saturate(1.5);backdrop-filter:blur(1.6cqw) saturate(1.5)}
.core{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.halo,.star-glow{fill:rgb(var(--g))}
.eye,.chev path{fill:#EEF3FF;stroke:#EEF3FF;stroke-width:3;stroke-linejoin:round;stroke-linecap:round}
.chev path{fill:none;stroke-width:4.2}
.blush ellipse{fill:#C77DFF}
.glass-front{position:absolute;inset:0;border-radius:50%;
  background:radial-gradient(48% 20% at 54% 93%,rgba(255,255,255,.55),rgba(255,255,255,0) 70%),
    radial-gradient(closest-side,rgba(255,255,255,0) 70%,rgba(214,224,255,.26) 86%,rgba(240,245,255,.72) 97%,rgba(255,255,255,.95) 100%);
  box-shadow:inset 0 0 0 .3cqw rgba(255,255,255,.55),inset -1.2cqw -2cqw 3.5cqw rgba(139,92,246,.24),inset 1.4cqw 1.6cqw 3cqw rgba(255,255,255,.42)}
.rim{position:absolute;inset:0;border-radius:50%;opacity:.35;
  background:conic-gradient(from 0deg,rgba(139,92,246,0),rgba(139,92,246,.8) 12%,rgba(59,130,246,0) 26%,rgba(199,210,254,.85) 44%,
    rgba(59,130,246,0) 58%,rgba(236,120,200,.3) 74%,rgba(139,92,246,0) 88%);
  -webkit-mask:radial-gradient(closest-side,transparent 80%,#000 95%,#000 99%,transparent 100%);
  mask:radial-gradient(closest-side,transparent 80%,#000 95%,#000 99%,transparent 100%)}
.spec{position:absolute;left:13%;top:9%;width:44%;height:26%;border-radius:50%;transform:rotate(-32deg);opacity:.85;
  background:radial-gradient(closest-side,rgba(255,255,255,.95),rgba(255,255,255,.35) 55%,rgba(255,255,255,0));filter:blur(.5cqw)}
.spec::after{content:"";position:absolute;left:24%;top:32%;width:20%;height:22%;border-radius:50%;background:#fff;filter:blur(.25cqw)}
.fx{z-index:2}
.p{position:absolute;left:50%;top:46%;will-change:transform,opacity;filter:drop-shadow(0 0 .8cqw rgba(var(--g),.55))}
.p svg{display:block;width:100%;height:100%}
.p.z{font:700 1em/1 ui-rounded,system-ui,sans-serif;color:rgb(var(--g));filter:none;width:auto;height:auto}
.compact .ring,.compact .shadow,.compact .ripple,.compact .fx{display:none}
.compact .spec{filter:none}
@media (prefers-reduced-motion:reduce){.listening .ripple{animation:none}}
`;

  let uid = 0;
  const ringSvg = (id, side) => `
<svg class="ring ring-${side}" viewBox="-100 -100 200 200" aria-hidden="true">
  <defs>
    <linearGradient id="rg${side}${id}" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#A9BBFF" stop-opacity=".5"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#A9BBFF" stop-opacity=".5"/>
    </linearGradient>
    <radialGradient id="mg${side}${id}" cx=".35" cy=".3" r=".75">
      <stop offset="0" stop-color="#EAF2FF"/><stop offset=".3" stop-color="#7FB0FF"/><stop offset=".72" stop-color="#2F6BF0"/><stop offset="1" stop-color="#1E3A8A"/>
    </radialGradient>
    <filter id="rb${side}${id}" x="-20%" y="-80%" width="140%" height="260%"><feGaussianBlur stdDeviation="2.6"/></filter>
    <filter id="mb${side}${id}" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3.4"/></filter>
  </defs>
  <g class="ring-g">
    <path class="ring-glow" stroke-width="6" filter="url(#rb${side}${id})"/>
    <path class="ring-edge" stroke-width="${side === 'front' ? 3.6 : 2.8}"/>
    <path class="ring-line" stroke="url(#rg${side}${id})" stroke-width="${side === 'front' ? 2.2 : 1.6}"/>
    <g class="moon"><circle class="moon-glow" r="12" filter="url(#mb${side}${id})"/><circle r="6.4" fill="url(#mg${side}${id})"/><circle cx="-2" cy="-2.3" r="1.7" fill="#fff" opacity=".9"/></g>
  </g>
</svg>`;

  const template = (id) => `
<div class="stage" part="stage">
  <div class="shadow"></div>
  <div class="body">
    <div class="glow"></div>
    <div class="ripple"></div><div class="ripple r2"></div>
    ${ringSvg(id, 'back')}
    <div class="orb" part="orb">
      <div class="glass-back"></div>
      <svg class="core" viewBox="-100 -100 200 200" aria-hidden="true">
        <defs>
          <radialGradient id="cb${id}" cx=".42" cy=".28" r=".85">
            <stop offset="0" stop-color="#2C42A6"/><stop offset=".38" stop-color="#16236A"/><stop offset=".78" stop-color="#0B1026"/><stop offset="1" stop-color="#0A0F24"/>
          </radialGradient>
          <linearGradient id="cs${id}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#fff" stop-opacity=".24"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="ce${id}" x1="0" y1="0" x2="1" y2="1">
            <stop offset=".45" stop-color="#93B4FF" stop-opacity="0"/><stop offset="1" stop-color="#93B4FF" stop-opacity=".75"/>
          </linearGradient>
          <filter id="eg${id}" x="-60%" y="-80%" width="220%" height="260%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="2.4" result="b"/>
            <feFlood flood-color="#8FB4FF"/><feComposite in2="b" operator="in" result="g"/>
            <feMerge><feMergeNode in="g"/><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="sb${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="8"/></filter>
          <filter id="bl${id}" x="-60%" y="-100%" width="220%" height="300%"><feGaussianBlur stdDeviation="3.2"/></filter>
          <clipPath id="cc${id}"><path d="${STAR}"/></clipPath>
        </defs>
        <circle class="halo" cy="10" r="54" filter="url(#sb${id})"/>
        <g class="star">
          <path class="star-glow" d="${STAR}" filter="url(#sb${id})"/>
          <path d="${STAR}" fill="url(#cb${id})" stroke="url(#cb${id})" stroke-width="4" stroke-linejoin="round"/>
          <path d="${STAR}" fill="url(#cs${id})"/>
          <path d="${STAR}" fill="none" stroke="url(#ce${id})" stroke-width="1.6"/>
          <g clip-path="url(#cc${id})"><g class="blush" filter="url(#bl${id})" opacity="0"><ellipse cx="-37" cy="29" rx="9" ry="5"/><ellipse cx="37" cy="29" rx="9" ry="5"/></g></g>
          <g class="eyes" filter="url(#eg${id})">
            <path class="eye eye-l"/><path class="eye eye-r"/>
            <g class="chev" opacity="0"><path class="chev-l" d="M-6,-6.5L5,0L-6,6.5"/><path class="chev-r" d="M6,-6.5L-5,0L6,6.5"/></g>
          </g>
        </g>
      </svg>
      <div class="glass-front"></div>
      <div class="rim"></div>
      <div class="spec"></div>
    </div>
    ${ringSvg(id, 'front')}
  </div>
  <div class="fx"></div>
</div>`;

  const eyePath = (w, T, B) => {
    const k = 0.5523, wk = w * k;
    return `M${f2(-w)},0C${f2(-w)},${f2(T * k)} ${f2(-wk)},${f2(T)} 0,${f2(T)}C${f2(wk)},${f2(T)} ${f2(w)},${f2(T * k)} ${f2(w)},0` +
           `C${f2(w)},${f2(B * k)} ${f2(wk)},${f2(B)} 0,${f2(B)}C${f2(-wk)},${f2(B)} ${f2(-w)},${f2(B * k)} ${f2(-w)},0Z`;
  };

  const RX = 92, ORB_Y = -8, RING_Y = 4; // ring-straal en orb-middelpunt in stage-ruimte (200 units = 100cqw)

  /* ------------------------------------------------------------- element */
  class NovaPet extends HTMLElement {
    static get observedAttributes() { return ['state', 'size', 'sound']; }

    constructor() {
      super();
      this._id = 'n' + (++uid);
      const root = this.attachShadow({ mode: 'open' });
      // VS Code webviews forbid inline <style>, so the stylesheet is adopted instead (changed from the original).
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
      root.innerHTML = template(this._id);
      const q = (s) => root.querySelector(s);
      this.$ = {
        stage: q('.stage'), body: q('.body'), shadow: q('.shadow'), glow: q('.glow'), orb: q('.orb'), rim: q('.rim'), fx: q('.fx'),
        star: q('.star'), halo: q('.halo'), starGlow: q('.star-glow'), eyes: q('.eyes'), eyeL: q('.eye-l'), eyeR: q('.eye-r'),
        chev: q('.chev'), chevL: q('.chev-l'), chevR: q('.chev-r'), blush: q('.blush'),
        ringBack: q('.ring-back'), ringFront: q('.ring-front'), ringBG: q('.ring-back .ring-g'), ringFG: q('.ring-front .ring-g'),
        ringBP: root.querySelectorAll('.ring-back .ring-g > path'), ringFP: root.querySelectorAll('.ring-front .ring-g > path'),
        moonB: q('.ring-back .moon'), moonF: q('.ring-front .moon'),
      };

      this._state = 'idle';
      this.t = 0;
      this.fp = Object.assign({}, FACES.content);
      this.squeeze = 0;
      this.sq = new Spring(0, 220, 13);
      this.bx = new Spring(0, 140, 12);
      this.by = new Spring(0, 160, 11);
      this.rot = new Spring(0, 120, 10);
      this.gX = new Spring(0, 260, 28);
      this.gY = new Spring(0, 260, 28);
      const S = STATES.idle;
      this.v = { lean: 1, ring: 1, tilt: S.tilt, ry: S.ry, orbit: S.orbit, rim: S.rim, glow: S.glow, core: S.core, blush: 0, float: 1, level: 0 };
      this.rgb = S.rgb.slice();
      this.orbitA = 1.2; this.rimRot = 0; this.floatPh = rand(0, TAU);
      this.blinkT = -1; this.blinkNext = rand(1, 3); this.blinkDouble = false;
      this.sacc = 0; this.saccX = 0; this.saccY = 0;
      this.ptr = { x: 0, y: 0, at: -1e9 };
      this.glance = null; this.nextIdle = rand(3, 6);
      this.lastActivity = performance.now();
      this.napping = false; this.pet = 0; this.petting = false; this.pokes = [];
      this.act = null; this.ov = {}; this.particles = []; this.fxTimer = 0;
      this.moonX = 0; this.moonY = 0;
      this._levelIn = 0; this._levelAt = -1e9;
      this._look = null; this._rectAt = -1e9; this._rectC = null;
      this._hover = false; this._down = null; this._lastPet = null;
      this._visible = true; this._running = false; this._raf = 0; this._last = 0;
      this._doze = 0; this._dozing = false; this._napAt = 0;
      this._mo = 1; this._ry = -1; this._gStr = '';
      this._voice = rand(.97, 1.03); this._pitch = this._voice; this._sfxAt = {}; this._purr = null; this._bubT = 0; this._sylT = 0;
      this._tick = this._tick.bind(this);

      // Handlers
      this._onWinMove = (e) => {
        const now = performance.now();
        this.ptr.x = e.clientX; this.ptr.y = e.clientY; this.ptr.at = now;
        if (this.napping) { if (this._near(e.clientX, e.clientY, 2.2)) this.wake(); }
        else this.lastActivity = now;
      };
      this._onWinKey = () => { if (!this.napping) this.lastActivity = performance.now(); };
      this._onEnter = () => { this._hover = true; };
      this._onLeave = () => { this._hover = false; this._lastPet = null; };
      this._onDown = (e) => {
        if (!this._interactive()) return;
        const now = performance.now();
        this.lastActivity = now; this.ptr.x = e.clientX; this.ptr.y = e.clientY; this.ptr.at = now;
        this._down = { x: e.clientX, y: e.clientY, t: now, moved: 0, hug: false, woke: false };
        this._lastPet = { x: e.clientX, y: e.clientY };
        try { this.$.orb.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
        if (this.napping) { this.wake(); this._down.woke = true; return; }
        clearTimeout(this._holdTimer);
        this._holdTimer = setTimeout(() => {
          const d = this._down;
          if (d && d.moved < 14) { d.hug = true; this._act('hug'); this._emit('nova-hug'); }
        }, 520);
      };
      this._onMove = (e) => {
        if (!this._interactive() || !(this._hover || this._down)) return;
        const lp = this._lastPet;
        this._lastPet = { x: e.clientX, y: e.clientY };
        if (!lp) return;
        const dist = Math.hypot(e.clientX - lp.x, e.clientY - lp.y);
        const D = this.$.orb.getBoundingClientRect().width || 100;
        if (this._down) this._down.moved += dist;
        if (!this._down || this._down.moved > 14) this.pet = Math.min(3, this.pet + dist / D * .85);
      };
      this._onUp = (e) => {
        clearTimeout(this._holdTimer);
        const d = this._down; this._down = null;
        if (!d) return;
        if (d.hug) { this.act = null; this._act('joy'); return; }
        if (d.woke) return;
        if (e.type === 'pointerup' && d.moved < 10 && performance.now() - d.t < 450) this.poke(e.clientX, e.clientY);
      };
      this._onKey = (e) => {
        if (!this._interactive()) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.napping ? this.wake() : this.poke(); }
      };
      this._onCtx = (e) => e.preventDefault();
      this._onVis = () => this._sync();

      this._rmq = window.matchMedia('(prefers-reduced-motion: reduce)');
      this._onRm = () => { this._rm = this._rmq.matches; this._mo = this._rm ? .3 : 1; };
      this._onRm();
    }

    /* ---------------------------------------------------- lifecycle */
    connectedCallback() {
      this._upgrade('state'); this._upgrade('level');
      if (!this.hasAttribute('role')) this.setAttribute('role', 'img');
      if (!this.hasAttribute('tabindex') && this._interactive()) this.setAttribute('tabindex', '0');
      this._label();
      const o = this.$.orb;
      window.addEventListener('pointermove', this._onWinMove, { passive: true });
      window.addEventListener('pointerdown', this._onWinMove, { passive: true });
      window.addEventListener('keydown', this._onWinKey, { passive: true });
      o.addEventListener('pointerenter', this._onEnter);
      o.addEventListener('pointerleave', this._onLeave);
      o.addEventListener('pointerdown', this._onDown);
      o.addEventListener('pointermove', this._onMove);
      o.addEventListener('pointerup', this._onUp);
      o.addEventListener('pointercancel', this._onUp);
      o.addEventListener('contextmenu', this._onCtx);
      this.addEventListener('keydown', this._onKey);
      document.addEventListener('visibilitychange', this._onVis);
      this._rmq.addEventListener && this._rmq.addEventListener('change', this._onRm);
      if ('IntersectionObserver' in window) {
        this._io = new IntersectionObserver((es) => { this._visible = es[es.length - 1].isIntersecting; this._sync(); }, { rootMargin: '120px' });
        this._io.observe(this);
      }
      if ('ResizeObserver' in window) {
        this._ro = new ResizeObserver(() => { const w = this.getBoundingClientRect().width; this.$.stage.classList.toggle('compact', w < 64); this._rectAt = -1e9; if (w) this._pitch = clamp(Math.pow(160 / w, .14), .9, 1.3) * this._voice; });
        this._ro.observe(this);
      }
      this._sync();
    }

    disconnectedCallback() {
      const o = this.$.orb;
      window.removeEventListener('pointermove', this._onWinMove);
      window.removeEventListener('pointerdown', this._onWinMove);
      window.removeEventListener('keydown', this._onWinKey);
      o.removeEventListener('pointerenter', this._onEnter);
      o.removeEventListener('pointerleave', this._onLeave);
      o.removeEventListener('pointerdown', this._onDown);
      o.removeEventListener('pointermove', this._onMove);
      o.removeEventListener('pointerup', this._onUp);
      o.removeEventListener('pointercancel', this._onUp);
      o.removeEventListener('contextmenu', this._onCtx);
      this.removeEventListener('keydown', this._onKey);
      document.removeEventListener('visibilitychange', this._onVis);
      this._rmq.removeEventListener && this._rmq.removeEventListener('change', this._onRm);
      this._io && this._io.disconnect(); this._ro && this._ro.disconnect();
      clearTimeout(this._holdTimer);
      this._running = false; cancelAnimationFrame(this._raf); clearTimeout(this._doze); this._raf = this._doze = 0;
      this._stopPurr();
    }

    attributeChangedCallback(name, _old, val) {
      if (name === 'state') { if (val && STATES[val] && val !== this._state) this._setState(val); }
      else if (name === 'sound') { if (val === 'on') { NovaAudio.want(); NovaAudio.unlock(); } else this._stopPurr(); }
      else if (name === 'size') {
        if (val == null || val === '') this.style.removeProperty('--nova-size');
        else this.style.setProperty('--nova-size', /^\d+(\.\d+)?$/.test(val) ? val + 'px' : val);
      }
    }

    /* ------------------------------------------------------ public API */
    get state() { return this._state; }
    set state(v) { if (STATES[v] && v !== this._state) { this._setState(v); this.setAttribute('state', v); } }

    get level() { return this._levelIn; }
    set level(v) { this._levelIn = clamp(+v || 0, 0, 1); this._levelAt = performance.now(); }

    react(name) {
      if (!ACTS[name] || name === 'hug') return this;
      this.lastActivity = performance.now();
      if (this.napping && name !== 'yawn') this._setNap(false);
      this._act(name);
      return this;
    }
    lookAt(target) { this._look = target || null; this.lastActivity = performance.now(); if (this.napping && target) this.wake(); return this; }
    wake() { if (this.napping) { this._setNap(false); this._act('startle'); } this.lastActivity = performance.now(); return this; }
    sleep() { if (!this.napping) this._act('yawn', { nap: true }); return this; }
    poke(x, y) {
      const r = this.$.orb.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = x == null ? 0 : x - cx, dy = y == null ? -1 : y - cy;
      const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
      const now = performance.now();
      this.lastActivity = now;
      if (this.act && this.act.name === 'dizzy') return this;
      this.pokes = this.pokes.filter((p) => now - p < 2600); this.pokes.push(now);
      if (this.pokes.length >= 5) { this.pokes = []; this._act('dizzy'); }
      else this._act('poke', { dir: { x: dx, y: dy } });
      this._emit('nova-poke', { count: this.pokes.length });
      return this;
    }
    static get reactions() { return PUBLIC_REACTIONS.slice(); }
    static get muted() { return globalMuted; }
    static set muted(v) { globalMuted = !!v; }
    /** Speel een los geluid af, bijvoorbeeld nova.playSound('tinkle'). */
    playSound(name) { NovaAudio.play(name, this._vol(), this._pitch); return this; }
    static get sounds() { return NovaAudio.names.slice(); }
    static get states() { return Object.keys(STATES); }

    /* -------------------------------------------------------- internals */
    _upgrade(prop) { if (Object.prototype.hasOwnProperty.call(this, prop)) { const v = this[prop]; delete this[prop]; this[prop] = v; } }
    _attr(n, d) { const v = this.getAttribute(n); return v == null ? d : v; }
    _interactive() { return this._attr('interactive', 'true') !== 'false'; }
    _autonomy() { return this._attr('autonomy', 'on') !== 'off'; }
    _track() { return this._attr('track', 'pointer') !== 'none'; }
    _sleepAfter() { const v = parseFloat(this._attr('sleep-after', '45')); return isNaN(v) ? 45 : v; }
    _soundOn() { return !globalMuted && this._attr('sound', 'off') === 'on'; }
    _vol() { const v = parseFloat(this._attr('volume', '.6')); return clamp(isNaN(v) ? .6 : v, 0, 1); }
    _sfx(name) {
      if (!name || !this._soundOn() || !NovaAudio.ready) return;
      const now = performance.now();
      if (now - (this._sfxAt[name] || 0) < 60) return;
      this._sfxAt[name] = now;
      NovaAudio.play(name, this._vol(), this._pitch);
    }
    _stopPurr() { if (this._purr) { this._purr.stop(); this._purr = null; } }
    _label() { this.setAttribute('aria-label', `Nova, ${this.napping ? 'slaapt' : this._state}`); }
    _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail: detail || {} })); }

    _setState(v) {
      const prev = this._state;
      this._state = v;
      this.lastActivity = performance.now();
      if (this.napping) this._setNap(false);
      if (v === 'success') this._act('celebrate');
      else if (v === 'error') this._act('shake', { face: 'worried' });
      else if (v === 'listening') this._act('perk');
      else if (prev === 'resting') this._act('startle');
      else if (this.act && this.act.name === 'yawn') this.act = null;
      this.$.stage.classList.toggle('listening', v === 'listening');
      this._label();
      this._emit('nova-statechange', { state: v, previous: prev });
    }

    _setNap(on) {
      if (this.napping === on) return;
      this.napping = on;
      if (on) this._napAt = performance.now();
      else if (this._doze) { clearTimeout(this._doze); this._doze = 0; this._raf = requestAnimationFrame(this._tick); }
      this._label();
      this._emit(on ? 'nova-sleep' : 'nova-wake');
    }

    _act(name, o) {
      const def = ACTS[name];
      if (!def) return;
      if (this.act && this.act.name === 'hug' && name !== 'joy') return;
      this.act = { name, t: 0, dur: def.dur, o: o || {} };
      def.start && def.start(this, this.act);
      const s = ACT_SFX[name];
      if (s) this._sfx(typeof s === 'function' ? s(this.act.o) : s);
    }

    _jump(v) { this.by.v -= v * this._mo; }

    _spark(x, y, o) {
      if (this._rm || this.particles.length > 30) return;
      o = o || {};
      if (x == null) { const a = rand(-Math.PI, 0); const r = rand(30, 42); x = Math.cos(a) * r; y = Math.sin(a) * r - 2; }
      const el = document.createElement('div');
      el.className = 'p';
      const s = o.size || rand(3, 5.5);
      el.style.width = el.style.height = s + 'cqw';
      el.innerHTML = `<svg viewBox="-10 -10 20 20"><path d="${SPARK}" fill="${o.color || SPARK_COLORS[(Math.random() * SPARK_COLORS.length) | 0]}"/></svg>`;
      this.$.fx.appendChild(el);
      this.particles.push({ el, kind: 's', x, y, vx: o.vx != null ? o.vx : rand(-4, 4), vy: o.vy != null ? o.vy : rand(-8, -3), age: 0, life: o.life || rand(.9, 1.5), r: rand(-20, 20), vr: rand(-90, 90) });
    }

    _burst(n) {
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + rand(-1.5, 1.5), sp = rand(22, 46);
        this._spark(Math.cos(a) * 28, Math.sin(a) * 28, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(.8, 1.3) });
      }
    }

    _zed() {
      this._sfx('snore');
      if (this.particles.length > 30) return;
      const el = document.createElement('div');
      el.className = 'p z'; el.textContent = 'z';
      this.$.fx.appendChild(el);
      this.particles.push({ el, kind: 'z', x: 14, y: -27, vx: 4, vy: -7, age: 0, life: 2.8, r: -12, vr: 6 });
    }

    _rect(now) {
      if (now - this._rectAt > 250 || !this._rectC) { this._rectC = this.getBoundingClientRect(); this._rectAt = now; }
      return this._rectC;
    }
    _near(x, y, k) {
      const r = this.getBoundingClientRect();
      return Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height * .46)) < Math.max(140, r.width * k);
    }
    _lookPoint() {
      const t = this._look;
      if (!t) return null;
      if (t.getBoundingClientRect) { const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
      return t;
    }

    _sync() {
      const run = this.isConnected && this._visible && !document.hidden;
      if (run && !this._running) { this._running = true; this._last = 0; this._raf = requestAnimationFrame(this._tick); }
      else if (!run && this._running) { this._running = false; cancelAnimationFrame(this._raf); clearTimeout(this._doze); this._raf = this._doze = 0; }
    }

    _idleBehaviour(now) {
      const busy = now - this.ptr.at < 1500;
      const list = this._rm ? [['glance', 3], ['blink', 1]]
        : busy ? [['hop', 1], ['wiggle', 1], ['sparklook', 1], ['blink', 1]]
        : [['glance', 4], ['lookaround', 1.4], ['hop', 1.2], ['wiggle', 1.1], ['moonwatch', 1.3], ['stretch', .8], ['sparklook', 1.2], ['blink', 1]];
      let sum = 0; for (const [, w] of list) sum += w;
      let r = Math.random() * sum, pick = list[0][0];
      for (const [n, w] of list) { if ((r -= w) <= 0) { pick = n; break; } }
      if (pick === 'glance') { this.glance = { x: rand(-.9, .9), y: rand(-.55, .35), until: this.t + rand(1.1, 2.2) }; if (chance(.35)) this._sfx('hm'); }
      else if (pick === 'blink') { this.blinkT = 0; this.blinkDouble = true; }
      else this._act(pick);
    }

    _tick(now) {
      if (!this._running) return;
      let dt = this._last ? (now - this._last) / 1000 : 1 / 60;
      this._last = now;
      if (dt > (this._dozing ? .5 : .1)) dt = 1 / 60;
      dt = Math.min(dt, this._dozing ? 1.5 / DOZE_FPS : 1 / 30);
      this.t += dt;
      this._update(dt, now);
      this._render(dt);
      // Slaapt Nova en is het indommelen voorbij, dan volstaan een paar beelden per seconde.
      this._dozing = this.napping && !this.act && !this._down && !this.petting && now - this._napAt > 2500;
      if (this._dozing) this._doze = setTimeout(() => { this._doze = 0; if (this._running) this._raf = requestAnimationFrame(this._tick); }, 1000 / DOZE_FPS);
      else this._raf = requestAnimationFrame(this._tick);
    }

    _update(dt, now) {
      const S = STATES[this._state], t = this.t, v = this.v;
      const ov = this.ov = { face: null, blush: null, gx: null, gy: null, orbit: null, glow: 0, purr: 0, dy: 0, noBlink: false };

      // aaien
      this.pet = Math.max(0, this.pet - dt * .75);
      if (!this.petting && this.pet > 1.1) { this.petting = true; this.lastActivity = now; this._emit('nova-pet'); this._sfx('coo'); if (this.napping) this.wake(); }
      else if (this.petting && this.pet < .35) this.petting = false;

      // eigen leven + in slaap vallen
      if (this._autonomy() && this._state === 'idle' && !this.napping && !this.act && !this._down && !this.petting) {
        const sa = this._sleepAfter();
        if (sa > 0 && now - this.lastActivity > sa * 1000) this._act('yawn', { nap: true });
        else if ((this.nextIdle -= dt) <= 0) { this._idleBehaviour(now); this.nextIdle = rand(3.5, 8.5); }
      }

      // standaard spring-targets
      this.sq.target = 0; this.bx.target = 0; this.by.target = 0;
      this.rot.target = this.gX.x * 3.5 + (this._state === 'thinking' ? Math.sin(t * .45) * 5 : 0) + (this._state === 'error' ? -3 : 0);

      // lopende act
      if (this.act) {
        const a = this.act, def = ACTS[a.name];
        a.t += dt;
        const p = a.dur === Infinity ? 0 : Math.min(1, a.t / a.dur);
        def.frame && def.frame(this, a, p, dt);
        if (a.t >= a.dur && this.act === a) { this.act = null; def.end && def.end(this, a); }
      }

      // gezicht
      const ptrRecent = this._track() && now - this.ptr.at < 2200;
      let face = S.face;
      if (this._state === 'idle') face = (ptrRecent || (this.glance && t < this.glance.until) || this._look) ? 'open' : 'content';
      if (this.napping) face = 'closed';
      if (this.petting) face = 'content';
      if (ov.face) face = ov.face;
      const F = FACES[face];
      for (const k in F) this.fp[k] = damp(this.fp[k], F[k], 18, dt);
      this.squeeze = damp(this.squeeze, face === 'squeeze' ? 1 : 0, 20, dt);

      // knipperen
      const canBlink = !ov.noBlink && face !== 'closed' && face !== 'squeeze' && !this.napping;
      if (this.blinkT >= 0) {
        this.blinkT += dt;
        if (this.blinkT > .17) {
          this.blinkT = -1;
          if (this.blinkDouble) { this.blinkDouble = false; this.blinkNext = .1; }
          else this.blinkNext = rand(1.8, 5.5) * (this._state === 'thinking' ? 1.6 : 1);
        }
      } else if ((this.blinkNext -= dt) <= 0 && canBlink) { this.blinkT = 0; if (!this.blinkDouble) this.blinkDouble = chance(.15); }
      this.blinkC = this.blinkT >= 0 && canBlink ? Math.sin(Math.PI * this.blinkT / .17) : 0;

      // blik
      const r = this._rect(now);
      const cx = r.left + r.width * .5, cy = r.top + r.height * .46, R = r.width * .31 || 50;
      const toG = (px, py) => { const dx = px - cx, dy = py - cy; return [clamp(dx / (Math.abs(dx) + R * 2.4) * 1.25, -1, 1), clamp(dy / (Math.abs(dy) + R * 2.4) * 1.25, -1, 1)]; };
      let gx = 0, gy = 0;
      if (ov.gx != null) { gx = ov.gx; gy = ov.gy; }
      else if (this.napping || this._state === 'resting') { gx = 0; gy = .3; }
      else if (this._state === 'thinking') { gx = Math.sin(t * .42) * .7; gy = -.72 + Math.sin(t * 1.3) * .08; }
      else if (this._look) { const p = this._lookPoint(); if (p) [gx, gy] = toG(p.x, p.y); }
      else if (this.petting || this._down || ptrRecent) [gx, gy] = toG(this.ptr.x, this.ptr.y);
      else if (this.glance && t < this.glance.until) { gx = this.glance.x; gy = this.glance.y; }
      else if (this._state === 'listening') { gx = 0; gy = .12; }
      else { gx = Math.sin(t * .21) * .14; gy = .04 + Math.sin(t * .33) * .05; }
      if ((this.sacc -= dt) <= 0) { this.sacc = rand(.4, 1.5); this.saccX = rand(-.06, .06); this.saccY = rand(-.05, .05); }
      this.gX.target = clamp(gx + this.saccX, -1, 1);
      this.gY.target = clamp(gy + this.saccY, -1, 1);

      // springs (substeps voor stabiliteit)
      const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
      for (let i = 0; i < n; i++) { this.sq.step(h); this.bx.step(h); this.by.step(h); this.rot.step(h); this.gX.step(h); this.gY.step(h); }

      // niveau (audio / stream)
      let lvl;
      if (now - this._levelAt < 350) lvl = this._levelIn;
      else if (this._state === 'responding') lvl = (.5 + .5 * Math.sin(t * 10.5)) * (.55 + .45 * Math.sin(t * 2.9 + 1));
      else if (this._state === 'listening') lvl = .15 + .15 * Math.sin(t * 2.2);
      else lvl = 0;
      v.level = damp(v.level, lvl, 14, dt);

      // stemgeluiden die bij een status horen
      const voiced = this._soundOn() && NovaAudio.ready;
      if (voiced && this.petting && !this._purr) this._purr = NovaAudio.purr(this._vol());
      else if ((!voiced || !this.petting) && this._purr) this._stopPurr();
      if (voiced && this._state === 'thinking' && (this._bubT -= dt) <= 0) { this._sfx('bubble'); this._bubT = rand(.28, .85); }
      if (voiced && this._state === 'responding' && now - this._levelAt >= 350 && (this._sylT -= dt) <= 0) {
        this._sfx('syllable');
        this._sylT = chance(.12) ? rand(.3, .5) : rand(.075, .16);
      }

      // sfeerwaarden
      const nap = this.napping, compact = this.$.stage.classList.contains('compact');
      const ring = (nap ? 0 : S.ring);
      v.lean = damp(v.lean, S.lean, 6, dt);
      v.ring = damp(v.ring, ring, 4, dt);
      v.tilt = damp(v.tilt, S.tilt, 3, dt);
      v.ry = damp(v.ry, S.ry, 3, dt);
      v.orbit = damp(v.orbit, (ov.orbit != null ? ov.orbit : S.orbit) * (nap ? .2 : 1) * (this._rm ? .3 : 1), 3, dt);
      v.rim = damp(v.rim, S.rim + (this.petting ? .3 : 0), 4, dt);
      v.glow = damp(v.glow, (S.glow + ov.glow + (this.petting ? .2 : 0) + v.level * .25) * (nap ? .55 : 1) * (compact ? .6 : 1), 5, dt);
      v.core = damp(v.core, S.core * (nap ? .6 : 1) + v.level * .3, 5, dt);
      v.blush = damp(v.blush, ov.blush != null ? ov.blush : this.petting ? 1 : 0, 6, dt);
      v.float = damp(v.float, this._rm ? 0 : S.float * (nap ? .5 : 1), 3, dt);
      const tgt = nap ? [129, 140, 248] : (this.petting || (this.act && this.act.name === 'hug')) ? [118, 104, 246] : S.rgb;
      for (let i = 0; i < 3; i++) this.rgb[i] = damp(this.rgb[i], tgt[i], 4, dt);
      this.orbitA += v.orbit * dt;
      this.rimRot = (this.rimRot + S.rimSpd * (this.petting ? 2 : 1) * dt) % 360;
      this.floatPh += dt * TAU * .24 * S.fs * (nap ? .5 : 1);

      // maan-positie (voor 'moonwatch')
      const th = this.orbitA, tr = v.tilt * Math.PI / 180;
      const lx = RX * Math.cos(th), ly = v.ry * Math.sin(th);
      this.moonX = clamp((lx * Math.cos(tr) - ly * Math.sin(tr)) / RX, -1, 1);
      this.moonY = clamp((lx * Math.sin(tr) + ly * Math.cos(tr)) / 60, -1, 1);

      // ambient deeltjes
      if (!this._rm && !compact) {
        this.fxTimer -= dt;
        if ((nap || this._state === 'resting') && this.fxTimer <= 0) { this._zed(); this.fxTimer = 2.4; }
        else if (this._state === 'success' && chance(dt * .9)) { this._spark(); if (chance(.5)) this._sfx('tinkle'); }
        else if (this.petting && chance(dt * 2)) { this._spark(); if (chance(.4)) this._sfx('tinkle'); }
      }
    }

    _render(dt) {
      const $ = this.$, v = this.v, t = this.t, fp = this.fp;
      const gx = this.gX.x, gy = this.gY.x, lvl = v.level;
      const purr = (this.petting ? 1 : 0) + this.ov.purr;

      // kleur
      const gs = `${this.rgb[0] | 0},${this.rgb[1] | 0},${this.rgb[2] | 0}`;
      if (gs !== this._gStr) { $.stage.style.setProperty('--g', gs); this._gStr = gs; }

      // lichaam
      const fy = Math.sin(this.floatPh) * 1.5 * v.float;
      const y = this.by.x + fy + this.ov.dy;
      const sq = this.sq.x + (purr ? Math.sin(t * 22) * .012 * purr : 0);
      const sy = (1 + sq) * v.lean, sx = (1 - sq * .55) * v.lean;
      const rot = this.rot.x + (purr ? Math.sin(t * 31) * 1.2 * purr : 0);
      $.body.style.transform = `translate3d(${f2(this.bx.x)}cqw,${f2(y)}cqw,0) rotate(${f2(rot)}deg) scale(${f2(sx * 1000) / 1000},${f2(sy * 1000) / 1000})`;
      const lift = clamp(-y, -4, 12);
      $.shadow.style.transform = `translate(-50%,-50%) scale(${f2(1 - lift * .035)})`;
      $.shadow.style.opacity = f2(clamp(1 - lift * .05, .3, 1.1));
      $.glow.style.opacity = f2(v.glow);
      $.rim.style.opacity = f2(v.rim);
      $.rim.style.transform = `rotate(${f2(this.rimRot)}deg)`;

      // kern
      const cs = 1 + Math.sin(t * 1.6) * .012 + lvl * .05;
      $.star.setAttribute('transform', `translate(${f2(gx * 4)},${f2(gy * 3 - lvl * 1.2)}) rotate(${f2(gx * 3)}) translate(0,10) scale(${f2(cs * 1000) / 1000}) translate(0,-10)`);
      $.halo.setAttribute('opacity', f2(v.core * .75));
      $.starGlow.setAttribute('opacity', f2(v.core * .7));
      $.blush.setAttribute('opacity', f2(v.blush * .6));

      // ogen
      const spread = fp.sx * (1 - .1 * Math.abs(gx));
      const ex = gx * 8, ey = fp.y + gy * 6 - lvl * 1.4;
      const bc = this.blinkC || 0;
      const T = fp.T + (fp.B * .55 - .7 - fp.T) * bc, B = fp.B + (fp.B * .55 + .7 - fp.B) * bc;
      const eyeOp = f2(1 - this.squeeze);
      for (let s = -1; s <= 1; s += 2) {
        const el = s < 0 ? $.eyeL : $.eyeR;
        const w = fp.w * (1 - .2 * Math.max(0, s * gx));
        el.setAttribute('d', eyePath(w, T, B));
        el.setAttribute('transform', `translate(${f2(s * spread + ex)},${f2(ey)}) rotate(${f2(s * fp.rot)})`);
        el.setAttribute('opacity', eyeOp);
        (s < 0 ? $.chevL : $.chevR).setAttribute('transform', `translate(${f2(s * spread + ex)},${f2(ey)})`);
      }
      $.chev.setAttribute('opacity', f2(this.squeeze));

      // ring + maan
      const ringOp = v.ring;
      $.ringBack.style.opacity = f2(ringOp * .7);
      $.ringFront.style.opacity = f2(ringOp);
      if (ringOp > .01) {
        const tr = `translate(0,${ORB_Y + RING_Y}) rotate(${f2(v.tilt)})`;
        $.ringBG.setAttribute('transform', tr); $.ringFG.setAttribute('transform', tr);
        if (Math.abs(v.ry - this._ry) > .02) {
          this._ry = v.ry;
          const ry = f2(v.ry);
          const back = `M${-RX},0A${RX},${ry} 0 0 1 ${RX},0`, front = `M${RX},0A${RX},${ry} 0 0 1 ${-RX},0`;
          $.ringBP.forEach((p) => p.setAttribute('d', back));
          $.ringFP.forEach((p) => p.setAttribute('d', front));
        }
        const th = this.orbitA, sn = Math.sin(th);
        const mt = `translate(${f2(RX * Math.cos(th))},${f2(v.ry * sn)}) rotate(${f2(-v.tilt)}) scale(${f2(1 + .18 * sn)})`;
        const front = sn > 0;
        $.moonF.setAttribute('transform', mt); $.moonB.setAttribute('transform', mt);
        $.moonF.style.display = front ? '' : 'none';
        $.moonB.style.display = front ? 'none' : '';
      }

      // deeltjes
      const ps = this.particles;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.age += dt;
        const k = p.age / p.life;
        if (k >= 1) { p.el.remove(); ps.splice(i, 1); continue; }
        if (p.kind === 'z') {
          p.x += (p.vx + Math.sin(p.age * 3) * 3) * dt; p.y += p.vy * dt; p.r += p.vr * dt;
          const op = k < .2 ? k / .2 : 1 - (k - .2) / .8;
          p.el.style.fontSize = f2(4.5 + k * 4) + 'cqw';
          p.el.style.opacity = f2(op * .85);
          p.el.style.transform = `translate(${f2(p.x)}cqw,${f2(p.y)}cqw) translate(-50%,-50%) rotate(${f2(p.r)}deg)`;
        } else {
          const drag = Math.exp(-2.4 * dt);
          p.vx *= drag; p.vy *= drag; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
          const sc = Math.pow(Math.sin(Math.PI * k), .6);
          p.el.style.opacity = f2(sc);
          p.el.style.transform = `translate(${f2(p.x)}cqw,${f2(p.y)}cqw) translate(-50%,-50%) rotate(${f2(p.r)}deg) scale(${f2(sc)})`;
        }
      }
    }
  }

  customElements.define('nova-pet', NovaPet);
})();
