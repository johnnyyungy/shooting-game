'use strict';

/* ============================== SETUP ============================== */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

const scoreEl = document.getElementById('score');
const waveEl = document.getElementById('wave');
const livesRowEl = document.getElementById('lives');
const hullBarFillEl = document.getElementById('hullBarFill');
const wingmanModeLabelEl = document.getElementById('wingmanModeLabel');
const bombsRowEl = document.getElementById('bombs');
const startOverlay = document.getElementById('startOverlay');
const pauseOverlay = document.getElementById('pauseOverlay');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const finalScoreEl = document.getElementById('finalScore');
const highScoreEl = document.getElementById('highScore');
const difficultyTagEl = document.getElementById('difficultyTag');
const powerupToastEl = document.getElementById('powerupToast');
const shieldBarWrapEl = document.getElementById('shieldBarWrap');
const shieldBarFillEl = document.getElementById('shieldBarFill');
const shieldLabelEl = document.getElementById('shieldLabel');
const weaponsWrapEl = document.getElementById('weaponsWrap');
const weaponsEl = document.getElementById('weapons');
const bossBarWrapEl = document.getElementById('bossBarWrap');
const bossBarLabelEl = document.getElementById('bossBarLabel');
const bossBarFillEl = document.getElementById('bossBarFill');
const difficultyButtons = document.querySelectorAll('.diff-btn');
let toastTimeoutHandle = null;

const HIGH_SCORE_KEYS = {
  easy: 'neonskies_highscore_easy',
  normal: 'neonskies_highscore_normal',
  hard: 'neonskies_highscore_hard',
};
const DIFFICULTY_KEY = 'neonskies_difficulty';
const DEBUG = new URLSearchParams(location.search).has('debug');

// Each difficulty scales a small, deliberately limited set of levers rather
// than touching everything: fire rate (global), Spread's arc specifically
// (the actual mechanism behind its wide simultaneous coverage), enemy
// toughness/speed tier, and a score multiplier. Difficulties get separate
// best-score tracking (HIGH_SCORE_KEYS) rather than one shared leaderboard,
// since the multiplier alone can't equalize how much further an easier
// difficulty lets a run survive.
const DIFFICULTY_PRESETS = {
  easy: { label: 'EASY', cooldownMult: 0.85, spreadArcMult: 1.15, tierShift: -1, scoreMult: 0.75 },
  normal: { label: 'NORMAL', cooldownMult: 1, spreadArcMult: 1, tierShift: 0, scoreMult: 1 },
  hard: { label: 'HARD', cooldownMult: 1.15, spreadArcMult: 0.8, tierShift: 1, scoreMult: 1.5 },
};

function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
// Shortest distance from point (px,py) to line segment (x1,y1)-(x2,y2) — used
// for angled-beam hit detection, where the hazard isn't an axis-aligned box.
function pointSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 0 ? clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1) : 0;
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerpColor(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
}
// Same as lerpColor but for two already-resolved [r,g,b] arrays (e.g. values
// pulled from Background.palette, which are arrays, not hex strings).
function lerpRgb(a, b, t) {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
}
function rgbaStr(rgb, a) {
  return a === undefined ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
}

/* ============================== AUDIO ============================== */

const Audio_ = {
  ctx: null,
  ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, type, vol, glideTo) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  },
  // Sigmoid waveshaping curve for a WaveShaperNode — gives a harsh, gritty
  // "crunch" texture instead of the clean filtered-noise sound every other
  // explosion here uses, so boss-piece destruction reads as distinct rather
  // than just a louder/longer version of the same clean pop.
  distortionCurve(amount) {
    const n = 44100;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  },
  shoot() { this.tone(rand(760, 820), 0.08, 'square', 0.05, 420); },
  hitEnemy() { this.tone(220, 0.12, 'sawtooth', 0.06, 60); },
  explosion() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const bufSize = this.ctx.sampleRate * 0.3;
    const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.25, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, t0);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t0);
  },
  playerHit() { this.tone(140, 0.35, 'sawtooth', 0.09, 40); },
  gameOver() {
    if (!this.ctx) return;
    [220, 180, 140, 90].forEach((f, i) => {
      setTimeout(() => this.tone(f, 0.3, 'triangle', 0.08), i * 140);
    });
  },
  wave() { this.tone(500, 0.12, 'sine', 0.06, 900); },
  powerup() {
    if (!this.ctx) return;
    [520, 700, 900].forEach((f, i) => {
      setTimeout(() => this.tone(f, 0.14, 'square', 0.07), i * 70);
    });
  },
  powerupReroll() { this.tone(950, 0.06, 'triangle', 0.05, 650); },
  shieldBlock() { this.tone(320, 0.1, 'triangle', 0.08, 500); },
  lifeLost() {
    if (!this.ctx) return;
    [300, 190].forEach((f, i) => {
      setTimeout(() => this.tone(f, 0.22, 'sawtooth', 0.09, f * 0.6), i * 130);
    });
  },
  bossWarning() {
    if (!this.ctx) return;
    for (let i = 0; i < 4; i++) {
      const f = i % 2 === 0 ? 600 : 440;
      setTimeout(() => this.tone(f, 0.18, 'sawtooth', 0.08), i * 180);
    }
  },
  bombBlast() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const bufSize = this.ctx.sampleRate * 0.6;
    const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.4, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, t0);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t0);
    this.tone(90, 0.5, 'sawtooth', 0.12, 40);
  },
  ringFire() {
    if (!this.ctx) return;
    [420, 620].forEach((f, i) => {
      setTimeout(() => this.tone(f, 0.16, 'sawtooth', 0.06, f * 1.4), i * 60);
    });
  },
  laserBeam() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    // Main body: a harsh, fairly slow descending sweep — the core "laser" character.
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(2000, t0);
    osc.frequency.exponentialRampToValueAtTime(160, t0 + 0.45);
    gain.gain.setValueAtTime(0.12, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.5);
    // Thin high overtone on top for the "zap" bite at the start of the shot.
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(3400, t0);
    osc2.frequency.exponentialRampToValueAtTime(600, t0 + 0.28);
    gain2.gain.setValueAtTime(0.05, t0);
    gain2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
    osc2.connect(gain2).connect(this.ctx.destination);
    osc2.start(t0);
    osc2.stop(t0 + 0.28);
  },
  bossSegmentBurst() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    // Duration pushed much closer to bossDefeated's (was 0.4s) — length is a
    // far more reliable "this is bigger" cue during fast gameplay than subtle
    // filter/gain differences, which weren't registering.
    const bufSize = this.ctx.sampleRate * 0.6;
    const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // Distortion before the filter — a genuinely different texture (harsh,
    // gritty "crunch") rather than just a bigger/longer version of the same
    // clean filtered-noise sound every other explosion here uses.
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this.distortionCurve(45);
    shaper.oversample = '4x';
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.4, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, t0);
    filter.frequency.exponentialRampToValueAtTime(180, t0 + 0.6);
    src.connect(shaper).connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t0);
    this.tone(180, 0.35, 'sawtooth', 0.09, 50);
    // Metallic clang — an inharmonic tone pair (frequencies not in a clean
    // ratio) reads as bell/metal-like rather than musical, fitting armored
    // boss plating breaking apart rather than a soft enemy popping.
    [1800, 2600].forEach((f) => {
      const osc = this.ctx.createOscillator();
      const og = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t0);
      og.gain.setValueAtTime(0.06, t0);
      og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
      osc.connect(og).connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.18);
    });
    // Tight secondary micro-hit — much closer than bossDefeated's spaced
    // "ka-BOOM" (60ms here vs. 160ms there), for a quick "crack-crack"
    // shatter rather than two distinctly-timed booms. Also distorted, to
    // match the primary hit's texture.
    setTimeout(() => {
      if (!this.ctx) return;
      const t1 = this.ctx.currentTime;
      const buf2Size = this.ctx.sampleRate * 0.3;
      const buf2 = this.ctx.createBuffer(1, buf2Size, this.ctx.sampleRate);
      const data2 = buf2.getChannelData(0);
      for (let i = 0; i < buf2Size; i++) data2[i] = (Math.random() * 2 - 1) * (1 - i / buf2Size);
      const src2 = this.ctx.createBufferSource();
      src2.buffer = buf2;
      const shaper2 = this.ctx.createWaveShaper();
      shaper2.curve = this.distortionCurve(45);
      shaper2.oversample = '4x';
      const gain2 = this.ctx.createGain();
      gain2.gain.setValueAtTime(0.3, t1);
      gain2.gain.exponentialRampToValueAtTime(0.001, t1 + 0.3);
      const filter2 = this.ctx.createBiquadFilter();
      filter2.type = 'lowpass';
      filter2.frequency.setValueAtTime(2400, t1);
      filter2.frequency.exponentialRampToValueAtTime(250, t1 + 0.3);
      src2.connect(shaper2).connect(filter2).connect(gain2).connect(this.ctx.destination);
      src2.start(t1);
    }, 60);
  },
  bossDefeated() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    // Big primary blast, deeper/longer than the regular explosion or a
    // boss-segment pop. Cutoff kept higher than the first version (was
    // 1000Hz) — too low a lowpass strips the high-frequency "crack" that
    // actually reads as punch, so it sounded duller despite the higher gain.
    const bufSize = this.ctx.sampleRate * 0.8;
    const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.6, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.8);
    // Sweeping cutoff again here — bright crack at onset, darkening toward a
    // muffled thud as it decays, instead of one static (and thus flat/"pop"
    // sounding) brightness for the whole 0.8s.
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, t0);
    filter.frequency.exponentialRampToValueAtTime(150, t0 + 0.8);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t0);
    // Deep descending rumble underneath for weight (same sweep technique as
    // laserBeam). Pitched up from the original 70Hz — most small speakers
    // reproduce that poorly, so it was barely contributing anything audible.
    this.tone(110, 0.7, 'sawtooth', 0.16, 35);
    // Secondary boom, further delayed than before (was 90ms, blended into
    // the tail of the first blast instead of reading as a distinct hit) for
    // an actual "ka-BOOM" double impact.
    setTimeout(() => {
      if (!this.ctx) return;
      const t1 = this.ctx.currentTime;
      const buf2Size = this.ctx.sampleRate * 0.5;
      const buf2 = this.ctx.createBuffer(1, buf2Size, this.ctx.sampleRate);
      const data2 = buf2.getChannelData(0);
      for (let i = 0; i < buf2Size; i++) data2[i] = (Math.random() * 2 - 1) * (1 - i / buf2Size);
      const src2 = this.ctx.createBufferSource();
      src2.buffer = buf2;
      const gain2 = this.ctx.createGain();
      gain2.gain.setValueAtTime(0.42, t1);
      gain2.gain.exponentialRampToValueAtTime(0.001, t1 + 0.5);
      const filter2 = this.ctx.createBiquadFilter();
      filter2.type = 'lowpass';
      filter2.frequency.setValueAtTime(1800, t1);
      filter2.frequency.exponentialRampToValueAtTime(150, t1 + 0.5);
      src2.connect(filter2).connect(gain2).connect(this.ctx.destination);
      src2.start(t1);
    }, 160);
  }
};

/* ============================== MUSIC ============================== */

const MUSIC_TRACKS = [
  encodeURI('Drum Or Bass - Ryan Stasik.mp3'),
  encodeURI('Horizons - Alex Jones _ Xander Jones.mp3'),
  encodeURI('Midnight - Dan Henig.mp3'),
  encodeURI('Rinse Repeat - DivKid.mp3'),
  encodeURI('Fly High - Gunnar Olsen.mp3'),
];

const Music = {
  players: [],
  current: 0,
  trackIndex: 0,
  fadeSeconds: 2.5,
  maxVolume: 0.45,
  fading: false,
  init() {
    this.players = [document.getElementById('bgMusicA'), document.getElementById('bgMusicB')];
    this.players.forEach((p) => {
      p.volume = 0;
      p.addEventListener('timeupdate', () => this.checkForCrossfade(p));
      p.addEventListener('ended', () => this.onEnded(p));
    });
  },
  start() {
    this.trackIndex = 0;
    this.current = 0;
    this.fading = false;
    const active = this.players[0];
    const idle = this.players[1];
    idle.pause();
    idle.volume = 0;
    active.src = MUSIC_TRACKS[0];
    active.currentTime = 0;
    active.volume = this.maxVolume;
    active.play().catch(() => {});
  },
  pause() { this.players.forEach((p) => p.pause()); },
  resume() { this.players[this.current].play().catch(() => {}); },
  fadeOut(duration = 1.5) {
    this.fading = true;
    const startVols = this.players.map((p) => p.volume);
    const startT = performance.now();
    const durationMs = duration * 1000;
    const step = () => {
      const t = clamp((performance.now() - startT) / durationMs, 0, 1);
      this.players.forEach((p, i) => { p.volume = startVols[i] * (1 - t); });
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        this.players.forEach((p) => p.pause());
      }
    };
    requestAnimationFrame(step);
  },
  checkForCrossfade(player) {
    if (this.fading || this.players[this.current] !== player) return;
    if (player.duration && !isNaN(player.duration) && player.duration - player.currentTime <= this.fadeSeconds) {
      this.crossfade();
    }
  },
  onEnded(player) {
    if (this.players[this.current] !== player) return;
    if (!this.fading) this.hardSwitch();
  },
  crossfade() {
    this.fading = true;
    Background.beginTransition();
    const outgoing = this.players[this.current];
    const next = 1 - this.current;
    const incoming = this.players[next];
    this.trackIndex = (this.trackIndex + 1) % MUSIC_TRACKS.length;
    incoming.src = MUSIC_TRACKS[this.trackIndex];
    incoming.currentTime = 0;
    incoming.volume = 0;
    incoming.play().catch(() => {});
    this.current = next;

    const startT = performance.now();
    const durationMs = this.fadeSeconds * 1000;
    const step = () => {
      const t = clamp((performance.now() - startT) / durationMs, 0, 1);
      outgoing.volume = this.maxVolume * (1 - t);
      incoming.volume = this.maxVolume * t;
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        outgoing.pause();
        outgoing.volume = 0;
        this.fading = false;
      }
    };
    requestAnimationFrame(step);
  },
  hardSwitch() {
    const outgoing = this.players[this.current];
    const next = 1 - this.current;
    const incoming = this.players[next];
    this.trackIndex = (this.trackIndex + 1) % MUSIC_TRACKS.length;
    outgoing.pause();
    outgoing.volume = 0;
    incoming.src = MUSIC_TRACKS[this.trackIndex];
    incoming.currentTime = 0;
    incoming.volume = this.maxVolume;
    incoming.play().catch(() => {});
    this.current = next;
  }
};

/* ============================== INPUT ============================== */

const Input = {
  keys: new Set(),
  firePressed: false,
  init() {
    window.addEventListener('keydown', (e) => {
      const code = e.code;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyW','KeyA','KeyS','KeyD'].includes(code)) {
        e.preventDefault();
      }
      this.keys.add(code);
      if (code === 'Space') {
        if (Game.state === 'start' || Game.state === 'gameover') Game.start();
        else if (Game.state === 'paused') Game.togglePause();
        else this.firePressed = true;
      }
      if (code === 'KeyP' || code === 'Escape') Game.togglePause();
      if (code === 'KeyQ' && Game.state === 'playing' && Game.player) Game.player.cycleWingmanMode();
      if (code === 'KeyE' && Game.state === 'playing' && Game.player) Game.player.cycleWeapon();
      if (code === 'KeyB' && Game.state === 'playing' && Game.player) Game.player.useBomb();
      if (DEBUG && Game.state === 'playing') {
        if (code === 'Digit1') Game.spawnBossOfType('sentinel');
        if (code === 'Digit2') Game.spawnBossOfType('ring');
        if (code === 'Digit3') Game.spawnBossOfType('snake');
        if (code === 'Digit0') {
          Game.bossAppearances = { sentinel: 0, ring: 0, snake: 0 };
          Game.showToast('BOSS TIERS RESET', '#ffffff');
        }
      }
      if (code === 'Enter') {
        if (Game.state === 'start') Game.start();
        else if (Game.state === 'gameover') Game.start();
        else if (Game.state === 'paused') Game.togglePause();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space') this.firePressed = false;
    });
    window.addEventListener('blur', () => this.keys.clear());
  },
  up() { return this.keys.has('ArrowUp') || this.keys.has('KeyW'); },
  down() { return this.keys.has('ArrowDown') || this.keys.has('KeyS'); },
  left() { return this.keys.has('ArrowLeft') || this.keys.has('KeyA'); },
  right() { return this.keys.has('ArrowRight') || this.keys.has('KeyD'); },
};

