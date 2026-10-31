// Sons synthétisés (Web Audio), aucun fichier à charger : cartes qui claquent, pioche, colonne, cloche du tour et fanfares.
import { useStore } from '../store';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!useStore.getState().prefs.sound) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number; slide?: number; attack?: number } = {}): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + (opts.delay ?? 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * opts.slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.1, t0 + (opts.attack ?? 0.008));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(dur: number, opts: { gain?: number; delay?: number; freq?: number; type?: BiquadFilterType; q?: number; fade?: number; sweep?: number } = {}): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + (opts.delay ?? 0);
  const buffer = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const data = buffer.getChannelData(0);
  const fade = opts.fade ?? 2;
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** fade;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = opts.type ?? 'bandpass';
  filter.frequency.setValueAtTime(opts.freq ?? 2400, t0);
  if (opts.sweep) filter.frequency.exponentialRampToValueAtTime(opts.sweep, t0 + dur);
  if (opts.q) filter.Q.value = opts.q;
  const g = a.createGain();
  g.gain.value = opts.gain ?? 0.25;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t0);
}

/** Do majeur, pour les petites fanfares. */
const C = [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5, 1174.66, 1318.51];

export const sfx = {
  /** Une carte qu'on retourne : un claquement sec. */
  flip: () => {
    noise(0.05, { gain: 0.32, freq: 3200, q: 0.8, fade: 3 });
    tone(420, 0.06, { type: 'triangle', gain: 0.05, slide: 1.6 });
  },
  /** La pioche : la carte glisse du paquet. */
  draw: () => noise(0.22, { gain: 0.18, freq: 900, sweep: 4200, q: 1.2, fade: 1 }),
  /** Une carte posée sur la table. */
  place: () => {
    noise(0.07, { gain: 0.3, freq: 600, type: 'lowpass', fade: 3 });
    tone(180, 0.09, { gain: 0.08, slide: 0.6 });
  },
  /** Colonne retirée : un petit arpège qui monte. */
  column: () => {
    [0, 2, 4, 7].forEach((n, i) => tone(C[n], 0.35, { type: 'triangle', gain: 0.07, delay: i * 0.07 }));
    noise(0.3, { gain: 0.05, freq: 6000, delay: 0.25, fade: 1 });
  },
  /** À toi : deux notes claires. */
  turn: () => {
    tone(C[4], 0.5, { gain: 0.06 });
    tone(C[7], 0.7, { gain: 0.05, delay: 0.11 });
  },
  /** Quelqu'un a tout retourné : l'alerte du dernier tour. */
  last: () => {
    [7, 4, 7, 4].forEach((n, i) => tone(C[n], 0.16, { type: 'square', gain: 0.025, delay: i * 0.15 }));
  },
  /** Le grand retournement de fin de manche : un roulement de tambour. */
  reveal: () => {
    for (let i = 0; i < 14; i++) noise(0.05, { gain: 0.12 + i * 0.012, freq: 180, type: 'lowpass', delay: i * 0.055, fade: 3 });
    tone(C[7], 0.6, { type: 'triangle', gain: 0.06, delay: 0.8 });
  },
  /** Points doublés : le trombone triste. */
  doubled: () => {
    [392, 370, 349.23, 311.13].forEach((f, i) => tone(f / 2, i === 3 ? 0.9 : 0.32, { type: 'sawtooth', gain: 0.035, delay: i * 0.3, slide: i === 3 ? 0.9 : 1 }));
  },
  /** Fin de partie : la fanfare du vainqueur, plus modeste pour les autres. */
  fanfare: (won: boolean) => {
    const notes = won ? [0, 2, 4, 7, 4, 7, 9] : [4, 2, 0, 2, 4];
    notes.forEach((n, i) => tone(C[n], i === notes.length - 1 ? 0.9 : 0.22, { type: 'triangle', gain: 0.07, delay: i * 0.13 }));
  },
  tap: () => tone(880, 0.05, { gain: 0.025, slide: 1.4 }),
  /** Début de manche : on bat les cartes. */
  shuffle: () => {
    for (let i = 0; i < 8; i++) noise(0.04, { gain: 0.12, freq: 2600 + Math.random() * 1500, delay: i * 0.045, fade: 2 });
  },
};
