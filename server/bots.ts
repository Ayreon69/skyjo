// Cerveau des bots (et du pilote automatique) : ils ne voient que ce que voit un joueur à la table.
// Une carte cachée vaut, pour eux, la moyenne des cartes qu'on n'a pas encore vues.
import { COPIES, GRID, VALUES, colOf, columnCells, type Cell } from '../shared/protocol';
import type { Game } from './game';

export type BotMove = { type: 'draw' } | { type: 'take'; index: number } | { type: 'swap'; index: number } | { type: 'flip'; index: number };

export interface BotView {
  grid: Cell[];
  others: Cell[][];
  discardTop: number | null;
  drawn: number | null;
  /** Quelqu'un a déjà tout retourné : c'est mon dernier tour. */
  lastChance: boolean;
  /** Valeur moyenne d'une carte encore jamais vue. */
  unknown: number;
}

function publicGrid(g: Game, id: string): Cell[] {
  return g.grid(id).map((c) => (c === null ? null : c.up ? c.value : 'hidden'));
}

export function botView(g: Game, me: string): BotView {
  // On décompte les cartes visibles de toutes les grilles, la défausse et la carte piochée.
  const left = { ...COPIES };
  for (const id of g.order) for (const c of g.grid(id)) if (c?.up) left[c.value]--;
  if (g.discardTop !== null) left[g.discardTop]--;
  if (g.drawn !== null) left[g.drawn]--;
  let n = 0;
  let sum = 0;
  for (const v of VALUES) {
    const k = Math.max(0, left[v]);
    n += k;
    sum += k * v;
  }
  return {
    grid: publicGrid(g, me),
    others: g.order.filter((id) => id !== me).map((id) => publicGrid(g, id)),
    discardTop: g.discardTop,
    drawn: g.drawn,
    lastChance: g.enderId !== null && g.enderId !== me,
    unknown: n ? sum / n : 5,
  };
}

/** Mise en place : deux cartes au hasard, dans deux colonnes différentes. */
export function setupPick(grid: Cell[]): number {
  const hidden = grid.map((c, i) => (c === 'hidden' ? i : -1)).filter((i) => i >= 0);
  const upCols = new Set(grid.map((c, i) => (typeof c === 'number' ? colOf(i) : -1)));
  const fresh = hidden.filter((i) => !upCols.has(colOf(i)));
  const pool = fresh.length ? fresh : hidden;
  return pool[Math.floor(Math.random() * pool.length)];
}

const est = (c: Cell, unknown: number): number => (c === 'hidden' ? unknown : typeof c === 'number' ? c : 0);

/** Ce que rapporte une carte posée à cette place : les points économisés, colonne comprise. */
export function gain(v: BotView, card: number, index: number): number {
  const cell = v.grid[index];
  if (cell === null) return -Infinity;
  const current = est(cell, v.unknown);
  let g = current - card;
  const others = columnCells(colOf(index))
    .filter((i) => i !== index)
    .map((i) => v.grid[i]);
  if (others.every((c) => c === card)) {
    // La colonne entière disparaît : on économise aussi les deux autres cartes (perte si elles étaient négatives).
    return current + 2 * card;
  }
  if (others.some((c) => c === card) && others.every((c) => c !== null)) g += Math.max(0, card) * 0.35;
  // Casser une paire qui promettait une colonne coûte un peu.
  if (typeof cell === 'number' && cell > 0 && others.some((c) => c === cell)) g -= cell * 0.35;
  return g;
}

/** Le coup retournerait-il la dernière carte cachée ? (Posée ou retournée, la case devient visible.) */
function endsRound(v: BotView, index: number): boolean {
  if (v.lastChance) return false;
  return v.grid.every((c, i) => i === index || c !== 'hidden');
}

/** Finir la manche n'est sûr que si on a nettement le plus petit score. */
function safeToEnd(v: BotView, index: number, card: number | null): boolean {
  const grid = [...v.grid];
  // La carte retournée vaut la moyenne : on ne la connaît pas encore.
  grid[index] = card === null ? v.unknown : card;
  let mine = 0;
  for (let col = 0; col < GRID / 3; col++) {
    const cells = columnCells(col).map((i) => grid[i]);
    if (cells.every((c) => typeof c === 'number' && c === cells[0])) continue;
    for (const c of cells) mine += est(c, v.unknown);
  }
  // Retournée au hasard, la carte peut être forte : on garde une marge.
  if (card === null) mine += 3;
  if (mine <= 0) return true;
  // Chaque adversaire doit être nettement au-dessus : il jouera encore un tour pour baisser son score,
  // et ses cartes cachées peuvent être meilleures que prévu.
  return v.others.every((g) => {
    const hidden = g.filter((c) => c === 'hidden').length;
    const score = g.reduce<number>((n, c) => n + est(c, v.unknown), 0);
    return mine < score - 5 - 2.5 * Math.sqrt(hidden);
  });
}

function bestPlacement(v: BotView, card: number): { index: number; gain: number } {
  let best = { index: -1, gain: -Infinity };
  for (let i = 0; i < GRID; i++) {
    if (v.grid[i] === null) continue;
    let g = gain(v, card, i);
    if (endsRound(v, i) && !safeToEnd(v, i, card)) g -= 100;
    if (g > best.gain) best = { index: i, gain: g };
  }
  return best;
}

export function botMove(v: BotView): BotMove {
  const hidden = v.grid.map((c, i) => (c === 'hidden' ? i : -1)).filter((i) => i >= 0);
  if (v.drawn === null) {
    if (v.discardTop !== null) {
      const take = bestPlacement(v, v.discardTop);
      // Une bonne carte sur la défausse se prend sans hésiter ; une moyenne se laisse.
      if (take.index >= 0 && take.gain >= (v.lastChance ? 0.5 : 2.5)) return { type: 'take', index: take.index };
    }
    return { type: 'draw' };
  }
  const swap = bestPlacement(v, v.drawn);
  // Retourner une carte ne rapporte rien en moyenne, mais fait avancer la manche.
  let flip = { index: -1, gain: -Infinity };
  for (const i of hidden) {
    let g = v.lastChance ? 0 : hidden.length > 2 ? 0.6 : 0.2;
    if (endsRound(v, i) && !safeToEnd(v, i, null)) g -= 100;
    // Plutôt dans une colonne où rien ne se prépare.
    const others = columnCells(colOf(i)).filter((j) => j !== i).map((j) => v.grid[j]);
    if (typeof others[0] === 'number' && others[0] === others[1]) g += 0.4;
    g += Math.random() * 0.05;
    if (g > flip.gain) flip = { index: i, gain: g };
  }
  if (flip.index >= 0 && flip.gain >= swap.gain) return { type: 'flip', index: flip.index };
  return { type: 'swap', index: swap.index >= 0 ? swap.index : v.grid.findIndex((c) => c !== null) };
}