/* ============================== BACKGROUND ============================== */

const DAY_PHASES = ['night', 'dawn', 'morning', 'dusk', 'zenith'];

const DAY_PALETTES = {
  night: {
    skyTop: '#0a0322', skyMid: '#1c0f45', skyBottom: '#3a1360',
    sunTop: '#fff07a', sunMid: '#ff9d2e', sunBottom: '#ff2ee0',
    groundTop: '#2a0f4d', groundBottom: '#0a0316',
    starAlpha: 1,
  },
  dawn: {
    skyTop: '#140a1f', skyMid: '#5a3a1a', skyBottom: '#e8a23a',
    sunTop: '#fff6c8', sunMid: '#ffcc33', sunBottom: '#ff8f2e',
    groundTop: '#3a2410', groundBottom: '#150a08',
    starAlpha: 0.5,
  },
  morning: {
    skyTop: '#02150d', skyMid: '#0f4a30', skyBottom: '#1c8a5c',
    sunTop: '#fff4d6', sunMid: '#ffd24a', sunBottom: '#ff9d4a',
    groundTop: '#0d3a26', groundBottom: '#020f08',
    starAlpha: 0.45,
  },
  dusk: {
    skyTop: '#1a0a2e', skyMid: '#7a1f5a', skyBottom: '#ff6fa8',
    sunTop: '#ffd6e8', sunMid: '#ff5fa0', sunBottom: '#ff2ee0',
    groundTop: '#3a1030', groundBottom: '#0a0316',
    starAlpha: 0.4,
  },
  zenith: {
    skyTop: '#020f14', skyMid: '#0a5568', skyBottom: '#17b8d6',
    sunTop: '#fff4d6', sunMid: '#ffd24a', sunBottom: '#ff9d4a',
    groundTop: '#0a3a4a', groundBottom: '#020f14',
    starAlpha: 0.45,
  },
};

