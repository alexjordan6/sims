// Tiny WebAudio synth: no assets, just oscillators and filtered noise. Cartoon-flavoured.

type Ctx = AudioContext;

export class Sfx {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  /** the looping wind around the lair: a low moaning noise whose level follows how close you are */
  private windGain: GainNode | null = null;
  private windLevel = 0;
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

  /** A short tone: frequency glides from f0 to f1 over `dur` seconds. */
  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol = 0.3, delay = 0): void {
    const c = this.ctx; if (!c || !this.master || this.muted) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** Filtered noise burst, for whooshes and thuds. */
  private noise(dur: number, f0: number, f1: number, vol = 0.25, q = 1, delay = 0): void {
    const c = this.ctx; if (!c || !this.master || !this.noiseBuf || this.muted) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  swing(stage = 0): void { this.noise(0.14, stage === 2 ? 600 : 1400, stage === 2 ? 2400 : 400, 0.2, 0.8); }
  hit(crit = false): void {
    this.noise(0.08, 300, 80, 0.35, 0.6);
    this.tone('square', crit ? 520 : 240, crit ? 130 : 60, crit ? 0.14 : 0.08, 0.25);
    if (crit) this.tone('triangle', 900, 1400, 0.12, 0.2, 0.03);
  }
  hurt(): void { this.tone('sawtooth', 180, 70, 0.16, 0.25); this.noise(0.1, 200, 60, 0.2); }
  kill(): void { this.tone('square', 700, 90, 0.22, 0.25); this.noise(0.18, 900, 150, 0.25, 0.5, 0.04); }
  poof(): void { this.noise(0.25, 700, 120, 0.25, 0.4); }
  streak(n: number): void { for (let i = 0; i < Math.min(n, 4); i++) this.tone('triangle', 520 + i * 160, 700 + i * 160, 0.1, 0.18, i * 0.06); }
  bolt(): void { this.tone('sawtooth', 1200, 300, 0.18, 0.15); }
  grunt(): void { this.tone('sawtooth', 120, 90, 0.12, 0.12); }
  whiff(): void { this.noise(0.1, 800, 300, 0.1, 0.8); }
  horn(): void { this.tone('sawtooth', 110, 165, 0.5, 0.2); this.tone('sawtooth', 165, 220, 0.5, 0.15, 0.25); }
  chop(): void { this.noise(0.06, 500, 150, 0.3, 0.7); this.tone('square', 200, 120, 0.06, 0.15); }
  dig(): void { this.noise(0.12, 300, 90, 0.2, 0.6); }
  /** a giant's footstep; `vol` fades with distance */
  thud(vol = 1): void { this.tone('sine', 70, 40, 0.18, 0.35 * vol); this.noise(0.08, 160, 60, 0.15 * vol, 0.8); }
}
