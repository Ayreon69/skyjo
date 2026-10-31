// Le moteur d'une partie de Skyjo : manches, mise en place, tours, colonnes, fin de manche, points et feuille de marque.
import crypto from 'node:crypto';
import { COPIES, GRID, ROWS, SETUP_FLIPS, VALUES, columnCells, parseIndex, type GameEvent, type RoundLine, type RoundResult, type Stage } from '../shared/protocol';

export interface Slot {
  value: number;
  up: boolean;
}
export type GCell = Slot | null;

export interface GameOptions {
  limit: number;
  /** Durée d'affichage d'un événement. */
  eventMs?: number;
  /** Mélange des cartes (remplaçable dans les tests pour fixer la donne). */
  shuffle?: (cards: number[]) => number[];
}

export interface PlayerStats {
  columns: number;
  doubled: number;
  ended: number;
}

export function freshDeck(): number[] {
  const cards: number[] = [];
  for (const v of VALUES) for (let i = 0; i < COPIES[v]; i++) cards.push(v);
  return cards;
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class Game {
  readonly order: string[];
  readonly limit: number;
  round = 0;
  stage: Stage = 'setup';
  grids = new Map<string, GCell[]>();
  /** La pioche : la carte du dessus est la dernière. */
  deck: number[] = [];
  /** La défausse : seule la carte du dessus (la dernière) se voit. */
  discard: number[] = [];
  setupLeft = new Map<string, number>();
  /** Index du joueur dont c'est le tour dans `order`, -1 hors des tours. */
  turn = -1;
  seq = 0;
  drawn: number | null = null;
  enderId: string | null = null;
  lastTurns: string[] = [];
  totals = new Map<string, number>();
  sheet: { round: number; scores: Record<string, number>; doubled: string[] }[] = [];
  result: RoundResult | null = null;
  stats = new Map<string, PlayerStats>();
  events: GameEvent[] = [];
  /** Celui qui a fini la manche précédente commence la suivante. */
  private starterNext: string | null = null;
  private eventId = 0;
  private readonly eventMs: number;
  private readonly mix: (cards: number[]) => number[];

  constructor(order: string[], opts: GameOptions) {
    this.order = [...order];
    this.limit = opts.limit;
    this.eventMs = opts.eventMs ?? 3500;
    this.mix = opts.shuffle ?? shuffle;
    for (const id of order) {
      this.totals.set(id, 0);
      this.stats.set(id, { columns: 0, doubled: 0, ended: 0 });
    }
    this.startRound();
  }

  get current(): string | null {
    return this.stage === 'play' && this.turn >= 0 ? this.order[this.turn] : null;
  }

  grid(id: string): GCell[] {
    return this.grids.get(id) ?? [];
  }

  get discardTop(): number | null {
    return this.discard.length ? this.discard[this.discard.length - 1] : null;
  }

  private emit(e: Omit<GameEvent, 'id' | 'at' | 'until'>): void {
    const now = Date.now();
    this.events = this.events.filter((x) => x.until > now);
    this.events.push({ ...e, id: ++this.eventId, at: now, until: now + this.eventMs });
    // Quelques secondes de mémoire, jamais un historique.
    if (this.events.length > 4) this.events = this.events.slice(-4);
  }

  // ───────────────────────────── Manche ─────────────────────────────

  startRound(): void {
    this.round++;
    this.deck = this.mix(freshDeck());
    this.grids.clear();
    for (const id of this.order) this.grids.set(id, []);
    // On distribue une carte à la fois, comme à la table.
    for (let i = 0; i < GRID; i++) for (const id of this.order) this.grids.get(id)!.push({ value: this.deck.pop()!, up: false });
    this.discard = [this.deck.pop()!];
    this.setupLeft = new Map(this.order.map((id) => [id, SETUP_FLIPS]));
    this.stage = 'setup';
    this.turn = -1;
    this.drawn = null;
    this.enderId = null;
    this.lastTurns = [];
    this.result = null;
    this.events = [];
    this.seq++;
  }

  setupFlip(id: string, raw: unknown): string | undefined {
    if (this.stage !== 'setup') return 'La mise en place est terminée.';
    const grid = this.grids.get(id);
    if (!grid) return 'Tu ne joues pas cette manche.';
    const left = this.setupLeft.get(id) ?? 0;
    if (left <= 0) return 'Tu as déjà retourné tes deux cartes.';
    const i = parseIndex(raw);
    const cell = i === null ? null : grid[i];
    if (i === null || !cell || cell.up) return 'Choisis une carte face cachée.';
    cell.up = true;
    this.setupLeft.set(id, left - 1);
    this.emit({ kind: 'flip', by: id, index: i, value: cell.value, setup: true });
    if ([...this.setupLeft.values()].every((n) => n <= 0)) this.beginPlay();
    return undefined;
  }

  /** Qui commence : celui qui a fini la manche précédente ; à la première, le plus gros total de cartes retournées. */
  starter(): string {
    if (this.starterNext && this.order.includes(this.starterNext)) return this.starterNext;
    let best = this.order[0];
    let bestKey: [number, number] = [-Infinity, -Infinity];
    for (const id of this.order) {
      const up = this.grid(id).filter((c): c is Slot => !!c && c.up).map((c) => c.value);
      const key: [number, number] = [up.reduce((a, b) => a + b, 0), Math.max(...up, -Infinity)];
      // Égalité parfaite : le premier assis (l'ordre a été tiré au sort).
      if (key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
        best = id;
        bestKey = key;
      }
    }
    return best;
  }

  private beginPlay(): void {
    const first = this.starter();
    this.turn = this.order.indexOf(first);
    this.stage = 'play';
    this.seq++;
    this.emit({ kind: 'start', by: first });
  }

  // ───────────────────────────── Tour ─────────────────────────────

  private check(id: string): string | undefined {
    if (this.stage !== 'play') return this.stage === 'setup' ? 'Retourne d’abord tes deux cartes.' : 'La manche est terminée.';
    if (this.current !== id) return "Ce n'est pas ton tour.";
    return undefined;
  }

  /** Pioche vide : on remélange la défausse, sauf sa carte du dessus. */
  private ensureDeck(): void {
    if (this.deck.length || this.discard.length < 2) return;
    const top = this.discard.pop()!;
    this.deck = this.mix(this.discard);
    this.discard = [top];
    this.emit({ kind: 'reshuffle', by: this.current ?? '' });
  }

  draw(id: string): string | undefined {
    const err = this.check(id);
    if (err) return err;
    if (this.drawn !== null) return 'Tu as déjà pioché : pose ou défausse ta carte.';
    this.ensureDeck();
    if (!this.deck.length) return 'La pioche est vide : prends la carte de la défausse.';
    this.drawn = this.deck.pop()!;
    this.seq++;
    this.emit({ kind: 'draw', by: id, value: this.drawn });
    return undefined;
  }

  /** Prendre la carte de la défausse et l'échanger aussitôt avec une carte de sa grille. */
  takeDiscard(id: string, raw: unknown): string | undefined {
    const err = this.check(id);
    if (err) return err;
    if (this.drawn !== null) return 'Tu as pioché : pose ou défausse cette carte.';
    if (!this.discard.length) return 'La défausse est vide.';
    const i = parseIndex(raw);
    if (i === null || !this.grid(id)[i]) return 'Choisis une carte de ta grille.';
    this.exchange(id, i, this.discard.pop()!, 'discard');
    return undefined;
  }

  /** Garder la carte piochée à la place d'une carte de sa grille. */
  swapDrawn(id: string, raw: unknown): string | undefined {
    const err = this.check(id);
    if (err) return err;
    if (this.drawn === null) return "Pioche d'abord une carte.";
    const i = parseIndex(raw);
    if (i === null || !this.grid(id)[i]) return 'Choisis une carte de ta grille.';
    const card = this.drawn;
    this.drawn = null;
    this.exchange(id, i, card, 'deck');
    return undefined;
  }

  /** Défausser la carte piochée, puis retourner une de ses cartes cachées. */
  discardFlip(id: string, raw: unknown): string | undefined {
    const err = this.check(id);
    if (err) return err;
    if (this.drawn === null) return "Pioche d'abord une carte.";
    const i = parseIndex(raw);
    const cell = i === null ? null : this.grid(id)[i];
    if (i === null || !cell || cell.up) return 'Choisis une de tes cartes face cachée.';
    const card = this.drawn;
    this.drawn = null;
    this.discard.push(card);
    cell.up = true;
    this.emit({ kind: 'flip', by: id, index: i, value: cell.value, discarded: card });
    this.afterMove(id);
    return undefined;
  }

  private exchange(id: string, i: number, card: number, source: 'deck' | 'discard'): void {
    const grid = this.grid(id);
    const old = grid[i]!;
    grid[i] = { value: card, up: true };
    // La carte remplacée part sur la défausse, face visible, même si elle était cachée.
    this.discard.push(old.value);
    this.emit({ kind: 'swap', by: id, index: i, value: card, old: old.value, wasHidden: !old.up, source });
    this.afterMove(id);
  }

  /** Trois cartes identiques et visibles dans une colonne : elle quitte la grille et part sur la défausse. */
  private clearColumns(id: string): number {
    const grid = this.grid(id);
    let cleared = 0;
    for (let col = 0; col < grid.length / ROWS; col++) {
      const cells = columnCells(col);
      const slots = cells.map((i) => grid[i]);
      if (!slots.every((s): s is Slot => !!s && s.up)) continue;
      const value = slots[0]!.value;
      if (!slots.every((s) => s!.value === value)) continue;
      for (const i of cells) {
        this.discard.push(value);
        grid[i] = null;
      }
      cleared++;
      this.stats.get(id)!.columns++;
      this.emit({ kind: 'column', by: id, col, value });
    }
    return cleared;
  }

  allUp(id: string): boolean {
    return this.grid(id).every((c) => c === null || c.up);
  }

  private afterMove(id: string): void {
    this.clearColumns(id);
    if (this.enderId) this.lastTurns = this.lastTurns.filter((x) => x !== id);
    else if (this.allUp(id)) {
      this.enderId = id;
      this.lastTurns = this.order.filter((x) => x !== id);
      this.emit({ kind: 'last', by: id });
    }
    if (this.enderId && !this.lastTurns.length) {
      this.endRound();
      return;
    }
    this.turn = (this.turn + 1) % this.order.length;
    this.seq++;
  }

  // ───────────────────────────── Fin de manche ─────────────────────────────

  /** Points visibles d'une grille (toutes ses cartes doivent être retournées). */
  points(id: string): number {
    return this.grid(id).reduce((n, c) => n + (c ? c.value : 0), 0);
  }

  private endRound(): void {
    const ender = this.enderId!;
    // Toutes les cartes se retournent ; une colonne de trois identiques ainsi révélée part aussi.
    for (const id of this.order) {
      for (const c of this.grid(id)) if (c) c.up = true;
      this.clearColumns(id);
    }
    const raw = new Map(this.order.map((id) => [id, this.points(id)]));
    const mine = raw.get(ender)!;
    // Celui qui a fini doit avoir strictement le plus petit score, sinon ses points (s'ils sont positifs) doublent.
    const doubled = mine > 0 && this.order.some((id) => id !== ender && raw.get(id)! <= mine);
    const lines: RoundLine[] = this.order.map((id) => {
      const r = raw.get(id)!;
      const isDoubled = id === ender && doubled;
      const score = isDoubled ? r * 2 : r;
      const total = this.totals.get(id)! + score;
      this.totals.set(id, total);
      return { id, score, raw: r, doubled: isDoubled, ended: id === ender, total };
    });
    const st = this.stats.get(ender)!;
    st.ended++;
    if (doubled) st.doubled++;
    this.sheet.push({ round: this.round, scores: Object.fromEntries(lines.map((l) => [l.id, l.score])), doubled: doubled ? [ender] : [] });
    this.result = { round: this.round, enderId: ender, lines, gameOver: lines.some((l) => l.total >= this.limit), nextAt: 0 };
    this.starterNext = ender;
    this.stage = 'scores';
    this.turn = -1;
    this.drawn = null;
    this.lastTurns = [];
    this.seq++;
  }

  nextRound(): boolean {
    if (this.stage !== 'scores' || !this.result || this.result.gameOver) return false;
    this.startRound();
    return true;
  }

  /** Le classement : le plus petit total gagne ; les ex æquo partagent leur place. */
  ranking(): { id: string; total: number; rank: number }[] {
    const sorted = this.order.map((id) => ({ id, total: this.totals.get(id)! })).sort((a, b) => a.total - b.total);
    return sorted.map((x) => ({ ...x, rank: sorted.findIndex((y) => y.total === x.total) + 1 }));
  }
}