const Background = {
  horizonY: H * 0.62,
  scroll: 0,
  stars: [],
  phaseIndex: 0,
  prevPhaseIndex: 0,
  transitionT: 999,
  transitionDuration: 2.5,
  speedMult: 1,
  beginTransition() {
    this.prevPhaseIndex = this.phaseIndex;
    this.phaseIndex = (this.phaseIndex + 1) % DAY_PHASES.length;
    this.transitionT = 0;
  },
  resetPhase() {
    this.phaseIndex = 0;
    this.prevPhaseIndex = 0;
    this.transitionT = 999;
    this.speedMult = 1;
  },
  get palette() {
    const t = clamp(this.transitionT / this.transitionDuration, 0, 1);
    const from = DAY_PALETTES[DAY_PHASES[this.prevPhaseIndex]];
    const to = DAY_PALETTES[DAY_PHASES[this.phaseIndex]];
    return {
      skyTop: lerpColor(from.skyTop, to.skyTop, t),
      skyMid: lerpColor(from.skyMid, to.skyMid, t),
      skyBottom: lerpColor(from.skyBottom, to.skyBottom, t),
      sunTop: lerpColor(from.sunTop, to.sunTop, t),
      sunMid: lerpColor(from.sunMid, to.sunMid, t),
      sunBottom: lerpColor(from.sunBottom, to.sunBottom, t),
      groundTop: lerpColor(from.groundTop, to.groundTop, t),
      groundBottom: lerpColor(from.groundBottom, to.groundBottom, t),
      starAlpha: from.starAlpha + (to.starAlpha - from.starAlpha) * t,
    };
  },
  init() {
    this.stars = [];
    const layers = [
      { n: 40, speed: 18, size: 1, alpha: 0.4 },
      { n: 28, speed: 34, size: 1.5, alpha: 0.65 },
      { n: 16, speed: 58, size: 2, alpha: 0.9 },
    ];
    layers.forEach((layer) => {
      for (let i = 0; i < layer.n; i++) {
        this.stars.push({
          x: rand(0, W), y: rand(0, this.horizonY),
          speed: layer.speed, size: layer.size, alpha: layer.alpha
        });
      }
    });
    // Jagged skyline silhouette, authored across [0, W] and tiled twice at
    // draw time — since the pattern's left/right edges both sit at y=0
    // implicitly via the shared baseline, it scrolls seamlessly at period W.
    const peakCount = 14;
    this.skylinePoints = [];
    for (let i = 0; i <= peakCount; i++) {
      this.skylinePoints.push({ x: (i / peakCount) * W, h: rand(20, 70) });
    }
    this.meteors = [];
    this.shootingStarTimer = rand(15, 30);
    this.showerTimer = rand(90, 150);
    this.showerSpawnRemaining = 0;
    this.showerSpawnTimer = 0;
  },
  // Moves down-right (away from the player) rather than down-left — the
  // latter had a similar trajectory shape to an aimed shot heading toward
  // the ship, which read as a threat rather than scenery.
  spawnMeteor() {
    this.meteors.push({
      x: rand(-W * 0.05, W * 0.5),
      y: rand(0, this.horizonY * 0.35),
      vx: rand(700, 950),
      vy: rand(380, 520),
      life: 0,
      maxLife: rand(0.7, 1.1),
    });
  },
  update(dt) {
    // Ease toward a "hyperspeed" multiplier while a boss is present, rather
    // than snapping — reads as an acceleration/deceleration, not a jump-cut.
    const targetMult = Game.boss ? 7 : 1;
    this.speedMult += (targetMult - this.speedMult) * Math.min(1, dt * 1.5);
    this.scroll += dt * this.speedMult;
    if (this.transitionT < this.transitionDuration) this.transitionT += dt;
    this.stars.forEach((s) => {
      s.x -= s.speed * dt * this.speedMult;
      if (s.x < 0) { s.x = W; s.y = rand(0, this.horizonY); }
    });

    this.meteors.forEach((s) => {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life += dt;
    });
    this.meteors = this.meteors.filter((s) => s.life < s.maxLife && s.x <= W + 50 && s.y <= this.horizonY);

    this.shootingStarTimer -= dt;
    if (this.shootingStarTimer <= 0) {
      this.shootingStarTimer = rand(15, 30);
      this.spawnMeteor();
    }

    // Meteor shower: a rarer, bigger event — a staggered burst of several
    // meteors rather than one at a time. Held off while a boss is present,
    // same reasoning as the hyperspeed dimming — boss fights already stack
    // enough visual activity without more background motion competing for
    // attention.
    if (!Game.boss) {
      if (this.showerSpawnRemaining > 0) {
        this.showerSpawnTimer -= dt;
        if (this.showerSpawnTimer <= 0) {
          this.showerSpawnTimer = rand(0.15, 0.3);
          this.spawnMeteor();
          this.showerSpawnRemaining--;
        }
      } else {
        this.showerTimer -= dt;
        if (this.showerTimer <= 0) {
          this.showerTimer = rand(90, 150);
          this.showerSpawnRemaining = Math.floor(rand(6, 10));
          this.showerSpawnTimer = 0;
        }
      }
    }
  },
  draw() {
    const pal = this.palette;

    // sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, this.horizonY);
    sky.addColorStop(0, rgbaStr(pal.skyTop));
    sky.addColorStop(0.55, rgbaStr(pal.skyMid));
    sky.addColorStop(1, rgbaStr(pal.skyBottom));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, this.horizonY);

    // stars — plain squares at rest; extra length scales with how far
    // speedMult has ramped above 1, so it's an exact square when idle and
    // only stretches into a streak once boosted into hyperspeed.
    this.stars.forEach((s) => {
      const boost = Math.max(0, this.speedMult - 1);
      // Dim slightly at full hyperspeed so the streaks read as receding
      // background rather than competing for attention with actual bullets.
      const boostFrac = clamp(boost / 6, 0, 1);
      ctx.globalAlpha = s.alpha * pal.starAlpha * (1 - boostFrac * 0.35);
      const streakLen = clamp(s.size + boost * s.speed * 0.18, s.size, 120);
      if (streakLen > s.size * 1.5) {
        // Bright leading edge fading to transparent at the tail — stars
        // travel toward -x, so the streak's front is at s.x.
        const grad = ctx.createLinearGradient(s.x, 0, s.x + streakLen, 0);
        grad.addColorStop(0, '#eafcff');
        grad.addColorStop(1, 'rgba(234, 252, 255, 0)');
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = '#eafcff';
      }
      ctx.fillRect(s.x, s.y, streakLen, s.size);
    });
    ctx.globalAlpha = 1;

    // meteors — individual rare shooting stars, or several at once during a
    // shower burst; each fades in then out over its own short life.
    this.meteors.forEach((s) => {
      const fadeIn = clamp(s.life / 0.15, 0, 1);
      const fadeOut = clamp((s.maxLife - s.life) / 0.2, 0, 1);
      const tailX = s.x - s.vx * 0.09, tailY = s.y - s.vy * 0.09;
      ctx.save();
      ctx.globalAlpha = Math.min(fadeIn, fadeOut);
      const grad = ctx.createLinearGradient(s.x, s.y, tailX, tailY);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.strokeStyle = grad;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 10;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
      ctx.restore();
    });

    // sun
    const sunX = W * 0.72, sunY = this.horizonY - 30, sunR = 76;
    const sunGrad = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
    sunGrad.addColorStop(0, rgbaStr(pal.sunTop));
    sunGrad.addColorStop(0.45, rgbaStr(pal.sunMid));
    sunGrad.addColorStop(1, rgbaStr(pal.sunBottom));
    ctx.save();
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = sunGrad;
    ctx.fillRect(sunX - sunR, sunY - sunR, sunR * 2, sunR * 2);
    ctx.fillStyle = rgbaStr(pal.skyMid);
    for (let i = 0; i < 6; i++) {
      const ly = sunY + sunR * 0.15 + i * 9;
      ctx.fillRect(sunX - sunR, ly, sunR * 2, 3 + i);
    }
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = rgbaStr(pal.sunMid, 0.6);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // distant skyline silhouette — tinted from the sky-bottom color so its
    // hue shifts with the day cycle; scroll speed shares speedMult so it
    // visibly rushes by faster during hyperspeed too, not just the stars.
    ctx.save();
    ctx.fillStyle = rgbaStr(lerpRgb(pal.skyBottom, hexToRgb('#04010a'), 0.55));
    const skylineScroll = (this.scroll * 8) % W;
    for (let tile = -1; tile <= 1; tile++) {
      const baseX = tile * W - skylineScroll;
      ctx.beginPath();
      ctx.moveTo(baseX, this.horizonY);
      this.skylinePoints.forEach((p) => ctx.lineTo(baseX + p.x, this.horizonY - p.h));
      ctx.lineTo(baseX + W, this.horizonY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // ground plane
    const groundGrad = ctx.createLinearGradient(0, this.horizonY, 0, H);
    groundGrad.addColorStop(0, rgbaStr(pal.groundTop));
    groundGrad.addColorStop(1, rgbaStr(pal.groundBottom));
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, this.horizonY, W, H - this.horizonY);

    // horizon glow line
    ctx.save();
    ctx.strokeStyle = rgbaStr(pal.sunMid);
    ctx.shadowColor = rgbaStr(pal.sunMid);
    ctx.shadowBlur = 14;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, this.horizonY);
    ctx.lineTo(W, this.horizonY);
    ctx.stroke();
    ctx.restore();

    // perspective grid
    ctx.save();
    ctx.strokeStyle = 'rgba(46, 242, 255, 0.5)';
    ctx.shadowColor = 'rgba(46, 242, 255, 0.6)';
    ctx.shadowBlur = 4;
    ctx.lineWidth = 1;
    const vanishX = W * 0.5;
    const vCount = 14;
    for (let i = -vCount; i <= vCount; i++) {
      const bottomX = vanishX + (i / vCount) * W * 1.3;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(vanishX, this.horizonY);
      ctx.lineTo(bottomX, H);
      ctx.stroke();
    }
    const rungCount = 9;
    const speedFactor = (this.scroll * 0.6) % 1;
    for (let i = 0; i < rungCount; i++) {
      const f = (i + speedFactor) / rungCount;
      const y = this.horizonY + (H - this.horizonY) * f * f;
      ctx.globalAlpha = 0.15 + f * 0.55;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
};

/* ============================== PARTICLES ============================== */

class Particle {
  constructor(x, y, vx, vy, life, color, size) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life; this.color = color; this.size = size;
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 0.96;
    this.vy *= 0.96;
    this.life -= dt;
  }
  draw() {
    const a = clamp(this.life / this.maxLife, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 8;
    ctx.fillRect(this.x - this.size / 2, this.y - this.size / 2, this.size, this.size);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}

const Particles = {
  list: [],
  burst(x, y, color, count, speed, life = [0.3, 0.7], size = [2, 5]) {
    for (let i = 0; i < count; i++) {
      const ang = rand(0, Math.PI * 2);
      const spd = rand(speed * 0.3, speed);
      this.list.push(new Particle(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd, rand(life[0], life[1]), color, rand(size[0], size[1])));
    }
  },
  trail(x, y, color) {
    this.list.push(new Particle(x, y, rand(-20, 10), rand(-10, 10), rand(0.2, 0.35), color, rand(2, 4)));
  },
  // Spawns particles on a ring around (x,y) moving inward — the opposite of
  // burst() — for "gathering energy" charge-up effects.
  converge(x, y, color, count, speed, radius = 60) {
    for (let i = 0; i < count; i++) {
      const ang = rand(0, Math.PI * 2);
      const r = rand(radius * 0.6, radius);
      const px = x + Math.cos(ang) * r, py = y + Math.sin(ang) * r;
      const spd = rand(speed * 0.7, speed);
      this.list.push(new Particle(px, py, -Math.cos(ang) * spd, -Math.sin(ang) * spd, rand(0.25, 0.45), color, rand(2, 4)));
    }
  },
  update(dt) {
    this.list.forEach((p) => p.update(dt));
    this.list = this.list.filter((p) => p.life > 0);
  },
  draw() { this.list.forEach((p) => p.draw()); },
  clear() { this.list = []; }
};

// Brief jagged lightning-bolt lines connecting two points — used to make the
// Chain weapon's jump between enemies actually visible, since particle
// bursts alone don't read as "this hit jumped from A to B."
const Bolts = {
  list: [],
  spawn(x1, y1, x2, y2, color) {
    const segments = 4;
    const points = [{ x: x1, y: y1 }];
    const dx = x2 - x1, dy = y2 - y1;
    const perpX = -dy, perpY = dx;
    const perpLen = Math.hypot(perpX, perpY) || 1;
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const offset = rand(-10, 10);
      points.push({
        x: x1 + dx * t + (perpX / perpLen) * offset,
        y: y1 + dy * t + (perpY / perpLen) * offset,
      });
    }
    points.push({ x: x2, y: y2 });
    this.list.push({ points, color, life: 0.3, maxLife: 0.3 });
  },
  update(dt) {
    this.list.forEach((b) => { b.life -= dt; });
    this.list = this.list.filter((b) => b.life > 0);
  },
  draw() {
    this.list.forEach((b) => {
      const a = clamp(b.life / b.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.beginPath();
      b.points.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      // Wide colored glow pass, then a bright white core on top — reads as a
      // much punchier bolt than a single thin stroke.
      ctx.strokeStyle = b.color;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 26;
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
    });
  },
  clear() { this.list = []; }
};

/* ============================== PLAYER ============================== */

class Player {
  constructor() {
    this.w = 46; this.h = 24;
    this.x = 90; this.y = H / 2 - this.h / 2;
    this.speed = 360;
    this.lives = 3;
    this.maxLives = 3;
    this.hull = 3;
    this.hullMax = 3;
    this.invulnTime = 0;
    this.fireCooldown = 0;
    this.thrusterT = 0;
    this.tilt = 0;
    this.weapons = {};
    this.weaponOrder = ['normal'];
    this.activeWeapon = 'normal';
    this.shieldHp = 0;
    this.shieldLevel = 1;
    this.shieldMaxHp = SHIELD_BASE_MAX;
    this.shieldAnimT = 0;
    this.wingmen = 0;
    this.wingmanFireCooldown = 0;
    this.wingmanMode = 'forward';
    this.orbitAngle = 0;
    this.bombs = 3;
    this.maxBombs = 5;
    this.bombCooldown = 0;
  }
  update(dt) {
    let vx = 0, vy = 0;
    if (Input.left()) vx -= 1;
    if (Input.right()) vx += 1;
    if (Input.up()) vy -= 1;
    if (Input.down()) vy += 1;
    const len = Math.hypot(vx, vy) || 1;
    vx = (vx / len) * this.speed;
    vy = (vy / len) * this.speed;
    this.x = clamp(this.x + vx * dt, 6, W - this.w - 6);
    this.y = clamp(this.y + vy * dt, Background.horizonY * 0.02, Background.horizonY - this.h - 4);

    this.tilt += ((vy / this.speed) * 0.35 - this.tilt) * Math.min(1, dt * 10);

    if (this.invulnTime > 0) this.invulnTime -= dt;
    if (this.bombCooldown > 0) this.bombCooldown -= dt;
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.wingmanFireCooldown > 0) this.wingmanFireCooldown -= dt;
    if (this.wingmanMode === 'orbit' && this.wingmen > 0) this.orbitAngle += dt * 2.6;

    if (this.shieldHp > 0) {
      this.shieldAnimT += dt;
    } else {
      this.shieldAnimT = 0;
    }

    if (Input.firePressed && this.fireCooldown <= 0) {
      const gx = this.x + this.w - 6, gy = this.y + this.h / 2 - 2;
      const level = this.weapons[this.activeWeapon] ? this.weapons[this.activeWeapon].level : 1;
      const diff = DIFFICULTY_PRESETS[Game.difficulty];
      if (this.activeWeapon === 'spread') {
        const cfg = WEAPON_LEVELS.spread[level - 1];
        this.fireCooldown = cfg.cooldown * diff.cooldownMult;
        const arc = cfg.arc * diff.spreadArcMult;
        const step = cfg.count > 1 ? arc / (cfg.count - 1) : 0;
        for (let i = 0; i < cfg.count; i++) {
          Bullets.spawnPlayer(gx, gy, -arc / 2 + i * step, null, null, level);
        }
      } else if (this.activeWeapon === 'rapid') {
        const cfg = WEAPON_LEVELS.rapid[level - 1];
        this.fireCooldown = cfg.cooldown * diff.cooldownMult;
        if (cfg.streams >= 3) {
          Bullets.spawnPlayer(gx, gy - 8, 0, null, null, level);
          Bullets.spawnPlayer(gx, gy, 0, null, null, level);
          Bullets.spawnPlayer(gx, gy + 8, 0, null, null, level);
        } else {
          Bullets.spawnPlayer(gx, gy - 6, 0, null, null, level);
          Bullets.spawnPlayer(gx, gy + 6, 0, null, null, level);
        }
      } else if (this.activeWeapon === 'pierce') {
        const cfg = WEAPON_LEVELS.pierce[level - 1];
        this.fireCooldown = cfg.cooldown * diff.cooldownMult;
        Bullets.spawnPlayer(gx, gy, 0, '#8aff2e', '#5cff00', level, { pierce: cfg.pierceCount });
      } else if (this.activeWeapon === 'chain') {
        const cfg = WEAPON_LEVELS.chain[level - 1];
        // Twin bolts in a double-helix (opposite zigzag phase) instead of one
        // single wiggling line — less likely for a target to slip between
        // both strands, and reads more like an actual electric strand.
        // Cooldown doubles to keep total bullets/sec unchanged from before.
        this.fireCooldown = cfg.cooldown * diff.cooldownMult * 2;
        // A phase offset alone isn't enough — sin(0) and sin(π) are both 0,
        // so the pair would spawn coincident and only diverge with travel
        // time. A spawn-time offset on top keeps them visibly separate from
        // frame one while still crossing as the phases swing.
        // Quarter-cycle (sin vs. cos) rather than half-cycle (mirrored)
        // offset: mirrored strands are both at their widest-apart extreme at
        // the same instant, leaving a gap neither one covers. With a
        // quarter-cycle offset, whenever one bolt is at its extreme the
        // other is passing back through center, so the middle is never
        // uncovered by both at once.
        Bullets.spawnPlayer(gx, gy - 4, 0, '#b98cff', '#8a2eff', level, { chain: cfg.chainCount, chainRadius: cfg.chainRadius, zigPhase: 0 });
        Bullets.spawnPlayer(gx, gy + 4, 0, '#b98cff', '#8a2eff', level, { chain: cfg.chainCount, chainRadius: cfg.chainRadius, zigPhase: Math.PI / 2 });
      } else {
        this.fireCooldown = 0.14 * diff.cooldownMult;
        Bullets.spawnPlayer(gx, gy);
      }
      Audio_.shoot();
    }

    if (this.wingmen > 0 && Input.firePressed && this.wingmanFireCooldown <= 0) {
      this.wingmanFireCooldown = 0.22;
      this.getWingmanSlots().forEach((s) => {
        // PlayerBullet's angled render path adds (w/2, h/2) = (6, 1.5) as a world-space
        // offset before rotating, so pre-subtract it here to land exactly on the muzzle tip.
        const mx = s.x + Math.cos(s.angle) * 11 - 6, my = s.y + Math.sin(s.angle) * 11 - 1.5;
        Bullets.spawnPlayer(mx, my, s.angle, '#ffe27a', '#ffcf40');
      });
      Audio_.shoot();
    }

    this.thrusterT += dt;
    if (this.thrusterT > 0.02) {
      this.thrusterT = 0;
      Particles.trail(this.x - 4, this.y + this.h / 2 + rand(-4, 4), pick(['#ff9d2e', '#ff2ee0', '#2ef2ff']));
    }
  }
  get hitbox() { return { x: this.x + 8, y: this.y + 5, w: this.w - 16, h: this.h - 10 }; }
  hit() {
    if (this.invulnTime > 0) return false;
    if (this.shieldHp > 0) {
      this.shieldHp -= 1;
      this.invulnTime = 0.3;
      Audio_.shieldBlock();
      Particles.burst(this.x + this.w / 2, this.y + this.h / 2, '#7b2eff', 10, 160);
      return false;
    }
    this.hull -= 1;
    if (this.wingmen > 0) {
      const slots = this.getWingmanSlots();
      const lost = slots[slots.length - 1];
      this.wingmen -= 1;
      Particles.burst(lost.x, lost.y, '#ffcf40', 10, 150);
    }
    if (this.hull > 0) {
      Audio_.playerHit();
      this.invulnTime = 1.1;
      Game.shake(0.25, 6);
      Particles.burst(this.x + this.w / 2, this.y + this.h / 2, '#ff2ee0', 14, 180);
    } else {
      Audio_.lifeLost();
      this.weapons = {};
      this.weaponOrder = ['normal'];
      this.activeWeapon = 'normal';
      this.lives -= 1;
      this.invulnTime = 2.5;
      Game.shake(0.35, 9);
      Particles.burst(this.x + this.w / 2, this.y + this.h / 2, '#ff2ee0', 24, 220);
      Game.showToast('HULL BREACHED', '#ff2e2e');
      Game.flashLifeLost();
      if (this.lives > 0) this.hull = this.hullMax;
    }
    return true;
  }
  draw() {
    if (this.invulnTime > 0 && Math.floor(this.invulnTime * 16) % 2 === 0) return;
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    ctx.rotate(this.tilt);

    if (this.shieldHp > 0) {
      const frac = this.shieldHp / this.shieldMaxHp;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, this.w * 0.85, this.h * 1.7, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#7b2eff';
      ctx.shadowColor = '#7b2eff';
      ctx.shadowBlur = 10 + 10 * frac;
      ctx.lineWidth = 1.5 + 1.5 * frac;
      ctx.globalAlpha = (0.35 + 0.35 * frac) + 0.25 * Math.sin(this.shieldAnimT * 6);
      ctx.stroke();
      ctx.restore();
    }

    // engine glow
    ctx.beginPath();
    const g = ctx.createRadialGradient(-this.w / 2 - 2, 0, 0, -this.w / 2 - 2, 0, 16);
    g.addColorStop(0, 'rgba(46,242,255,0.9)');
    g.addColorStop(1, 'rgba(46,242,255,0)');
    ctx.fillStyle = g;
    ctx.arc(-this.w / 2 - 2, 0, 16, 0, Math.PI * 2);
    ctx.fill();

    // body
    ctx.beginPath();
    ctx.moveTo(this.w / 2, 0);
    ctx.lineTo(this.w / 2 - 18, -this.h / 2);
    ctx.lineTo(-this.w / 2 + 6, -this.h / 2 + 4);
    ctx.lineTo(-this.w / 2, 0);
    ctx.lineTo(-this.w / 2 + 6, this.h / 2 - 4);
    ctx.lineTo(this.w / 2 - 18, this.h / 2);
    ctx.closePath();
    const bodyGrad = ctx.createLinearGradient(-this.w / 2, 0, this.w / 2, 0);
    bodyGrad.addColorStop(0, '#1c8ea8');
    bodyGrad.addColorStop(0.6, '#2ef2ff');
    bodyGrad.addColorStop(1, '#eafcff');
    ctx.fillStyle = bodyGrad;
    ctx.shadowColor = '#2ef2ff';
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();

    // cockpit
    ctx.beginPath();
    ctx.ellipse(this.w / 2 - 20, -1, 6, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ff2ee0';
    ctx.shadowColor = '#ff2ee0';
    ctx.shadowBlur = 8;
    ctx.fill();

    ctx.restore();
    ctx.shadowBlur = 0;

    if (this.wingmen > 0) {
      this.getWingmanSlots().forEach((s) => this.drawWingmanPod(s.x, s.y, s.angle));
    }
  }
  getWingmanSlots() {
    if (this.wingmen <= 0) return [];
    if (this.wingmanMode === 'orbit') {
      const cx = this.x + this.w / 2, cy = this.y + this.h / 2, r = 42;
      const slots = [];
      for (let i = 0; i < this.wingmen; i++) {
        const a = this.orbitAngle + i * (Math.PI * 2 / this.wingmen);
        slots.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, angle: a });
      }
      return slots;
    }
    const wx = this.x + this.w * 0.55;
    if (this.wingmanMode === 'outward') {
      const topY = this.y - 6, botY = this.y + this.h + 2;
      const outwardDefs = [
        { x: wx, y: topY, angle: -Math.PI / 2 },
        { x: wx, y: botY, angle: Math.PI / 2 },
        { x: wx - 12, y: topY, angle: -Math.PI / 2 },
        { x: wx - 12, y: botY, angle: Math.PI / 2 },
      ];
      return outwardDefs.slice(0, this.wingmen);
    }
    const defs = [
      { y: this.y - 6 },
      { y: this.y + this.h + 2 },
      { y: this.y - 20 },
      { y: this.y + this.h + 16 },
    ];
    return defs.slice(0, this.wingmen).map((d) => ({ x: wx, y: d.y, angle: 0 }));
  }
  cycleWingmanMode() {
    const order = ['forward', 'outward', 'orbit'];
    const i = order.indexOf(this.wingmanMode);
    this.wingmanMode = order[(i + 1) % order.length];
    Game.showToast(`WINGMEN: ${this.wingmanMode.toUpperCase()}`, '#ffcf40');
    Audio_.powerup();
    Game.updateHud();
  }
  cycleWeapon() {
    if (this.weaponOrder.length <= 1) return;
    const i = this.weaponOrder.indexOf(this.activeWeapon);
    this.activeWeapon = this.weaponOrder[(i + 1) % this.weaponOrder.length];
    const label = this.activeWeapon === 'normal' ? 'STANDARD CANNON' : POWERUP_TYPES[this.activeWeapon].name;
    const held = this.weapons[this.activeWeapon];
    Game.showToast(`WEAPON: ${label}${held ? ` LV${held.level}` : ''}`, '#eafcff');
    Audio_.powerup();
    Game.updateHud();
  }
  useBomb() {
    if (this.bombs <= 0 || this.bombCooldown > 0) return;
    this.bombs -= 1;
    this.bombCooldown = 1.5;
    this.invulnTime = Math.max(this.invulnTime, 1.0);
    Game.detonateBomb();
    Game.updateHud();
  }
  drawWingmanPod(x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(-7, -5);
    ctx.lineTo(-7, 5);
    ctx.closePath();
    ctx.fillStyle = '#ffcf40';
    ctx.shadowColor = '#ffcf40';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.strokeStyle = '#fff3c4';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}

/* ============================== BULLETS ============================== */

class PlayerBullet {
  constructor(x, y, angle, color, glow, level = 1, opts = {}) {
    this.x = x; this.y = y;
    this.level = level;
    this.isPierce = !!opts.pierce;
    this.isChain = !!opts.chain;
    // Pierce and Chain get their own base shapes (not just a level scale-up)
    // so each reads as distinct in flight, even before any hit resolves —
    // Pierce goes long and thin (laser-cannon bolt), Chain shorter/stubbier.
    let baseW = 12, baseH = 3, growW = 3.5, growH = 1.2;
    if (this.isPierce) { baseW = 92; baseH = 2.2; growW = 18; growH = 0.5; }
    else if (this.isChain) { baseW = 16; baseH = 2.2; growW = 3; growH = 0.6; }
    this.w = baseW + (level - 1) * growW;
    this.h = baseH + (level - 1) * growH;
    this.speed = 820;
    this.angle = angle || 0;
    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed;
    const baseColor = color || '#eafcff';
    this.color = level > 1 ? rgbaStr(lerpColor(baseColor, '#ffffff', (level - 1) * 0.18)) : baseColor;
    this.glow = glow || '#2ef2ff';
    // Pierce: bullet survives N hits before dying instead of dying on the first.
    // Chain: on the first hit, also jumps to nearby enemies within chainRadius.
    this.pierceRemaining = opts.pierce || 0;
    this.chainRemaining = opts.chain || 0;
    this.chainRadius = opts.chainRadius || 0;
    this._chainedTargets = null;
    this.trailTimer = 0;
    this.sparkTimer = 0;
    // Zigzag path: baseY advances in a straight line, y is offset from it by
    // a sine wave, and the render angle is the path's analytic derivative
    // (base velocity + the wave's instantaneous slope) rather than a fixed
    // firing angle — same "derive heading, don't fixed-angle it" approach
    // used for the Snake boss segments, so the bolt visibly tilts into its
    // own weave instead of staying a flat horizontal bar.
    this.baseY = y;
    // A twin-bolt pair passes an explicit zigPhase (0 / π) so they oscillate
    // in opposite directions as a double helix; anything else gets a random
    // phase so unrelated shots don't all wiggle in lockstep. zigPhase is kept
    // separate from zigT (pure elapsed time) rather than folded into it,
    // since zigT gets multiplied by zigFreq inside sin() — a phase baked into
    // zigT would get scaled by that same frequency.
    this.zigT = 0;
    this.zigPhase = opts.zigPhase !== undefined ? opts.zigPhase : rand(0, Math.PI * 2);
    this.zigAmp = 12;
    this.zigFreq = 36;
  }
  update(dt) {
    this.x += this.vx * dt;
    if (this.isChain) {
      this.baseY += this.vy * dt;
      this.zigT += dt;
      this.y = this.baseY + Math.sin(this.zigT * this.zigFreq + this.zigPhase) * this.zigAmp;
      const dyDt = this.vy + this.zigAmp * this.zigFreq * Math.cos(this.zigT * this.zigFreq + this.zigPhase);
      this.angle = Math.atan2(dyDt, this.vx);
    } else {
      this.y += this.vy * dt;
    }
    if (this.isPierce) {
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        this.trailTimer = 0.02;
        Particles.trail(this.x + this.w / 2, this.y + this.h / 2, this.glow);
      }
    }
    if (this.isChain) {
      // Without a trail, only an instantaneous rotated bar is ever visible —
      // the sine path itself was never actually seen, just implied by
      // rotation, which is why the "helix" read as noise instead of a curve.
      // Sampling interval scaled down to match zigFreq — tuned originally at
      // freq 16 for ~5 samples per quarter-cycle; at the current higher freq
      // that same interval would only catch ~2 samples per quarter-cycle,
      // undersampling the tighter curve and leaving visible gaps.
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        this.trailTimer = 0.008;
        Particles.trail(this.x + this.w / 2, this.y + this.h / 2, this.glow);
      }
      // Short life + small size so these read as a quick electric flicker
      // rather than a drifting puff of smoke (the default burst() life/size
      // is tuned for explosions, not sparks).
      this.sparkTimer -= dt;
      if (this.sparkTimer <= 0) {
        this.sparkTimer = 0.07;
        Particles.burst(this.x + rand(-4, 4), this.y + this.h / 2 + rand(-7, 7), '#ffffff', 2, 90, [0.1, 0.18], [1.5, 2.5]);
      }
    }
  }
  get box() {
    if (this.isChain) {
      // Collision-only padding, invisible: the sine wave crosses its own
      // centerline fastest (velocity peaks exactly at zero-offset), so a
      // target sitting dead-center in the wiggle actually gets the
      // *narrowest* window to be caught by the bolt's thin visual hitbox.
      // Padding the check taller than the rendered bolt compensates without
      // touching how the curve actually looks.
      const pad = 14;
      return { x: this.x, y: this.y - pad / 2, w: this.w, h: this.h + pad };
    }
    return this;
  }
  draw() {
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    ctx.rotate(this.angle);
    ctx.shadowColor = this.glow;
    ctx.shadowBlur = 10 + (this.level - 1) * 4;
    if (this.isPierce) {
      // Arrowhead + thin shaft: the head deliberately flares wider than the
      // shaft (not just a corner-taper on a uniform sliver) so the point
      // actually reads at this bolt's extreme length-to-thickness ratio —
      // a taper scaled off the shaft's own ~3px thickness was too small a
      // fraction of the shape to be visible.
      const grad = ctx.createLinearGradient(-this.w / 2, 0, this.w / 2, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.55, this.color);
      grad.addColorStop(1, '#ffffff');
      ctx.fillStyle = grad;
      const headLen = this.w * 0.4;
      const headHalfWidth = this.h * 2.2;
      const headBaseX = this.w / 2 - headLen;
      ctx.beginPath();
      ctx.moveTo(this.w / 2, 0);
      ctx.lineTo(headBaseX, -headHalfWidth);
      ctx.lineTo(headBaseX, -this.h / 2);
      ctx.lineTo(-this.w / 2, -this.h / 2);
      ctx.lineTo(-this.w / 2, this.h / 2);
      ctx.lineTo(headBaseX, this.h / 2);
      ctx.lineTo(headBaseX, headHalfWidth);
      ctx.closePath();
      ctx.fill();
      ctx.shadowColor = 'rgba(8, 4, 16, 0.4)';
      ctx.shadowBlur = 3;
      ctx.strokeStyle = 'rgba(8, 4, 16, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = this.color;
      ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
      ctx.shadowColor = 'rgba(8, 4, 16, 0.4)';
      ctx.shadowBlur = 3;
      ctx.strokeStyle = 'rgba(8, 4, 16, 0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-this.w / 2, -this.h / 2, this.w, this.h);
    }
    ctx.restore();
  }
}

