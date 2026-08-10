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
const powerupToastEl = document.getElementById('powerupToast');
const shieldBarWrapEl = document.getElementById('shieldBarWrap');
const shieldBarFillEl = document.getElementById('shieldBarFill');
const bossBarWrapEl = document.getElementById('bossBarWrap');
const bossBarLabelEl = document.getElementById('bossBarLabel');
const bossBarFillEl = document.getElementById('bossBarFill');
let toastTimeoutHandle = null;

const HIGH_SCORE_KEY = 'neonskies_highscore';
const DEBUG = new URLSearchParams(location.search).has('debug');

function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerpColor(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
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
  }
};

/* ============================== MUSIC ============================== */

const MUSIC_TRACKS = [
  encodeURI('Drum Or Bass - Ryan Stasik.mp3'),
  encodeURI('Horizons - Alex Jones _ Xander Jones.mp3'),
  encodeURI('Midnight - Dan Henig.mp3'),
  encodeURI('Rinse Repeat - DivKid.mp3'),
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
        else this.firePressed = true;
      }
      if (code === 'KeyP' || code === 'Escape') Game.togglePause();
      if (code === 'KeyQ' && Game.state === 'playing' && Game.player) Game.player.cycleWingmanMode();
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

const DAY_PHASES = ['night', 'dawn', 'morning', 'dusk'];

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
};

