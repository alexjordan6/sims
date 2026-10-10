// Tiny WebAudio synth: no assets, just oscillators and filtered noise. Everything struck goes through a
// muffling low-pass and a long, cold reverb; under it all a drone that thickens as night comes on.

type Ctx = AudioContext;

export class Sfx {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  /** where struck sounds go: muffled, and sent into the reverb */
  private bus: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private droneLevel = 0;
  private noiseBuf: AudioBuffer | null = null;
  /** the looping wind around the lair: a low moaning noise whose level follows how close you are */
  private windGain: GainNode | null = null;
  private windLevel = 0;
  /** the gnome glade's warm hum, level following how close the player is */
  private gladeGain: GainNode | null = null;
  private gladeLevel = 0;
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem('village.muted') === '1'; } catch { /* ignore */ }
    // browsers only allow audio after a user gesture
    const unlock = () => { this.ensure(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try { localStorage.setItem('village.muted', this.muted ? '1' : '0'); } catch { /* ignore */ }
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    this.droneLevel = -1; // re-set on the next drone() call
    return this.muted;
  }

  private ensure(): Ctx | null {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return this.ctx; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // the bus: a low-pass (nothing rings bright here) and a long reverb of decaying noise
    const c = this.ctx;
    this.bus = c.createGain();
    const muffle = c.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 2600;
    const verb = c.createConvolver();
    const ir = c.createBuffer(2, Math.floor(c.sampleRate * 2.4), c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const x = ir.getChannelData(ch); for (let i = 0; i < x.length; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / x.length, 3.2); }
    verb.buffer = ir;
    const wet = c.createGain(); wet.gain.value = 0.32;
    this.bus.connect(muffle); muffle.connect(this.master); muffle.connect(verb); verb.connect(wet).connect(this.master);
    return this.ctx;
  }

  /**
   * Set the eerie wind's level (0 = silent, 1 = right at the lair). The loop is built on first use:
   * looped noise through a low-pass that an LFO slowly sweeps, so it moans rather than hisses.
   */
  wind(level: number): void {
    level = Math.max(0, Math.min(1, level));
    if (level === 0 && !this.windGain) return;
    const c = this.ensure(); if (!c || !this.master || !this.noiseBuf) return;
    if (!this.windGain) {
      const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260; f.Q.value = 2.5;
      const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.13;
      const depth = c.createGain(); depth.gain.value = 120;
      lfo.connect(depth).connect(f.frequency);
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start(); lfo.start();
      this.windGain = g;
    }
    if (Math.abs(level - this.windLevel) < 0.01) return;
    this.windLevel = level;
    this.windGain.gain.setTargetAtTime(level * 0.12, c.currentTime, 0.6);
  }

  /**
   * Set the gnome glade's level (0 = silent, 1 = at the cottage door). Two sines a fifth apart, one
   * detuned, under a slow tremolo — a warm hum where the wind is a moan. Built on first use, like wind().
   */
  glade(level: number): void {
    level = Math.max(0, Math.min(1, level));
    if (level === 0 && !this.gladeGain) return;
    const c = this.ensure(); if (!c || !this.master) return;
    if (!this.gladeGain) {
      const g = c.createGain(); g.gain.value = 0;
      const trem = c.createGain(); trem.gain.value = 0.7;
      const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.22;
      const depth = c.createGain(); depth.gain.value = 0.3;
      lfo.connect(depth).connect(trem.gain);
      for (const [f, vol] of [[392, 1], [588, 0.55], [394.5, 0.4]] as const) {
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const og = c.createGain(); og.gain.value = vol;
        o.connect(og).connect(trem); o.start();
      }
      trem.connect(g).connect(this.master);
      lfo.start();
      this.gladeGain = g;
    }
    if (Math.abs(level - this.gladeLevel) < 0.01) return;
    this.gladeLevel = level;
    this.gladeGain.gain.setTargetAtTime(level * 0.05, c.currentTime, 0.8);
  }

  /**
   * The drone under everything (0 = silent, 1 = deepest night): two detuned saws and a sub-bass through a
   * low-pass that slowly breathes. Built on first use, like wind().
   */
  drone(level: number): void {
    level = Math.max(0, Math.min(1, level));
    const c = this.ensure(); if (!c || !this.master) return;
    if (!this.droneGain) {
      const g = c.createGain(); g.gain.value = 0;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 150; f.Q.value = 4;
      const lfo = c.createOscillator(); lfo.frequency.value = 0.06;
      const depth = c.createGain(); depth.gain.value = 70;
      lfo.connect(depth).connect(f.frequency);
      for (const [type, hz, vol] of [['sawtooth', 41.2, 0.5], ['sawtooth', 41.9, 0.5], ['sine', 55, 0.8], ['triangle', 58.3, 0.25]] as const) {
        const o = c.createOscillator(); o.type = type; o.frequency.value = hz;
        const og = c.createGain(); og.gain.value = vol;
        o.connect(og).connect(f); o.start();
      }
      f.connect(g).connect(this.master);
      lfo.start();
      this.droneGain = g;
    }
    if (Math.abs(level - this.droneLevel) < 0.01) return;
    this.droneLevel = level;
    this.droneGain.gain.setTargetAtTime(this.muted ? 0 : level * 0.09, c.currentTime, 1.5);
  }
  /** A raid is coming: a slow, sour swell — a tritone that rises out of nothing and dies in the reverb. */
  stinger(): void {
    const c = this.ctx; if (!c || !this.bus || this.muted) return;
    const t = c.currentTime;
    for (const [hz, vol] of [[98, 0.16], [138.6, 0.12], [196.5, 0.06]] as const) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(hz, t); o.frequency.linearRampToValueAtTime(hz * 0.97, t + 2.2);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.9); g.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
      o.connect(g).connect(this.bus); o.start(t); o.stop(t + 2.5);
    }
    this.noise(2.0, 180, 60, 0.12, 0.6, 0.3);
  }
  /** Something breathing in the thorns: a narrow band of noise that swells and falls. */
  whisper(): void { this.noise(1.1, 2300, 1500, 0.05, 7); this.noise(0.9, 1700, 2100, 0.035, 9, 0.35); }
  /** Old wood shifting somewhere near: a low, slow creak. */
  creak(): void { this.tone('triangle', 150, 104, 0.55, 0.05); this.tone('sawtooth', 152, 100, 0.5, 0.02, 0.05); }

  /** voices started in the current 50 ms window: a thousand-body melee must not start a thousand oscillators */
  private voiceWin = 0; private voices = 0;
  private voiceOk(): boolean {
    const now = performance.now();
    if (now - this.voiceWin > 50) { this.voiceWin = now; this.voices = 0; }
    return ++this.voices <= 14;
  }

  /** A short tone: frequency glides from f0 to f1 over `dur` seconds. */
  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol = 0.3, delay = 0): void {
    const c = this.ctx; if (!c || !this.master || this.muted || !this.voiceOk()) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.bus ?? this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** Filtered noise burst, for whooshes and thuds. */
  private noise(dur: number, f0: number, f1: number, vol = 0.25, q = 1, delay = 0): void {
    const c = this.ctx; if (!c || !this.master || !this.noiseBuf || this.muted || !this.voiceOk()) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.bus ?? this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  swing(stage = 0): void { this.noise(0.14, stage === 2 ? 600 : 1400, stage === 2 ? 2400 : 400, 0.2, 0.8); }
  /** A blow landing. `heft` is what it weighed: an ordinary swing is 1, an overhead well over it. */
  hit(crit = false, heft = 1): void {
    const h = Math.max(0.4, Math.min(2.2, heft));
    this.noise(0.08 * h, 300, 80, 0.35, 0.6);
    this.tone('square', crit ? 520 : 240, crit ? 130 : 60, crit ? 0.14 : 0.08, 0.25);
    // the bottom end is what makes it weigh anything; a heavy blow gets more of it, and lower
    this.tone('sine', 78 / h, 40, 0.1 + 0.07 * h, 0.14 * h);
    if (crit) this.tone('triangle', 900, 1400, 0.12, 0.2, 0.03);
  }
  hurt(): void { this.tone('sawtooth', 180, 70, 0.16, 0.25); this.noise(0.1, 200, 60, 0.2); }
  kill(): void { this.tone('square', 700, 90, 0.22, 0.25); this.noise(0.18, 900, 150, 0.25, 0.5, 0.04); }
  poof(): void { this.noise(0.25, 700, 120, 0.25, 0.4); }
  streak(n: number): void { const minor = [330, 392, 440, 523]; for (let i = 0; i < Math.min(n, 4); i++) this.tone('triangle', minor[i], minor[i] * 0.98, 0.16, 0.16, i * 0.07); }
  bolt(): void { this.tone('sawtooth', 1200, 300, 0.18, 0.15); }
  grunt(): void { this.tone('sawtooth', 120, 90, 0.12, 0.12); }
  whiff(): void { this.noise(0.1, 800, 300, 0.1, 0.8); }
  /** the dodge roll: a scuff of cloth on grass, then the shoulder landing */
  roll(): void { this.noise(0.18, 520, 130, 0.16, 0.5); this.tone('sine', 95, 60, 0.09, 0.09, 0.14); }
  horn(): void { this.tone('sawtooth', 110, 165, 0.5, 0.2); this.tone('sawtooth', 165, 220, 0.5, 0.15, 0.25); }
  private buzzAt = 0;
  /** An angry rasp from a swarm. The fx pushes one per frame, so it only actually sounds a few times a second. */
  buzz(): void {
    const now = performance.now();
    if (now - this.buzzAt < 160) return;
    this.buzzAt = now;
    this.tone('sawtooth', 210, 180, 0.12, 0.05);
    this.tone('square', 105, 92, 0.12, 0.03, 0.01);
  }
  chop(): void { this.noise(0.06, 500, 150, 0.3, 0.7); this.tone('square', 200, 120, 0.06, 0.15); }
  dig(): void { this.noise(0.12, 300, 90, 0.2, 0.6); }
  /** a giant's footstep; `vol` fades with distance */
  thud(vol = 1): void { this.tone('sine', 70, 40, 0.18, 0.35 * vol); this.noise(0.08, 160, 60, 0.15 * vol, 0.8); }
  /** the Ogre's ground slam: a deep boom with a long rumble under it */
  slam(): void { this.tone('sine', 55, 28, 0.45, 0.5); this.tone('sawtooth', 90, 40, 0.3, 0.12); this.noise(0.35, 120, 40, 0.3, 0.9); }
  /** the Ogre's charge: a rising bellow */
  roar(): void { this.tone('sawtooth', 80, 140, 0.4, 0.22); this.tone('square', 60, 110, 0.4, 0.08, 0.05); this.noise(0.3, 400, 150, 0.12, 0.6); }
}