class EnemyBullet {
  constructor(x, y, vx, vy) { this.x = x; this.y = y; this.w = 8; this.h = 8; this.vx = vx; this.vy = vy; }
  update(dt) { this.x += this.vx * dt; this.y += this.vy * dt; }
  get box() { return this; }
  draw() {
    ctx.save();
    ctx.fillStyle = '#ff5555';
    ctx.shadowColor = '#ff2e2e';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(this.x + this.w / 2, this.y + this.h / 2, this.w / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'rgba(8, 4, 16, 0.4)';
    ctx.shadowBlur = 3;
    ctx.strokeStyle = 'rgba(8, 4, 16, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}

const Bullets = {
  player: [],
  enemy: [],
  spawnPlayer(x, y, angle, color, glow, level, opts) { this.player.push(new PlayerBullet(x, y, angle, color, glow, level, opts)); },
  spawnEnemy(x, y, vx, vy) { this.enemy.push(new EnemyBullet(x, y, vx, vy)); },
  update(dt) {
    this.player.forEach((b) => b.update(dt));
    this.enemy.forEach((b) => b.update(dt));
    this.player = this.player.filter((b) => b.x < W + 20 && b.x > -20 && b.y > -20 && b.y < H + 20);
    this.enemy = this.enemy.filter((b) => b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < H + 20);
  },
  draw() {
    this.player.forEach((b) => b.draw());
    this.enemy.forEach((b) => b.draw());
  },
  clear() { this.player = []; this.enemy = []; }
};

/* ============================== ENEMIES ============================== */

const ENEMY_TYPES = {
  drone: { w: 30, h: 20, hp: 1, speed: [160, 220], score: 100, color: '#ff2ee0' },
  interceptor: { w: 28, h: 18, hp: 1, speed: [220, 280], score: 150, color: '#7b2eff' },
  cruiser: { w: 46, h: 30, hp: 3, speed: [80, 120], score: 300, color: '#ff9d2e' },
  sentry: { w: 30, h: 22, hp: 2, speed: [140, 190], score: 200, color: '#4fc3f7' },
  turret: { w: 34, h: 26, hp: 4, speed: [35, 55], score: 350, color: '#ff6b4a' },
  swarmer: { w: 18, h: 12, hp: 1, speed: [210, 210], score: 70, color: '#c8ff2e' },
};
const SHIELD_COLOR = '#6ecbff';

// Individual enemy stats step up every 15 waves (HP on the ranged types, speed
// on everything) so late waves are individually tougher, not just more numerous.
// Difficulty shifts this up/down by roughly a tier (DIFFICULTY_PRESETS.tierShift).
function waveTier(wave) {
  const shift = DIFFICULTY_PRESETS[Game.difficulty].tierShift;
  return clamp(Math.floor(wave / 15) + shift, 0, 8);
}

class Enemy {
  constructor(type, wave = 1, fixedY) {
    const spec = ENEMY_TYPES[type];
    this.type = type;
    this.spec = spec;
    this.w = spec.w; this.h = spec.h;
    this.x = W + rand(10, 80);
    const yMin = Background.horizonY * 0.05, yMax = Background.horizonY - spec.h - 10;
    this.y = fixedY !== undefined ? clamp(fixedY, yMin, yMax) : rand(yMin, yMax);
    const tier = waveTier(wave);
    const hpGrowth = (type === 'cruiser' || type === 'turret') ? tier : Math.floor(tier / 2);
    this.hp = spec.hp + hpGrowth;
    const speedMult = 1 + tier * 0.05;
    this.speed = rand(spec.speed[0], spec.speed[1]) * speedMult;
    this.scoreValue = Math.round(spec.score * (1 + tier * 0.12));
    this.t = rand(0, Math.PI * 2);
    this.baseY = this.y;
    this.fireTimer = rand(0.6, 1.6);
    this.hitFlash = 0;
    if (type === 'sentry') {
      this.shieldAngle = rand(0, Math.PI * 2);
      // Wide blocked arc, narrow rotating gap — forces timing a shot through
      // the gap rather than just spraying into a 50/50 rotating half-shield.
      this.shieldArc = Math.PI * 1.55;
    }
  }
  update(dt, player) {
    this.t += dt;
    this.x -= this.speed * dt;
    if (this.type === 'interceptor') {
      this.y = this.baseY + Math.sin(this.t * 3.2) * 46;
    }
    if (this.type === 'cruiser') {
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && this.x < W - 40) {
        this.fireTimer = rand(1.2, 2.0);
        const dx = player.x - this.x, dy = (player.y + player.h / 2) - (this.y + this.h / 2);
        const d = Math.hypot(dx, dy) || 1;
        const spd = 260;
        Bullets.spawnEnemy(this.x, this.y + this.h / 2 - 4, (dx / d) * spd, (dy / d) * spd);
      }
    }
    if (this.type === 'turret') {
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && this.x < W - 20) {
        this.fireTimer = rand(1.6, 2.2);
        const dx = player.x - this.x, dy = (player.y + player.h / 2) - (this.y + this.h / 2);
        const baseAngle = Math.atan2(dy, dx);
        const spreadCount = 3, spreadArc = 0.4, spd = 220;
        for (let i = 0; i < spreadCount; i++) {
          const a = baseAngle + (i - (spreadCount - 1) / 2) * (spreadArc / (spreadCount - 1));
          Bullets.spawnEnemy(this.x, this.y + this.h / 2 - 4, Math.cos(a) * spd, Math.sin(a) * spd);
        }
      }
    }
    if (this.type === 'sentry') {
      this.shieldAngle += dt * 1.6;
    }
    if (this.hitFlash > 0) this.hitFlash -= dt;
  }
  get box() { return { x: this.x + 3, y: this.y + 3, w: this.w - 6, h: this.h - 6 }; }
  isShieldedFrom(bx, by) {
    if (this.type !== 'sentry') return false;
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    const angleToBullet = Math.atan2(by - cy, bx - cx);
    let diff = angleToBullet - this.shieldAngle;
    diff = ((diff + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return Math.abs(diff) < this.shieldArc / 2;
  }
  takeHit() {
    this.hp -= 1;
    this.hitFlash = 0.1;
    Audio_.hitEnemy();
    Particles.burst(this.x + this.w / 2, this.y + this.h / 2, this.spec.color, 6, 120);
    return this.hp <= 0;
  }
  draw() {
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    ctx.rotate(Math.PI);
    const c = this.hitFlash > 0 ? '#ffffff' : this.spec.color;
    ctx.beginPath();
    if (this.type === 'cruiser') {
      ctx.moveTo(this.w / 2, 0);
      ctx.lineTo(this.w / 2 - 14, -this.h / 2);
      ctx.lineTo(-this.w / 2 + 10, -this.h / 2);
      ctx.lineTo(-this.w / 2, 0);
      ctx.lineTo(-this.w / 2 + 10, this.h / 2);
      ctx.lineTo(this.w / 2 - 14, this.h / 2);
    } else if (this.type === 'turret') {
      ctx.moveTo(this.w / 2, 0);
      ctx.lineTo(0, -this.h / 2);
      ctx.lineTo(-this.w / 2, -this.h / 2 + 5);
      ctx.lineTo(-this.w / 2, this.h / 2 - 5);
      ctx.lineTo(0, this.h / 2);
    } else if (this.type === 'swarmer') {
      ctx.moveTo(this.w / 2, 0);
      ctx.lineTo(-this.w / 2, -this.h / 2);
      ctx.lineTo(-this.w / 2, this.h / 2);
    } else {
      ctx.moveTo(this.w / 2, 0);
      ctx.lineTo(-this.w / 2, -this.h / 2);
      ctx.lineTo(-this.w / 4, 0);
      ctx.lineTo(-this.w / 2, this.h / 2);
    }
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.shadowColor = this.spec.color;
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.restore();
    if (this.type === 'sentry') {
      ctx.save();
      ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
      ctx.strokeStyle = SHIELD_COLOR;
      ctx.shadowColor = SHIELD_COLOR;
      ctx.shadowBlur = 8;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, this.w * 0.75, this.shieldAngle - this.shieldArc / 2, this.shieldAngle + this.shieldArc / 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.shadowBlur = 0;
  }
}

// Deterministic per-wave roster: every player faces the same enemy count and
// type mix on a given wave number, so score/wave outcomes stay comparable
// for the leaderboard. Spawn position/speed/timing can still vary cosmetically.
const TURRET_UNLOCK_WAVE = 8;
const SWARMER_UNLOCK_WAVE = 14;

function buildWaveRoster(wave) {
  const count = clamp(6 + Math.floor(wave * 1.6), 6, 50);
  // Cadences shrink as wave climbs, so a growing share of the roster is a
  // ranged threat (cruiser/turret) or shield-blocker (sentry) instead of filler.
  const shooterEvery = Math.max(3, 9 - Math.floor(wave / 12));
  const sentryEvery = Math.max(5, 11 - Math.floor(wave / 14));

  const roster = [];
  for (let i = 1; i <= count; i++) {
    let type = 'drone';
    if (wave >= 2 && i % 4 === 0) type = 'interceptor';
    if (wave >= 5 && i % sentryEvery === 0) type = 'sentry';
    if (wave >= 3 && i % shooterEvery === 0) type = 'cruiser';
    if (wave >= TURRET_UNLOCK_WAVE && i % shooterEvery === Math.floor(shooterEvery / 2)) type = 'turret';
    roster.push(type);
  }

  // Swarmer squads: clustered bursts of weak, fast enemies inserted as a group
  // so they arrive together and read as a wall of targets, not lone stragglers.
  if (wave >= SWARMER_UNLOCK_WAVE) {
    const squadCount = 1 + Math.floor((wave - SWARMER_UNLOCK_WAVE) / 15);
    for (let s = 0; s < squadCount; s++) {
      const insertAt = Math.floor(roster.length * ((s + 1) / (squadCount + 1)));
      roster.splice(insertAt, 0, 'swarmer', 'swarmer', 'swarmer', 'swarmer');
    }
  }
  return roster;
}

const Enemies = {
  list: [],
  roster: [],
  spawnIndex: 0,
  spawnTimer: 0,
  spawnEvery: 1.1,
  escapedInWave: 0,

  startWave(wave) {
    this.roster = buildWaveRoster(wave);
    this.spawnIndex = 0;
    this.spawnTimer = 0.6;
    this.escapedInWave = 0;
  },

  get waveCleared() {
    return this.spawnIndex >= this.roster.length && this.list.length === 0;
  },

  countAlive(type) {
    let n = 0;
    for (const e of this.list) if (e.type === type) n++;
    return n;
  },

  // How many of this type may be alive at once. Turret and cruiser both
  // linger on screen a long time (slow + tanky), so without a cap their
  // numbers compound as more spawn in before the earlier ones clear out.
  concurrencyCap(type) {
    if (type === 'turret') return 2;
    if (type === 'cruiser') return 3;
    return Infinity;
  },

  update(dt, player, wave, throttle) {
    if (this.spawnIndex < this.roster.length) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        const type = this.roster[this.spawnIndex];
        if (this.countAlive(type) >= this.concurrencyCap(type)) {
          this.spawnTimer = 0.4;
        } else {
          this.spawnTimer = clamp(this.spawnEvery - wave * 0.022, 0.35, 1.6) * (throttle ? 2.2 : 1);
          if (type === 'swarmer') {
            let clusterSize = 0;
            while (this.roster[this.spawnIndex + clusterSize] === 'swarmer') clusterSize++;
            const baseY = rand(Background.horizonY * 0.15, Background.horizonY - 80);
            const mid = (clusterSize - 1) / 2;
            for (let i = 0; i < clusterSize; i++) {
              this.list.push(new Enemy('swarmer', wave, baseY + (i - mid) * 28));
            }
            this.spawnIndex += clusterSize;
          } else {
            this.list.push(new Enemy(type, wave));
            this.spawnIndex++;
          }
        }
      }
    }
    this.list.forEach((e) => e.update(dt, player));
    const before = this.list.length;
    this.list = this.list.filter((e) => e.x > -80);
    this.escapedInWave += before - this.list.length;
  },
  draw() { this.list.forEach((e) => e.draw()); },
  clear() {
    this.list = [];
    this.roster = [];
    this.spawnIndex = 0;
    this.spawnTimer = 0;
    this.escapedInWave = 0;
  }
};

/* ============================== BOSSES ============================== */

const BOSS_COLOR = '#ff3355';
const BOSS_TIER_SUFFIXES = ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'EPSILON', 'ZETA', 'ETA', 'THETA', 'IOTA', 'KAPPA'];
const BOSS_ROTATION = ['sentinel', 'ring', 'snake'];

function bossTierName(appearanceIndex) {
  return BOSS_TIER_SUFFIXES[appearanceIndex - 1] || String(appearanceIndex);
}

// Burns `amount` of damage through a composite boss's *currently vulnerable*
// segment (always the tail end for the snake), chaining on to the next one
// exposed if a kill leaves damage remaining.
function damageSegmentsSequentially(boss, amount) {
  if (boss.barrageMode) return;
  let remaining = amount;
  while (remaining > 0 && boss.segments.length > 0) {
    const seg = boss.segments[boss.segments.length - 1];
    const dmg = Math.min(remaining, seg.hp);
    seg.hp -= dmg;
    seg.hitFlash = 0.15;
    remaining -= dmg;
    if (seg.hp <= 0) {
      boss.onSegmentDestroyed(seg);
      if (!boss.isDefeated) {
        Audio_.bossSegmentBurst();
        Particles.burst(seg.box.x + seg.box.w / 2, seg.box.y + seg.box.h / 2, boss.color, 16, 180);
        Game.addScore(seg.score || 30);
      }
    }
  }
}

class BossEscort {
  constructor(boss, index) {
    this.boss = boss;
    this.w = 40; this.h = 28;
    this.score = 60;
    const side = index % 2 === 0 ? -1 : 1;
    const rank = Math.floor(index / 2);
    // Trailing V behind the core (away from the player): the rank closest
    // to the core sits narrow, spreading wider the further back it trails.
    this.offsetX = 100 + rank * 50;
    this.offsetY = side * (38 + rank * 30);
    this.t = rand(0, Math.PI * 2);
    this.maxHp = Math.max(1, Math.round(boss.maxHp / 4));
    this.hp = this.maxHp;
    this.hitFlash = 0;
    this.fireTimer = rand(1.0, 1.8);
    this.x = boss.x + this.offsetX;
    this.y = boss.y + boss.h / 2 + this.offsetY;
  }
  update(dt, player) {
    this.t += dt;
    this.x = this.boss.x + this.offsetX;
    this.y = this.boss.y + this.boss.h / 2 + this.offsetY + Math.sin(this.t * 2) * 6;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.boss.entering) return;
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.fireTimer = rand(1.2, 2.0);
      const dx = (player.x + player.w / 2) - this.x, dy = (player.y + player.h / 2) - this.y;
      const d = Math.hypot(dx, dy) || 1;
      const spd = 260;
      Bullets.spawnEnemy(this.x, this.y, (dx / d) * spd, (dy / d) * spd);
    }
  }
  get box() { return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h }; }
  takeHit() {
    this.hp -= 1;
    this.hitFlash = 0.1;
    Audio_.hitEnemy();
    Particles.burst(this.x, this.y, BOSS_COLOR, 8, 150);
    return this.hp <= 0;
  }
  draw() {
    if (this.hp <= 0) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    const c = this.hitFlash > 0 ? '#ffffff' : BOSS_COLOR;
    ctx.beginPath();
    ctx.moveTo(this.w / 2, 0);
    ctx.lineTo(this.w / 2 - 10, -this.h / 2 + 3);
    ctx.lineTo(this.w / 4, -this.h / 2);
    ctx.lineTo(-this.w / 2 + 7, -this.h / 2 + 5);
    ctx.lineTo(-this.w / 2, 0);
    ctx.lineTo(-this.w / 2 + 7, this.h / 2 - 5);
    ctx.lineTo(this.w / 4, this.h / 2);
    ctx.lineTo(this.w / 2 - 10, this.h / 2 - 3);
    ctx.closePath();
    const grad = ctx.createLinearGradient(-this.w / 2, 0, this.w / 2, 0);
    grad.addColorStop(0, '#3a0a12');
    grad.addColorStop(0.55, c);
    grad.addColorStop(1, '#ffcf5c');
    ctx.fillStyle = grad;
    ctx.shadowColor = BOSS_COLOR;
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.strokeStyle = '#ffe1a8';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 3 + Math.sin(this.t * 6), 0, Math.PI * 2);
    ctx.fillStyle = '#ffe66a';
    ctx.shadowColor = '#ffe66a';
    ctx.shadowBlur = 8;
    ctx.fill();

    ctx.restore();
    ctx.shadowBlur = 0;
  }
}

