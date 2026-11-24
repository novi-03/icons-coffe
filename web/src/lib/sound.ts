/** Small synthesized alert tones (no audio files). Browsers require a user gesture before audio can play. */
let ctx: AudioContext | null = null;

export function unlockAudio() {
  try {
    ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  } catch {
    return false;
  }
}
export const audioReady = () => !!ctx && ctx.state === 'running';

function tone(freq: number, start: number, dur: number, volume: number, type: OscillatorType = 'sine') {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), ctx.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.05);
}

export type Chime = 'new-order' | 'ready' | 'request' | 'alert';
export function playChime(kind: Chime, volume = 0.6) {
  if (!ctx || ctx.state !== 'running' || volume <= 0) return;
  const v = Math.min(1, volume) * 0.35;
  if (kind === 'new-order') { tone(880, 0, 0.18, v); tone(1175, 0.2, 0.18, v); tone(1568, 0.4, 0.3, v); }
  else if (kind === 'ready') { tone(659, 0, 0.2, v, 'triangle'); tone(988, 0.22, 0.2, v, 'triangle'); tone(1319, 0.44, 0.45, v, 'triangle'); tone(1319, 0.95, 0.45, v, 'triangle'); }
  else if (kind === 'request') { tone(740, 0, 0.18, v); tone(554, 0.2, 0.25, v); }
  else { tone(440, 0, 0.25, v, 'square'); tone(440, 0.35, 0.25, v, 'square'); }
}

export function vibrate(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}
