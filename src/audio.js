// Minimal WebAudio synth SFX. Created lazily after a user gesture.
export class Sfx {
  constructor() {
    this.ctx = null;
  }
  ensure() {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      } catch (e) { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }
  _blip(freq, dur, type, vol, when = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  shot() { this._blip(160, 0.09, 'square', 0.18); this._blip(90, 0.14, 'sawtooth', 0.12); }
  awp() { this._blip(70, 0.25, 'sawtooth', 0.28); }
  hit() { this._blip(880, 0.05, 'square', 0.12); }
  hurt() { this._blip(220, 0.12, 'triangle', 0.2); }
  death() { this._blip(140, 0.3, 'triangle', 0.22); }
  buy() { this._blip(660, 0.07, 'square', 0.15); this._blip(990, 0.07, 'square', 0.12, 0.08); }
  roundWin() { [523, 659, 784].forEach((f, i) => this._blip(f, 0.16, 'square', 0.16, i * 0.12)); }
  roundLose() { [392, 330, 262].forEach((f, i) => this._blip(f, 0.2, 'triangle', 0.18, i * 0.15)); }
}
