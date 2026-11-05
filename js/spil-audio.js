// Soundtrack: “Metalmania” by Kevin MacLeod (incompetech.com), CC BY 4.0.
// See audio/LICENSE.txt. The recording is unmodified; playback volume is reduced.
export class MetalAudio {
  constructor() {
    this.enabled = true;
    this.playing = false;
    this.track = new Audio('/audio/metalmania.mp3');
    this.track.loop = true;
    this.track.preload = 'auto';
  }
  async init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const c = this.ctx = new AudioContext();
      this.master = c.createGain(); this.master.gain.value = this.enabled ? .8 : 0;
      const compressor = c.createDynamicsCompressor();
      compressor.threshold.value = -12; compressor.knee.value = 12; compressor.ratio.value = 4;
      compressor.attack.value = .003; compressor.release.value = .2;
      this.master.connect(compressor); compressor.connect(c.destination);
      this.music = c.createGain(); this.music.gain.value = .66;
      this.music.connect(this.master);
      this.source = c.createMediaElementSource(this.track); this.source.connect(this.music);
      this.fx = c.createGain(); this.fx.gain.value = .72; this.fx.connect(this.master);
      this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }
  toggle() {
    this.enabled = !this.enabled;
    if (this.ctx) this.master.gain.setTargetAtTime(this.enabled ? .8 : 0, this.ctx.currentTime, .04);
    return this.enabled;
  }
  start() {
    if (!this.ctx || this.playing) return;
    this.playing = true;
    this.ctx.resume().catch(() => {});
    this.track.play().catch(() => { this.playing = false; });
  }
  stop() { this.playing = false; this.track.pause(); }
  tone(freq, end, duration, volume, time, type = 'sine') {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, time); o.frequency.exponentialRampToValueAtTime(Math.max(end, 1), time + duration);
    g.gain.setValueAtTime(.0001, time); g.gain.exponentialRampToValueAtTime(volume, time + .004); g.gain.exponentialRampToValueAtTime(.0001, time + duration);
    o.connect(g); g.connect(this.fx); o.start(time); o.stop(time + duration + .02);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }
  hiss(time, duration, volume, frequency, type = 'highpass') {
    const c = this.ctx, s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
    s.buffer = this.noise; f.type = type; f.frequency.value = frequency;
    g.gain.setValueAtTime(volume, time); g.gain.exponentialRampToValueAtTime(.0001, time + duration);
    s.connect(f); f.connect(g); g.connect(this.fx); s.start(time, Math.random()); s.stop(time + duration);
    s.onended = () => { s.disconnect(); f.disconnect(); g.disconnect(); };
  }
  effect(name) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    if (name === 'swing') this.hiss(t, .12, .22, 900, 'bandpass');
    if (name === 'hit' || name === 'kill') {
      this.tone(name === 'kill' ? 150 : 110, 32, .24, .65, t);
      this.hiss(t, .14, .5, 1700, 'lowpass'); this.tone(70, 25, .18, .15, t, 'sawtooth');
      // Momentary music ducking gives each impact its own space in the mix.
      this.music.gain.cancelScheduledValues(t); this.music.gain.setValueAtTime(.45, t);
      this.music.gain.linearRampToValueAtTime(.66, t + .18);
    }
    if (name === 'jump') this.tone(160, 420, .13, .07, t, 'triangle');
    if (name === 'dash') this.hiss(t, .16, .2, 1800, 'bandpass');
    if (name === 'hurt') { this.tone(190, 55, .3, .2, t, 'sawtooth'); this.hiss(t, .12, .2, 900); }
    if (name === 'win') [0, 7, 12, 19, 24].forEach((n, i) => this.tone(220 * 2 ** (n / 12), 220 * 2 ** (n / 12), .5, .12, t + i * .085, 'triangle'));
  }
}