const Background = {
  horizonY: H * 0.62,
  scroll: 0,
  stars: [],
  phaseIndex: 0,
  prevPhaseIndex: 0,
  transitionT: 999,
  transitionDuration: 2.5,
  beginTransition() {
    this.prevPhaseIndex = this.phaseIndex;
    this.phaseIndex = (this.phaseIndex + 1) % DAY_PHASES.length;
    this.transitionT = 0;
  },
  resetPhase() {
    this.phaseIndex = 0;
    this.prevPhaseIndex = 0;
    this.transitionT = 999;
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
  },
  update(dt) {
    this.scroll += dt;
    if (this.transitionT < this.transitionDuration) this.transitionT += dt;
    this.stars.forEach((s) => {
      s.x -= s.speed * dt;
      if (s.x < 0) { s.x = W; s.y = rand(0, this.horizonY); }
    });
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

    // stars
    this.stars.forEach((s) => {
      ctx.globalAlpha = s.alpha * pal.starAlpha;
      ctx.fillStyle = '#eafcff';
      ctx.fillRect(s.x, s.y, s.size, s.size);
    });
    ctx.globalAlpha = 1;

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
  burst(x, y, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const ang = rand(0, Math.PI * 2);
      const spd = rand(speed * 0.3, speed);
      this.list.push(new Particle(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd, rand(0.3, 0.7), color, rand(2, 5)));
    }
  },
  trail(x, y, color) {
    this.list.push(new Particle(x, y, rand(-20, 10), rand(-10, 10), rand(0.2, 0.35), color, rand(2, 4)));
  },
  update(dt) {
    this.list.forEach((p) => p.update(dt));
    this.list = this.list.filter((p) => p.life > 0);
  },
  draw() { this.list.forEach((p) => p.draw()); },
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
    this.weapon = 'normal';
    this.shieldHp = 0;
    this.shieldMaxHp = 3;
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
      if (this.weapon === 'spread') {
        this.fireCooldown = 0.17;
        Bullets.spawnPlayer(gx, gy, -0.22);
        Bullets.spawnPlayer(gx, gy, 0);
        Bullets.spawnPlayer(gx, gy, 0.22);
      } else if (this.weapon === 'rapid') {
        this.fireCooldown = 0.09;
        Bullets.spawnPlayer(gx, gy - 6);
        Bullets.spawnPlayer(gx, gy + 6);
      } else {
        this.fireCooldown = 0.14;
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
      this.weapon = 'normal';
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
  constructor(x, y, angle, color, glow) {
    this.x = x; this.y = y; this.w = 12; this.h = 3; this.speed = 820;
    this.angle = angle || 0;
    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed;
    this.color = color || '#eafcff';
    this.glow = glow || '#2ef2ff';
  }
  update(dt) { this.x += this.vx * dt; this.y += this.vy * dt; }
  get box() { return this; }
  draw() {
    ctx.save();
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.glow;
    ctx.shadowBlur = 10;
    if (this.angle) {
      ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
      ctx.rotate(this.angle);
      ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
      ctx.shadowColor = 'rgba(8, 4, 16, 0.4)';
      ctx.shadowBlur = 3;
      ctx.strokeStyle = 'rgba(8, 4, 16, 0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-this.w / 2, -this.h / 2, this.w, this.h);
    } else {
      ctx.fillRect(this.x, this.y, this.w, this.h);
      ctx.shadowColor = 'rgba(8, 4, 16, 0.4)';
      ctx.shadowBlur = 3;
      ctx.strokeStyle = 'rgba(8, 4, 16, 0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(this.x, this.y, this.w, this.h);
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
  spawnPlayer(x, y, angle, color, glow) { this.player.push(new PlayerBullet(x, y, angle, color, glow)); },
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
  sentry: { w: 30, h: 22, hp: 1, speed: [140, 190], score: 200, color: '#4fc3f7' },
};
const SHIELD_COLOR = '#6ecbff';

class Enemy {
  constructor(type) {
    const spec = ENEMY_TYPES[type];
    this.type = type;
    this.spec = spec;
    this.w = spec.w; this.h = spec.h;
    this.x = W + rand(10, 80);
    this.y = rand(Background.horizonY * 0.05, Background.horizonY - spec.h - 10);
    this.speed = rand(spec.speed[0], spec.speed[1]);
    this.hp = spec.hp;
    this.t = rand(0, Math.PI * 2);
    this.baseY = this.y;
    this.fireTimer = rand(0.6, 1.6);
    this.hitFlash = 0;
    if (type === 'sentry') {
      this.shieldAngle = rand(0, Math.PI * 2);
      this.shieldArc = Math.PI;
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

const Enemies = {
  list: [],
  spawnTimer: 0,
  spawnEvery: 1.1,
  update(dt, player, wave, throttle) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = clamp(this.spawnEvery - wave * 0.05, 0.35, 2) * (throttle ? 2.2 : 1);
      const roll = Math.random();
      let type = 'drone';
      if (wave >= 2 && roll > 0.55) type = 'interceptor';
      if (wave >= 3 && roll > 0.82) type = 'cruiser';
      if (wave >= 5 && roll > 0.9) type = 'sentry';
      this.list.push(new Enemy(type));
    }
    this.list.forEach((e) => e.update(dt, player));
    this.list = this.list.filter((e) => e.x > -80);
  },
  draw() { this.list.forEach((e) => e.draw()); },
  clear() { this.list = []; this.spawnTimer = 0; }
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
        Audio_.explosion();
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
  }
  update(dt, player) {
    this.t += dt;
    if (this.entering) {
      this.x -= this.enterSpeed * dt;
      if (this.x <= this.targetX) { this.x = this.targetX; this.entering = false; this.t = 0; }
    } else {
      this.x = this.targetX + Math.sin(this.t * 0.5) * 50;
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
  applyBombDamage(amount) {
    this.hp -= amount;
    this.hitFlash = 0.15;
    Particles.burst(this.x + this.w / 2, this.y + this.h / 2, this.color, 24, 240);
  }
  takeHit() {
    this.hp -= 1;
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

    ctx.beginPath();
    ctx.arc(0, 0, 8 + 2 * Math.sin(this.t * 6), 0, Math.PI * 2);
    ctx.fillStyle = '#ffe66a';
    ctx.shadowColor = '#ffe66a';
    ctx.shadowBlur = 14;
    ctx.fill();

    ctx.restore();
    ctx.shadowBlur = 0;
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
    this.name = `RING-${bossTierName(appearanceIndex)}`;
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
  shield: { color: '#7b2eff', label: '◈', name: 'SHIELD' },
  health: { color: '#39ff6a', label: '+', name: 'HULL REPAIR' },
  wingman: { color: '#ffcf40', label: 'W', name: 'WINGMAN' },
  bomb: { color: '#ff5a2e', label: '●', name: 'BOMB', weight: 0.4 },
};

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
    if (DEBUG) {
      document.getElementById('debugTag').classList.remove('hidden');
      console.log('[DEBUG] 1/2/3 = spawn next-tier Sentinel/Ring/Snake, 0 = reset boss tiers');
    }
    requestAnimationFrame((t) => this.loop(t));
  },

  start() {
    Audio_.ensure();
    this.score = 0;
    this.wave = 1;
    this.player = new Player();
    Bullets.clear();
    Enemies.clear();
    Particles.clear();
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
    }
  },

  shake(time, mag) { this.shakeTime = time; this.shakeMag = mag; },

  flashLifeLost() { this.lifeLostFlashTime = 0.4; },

  detonateBomb() {
    Enemies.list.forEach((e) => {
      Particles.burst(e.x + e.w / 2, e.y + e.h / 2, e.spec.color, 16, 200);
      this.addScore(e.spec.score);
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
    } else {
      shieldBarWrapEl.classList.add('hidden');
    }
    if (this.player.wingmen > 0) {
      wingmanModeLabelEl.classList.remove('hidden');
      wingmanModeLabelEl.textContent = `WINGMEN: ${this.player.wingmanMode.toUpperCase()}`;
    } else {
      wingmanModeLabelEl.classList.add('hidden');
    }
  },

  addScore(v) {
    this.score += v;
    const newWave = 1 + Math.floor(this.score / 1200);
    if (newWave !== this.wave) { this.wave = newWave; Audio_.wave(); }
    this.updateHud();
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
    switch (type) {
      case 'spread':
        this.player.weapon = 'spread';
        break;
      case 'rapid':
        this.player.weapon = 'rapid';
        break;
      case 'shield':
        this.player.shieldHp = this.player.shieldMaxHp;
        break;
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
    Audio_.explosion();
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
    const high = Math.max(this.score, Number(localStorage.getItem(HIGH_SCORE_KEY) || 0));
    localStorage.setItem(HIGH_SCORE_KEY, String(high));
    finalScoreEl.textContent = `FINAL SCORE ${String(this.score).padStart(6, '0')}`;
    highScoreEl.textContent = `BEST ${String(high).padStart(6, '0')}`;
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

    const bossMilestone = Math.floor(this.wave / 15) * 15;
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
          b._dead = true;
          if (e.takeHit()) {
            e.hp = 0;
            this.addScore(e.spec.score);
            Audio_.explosion();
            Particles.burst(e.x + e.w / 2, e.y + e.h / 2, e.spec.color, 18, 200);
          }
        }
      }
      if (!b._dead && this.boss) {
        for (const seg of this.boss.segments) {
          if (seg.hp <= 0) continue;
          if (rectsOverlap({ x: b.x, y: b.y, w: b.w, h: b.h }, seg.box)) {
            b._dead = true;
            const died = seg.takeHit();
            if (died) {
              this.boss.onSegmentDestroyed(seg);
              if (!this.boss.isDefeated) {
                Audio_.explosion();
                Particles.burst(seg.box.x + seg.box.w / 2, seg.box.y + seg.box.h / 2, this.boss.color, 16, 180);
                this.addScore(seg.score || 30);
              }
            }
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
