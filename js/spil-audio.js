// Original 156 BPM soundtrack, synthesized locally. No audio downloads required.
export class MetalAudio {
  constructor() { this.enabled = true; this.playing = false; this.step = 0; this.cache = new Map(); }
  async init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.ctx = new AudioContext();
      const c = this.ctx;
      this.master = c.createGain(); this.master.gain.value = this.enabled ? 0.65 : 0;
      const compressor = c.createDynamicsCompressor();
      compressor.threshold.value = -18; compressor.knee.value = 15; compressor.ratio.value = 5;
      compressor.attack.value = .003; compressor.release.value = .18;
      this.master.connect(compressor); compressor.connect(c.destination);
      this.music = c.createGain(); this.music.gain.value = .7; this.music.connect(this.master);
      this.fx = c.createGain(); this.fx.gain.value = .7; this.fx.connect(this.master);
      this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      // A short stereo room gives the snare and guitars space without muddying the riff.
      this.room = c.createConvolver();
      const impulse = c.createBuffer(2, c.sampleRate * .65, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = impulse.getChannelData(ch);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3) * .24;
      }
      this.room.buffer = impulse; const wet = c.createGain(); wet.gain.value = .2;
      this.room.connect(wet); wet.connect(this.music);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }
  toggle() { this.enabled = !this.enabled; if (this.ctx) this.master.gain.setTargetAtTime(this.enabled ? .65 : 0, this.ctx.currentTime, .04); return this.enabled; }
  start() {
    if (!this.ctx || this.playing) return;
    this.playing = true; this.next = this.ctx.currentTime + .06;
    this.music.gain.setTargetAtTime(.7, this.ctx.currentTime, .04);
    this.schedule(); this.timer = setInterval(() => this.schedule(), 25);
  }
  stop() { this.playing = false; clearInterval(this.timer); if (this.ctx) this.music.gain.setTargetAtTime(0, this.ctx.currentTime, .04); }
  tone(freq, end, duration, volume, time, type = 'sine', bus = this.music) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, time); o.frequency.exponentialRampToValueAtTime(Math.max(end, 1), time + duration);
    g.gain.setValueAtTime(.0001, time); g.gain.exponentialRampToValueAtTime(volume, time + .004); g.gain.exponentialRampToValueAtTime(.0001, time + duration);
    o.connect(g); g.connect(bus); o.start(time); o.stop(time + duration + .02);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }
  hiss(time, duration, volume, frequency, bus = this.music, type = 'highpass', room = false) {
    const c = this.ctx, s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
    s.buffer = this.noise; f.type = type; f.frequency.value = frequency;
    g.gain.setValueAtTime(volume, time); g.gain.exponentialRampToValueAtTime(.0001, time + duration);
    s.connect(f); f.connect(g); g.connect(bus); if (room) g.connect(this.room);
    s.start(time, Math.random()); s.stop(time + duration);
    s.onended = () => { s.disconnect(); f.disconnect(); g.disconnect(); };
  }
  guitarBuffer(midi, sustain) {
    const key = `${midi}/${sustain}`; if (this.cache.has(key)) return this.cache.get(key);
    const rate = this.ctx.sampleRate, duration = sustain ? .48 : .16;
    const b = this.ctx.createBuffer(2, Math.ceil(rate * duration), rate);
    // Two detuned, hard-clipped power chords, palm-muted with a fast low-pass envelope.
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let low = 0, last = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / rate, f = 440 * 2 ** ((midi - 69 + (ch ? .045 : -.045)) / 12);
        let raw = 0;
        for (const ratio of [1, 1.4983, 2]) {
          const phase = t * f * ratio;
          raw += ((phase % 1) * 2 - 1) * .5 + Math.sin(phase * Math.PI * 2) * .25;
        }
        const clipped = Math.tanh(raw * 6);
        low += (clipped - low) * (.13 + .35 * Math.exp(-t * 30));
        const high = low - last * .65; last = low;
        const env = Math.min(1, t * 900) * Math.exp(-t * (sustain ? 5 : 24)) * Math.min(1, (duration - t) * 100);
        d[i] = high * env * .62;
      }
    }
    this.cache.set(key, b); return b;
  }
  guitar(midi, time, sustain = false, volume = 1) {
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    s.buffer = this.guitarBuffer(midi, sustain); g.gain.value = volume;
    s.connect(g); g.connect(this.music); if (sustain) g.connect(this.room);
    s.start(time); s.onended = () => { s.disconnect(); g.disconnect(); };
  }
  schedule() {
    if (!this.playing) return;
    const beat = 60 / 156 / 4;
    while (this.next < this.ctx.currentTime + .12) {
      const n = this.step % 16, bar = Math.floor(this.step / 16) % 8, t = this.next;
      const roots = [28, 28, 31, 29, 28, 28, 34, 29], root = roots[bar];
      const pattern = [0, 0, null, 0, 12, null, 0, 0, 0, null, 7, 0, 12, null, 7, 3];
      const note = pattern[n];
      if (note !== null) {
        this.guitar(root + note, t, n === 4 || n === 12, n % 4 === 0 ? 1 : .8);
        const freq = 440 * 2 ** ((root - 69) / 12);
        this.tone(freq, freq, beat * 1.7, .19, t, 'triangle');
      }
      if ([0, 3, 6, 8, 10, 11].includes(n) || (bar === 7 && n >= 12)) {
        this.tone(145, 43, .22, .75, t); this.hiss(t, .025, .14, 3200);
      }
      if (n === 4 || n === 12) {
        this.tone(190, 115, .13, .25, t, 'triangle'); this.hiss(t, .17, .4, 1100, this.music, 'highpass', true);
      }
      if (n % 2 === 0) this.hiss(t, n === 14 ? .14 : .045, n % 4 ? .055 : .09, 7500);
      if (n === 0 && bar % 2 === 0) this.hiss(t, .65, .13, 6200, this.music, 'highpass', true);
      if (bar >= 4 && n % 2 === 0) {
        const melody = [24, 31, 36, 34, 31, 27, 29, 31];
        const f = 440 * 2 ** ((root + melody[n / 2] - 69) / 12);
        this.tone(f, f * 1.003, .26, .045, t, 'sawtooth');
        this.tone(f, f, .3, .018, t + beat * 3, 'triangle');
      }
      this.step++; this.next += beat;
    }
  }
  effect(name) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    if (name === 'swing') this.hiss(t, .12, .22, 900, this.fx, 'bandpass');
    if (name === 'hit' || name === 'kill') {
      this.tone(name === 'kill' ? 150 : 110, 32, .24, .65, t, 'sine', this.fx);
      this.hiss(t, .14, .5, 1700, this.fx, 'lowpass');
      this.tone(70, 25, .18, .15, t, 'sawtooth', this.fx);
    }
    if (name === 'jump') this.tone(160, 420, .13, .07, t, 'triangle', this.fx);
    if (name === 'dash') this.hiss(t, .16, .2, 1800, this.fx, 'bandpass');
    if (name === 'hurt') { this.tone(190, 55, .3, .2, t, 'sawtooth', this.fx); this.hiss(t, .12, .2, 900, this.fx); }
    if (name === 'win') [0, 7, 12, 19, 24].forEach((n, i) => this.tone(220 * 2 ** (n / 12), 220 * 2 ** (n / 12), .5, .12, t + i * .085, 'triangle', this.fx));
  }
}