class MiniBoss {
  constructor(appearanceIndex) {
    this.w = 84; this.h = 58;
    this.x = W + 120;
    this.skyTopY = Background.horizonY * 0.08;
    this.skyBottomY = Background.horizonY - this.h - 20;
    this.y = rand(this.skyTopY, this.skyBottomY);
    this.targetY = rand(this.skyTopY, this.skyBottomY);
    this.ySpeed = 55;
    this.targetX = W * 0.66;
    this.enterSpeed = 210;
    this.entering = true;
    this.t = rand(0, Math.PI * 2);
    // Separate accumulator for the horizontal sway, advanced only while
    // 'active' — this.t keeps ticking through charging/beam for cosmetic
    // animation (core pulse etc.), but x itself is frozen in those phases,
    // so deriving x from this.t directly would snap to wherever the sine
    // curve says it "should" be at the new elapsed time once active resumes,
    // instead of continuing smoothly from the frozen position.
    this.swayPhase = this.t;
    this.tier = appearanceIndex;
    this.name = `SENTINEL-${bossTierName(appearanceIndex)}`;
    this.color = BOSS_COLOR;
    this.maxHp = 18 + appearanceIndex * 10;
    this.hp = this.maxHp;
    this.fireTimer = rand(0.6, 1.0);
    this.hitFlash = 0;
    const escortCount = clamp(appearanceIndex - 1, 0, 4);
    this.escorts = [];
    for (let i = 0; i < escortCount; i++) this.escorts.push(new BossEscort(this, i));

    // Charge/beam cycle: forces a recurring invulnerable window regardless of
    // how much damage the player can burst in, so the fight can't be melted
    // in one continuous DPS window. Charge triggers on whichever comes first:
    // a chunk of HP lost since the last charge, or a flat time cap.
    this.phase = 'active';
    this.damageSinceCharge = 0;
    this.chargeHpThreshold = this.maxHp * 0.25;
    this.activeTimer = 0;
    this.activeTimeCap = rand(6, 8);
    this.chargeDuration = 2.2;
    this.chargeTimer = 0;
    this.beamLockAt = this.chargeDuration - 0.9;
    this.beamLockPoint = null;
    this.beamThickness = 46;
    this.beamDuration = 0.6;
    this.beamTimer = 0;
    this.beamHasHit = false;
    this.convergeTimer = 0;
  }
  update(dt, player) {
    this.t += dt;
    if (this.entering) {
      this.x -= this.enterSpeed * dt;
      if (this.x <= this.targetX) { this.x = this.targetX; this.entering = false; this.t = 0; this.swayPhase = 0; }
    } else {
      if (this.phase === 'active') {
        this.swayPhase += dt;
        this.x = this.targetX + Math.sin(this.swayPhase * 0.5) * 50;
        const dy = this.targetY - this.y;
        if (Math.abs(dy) < 12) {
          this.targetY = rand(this.skyTopY, this.skyBottomY);
        } else {
          this.y += Math.sign(dy) * Math.min(Math.abs(dy), this.ySpeed * dt);
        }
        this.fireTimer -= dt;
        if (this.fireTimer <= 0) {
          this.fireTimer = rand(0.55, 0.9);
          this.fire(player);
        }
        this.activeTimer += dt;
        if (this.damageSinceCharge >= this.chargeHpThreshold || this.activeTimer >= this.activeTimeCap) {
          this.phase = 'charging';
          this.chargeTimer = 0;
          this.beamLockPoint = null;
        }
      } else if (this.phase === 'charging') {
        this.chargeTimer += dt;
        const chargeFrac = clamp(this.chargeTimer / this.chargeDuration, 0, 1);
        this.convergeTimer -= dt;
        if (this.convergeTimer <= 0) {
          this.convergeTimer = 0.045;
          const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
          const col = rgbaStr(lerpColor('#ffe66a', '#ffffff', chargeFrac));
          Particles.converge(cx, cy, col, 2, 150 + chargeFrac * 90, 55);
        }
        if (this.beamLockPoint === null && this.chargeTimer >= this.beamLockAt) {
          this.beamLockPoint = {
            x: player.x + player.w / 2,
            y: clamp(player.y + player.h / 2, this.skyTopY + 10, this.skyBottomY + this.h - 10),
          };
        }
        if (this.chargeTimer >= this.chargeDuration) {
          this.phase = 'beam';
          this.beamTimer = 0;
          this.beamHasHit = false;
          const noseX = this.x + 4, noseY = this.y + this.h / 2;
          Particles.burst(noseX, noseY, '#ffffff', 26, 260);
          Particles.burst(noseX, noseY, '#ff5050', 18, 200);
          Game.shake(0.25, 7);
          Audio_.laserBeam();
        }
      } else if (this.phase === 'beam') {
        this.beamTimer += dt;
        if (this.beamTimer >= this.beamDuration) {
          this.phase = 'active';
          this.damageSinceCharge = 0;
          this.activeTimer = 0;
          this.activeTimeCap = rand(6, 8);
          this.beamLockPoint = null;
        }
      }
    }
    if (this.hitFlash > 0) this.hitFlash -= dt;
    this.escorts.forEach((e) => e.update(dt, player));
  }
  fire(player) {
    const mx = this.x + 4, my = this.y + this.h / 2;
    const dx = (player.x + player.w / 2) - mx, dy = (player.y + player.h / 2) - my;
    const d = Math.hypot(dx, dy) || 1;
    const spd = 300;
    Bullets.spawnEnemy(mx, my, (dx / d) * spd, (dy / d) * spd);
  }
  get box() { return { x: this.x + 8, y: this.y + 8, w: this.w - 16, h: this.h - 16 }; }
  get segments() { return [this, ...this.escorts]; }
  get isDefeated() { return this.hp <= 0; }
  onSegmentDestroyed(segment) {
    if (segment !== this) this.escorts = this.escorts.filter((e) => e !== segment);
  }
  beamActive() { return this.phase === 'beam'; }
  // Straight line from the ship's nose through the locked target point,
  // extended to the left screen edge. Used for both the charging telegraph
  // and the actual beam (rendering + hit test) so they always match exactly.
  beamRay() {
    if (!this.beamLockPoint) return null;
    const x1 = this.x + 4, y1 = this.y + this.h / 2;
    let dx = this.beamLockPoint.x - x1;
    const dy = this.beamLockPoint.y - y1;
    if (dx >= -1) dx = -1;
    const s = -x1 / dx;
    return { x1, y1, x2: 0, y2: y1 + s * dy };
  }
  applyBombDamage(amount) {
    if (this.phase !== 'active') {
      Particles.burst(this.x + this.w / 2, this.y + this.h / 2, '#ffffff', 14, 160);
      return;
    }
    this.hp -= amount;
    this.damageSinceCharge += amount;
    this.hitFlash = 0.15;
    Particles.burst(this.x + this.w / 2, this.y + this.h / 2, this.color, 24, 240);
  }
  takeHit() {
    if (this.phase !== 'active') {
      Particles.burst(this.x + this.w / 2, this.y + this.h / 2, '#ffffff', 4, 90);
      return false;
    }
    this.hp -= 1;
    this.damageSinceCharge += 1;
    this.hitFlash = 0.08;
    Audio_.hitEnemy();
    Particles.burst(this.x + this.w / 2, this.y + this.h / 2, BOSS_COLOR, 5, 140);
    return this.hp <= 0;
  }
  draw() {
    this.escorts.forEach((e) => e.draw());
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    const c = this.hitFlash > 0 ? '#ffffff' : BOSS_COLOR;
    ctx.beginPath();
    ctx.moveTo(this.w / 2, 0);
    ctx.lineTo(this.w / 2 - 20, -this.h / 2 + 6);
    ctx.lineTo(this.w / 4, -this.h / 2);
    ctx.lineTo(-this.w / 2 + 14, -this.h / 2 + 10);
    ctx.lineTo(-this.w / 2, 0);
    ctx.lineTo(-this.w / 2 + 14, this.h / 2 - 10);
    ctx.lineTo(this.w / 4, this.h / 2);
    ctx.lineTo(this.w / 2 - 20, this.h / 2 - 6);
    ctx.closePath();
    const grad = ctx.createLinearGradient(-this.w / 2, 0, this.w / 2, 0);
    grad.addColorStop(0, '#3a0a12');
    grad.addColorStop(0.55, c);
    grad.addColorStop(1, '#ffcf5c');
    ctx.fillStyle = grad;
    ctx.shadowColor = BOSS_COLOR;
    ctx.shadowBlur = 20;
    ctx.fill();
    ctx.strokeStyle = '#ffe1a8';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const chargeFrac = this.phase === 'charging' ? clamp(this.chargeTimer / this.chargeDuration, 0, 1) : 0;
    const coreR = this.phase === 'charging'
      ? 8 + chargeFrac * 18
      : 8 + 2 * Math.sin(this.t * 6);
    const coreColor = chargeFrac > 0 ? rgbaStr(lerpColor('#ffe66a', '#ffffff', chargeFrac)) : '#ffe66a';
    ctx.beginPath();
    ctx.arc(0, 0, coreR, 0, Math.PI * 2);
    ctx.fillStyle = coreColor;
    ctx.shadowColor = coreColor;
    ctx.shadowBlur = 14;
    ctx.fill();

    if (this.phase !== 'active') {
      ctx.beginPath();
      ctx.arc(0, 0, this.w / 2 + 8 + 3 * Math.sin(this.t * 10), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 16;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    if (this.phase === 'charging') {
      // Two containment rings spinning opposite directions, tightening
      // (moving closer to the hull) as the charge nears completion.
      const ringR = this.w / 2 + 20 - chargeFrac * 10;
      ctx.lineWidth = 2;
      ctx.shadowColor = coreColor;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = 'rgba(255, 230, 140, 0.85)';
      ctx.beginPath();
      ctx.arc(0, 0, ringR, this.t * 4, this.t * 4 + Math.PI * 1.1);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.beginPath();
      ctx.arc(0, 0, ringR + 7, -this.t * 3.2, -this.t * 3.2 + Math.PI * 1.1);
      ctx.stroke();
    }

    ctx.restore();
    ctx.shadowBlur = 0;

    if (this.phase === 'charging' && this.beamLockPoint !== null) {
      const ray = this.beamRay();
      // Pulsing brightness instead of a flat static line — reads as an
      // active, urgent warning rather than background decoration.
      const flash = 0.5 + 0.5 * Math.sin(this.t * 14);
      ctx.save();
      ctx.globalAlpha = 0.45 + flash * 0.55;
      ctx.strokeStyle = '#ff5050';
      ctx.shadowColor = '#ff5050';
      ctx.shadowBlur = 8 + flash * 10;
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(ray.x1, ray.y1);
      ctx.lineTo(ray.x2, ray.y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    if (this.phase === 'beam') {
      const ray = this.beamRay();
      const angle = Math.atan2(ray.y2 - ray.y1, ray.x2 - ray.x1);
      const length = Math.hypot(ray.x2 - ray.x1, ray.y2 - ray.y1);
      const th = this.beamThickness;
      ctx.save();
      ctx.translate(ray.x1, ray.y1);
      ctx.rotate(angle);
      // Layered laser: soft outer glow, saturated mid band, white-hot core line.
      const outerGrad = ctx.createLinearGradient(0, -th / 2, 0, th / 2);
      outerGrad.addColorStop(0, 'rgba(255,90,90,0)');
      outerGrad.addColorStop(0.5, 'rgba(255,60,60,0.55)');
      outerGrad.addColorStop(1, 'rgba(255,90,90,0)');
      ctx.fillStyle = outerGrad;
      ctx.shadowColor = '#ff3030';
      ctx.shadowBlur = 30;
      ctx.fillRect(0, -th / 2, length, th);

      const midH = th * 0.55;
      const midGrad = ctx.createLinearGradient(0, -midH / 2, 0, midH / 2);
      midGrad.addColorStop(0, 'rgba(255,120,60,0)');
      midGrad.addColorStop(0.5, 'rgba(255,150,60,0.95)');
      midGrad.addColorStop(1, 'rgba(255,120,60,0)');
      ctx.fillStyle = midGrad;
      ctx.shadowBlur = 18;
      ctx.fillRect(0, -midH / 2, length, midH);

      ctx.strokeStyle = '#ffffff';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 16;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(length, 0);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// 8-sided plate: armor look for the ring's outer shell.
function drawOctagon(r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const ang = (Math.PI / 4) * i;
    const px = Math.cos(ang) * r, py = Math.sin(ang) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

class RingSegment {
  constructor(ring, baseAngle, size) {
    this.ring = ring;
    this.baseAngle = baseAngle;
    this.w = size; this.h = size;
    this.hp = 9 + (ring.tier - 1) * 3;
    this.maxHp = this.hp;
    this.score = 50;
    this.hitFlash = 0;
    this.x = 0; this.y = 0; this.angle = baseAngle;
  }
  updatePosition() {
    this.angle = this.baseAngle + this.ring.rotation;
    this.x = this.ring.centerX + Math.cos(this.angle) * this.ring.radius - this.w / 2;
    this.y = this.ring.centerY + Math.sin(this.angle) * this.ring.radius - this.h / 2;
  }
  get box() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  takeHit() {
    if (this.ring.spinning) {
      this.hitFlash = 0.08;
      Audio_.shieldBlock();
      Particles.burst(this.x + this.w / 2, this.y + this.h / 2, '#aab4c8', 5, 90);
      return false;
    }
    this.hp -= 1;
    this.hitFlash = 0.1;
    Audio_.hitEnemy();
    Particles.burst(this.x + this.w / 2, this.y + this.h / 2, this.ring.color, 8, 150);
    return this.hp <= 0;
  }
  draw() {
    if (this.hp <= 0) return;
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    const c = this.hitFlash > 0 ? '#ffffff' : (this.ring.spinning ? '#8a97ac' : this.ring.color);
    drawOctagon(this.w / 2);
    ctx.fillStyle = c;
    ctx.shadowColor = c;
    ctx.shadowBlur = this.ring.spinning ? 6 : 14;
    ctx.fill();
    ctx.restore();
    ctx.shadowBlur = 0;
  }
}

class RingCore {
  constructor(ring, appearanceIndex) {
    this.ring = ring;
    this.w = 34; this.h = 34;
    this.maxHp = 24 + (appearanceIndex - 1) * 10;
    this.hp = this.maxHp;
    this.score = 400;
    this.hitFlash = 0;
    this.fireTimer = rand(0.8, 1.2);
    this.updatePosition();
  }
  updatePosition() {
    this.x = this.ring.centerX - this.w / 2;
    this.y = this.ring.centerY - this.h / 2;
  }
  get box() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  // Once the shell is fully destroyed, the core is exposed permanently and
  // no longer gated by the spin/stop cycle.
  get vulnerable() { return this.ring.spinning || this.ring.segs.length === 0; }
  takeHit() {
    if (!this.vulnerable) {
      this.hitFlash = 0.08;
      Audio_.shieldBlock();
      Particles.burst(this.x + this.w / 2, this.y + this.h / 2, '#aab4c8', 6, 100);
      return false;
    }
    this.hp -= 1;
    this.hitFlash = 0.1;
    Audio_.hitEnemy();
    Particles.burst(this.x + this.w / 2, this.y + this.h / 2, BOSS_COLOR, 10, 170);
    return this.hp <= 0;
  }
  draw() {
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    ctx.rotate(this.ring.t * 0.8);
    const vulnerable = this.vulnerable;
    const c = this.hitFlash > 0 ? '#ffffff' : (vulnerable ? BOSS_COLOR : '#4a5568');
    drawOctagon(this.w / 2);
    ctx.fillStyle = c;
    ctx.shadowColor = vulnerable ? BOSS_COLOR : 'transparent';
    ctx.shadowBlur = vulnerable ? 22 : 4;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(this.x + this.w / 2, this.y + this.h / 2, 4 + 1.5 * Math.sin(this.ring.t * 6), 0, Math.PI * 2);
    ctx.fillStyle = '#ffe66a';
    ctx.shadowColor = '#ffe66a';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

class RingBoss {
  constructor(appearanceIndex) {
    this.tier = appearanceIndex;
    this.name = `SOVEREIGN-${bossTierName(appearanceIndex)}`;
    this.color = '#00e5ff';
    this.w = 160; this.h = 160;
    this.centerX = W + 140;
    this.skyTop = Background.horizonY * 0.1;
    this.skyBottom = Background.horizonY - this.h * 0.25;
    this.midY = (this.skyTop + this.skyBottom) / 2;
    this.ampY = (this.skyBottom - this.skyTop) / 2;
    this.centerY = this.midY;
    this.targetX = W * 0.62;
    this.enterSpeed = 200;
    this.entering = true;
    this.t = rand(0, Math.PI * 2);
    this.rotation = 0;
    this.rotationSpeed = 2.2;
    this.radius = 78;
    this.spinning = true;
    this.phaseTimer = rand(4, 5);
    const count = clamp(6 + (appearanceIndex - 1) * 2, 6, 14);
    const spacing = (Math.PI * 2 * this.radius) / count;
    const segSize = clamp(spacing - 14, 24, 70);
    this.segs = [];
    for (let i = 0; i < count; i++) this.segs.push(new RingSegment(this, i * (Math.PI * 2 / count), segSize));
    this.core = new RingCore(this, appearanceIndex);
    this.totalMaxHp = this.segs.reduce((sum, s) => sum + s.maxHp, 0) + this.core.maxHp;
    this.fireTimer = rand(2.0, 2.6);
    this.segs.forEach((s) => s.updatePosition());
  }
  get x() { return this.centerX - this.w / 2; }
  get y() { return this.centerY - this.h / 2; }
  get segments() { return [...this.segs, this.core]; }
  get isDefeated() { return this.core.hp <= 0; }
  get hp() { return this.segs.reduce((sum, s) => sum + Math.max(0, s.hp), 0) + Math.max(0, this.core.hp); }
  get maxHp() { return this.totalMaxHp; }
  onSegmentDestroyed(segment) {
    if (segment === this.core) return;
    this.segs = this.segs.filter((s) => s !== segment);
    if (this.segs.length === 0) {
      Game.showToast('SHELL DESTROYED', this.color);
    }
  }
  applyBombDamage(amount) {
    // A bomb's blast reaches the core directly, bypassing the shell entirely.
    this.core.hp -= amount;
    this.core.hitFlash = 0.15;
    Particles.burst(this.core.x + this.core.w / 2, this.core.y + this.core.h / 2, this.color, 20, 200);
  }
  update(dt, player) {
    this.t += dt;
    if (this.entering) {
      this.centerX -= this.enterSpeed * dt;
      if (this.centerX <= this.targetX) { this.centerX = this.targetX; this.entering = false; this.t = 0; }
    } else {
      this.centerX = this.targetX + Math.sin(this.t * 0.4) * 40;
      this.centerY = this.midY + Math.sin(this.t * 0.35) * this.ampY;

      if (this.segs.length > 0) {
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          this.spinning = !this.spinning;
          this.phaseTimer = this.spinning ? rand(4, 5) : rand(3.5, 4.5);
          Game.showToast(this.spinning ? 'CORE VULNERABLE' : 'SHELL VULNERABLE', this.color);
        }
      }
      if (this.spinning) {
        this.rotation += this.rotationSpeed * dt;
        this.fireTimer -= dt;
        if (this.fireTimer <= 0) {
          this.fireTimer = rand(2.2, 2.8);
          this.fireBurst();
        }
      }
      // The core is a persistent active threat once it's vulnerable, whether
      // that's during a spin phase or permanently once the shell is gone.
      if (this.core.vulnerable) {
        this.core.fireTimer -= dt;
        if (this.core.fireTimer <= 0) {
          this.core.fireTimer = rand(0.45, 0.7);
          this.fireCoreShot(player);
        }
      }
    }
    this.segs.forEach((s) => {
      s.updatePosition();
      if (s.hitFlash > 0) s.hitFlash -= dt;
    });
    this.core.updatePosition();
    if (this.core.hitFlash > 0) this.core.hitFlash -= dt;
  }
  fireBurst() {
    const alive = this.segs.filter((s) => s.hp > 0);
    if (alive.length === 0) return;
    const spd = 220;
    Audio_.ringFire();
    alive.forEach((s) => {
      Bullets.spawnEnemy(s.x + s.w / 2, s.y + s.h / 2, Math.cos(s.angle) * spd, Math.sin(s.angle) * spd);
    });
  }
  fireCoreShot(player) {
    const dx = (player.x + player.w / 2) - this.centerX, dy = (player.y + player.h / 2) - this.centerY;
    const d = Math.hypot(dx, dy) || 1;
    const spd = 260;
    Bullets.spawnEnemy(this.centerX, this.centerY, (dx / d) * spd, (dy / d) * spd);
  }
  draw() {
    this.core.draw();
    this.segs.forEach((s) => s.draw());
  }
}

const SNAKE_HEAD_COLOR = '#148F2B';

class SnakeSegment {
  constructor(snake, index, isHead, totalCount) {
    this.snake = snake;
    this.index = index;
    this.isHead = isHead;
    this.w = isHead ? 42 : 32; this.h = isHead ? 36 : 28;
    this.hp = isHead ? 16 + (snake.tier - 1) * 8 : 4 + (snake.tier - 1) * 2;
    this.maxHp = this.hp;
    this.score = isHead ? 120 : 40;
    this.hitFlash = 0;
    this.x = 0; this.y = 0;
    if (!isHead) {
      const t = totalCount > 2 ? (index - 1) / (totalCount - 2) : 0;
      this.bodyColor = rgbaStr(lerpColor(SNAKE_HEAD_COLOR, snake.color, t));
    }
  }
  updatePosition() {
    const s = this.snake;
    // pathPhase is accumulated each frame (phase += dt * pathSpeed) rather than
    // derived as t * pathSpeed, so a mid-fight pathSpeed change (headExposed's
    // speed-up) alters the rate going forward without snapping the position.
    const segT = s.pathPhase - this.index * s.phaseDelay;
    this.x = s.figureCenterX + s.entryOffsetX + Math.sin(2 * segT) * s.ampX;
    this.y = s.midY + Math.sin(segT) * s.ampY;
    // Exact instantaneous velocity from the derivative of the position formula,
    // used to orient each segment along its actual direction of travel.
    const entryVx = s.entering ? -s.entryDecayRate * s.entryOffsetX : 0;
    const vx = entryVx + Math.cos(2 * segT) * 2 * s.pathSpeed * s.ampX;
    const vy = Math.cos(segT) * s.pathSpeed * s.ampY;
    this.heading = Math.atan2(vy, vx);
  }
  get box() { return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h }; }
  // Only the current tail-end segment can be damaged — destruction proceeds
  // strictly back-to-front, so the head is only ever last.
  get isVulnerable() {
    if (this.snake.barrageMode) return false;
    const tail = this.snake.segs[this.snake.segs.length - 1];
    return tail === this;
  }
  takeHit() {
    if (!this.isVulnerable) {
      this.hitFlash = 0.08;
      Audio_.shieldBlock();
      Particles.burst(this.x, this.y, '#aab4c8', 5, 90);
      return false;
    }
    this.hp -= 1;
    this.hitFlash = 0.1;
    Audio_.hitEnemy();
    Particles.burst(this.x, this.y, this.snake.color, this.isHead ? 16 : 8, this.isHead ? 200 : 140);
    return this.hp <= 0;
  }
  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.heading || 0);
    const vulnerable = this.isVulnerable;
    const c = this.hitFlash > 0 ? '#ffffff' : (vulnerable ? BOSS_COLOR : (this.isHead ? SNAKE_HEAD_COLOR : this.bodyColor));
    ctx.beginPath();
    if (this.isHead) {
      ctx.moveTo(this.w / 2, 0);
      ctx.lineTo(this.w / 2 - 10, -this.h / 2);
      ctx.lineTo(-this.w / 2, -this.h / 2 + 6);
      ctx.lineTo(-this.w / 2, this.h / 2 - 6);
      ctx.lineTo(this.w / 2 - 10, this.h / 2);
    } else {
      const r = this.w / 2;
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI / 3) * i;
        const px = Math.cos(ang) * r, py = Math.sin(ang) * r * 0.85;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.shadowColor = c;
    ctx.shadowBlur = vulnerable ? (this.isHead ? 20 : 14) : (this.isHead ? 8 : 5);
    ctx.fill();
    if (this.isHead) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffe1a8';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(this.w * 0.08, 0, 6 + 2 * Math.sin(this.snake.t * 6), 0, Math.PI * 2);
      ctx.fillStyle = '#ffe66a';
      ctx.shadowColor = '#ffe66a';
      ctx.shadowBlur = 12;
      ctx.fill();
    } else if (vulnerable) {
      const tr = this.w * 0.22;
      ctx.beginPath();
      ctx.moveTo(tr, 0);
      ctx.lineTo(-tr * 0.6, -tr * 0.85);
      ctx.lineTo(-tr * 0.6, tr * 0.85);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 10;
      ctx.fill();
    }
    ctx.restore();
    ctx.shadowBlur = 0;
  }
}

class SnakeBoss {
  constructor(appearanceIndex) {
    this.tier = appearanceIndex;
    this.name = `VIPER-${bossTierName(appearanceIndex)}`;
    this.color = '#c8ff2e';
    this.basePathSpeed = 0.8;
    const count = clamp(7 + (appearanceIndex - 1) * 2, 7, 17);
    // Cap the total phase spread across the body well under a full loop
    // (2*PI) so long snakes never lap themselves and overlap the head.
    this.phaseDelay = count > 1 ? 4.5 / (count - 1) : 0.5;
    this.figureCenterX = W * 0.8;
    this.ampX = 75;
    this.ampXTarget = this.ampX;
    this.figureCenterXTarget = this.figureCenterX;
    this.driftTimer = rand(5, 8);
    this.headExposed = false;
    this.entryOffsetX = W * 0.45;
    this.entryDecayRate = 2.5;
    this.entering = true;
    this.t = rand(0, Math.PI * 2);
    this.pathPhase = rand(0, Math.PI * 2);
    this.fireTimer = rand(1.0, 1.6);
    this.barrageMode = false;
    this.barrageTimer = rand(6, 8);
    this.barrageDuration = 0;
    this.barrageFireTimer = 0;
    this.w = 90; this.h = 90;
    this.skyTop = Background.horizonY * 0.1;
    this.skyBottom = Background.horizonY - this.h * 0.25;
    this.midY = (this.skyTop + this.skyBottom) / 2;
    this.ampY = (this.skyBottom - this.skyTop) / 2;
    this.segs = [];
    for (let i = 0; i < count; i++) this.segs.push(new SnakeSegment(this, i, i === 0, count));
    this.totalMaxHp = this.segs.reduce((sum, s) => sum + s.maxHp, 0);
    this.segs.forEach((s) => s.updatePosition());
  }
  get x() { return (this.segs[0] ? this.segs[0].x : this.figureCenterX) - this.w / 2; }
  get y() { return (this.segs[0] ? this.segs[0].y : this.midY) - this.h / 2; }
  get segments() { return this.segs; }
  get isDefeated() { return this.segs.length === 0; }
  get hp() { return this.segs.reduce((sum, s) => sum + Math.max(0, s.hp), 0); }
  get maxHp() { return this.totalMaxHp; }
  get pathSpeed() { return this.basePathSpeed * (this.headExposed ? 1.4 : 1); }
  onSegmentDestroyed(segment) {
    this.segs = this.segs.filter((s) => s !== segment);
    if (this.segs.length === 1 && this.segs[0].isHead && !this.headExposed) {
      this.headExposed = true;
      Game.showToast('HEAD EXPOSED', this.color);
      Audio_.bossWarning();
    }
  }
  applyBombDamage(amount) {
    damageSegmentsSequentially(this, amount);
  }
  update(dt, player) {
    this.t += dt;
    this.pathPhase += dt * this.pathSpeed;
    if (this.entering) {
      // Ease the entry offset toward 0 instead of moving at a constant speed
      // and stopping dead — an instant velocity cutoff read as a visible jump
      // once the heading was computed from it.
      this.entryOffsetX -= this.entryOffsetX * this.entryDecayRate * dt;
      if (this.entryOffsetX < 2) { this.entryOffsetX = 0; this.entering = false; }
    } else {
      // Slowly retarget the loop's width/position so it's not the exact same
      // trail every cycle. Values are eased toward their targets each frame
      // (never snapped) so this never introduces a position discontinuity.
      this.driftTimer -= dt;
      if (this.driftTimer <= 0) {
        this.driftTimer = rand(5, 8);
        this.ampXTarget = rand(55, 95);
        this.figureCenterXTarget = rand(W * 0.72, W * 0.88);
      }
      const driftEase = Math.min(1, 1.2 * dt);
      this.ampX += (this.ampXTarget - this.ampX) * driftEase;
      this.figureCenterX += (this.figureCenterXTarget - this.figureCenterX) * driftEase;

      this.barrageTimer -= dt;
      if (!this.barrageMode && this.barrageTimer <= 0) {
        this.barrageMode = true;
        this.barrageDuration = 2.6;
        this.barrageFireTimer = 0;
        Game.showToast('VIPER BARRAGE', this.color);
        Audio_.bossWarning();
      }
      if (this.barrageMode) {
        this.barrageDuration -= dt;
        this.barrageFireTimer -= dt;
        if (this.barrageFireTimer <= 0) {
          this.barrageFireTimer = rand(0.14, 0.22);
          this.fireBarrageShot(player);
        }
        if (this.barrageDuration <= 0) {
          this.barrageMode = false;
          this.barrageTimer = rand(6, 8);
        }
      } else {
        this.fireTimer -= dt;
        if (this.fireTimer <= 0) {
          this.fireTimer = this.headExposed ? rand(0.6, 0.9) : rand(1.1, 1.6);
          this.fire(player);
        }
      }
    }
    this.segs.forEach((s) => {
      s.updatePosition();
      if (s.hitFlash > 0) s.hitFlash -= dt;
    });
  }
  fire(player) {
    const head = this.segs[0];
    if (!head) return;
    const dx = (player.x + player.w / 2) - head.x, dy = (player.y + player.h / 2) - head.y;
    const d = Math.hypot(dx, dy) || 1;
    const spd = 280;
    Bullets.spawnEnemy(head.x, head.y, (dx / d) * spd, (dy / d) * spd);
  }
  fireBarrageShot(player) {
    const alive = this.segs.filter((s) => s.hp > 0);
    if (alive.length === 0) return;
    const s = pick(alive);
    const dx = (player.x + player.w / 2) - s.x, dy = (player.y + player.h / 2) - s.y;
    const d = Math.hypot(dx, dy) || 1;
    const spd = 240;
    Bullets.spawnEnemy(s.x, s.y, (dx / d) * spd, (dy / d) * spd);
    Audio_.ringFire();
  }
  draw() {
    for (let i = this.segs.length - 1; i >= 0; i--) this.segs[i].draw();
  }
}

/* ============================== POWER-UPS ============================== */

const POWERUP_TYPES = {
  spread: { color: '#2ef2ff', label: '⌘', name: 'SPREAD SHOT' },
  rapid: { color: '#ff9d2e', label: '»', name: 'RAPID FIRE' },
  pierce: { color: '#8aff2e', label: '⇶', name: 'PIERCE BEAM' },
  chain: { color: '#b98cff', label: '⚡', name: 'CHAIN ARC' },
  shield: { color: '#7b2eff', label: '◈', name: 'SHIELD' },
  health: { color: '#39ff6a', label: '+', name: 'HULL REPAIR' },
  wingman: { color: '#ffcf40', label: 'W', name: 'WINGMAN' },
  bomb: { color: '#ff5a2e', label: '●', name: 'BOMB', weight: 0.4 },
};

const WEAPON_TYPES = ['spread', 'rapid', 'pierce', 'chain'];
const WEAPON_MAX_LEVEL = 3;
// Each weapon levels up along its own shape rather than a flat size/damage
// multiplier — Spread widens its fan, Rapid adds a stream, Pierce/Chain
// extend their reach.
const WEAPON_LEVELS = {
  // Spread trades width for rate as it levels — wider coverage, but cooldown
  // eases off instead of also getting faster, so it stays a crowd-control
  // weapon rather than also becoming the highest raw-DPS option.
  spread: [
    { count: 3, arc: 0.22, cooldown: 0.17 },
    { count: 5, arc: 0.32, cooldown: 0.19 },
    { count: 7, arc: 0.42, cooldown: 0.22 },
  ],
  // Rapid leans hard into single-target burst DPS instead of trying to
  // match Spread's coverage — narrow streams, but by far the fastest fire
  // rate at max level, so it's the clear pick against one tough target.
  rapid: [
    { streams: 2, cooldown: 0.09 },
    { streams: 2, cooldown: 0.05 },
    { streams: 3, cooldown: 0.04 },
  ],
  pierce: [
    { pierceCount: 2, cooldown: 0.16 },
    { pierceCount: 3, cooldown: 0.14 },
    { pierceCount: 5, cooldown: 0.12 },
  ],
  chain: [
    { chainCount: 1, chainRadius: 130, cooldown: 0.20 },
    { chainCount: 2, chainRadius: 160, cooldown: 0.18 },
    { chainCount: 3, chainRadius: 190, cooldown: 0.16 },
  ],
};

const SHIELD_BASE_MAX = 3;
const SHIELD_LEVEL_STEP = 2;
const SHIELD_MAX_LEVEL = 3;

function pickWeighted(entries) {
  const total = entries.reduce((sum, [, spec]) => sum + (spec.weight || 1), 0);
  let r = rand(0, total);
  for (const [key, spec] of entries) {
    r -= (spec.weight || 1);
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

class PowerUp {
  constructor(type) {
    this.type = type;
    this.spec = POWERUP_TYPES[type];
    this.w = 26; this.h = 26;
    this.x = W + rand(20, 80);
    this.baseY = rand(Background.horizonY * 0.1, Background.horizonY - this.h - 30);
    this.y = this.baseY;
    this.speed = 130;
    this.t = rand(0, Math.PI * 2);
    this.rerollCooldown = 0;
    this.flickerT = 0;
  }
  update(dt) {
    this.t += dt;
    this.x -= this.speed * dt;
    this.y = this.baseY + Math.sin(this.t * 2) * 14;
    if (this.rerollCooldown > 0) this.rerollCooldown -= dt;
    if (this.flickerT > 0) this.flickerT -= dt;
  }
  reroll() {
    const choices = Object.entries(POWERUP_TYPES).filter(([key]) => key !== this.type);
    this.type = pickWeighted(choices);
    this.spec = POWERUP_TYPES[this.type];
    this.rerollCooldown = 0.25;
    this.flickerT = 0.25;
  }
  get box() { return { x: this.x + 3, y: this.y + 3, w: this.w - 6, h: this.h - 6 }; }
  draw() {
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    const pulse = 0.7 + 0.3 * Math.sin(this.t * 5);
    const flick = this.flickerT > 0 ? clamp(this.flickerT / 0.25, 0, 1) : 0;
    const dispColor = flick > 0 ? rgbaStr(lerpColor('#ffffff', this.spec.color, 1 - flick)) : this.spec.color;
    ctx.rotate(this.t * 1.4);
    ctx.beginPath();
    const r = this.w / 2;
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI / 3) * i;
      const px = Math.cos(ang) * r, py = Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(10, 5, 20, 0.55)';
    ctx.strokeStyle = dispColor;
    ctx.shadowColor = dispColor;
    ctx.shadowBlur = 10 + 8 * pulse + 10 * flick;
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.rotate(-this.t * 1.4);
    ctx.fillStyle = dispColor;
    ctx.font = 'bold 15px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.spec.label, 0, 1);
    ctx.restore();
    ctx.shadowBlur = 0;
  }
}

const PowerUps = {
  list: [],
  spawnTimer: rand(8, 13),
  update(dt) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = rand(9, 15);
      this.list.push(new PowerUp(pickWeighted(Object.entries(POWERUP_TYPES))));
    }
    this.list.forEach((p) => p.update(dt));
    this.list = this.list.filter((p) => p.x > -40);
  },
  draw() { this.list.forEach((p) => p.draw()); },
  clear() { this.list = []; this.spawnTimer = rand(8, 13); }
};

/* ============================== GAME ============================== */

const Game = {
  state: 'start',
  difficulty: 'normal',
  score: 0,
  wave: 1,
  player: null,
  boss: null,
  lastBossWave: 0,
  bossRotationIndex: 0,
  bossAppearances: { sentinel: 0, ring: 0, snake: 0 },
  shakeTime: 0,
  shakeMag: 0,
  lifeLostFlashTime: 0,
  bombFlashTime: 0,
  dangerPulseT: 0,
  lastT: 0,

  init() {
    Background.init();
    Input.init();
    Music.init();
    document.getElementById('startBtn').addEventListener('click', () => this.start());
    document.getElementById('resumeBtn').addEventListener('click', () => this.togglePause());
    document.getElementById('retryBtn').addEventListener('click', () => this.start());
    document.getElementById('menuBtn').addEventListener('click', () => this.showMenu());
    // Single canonical copy of the controls list lives in the start overlay;
    // clone its contents into the pause overlay so both stay in sync without
    // duplicating the markup by hand.
    const sourceInstructions = document.querySelector('#startOverlay .instructions');
    const pauseInstructionsEl = document.getElementById('pauseInstructions');
    if (sourceInstructions && pauseInstructionsEl) {
      pauseInstructionsEl.innerHTML = sourceInstructions.innerHTML;
    }
    // Controls panel starts collapsed on the start screen (it's cluttering
    // things now that difficulty/mode selection lives here too) — it's
    // always visible on the pause screen already, so this is purely about
    // trimming the first screen the player sees, not hiding it entirely.
    const startInstructionsEl = document.getElementById('startInstructions');
    const controlsToggleEl = document.getElementById('controlsToggle');
    if (startInstructionsEl && controlsToggleEl) {
      controlsToggleEl.addEventListener('click', () => {
        const nowHidden = startInstructionsEl.classList.toggle('hidden');
        controlsToggleEl.textContent = nowHidden ? 'CONTROLS ▾' : 'CONTROLS ▴';
      });
    }
    const savedDifficulty = localStorage.getItem(DIFFICULTY_KEY);
    this.setDifficulty(DIFFICULTY_PRESETS[savedDifficulty] ? savedDifficulty : 'normal');
    difficultyButtons.forEach((btn) => {
      btn.addEventListener('click', () => this.setDifficulty(btn.dataset.difficulty));
    });
    if (DEBUG) {
      document.getElementById('debugTag').classList.remove('hidden');
      console.log('[DEBUG] 1/2/3 = spawn next-tier Sentinel/Sovereign/Viper, 0 = reset boss tiers');
    }
    requestAnimationFrame((t) => this.loop(t));
  },

  setDifficulty(difficulty) {
    this.difficulty = difficulty;
    localStorage.setItem(DIFFICULTY_KEY, difficulty);
    difficultyButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.difficulty === difficulty);
    });
    difficultyTagEl.textContent = DIFFICULTY_PRESETS[difficulty].label;
  },

  showMenu() {
    this.state = 'start';
    gameOverOverlay.classList.add('hidden');
    startOverlay.classList.remove('hidden');
  },

  start() {
    Audio_.ensure();
    this.score = 0;
    this.wave = 1;
    this.player = new Player();
    Bullets.clear();
    Enemies.clear();
    Enemies.startWave(this.wave);
    Particles.clear();
    Bolts.clear();
    PowerUps.clear();
    this.boss = null;
    this.lastBossWave = 0;
    this.bossRotationIndex = 0;
    this.bossAppearances = { sentinel: 0, ring: 0, snake: 0 };
    this.lifeLostFlashTime = 0;
    this.bombFlashTime = 0;
    this.dangerPulseT = 0;
    this.state = 'playing';
    startOverlay.classList.add('hidden');
    gameOverOverlay.classList.add('hidden');
    pauseOverlay.classList.add('hidden');
    this.updateHud();
    this.updateBossBar();
    Music.start();
    Background.resetPhase();
  },

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      pauseOverlay.classList.remove('hidden');
      Music.pause();
    } else if (this.state === 'paused') {
      this.state = 'playing';
      pauseOverlay.classList.add('hidden');
      Music.resume();
      // Sync the fire flag to whatever's physically held right now, so
      // resuming while still holding Space (or Enter, or clicking Resume
      // with Space held) keeps firing immediately instead of needing a
      // fresh press/release cycle.
      Input.firePressed = Input.keys.has('Space');
    }
  },

  shake(time, mag) { this.shakeTime = time; this.shakeMag = mag; },

  flashLifeLost() { this.lifeLostFlashTime = 0.4; },

  detonateBomb() {
    Enemies.list.forEach((e) => {
      Particles.burst(e.x + e.w / 2, e.y + e.h / 2, e.spec.color, 16, 200);
      this.addScore(e.scoreValue);
    });
    Enemies.list = [];
    Bullets.enemy = [];
    if (this.boss) {
      this.boss.applyBombDamage(9);
      this.updateBossBar();
      if (this.boss.isDefeated) this.defeatBoss();
    }
    Audio_.bombBlast();
    this.shake(0.4, 12);
    this.bombFlashTime = 0.45;
  },

  // Resolves what a bullet does after landing a hit: Chain jumps the hit to
  // nearby enemies before the bullet dies; Pierce lets the bullet survive to
  // hit again instead of dying immediately. A bullet dies here unless it
  // still has pierce charges left.
  applyBulletImpact(b, hitX, hitY, primaryTarget) {
    if (b.chainRemaining > 0) {
      const hitSet = b._chainedTargets || (b._chainedTargets = new Set());
      hitSet.add(primaryTarget);
      const candidates = Enemies.list
        .filter((e) => e.hp > 0 && !hitSet.has(e))
        .map((e) => ({ e, d: Math.hypot((e.x + e.w / 2) - hitX, (e.y + e.h / 2) - hitY) }))
        .filter((c) => c.d <= b.chainRadius)
        .sort((a, c) => a.d - c.d);
      let jumps = 0;
      let fromX = hitX, fromY = hitY;
      for (const c of candidates) {
        if (jumps >= b.chainRemaining) break;
        hitSet.add(c.e);
        jumps++;
        const tx = c.e.x + c.e.w / 2, ty = c.e.y + c.e.h / 2;
        Bolts.spawn(fromX, fromY, tx, ty, '#b98cff');
        Particles.burst(tx, ty, '#b98cff', 8, 140);
        if (c.e.takeHit()) {
          c.e.hp = 0;
          this.addScore(c.e.scoreValue);
          Audio_.explosion();
          Particles.burst(tx, ty, c.e.spec.color, 18, 200);
        }
        fromX = tx; fromY = ty;
      }
    }
    // Pierce: dies once it has landed pierceCount hits total (decrement then
    // check the fresh value, not the pre-hit one, so the count matches what
    // the weapon level actually promises).
    if (b.pierceRemaining > 0) {
      b.pierceRemaining -= 1;
    }
    if (b.pierceRemaining <= 0) {
      b._dead = true;
    }
  },

  updateHud() {
    scoreEl.textContent = String(this.score).padStart(6, '0');
    waveEl.textContent = String(this.wave).padStart(2, '0');
    const heartEls = livesRowEl.querySelectorAll('.heart');
    heartEls.forEach((el, i) => el.classList.toggle('lost', i >= this.player.lives));
    const bombEls = bombsRowEl.querySelectorAll('.bomb');
    bombEls.forEach((el, i) => el.classList.toggle('lost', i >= this.player.bombs));
    hullBarFillEl.style.width = `${(this.player.hull / this.player.hullMax) * 100}%`;
    hullBarFillEl.classList.toggle('critical', this.player.hull <= 1);
    if (this.player.shieldHp > 0) {
      shieldBarWrapEl.classList.remove('hidden');
      shieldBarFillEl.style.width = `${(this.player.shieldHp / this.player.shieldMaxHp) * 100}%`;
      shieldLabelEl.textContent = this.player.shieldLevel > 1 ? `SHIELD LV${this.player.shieldLevel}` : 'SHIELD';
    } else {
      shieldBarWrapEl.classList.add('hidden');
    }
    if (this.player.wingmen > 0) {
      wingmanModeLabelEl.classList.remove('hidden');
      wingmanModeLabelEl.textContent = `WINGMEN: ${this.player.wingmanMode.toUpperCase()}`;
    } else {
      wingmanModeLabelEl.classList.add('hidden');
    }
    const heldWeapons = this.player.weaponOrder.filter((t) => t !== 'normal');
    if (heldWeapons.length > 0) {
      weaponsWrapEl.classList.remove('hidden');
      weaponsEl.innerHTML = this.player.weaponOrder.map((t) => {
        const active = t === this.player.activeWeapon;
        if (t === 'normal') {
          return `<div class="weapon-icon${active ? ' active' : ''}" style="--wcolor:#eafcff"><span class="weapon-glyph">•</span></div>`;
        }
        const spec = POWERUP_TYPES[t];
        const level = this.player.weapons[t].level;
        const pips = Array.from({ length: WEAPON_MAX_LEVEL }, (_, i) =>
          `<span class="weapon-pip${i < level ? ' filled' : ''}"></span>`
        ).join('');
        return `<div class="weapon-icon${active ? ' active' : ''}" style="--wcolor:${spec.color}">
          <span class="weapon-glyph">${spec.label}</span>
          <div class="weapon-pips">${pips}</div>
        </div>`;
      }).join('');
    } else {
      weaponsWrapEl.classList.add('hidden');
    }
  },

  addScore(v) {
    this.score += Math.round(v * DIFFICULTY_PRESETS[this.difficulty].scoreMult);
    this.updateHud();
  },

  completeWave() {
    const advanceBonus = 50 + this.wave * 10;
    const perfect = Enemies.escapedInWave === 0;
    const perfectBonus = perfect ? 250 + this.wave * 30 : 0;
    this.addScore(advanceBonus + perfectBonus);
    if (perfect) {
      this.showToast(`WAVE ${this.wave} — PERFECT CLEAR +${advanceBonus + perfectBonus}`, '#5CFFB0');
    } else {
      this.showToast(`WAVE ${this.wave} CLEAR +${advanceBonus}`, '#8fd7ff');
    }
    Audio_.wave();
    this.wave += 1;
    this.updateHud();
    Enemies.startWave(this.wave);
  },

  showToast(text, color) {
    powerupToastEl.textContent = text;
    powerupToastEl.style.color = color;
    powerupToastEl.classList.add('show');
    clearTimeout(toastTimeoutHandle);
    toastTimeoutHandle = setTimeout(() => powerupToastEl.classList.remove('show'), 1400);
  },

  collectPowerUp(type) {
    const spec = POWERUP_TYPES[type];
    if (WEAPON_TYPES.includes(type)) {
      const p = this.player;
      const held = p.weapons[type];
      if (!held) {
        p.weapons[type] = { level: 1 };
        p.weaponOrder.push(type);
        p.activeWeapon = type;
      } else if (held.level < WEAPON_MAX_LEVEL) {
        held.level += 1;
      } else {
        this.addScore(200);
        this.showToast(`${spec.name} MAXED +200`, spec.color);
        Audio_.powerup();
        return;
      }
      this.updateHud();
      const lvl = p.weapons[type].level;
      this.showToast(`${spec.name} LV${lvl}`, spec.color);
      Audio_.powerup();
      return;
    }
    switch (type) {
      case 'shield': {
        const p = this.player;
        if (p.shieldLevel < SHIELD_MAX_LEVEL) {
          p.shieldLevel += 1;
          p.shieldMaxHp = SHIELD_BASE_MAX + (p.shieldLevel - 1) * SHIELD_LEVEL_STEP;
          p.shieldHp = p.shieldMaxHp;
        } else if (p.shieldHp < p.shieldMaxHp) {
          p.shieldHp = p.shieldMaxHp;
        } else {
          this.addScore(200);
          this.showToast('SHIELD MAXED +200', spec.color);
          Audio_.powerup();
          return;
        }
        break;
      }
      case 'health':
        if (this.player.hull < this.player.hullMax) {
          this.player.hull = this.player.hullMax;
        } else {
          this.addScore(200);
          this.showToast('HULL FULL +200', spec.color);
          Audio_.powerup();
          return;
        }
        break;
      case 'wingman':
        if (this.player.wingmen < 4) {
          this.player.wingmen += 1;
        } else {
          this.addScore(200);
          this.showToast('WINGMEN MAXED +200', spec.color);
          Audio_.powerup();
          return;
        }
        break;
      case 'bomb':
        if (this.player.bombs < this.player.maxBombs) {
          this.player.bombs += 1;
        } else {
          this.addScore(200);
          this.showToast('BOMBS FULL +200', spec.color);
          Audio_.powerup();
          return;
        }
        break;
    }
    this.updateHud();
    this.showToast(spec.name, spec.color);
    Audio_.powerup();
  },

  updateBossBar() {
    if (this.boss) {
      bossBarWrapEl.classList.remove('hidden');
      bossBarFillEl.style.width = `${(this.boss.hp / this.boss.maxHp) * 100}%`;
    } else {
      bossBarWrapEl.classList.add('hidden');
    }
  },

  spawnBoss() {
    const type = BOSS_ROTATION[this.bossRotationIndex % BOSS_ROTATION.length];
    this.bossRotationIndex++;
    this.spawnBossOfType(type);
  },

  spawnBossOfType(type) {
    this.bossAppearances[type] = (this.bossAppearances[type] || 0) + 1;
    const appearance = this.bossAppearances[type];
    if (type === 'ring') this.boss = new RingBoss(appearance);
    else if (type === 'snake') this.boss = new SnakeBoss(appearance);
    else this.boss = new MiniBoss(appearance);
    bossBarLabelEl.textContent = this.boss.name;
    this.showToast(`${this.boss.name} INCOMING`, this.boss.color);
    Audio_.bossWarning();
    this.updateBossBar();
  },

  defeatBoss() {
    const tier = this.boss.tier;
    const name = this.boss.name;
    const color = this.boss.color;
    Audio_.bossDefeated();
    this.shake(0.5, 14);
    Particles.burst(this.boss.x + this.boss.w / 2, this.boss.y + this.boss.h / 2, color, 40, 260);
    this.boss = null;
    this.updateBossBar();
    this.addScore(1500 + tier * 500);
    this.showToast(`${name} DESTROYED`, color);
  },

  gameOver() {
    this.state = 'gameover';
    Audio_.gameOver();
    Music.fadeOut(1.5);
    const key = HIGH_SCORE_KEYS[this.difficulty];
    const high = Math.max(this.score, Number(localStorage.getItem(key) || 0));
    localStorage.setItem(key, String(high));
    finalScoreEl.textContent = `FINAL SCORE ${String(this.score).padStart(6, '0')}`;
    highScoreEl.textContent = `BEST (${DIFFICULTY_PRESETS[this.difficulty].label}) ${String(high).padStart(6, '0')}`;
    gameOverOverlay.classList.remove('hidden');
  },

  update(dt) {
    if (this.state !== 'playing') return;
    Background.update(dt);
    this.player.update(dt);
    Bullets.update(dt);
    Enemies.update(dt, this.player, this.wave, !!this.boss);
    PowerUps.update(dt);
    Particles.update(dt);
    Bolts.update(dt);

    if (!this.boss && Enemies.waveCleared) {
      this.completeWave();
    }

    const bossMilestone = Math.floor(this.wave / 5) * 5;
    if (bossMilestone > 0 && bossMilestone !== this.lastBossWave && !this.boss) {
      this.lastBossWave = bossMilestone;
      this.spawnBoss();
    }
    if (this.boss) this.boss.update(dt, this.player);

    // player bullets vs enemies
    for (const b of Bullets.player) {
      for (const e of Enemies.list) {
        if (b._dead || e.hp <= 0) continue;
        if (rectsOverlap({ x: b.x, y: b.y, w: b.w, h: b.h }, e.box)) {
          if (e.isShieldedFrom(b.x, b.y)) {
            b._dead = true;
            Audio_.shieldBlock();
            Particles.burst(b.x, b.y, SHIELD_COLOR, 6, 100);
            continue;
          }
          if (e.takeHit()) {
            e.hp = 0;
            this.addScore(e.scoreValue);
            Audio_.explosion();
            Particles.burst(e.x + e.w / 2, e.y + e.h / 2, e.spec.color, 18, 200);
          }
          this.applyBulletImpact(b, e.x + e.w / 2, e.y + e.h / 2, e);
        }
      }
      if (!b._dead && this.boss) {
        for (const seg of this.boss.segments) {
          if (seg.hp <= 0) continue;
          if (rectsOverlap({ x: b.x, y: b.y, w: b.w, h: b.h }, seg.box)) {
            const died = seg.takeHit();
            if (died) {
              this.boss.onSegmentDestroyed(seg);
              if (!this.boss.isDefeated) {
                Audio_.bossSegmentBurst();
                Particles.burst(seg.box.x + seg.box.w / 2, seg.box.y + seg.box.h / 2, this.boss.color, 16, 180);
                this.addScore(seg.score || 30);
              }
            }
            this.applyBulletImpact(b, seg.box.x + seg.box.w / 2, seg.box.y + seg.box.h / 2, seg);
            this.updateBossBar();
            if (this.boss.isDefeated) this.defeatBoss();
            break;
          }
        }
      }
      if (!b._dead) {
        for (const p of PowerUps.list) {
          if (rectsOverlap({ x: b.x, y: b.y, w: b.w, h: b.h }, p.box)) {
            b._dead = true;
            if (p.rerollCooldown <= 0) {
              p.reroll();
              Audio_.powerupReroll();
            }
            break;
          }
        }
      }
    }
    Bullets.player = Bullets.player.filter((b) => !b._dead);
    Enemies.list = Enemies.list.filter((e) => e.hp > 0);

    // enemy bullets vs player
    for (const b of Bullets.enemy) {
      if (b._dead) continue;
      if (rectsOverlap({ x: b.x, y: b.y, w: b.w, h: b.h }, this.player.hitbox)) {
        b._dead = true;
        this.player.hit();
        this.updateHud();
        if (this.player.lives <= 0) { this.gameOver(); return; }
      }
    }
    Bullets.enemy = Bullets.enemy.filter((b) => !b._dead);

    // enemies vs player
    for (const e of Enemies.list) {
      if (rectsOverlap(e.box, this.player.hitbox)) {
        e.hp = 0;
        Audio_.explosion();
        Particles.burst(e.x + e.w / 2, e.y + e.h / 2, e.spec.color, 18, 200);
        this.player.hit();
        this.updateHud();
        if (this.player.lives <= 0) { this.gameOver(); return; }
      }
    }
    Enemies.list = Enemies.list.filter((e) => e.hp > 0);

    // boss vs player
    if (this.boss) {
      for (const seg of this.boss.segments) {
        if (seg.hp > 0 && rectsOverlap(seg.box, this.player.hitbox)) {
          this.player.hit();
          this.updateHud();
          if (this.player.lives <= 0) { this.gameOver(); return; }
          break;
        }
      }
      if (this.boss.beamActive && this.boss.beamActive() && !this.boss.beamHasHit) {
        const ray = this.boss.beamRay();
        if (ray) {
          const pc = { x: this.player.x + this.player.w / 2, y: this.player.y + this.player.h / 2 };
          const dist = pointSegmentDistance(pc.x, pc.y, ray.x1, ray.y1, ray.x2, ray.y2);
          const hitRadius = this.boss.beamThickness / 2 + Math.min(this.player.w, this.player.h) / 2;
          if (dist <= hitRadius) {
            this.boss.beamHasHit = true;
            this.player.hit();
            this.updateHud();
            if (this.player.lives <= 0) { this.gameOver(); return; }
          }
        }
      }
    }

    // power-ups vs player
    for (const p of PowerUps.list) {
      if (rectsOverlap(p.box, this.player.hitbox)) {
        p._dead = true;
        Particles.burst(p.x + p.w / 2, p.y + p.h / 2, p.spec.color, 14, 180);
        this.collectPowerUp(p.type);
      }
    }
    PowerUps.list = PowerUps.list.filter((p) => !p._dead);

    if (this.shakeTime > 0) this.shakeTime -= dt;
    if (this.lifeLostFlashTime > 0) this.lifeLostFlashTime -= dt;
    if (this.bombFlashTime > 0) this.bombFlashTime -= dt;
    if (this.player.lives <= 1 && this.player.hull <= 1) this.dangerPulseT += dt;
    else this.dangerPulseT = 0;
  },

  render() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (this.shakeTime > 0) {
      const m = this.shakeMag * (this.shakeTime / 0.35);
      ctx.translate(rand(-m, m), rand(-m, m));
    }
    Background.draw();
    Particles.draw();
    Bullets.draw();
    Enemies.draw();
    if (this.boss) this.boss.draw();
    PowerUps.draw();
    Bolts.draw();
    if (this.player) this.player.draw();
    ctx.restore();

    if (this.state === 'playing' && this.player.lives <= 1 && this.player.hull <= 1) {
      const pulse = 0.35 + 0.18 * Math.sin(this.dangerPulseT * 4);
      const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.75);
      grad.addColorStop(0, 'rgba(255, 20, 20, 0)');
      grad.addColorStop(1, `rgba(255, 20, 20, ${pulse})`);
      ctx.save();
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    if (this.lifeLostFlashTime > 0) {
      const a = clamp(this.lifeLostFlashTime / 0.4, 0, 1) * 0.5;
      ctx.save();
      ctx.fillStyle = `rgba(255, 30, 30, ${a})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    if (this.bombFlashTime > 0) {
      const t = clamp(this.bombFlashTime / 0.45, 0, 1);
      ctx.save();
      ctx.fillStyle = `rgba(255, 245, 220, ${t * 0.7})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

      const elapsedFrac = 1 - t;
      const waveX = -80 + elapsedFrac * (W + 160);
      const bandHalf = 90;
      const waveGrad = ctx.createLinearGradient(waveX - bandHalf, 0, waveX + bandHalf, 0);
      waveGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      waveGrad.addColorStop(0.5, `rgba(255, 255, 255, ${t * 0.55})`);
      waveGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.save();
      ctx.fillStyle = waveGrad;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  },

  loop(t) {
    const dt = Math.min(0.033, (t - (this.lastT || t)) / 1000);
    this.lastT = t;
    this.update(dt);
    this.render();
    requestAnimationFrame((tt) => this.loop(tt));
  }
};

Game.init();
