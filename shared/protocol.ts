// Contrat partagé entre le serveur et le client : vues de table, réglages, constantes et règles des cartes.

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

/** La grille de chacun : 3 rangées de 4 cartes. Une case se lit rangée par rangée : index = rangée × 4 + colonne. */
export const ROWS = 3;
export const COLS = 4;
export const GRID = ROWS * COLS;
/** Cartes à retourner au début de chaque manche. */
export const SETUP_FLIPS = 2;

/** Les 150 cartes : cinq -2, dix -1, quinze 0, et dix de chaque valeur de 1 à 12. */
export const COPIES: Record<number, number> = { [-2]: 5, [-1]: 10, 0: 15, 1: 10, 2: 10, 3: 10, 4: 10, 5: 10, 6: 10, 7: 10, 8: 10, 9: 10, 10: 10, 11: 10, 12: 10 };
export const VALUES = Object.keys(COPIES)
  .map(Number)
  .sort((a, b) => a - b);
export const DECK_SIZE = VALUES.reduce((n, v) => n + COPIES[v], 0);

/** La famille de couleur d'une carte, comme sur le vrai jeu : on lit sa grille d'un coup d'œil. */
export type Tone = 'deep' | 'neg' | 'zero' | 'low' | 'mid' | 'high';
export function toneOf(value: number): Tone {
  if (value <= -2) return 'deep';
  if (value < 0) return 'neg';
  if (value === 0) return 'zero';
  if (value <= 4) return 'low';
  if (value <= 8) return 'mid';
  return 'high';
}

export function colOf(index: number): number {
  return index % COLS;
}
export function rowOf(index: number): number {
  return Math.floor(index / COLS);
}
/** Les trois cases d'une colonne, de haut en bas. */
export function columnCells(col: number): number[] {
  return Array.from({ length: ROWS }, (_, r) => r * COLS + col);
}

export const AVATARS = ['soleil', 'nuage', 'arcenciel', 'montgolfiere', 'cerfvolant', 'avion', 'oiseau', 'papillon', 'lune', 'etoile', 'perroquet', 'ovni'] as const;
export const EMOTES = ['😎', '😱', '😅', '👏', '🤞', '🔥'] as const;
export const TAUNTS = ['Bien joué !', 'Aïe…', 'Merci pour la carte !', 'Tremblez !', 'Dernier tour ?', 'Je le sens bien'] as const;

/** La partie s'arrête dès qu'un joueur atteint ce total à la fin d'une manche. */
export const LIMIT_OPTIONS = [50, 100] as const;
export type Limit = (typeof LIMIT_OPTIONS)[number];
export const THINK_OPTIONS = [0, 30, 60] as const;
export type ThinkTime = (typeof THINK_OPTIONS)[number];

export interface Settings {
  limit: Limit;
  /** Temps de réflexion par tour, en secondes (0 : sans limite). */
  think: ThinkTime;
}

/**
 * Une case de grille telle que tout le monde la voit : la valeur si la carte est retournée,
 * 'hidden' si elle est face cachée (personne ne la connaît, pas même son propriétaire),
 * null si la colonne a été retirée.
 */
export type Cell = number | 'hidden' | null;

export type PlayerStatus = 'lobby' | 'playing' | 'spectator';

export interface PlayerView {
  id: string;
  name: string;
  avatar: string;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
  autopilot: boolean;
  status: PlayerStatus;
  /** La grille (null hors partie). */
  grid: Cell[] | null;
  /** Cartes qu'il lui reste à retourner en début de manche. */
  setupLeft: number;
  /** Total des manches déjà jouées. */
  total: number;
  /** Prêt pour la manche suivante (entre deux manches). */
  ready: boolean;
}

export type EventKind = 'start' | 'draw' | 'swap' | 'flip' | 'column' | 'last' | 'reshuffle';

/** Ce qui vient de se passer. Le serveur ne garde ces événements que quelques secondes : ce n'est pas un historique. */
export interface GameEvent {
  id: number;
  at: number;
  until: number;
  kind: EventKind;
  by: string;
  /** La case concernée. */
  index?: number;
  /** La carte posée, piochée ou retournée. */
  value?: number;
  /** Échange : la carte qui quitte la grille (révélée si elle était cachée), et d'où vient la nouvelle. */
  old?: number;
  wasHidden?: boolean;
  source?: 'deck' | 'discard';
  /** Retourner : la carte piochée qu'on a défaussée d'abord. */
  discarded?: number;
  /** Colonne retirée. */
  col?: number;
  /** Retourné pendant la mise en place. */
  setup?: boolean;
}

export interface RoundLine {
  id: string;
  /** Points de la manche, après doublement éventuel. */
  score: number;
  /** Points avant doublement. */
  raw: number;
  doubled: boolean;
  ended: boolean;
  total: number;
}

export interface RoundResult {
  round: number;
  enderId: string;
  lines: RoundLine[];
  /** La partie est finie : quelqu'un a atteint la limite. */
  gameOver: boolean;
  /** Fin de la pause entre deux manches : on repart sans attendre les retardataires. */
  nextAt: number;
}

export type Stage = 'setup' | 'play' | 'scores';

export interface GameView {
  round: number;
  stage: Stage;
  order: string[];
  /** À qui de jouer (null pendant la mise en place et entre deux manches). */
  turnId: string | null;
  turnEndsAt: number;
  /** Numéro de l'action : une action envoyée pour un tour déjà passé est refusée. */
  seq: number;
  deck: number;
  discardTop: number | null;
  /** La carte que le joueur vient de piocher, visible de tous jusqu'à ce qu'il la pose ou la défausse. */
  drawn: number | null;
  /** Celui qui a retourné toutes ses cartes : chacun des autres joue une dernière fois. */
  enderId: string | null;
  /** Ceux qui doivent encore jouer leur dernier tour. */
  lastTurns: string[];
  events: GameEvent[];
  result: RoundResult | null;
  /** La feuille de marque : les points de chacun, manche après manche, comme sur papier. */
  sheet: { round: number; scores: Record<string, number>; doubled: string[] }[];
}

export interface FinalEntry {
  id: string;
  name: string;
  avatar: string;
  total: number;
  rank: number;
  rounds: number[];
  /** Meilleure manche, pour la petite ligne sous le nom. */
  best: number;
  doubled: number;
}

export interface FinalView {
  limit: Limit;
  rounds: number;
  players: FinalEntry[];
}

export interface RoomView {
  code: string;
  phase: 'lobby' | 'playing' | 'finished';
  me: string;
  hostId: string;
  settings: Settings;
  players: PlayerView[];
  game: GameView | null;
  final: FinalView | null;
  serverNow: number;
}

export type Ack<T = unknown> = (res: { ok: boolean; error?: string; data?: T }) => void;

/** Une case reçue du réseau : un entier entre 0 et 11. */
export function parseIndex(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < GRID ? raw : null;
}
