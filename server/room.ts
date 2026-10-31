// Une table de Skyjo : salon, partie, minuteries, bots, pilote automatique et vue de chacun.
import crypto from 'node:crypto';
import {
  AVATARS,
  LIMIT_OPTIONS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  THINK_OPTIONS,
  type Cell,
  type FinalView,
  type GameView,
  type Limit,
  type PlayerStatus,
  type RoomView,
  type Settings,
  type ThinkTime,
} from '../shared/protocol';
import { botMove, botView, setupPick } from './bots';
import { Game, shuffle } from './game';

const BOT_NAMES = ['Zéphyr', 'Nimbus', 'Brise', 'Alizé', 'Mistral', 'Cumulus', 'Aurore', 'Sirocco', 'Stratus', 'Comète'];
const MAX_MEMBERS = 14;
/** Délai laissé à un joueur déconnecté avant que le pilote automatique ne prenne le relais. */
const GRACE_MS = 20_000;
/** Mode accéléré pour les tests locaux (SK_FAST=1) : bots et chronos quasi instantanés. */
const FAST = process.env.SK_FAST === '1';
const EVENT_MS = FAST ? 300 : 3_200;
/** Entre deux manches : le temps de voir les grilles se retourner, puis on repart sans attendre éternellement. */
const SCORES_MIN_MS = FAST ? 60 : 2_500;
const SCORES_MAX_MS = FAST ? 1_500 : 60_000;
/** Le temps de voir la dernière manche avant le podium, quand il n'y a plus que des bots. */
const FINISH_BOTS_MS = FAST ? 100 : 4_000;

export interface Player {
  id: string;
  token: string;
  name: string;
  avatar: string;
  isBot: boolean;
  sockets: Set<string>;
  connected: boolean;
  disconnectedAt: number;
  left: boolean;
  status: PlayerStatus;
}

function uid(): string {
  return crypto.randomBytes(9).toString('base64url');
}

export class Room {
  readonly code: string;
  hostId = '';
  phase: 'lobby' | 'playing' | 'finished' = 'lobby';
  settings: Settings = { limit: 100, think: 0 };
  players: Player[] = [];
  game: Game | null = null;
  final: FinalView | null = null;
  turnEndsAt = 0;
  turnStartedAt = 0;
  botActAt = 0;
  /** Mise en place : quand chaque bot (ou absent) retourne sa prochaine carte. */
  setupDue = new Map<string, number>();
  setupStartedAt = 0;
  scoresAt = 0;
  ready = new Set<string>();
  lastActive = Date.now();
  onChange: () => void = () => {};
  onEmote: (playerId: string, text: string) => void = () => {};

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string) {
    this.code = code;
  }

  // ───────────────────────────── Membres ─────────────────────────────

  get(id: string | undefined): Player | undefined {
    return id ? this.players.find((p) => p.id === id) : undefined;
  }

  findByToken(playerId: unknown, token: unknown): Player | undefined {
    if (typeof playerId !== 'string' || typeof token !== 'string') return undefined;
    const p = this.get(playerId);
    return p && !p.isBot && p.token === token ? p : undefined;
  }

  get seated(): Player[] {
    return this.players.filter((p) => p.status !== 'spectator');
  }

  get humansOnline(): number {
    return this.players.filter((p) => !p.isBot && p.connected).length;
  }

  touch(): void {
    this.lastActive = Date.now();
  }

  private uniqueName(name: string): string {
    const taken = new Set(this.players.map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 99; i++) {
      const candidate = `${name.slice(0, 13)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return name;
  }

  private makePlayer(name: string, avatar: string, isBot: boolean, status: PlayerStatus): Player {
    return {
      id: uid(),
      token: uid() + uid(),
      name: this.uniqueName(name),
      avatar,
      isBot,
      sockets: new Set(),
      connected: isBot,
      disconnectedAt: Date.now(),
      left: false,
      status,
    };
  }

  addHuman(name: string, avatar: string): Player | string {
    if (this.players.length >= MAX_MEMBERS) return 'Cette table est pleine.';
    if (this.phase === 'lobby' && this.seated.length >= MAX_PLAYERS) return `La table est complète (${MAX_PLAYERS} joueurs maximum).`;
    const p = this.makePlayer(name, avatar, false, this.phase === 'lobby' ? 'lobby' : 'spectator');
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    return p;
  }

  addBot(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut ajouter des bots.";
    if (this.phase !== 'lobby') return 'On ajoute des bots dans le salon.';
    if (this.seated.length >= MAX_PLAYERS) return `La table est complète (${MAX_PLAYERS} joueurs maximum).`;
    const used = new Set(this.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.players.length + 1}`;
    const usedAvatars = new Set(this.players.map((p) => p.avatar));
    const free = AVATARS.filter((a) => !usedAvatars.has(a));
    const pool = free.length ? free : AVATARS;
    this.players.push(this.makePlayer(name, pool[crypto.randomInt(pool.length)], true, 'lobby'));
    return undefined;
  }

  kick(by: string, target: string): { sockets: string[] } | string {
    if (by !== this.hostId) return "Seul l'hôte peut retirer un joueur.";
    if (this.phase !== 'lobby') return 'On ne peut retirer un joueur que dans le salon.';
    const p = this.get(target);
    if (!p || p.id === by) return 'Joueur introuvable.';
    this.players = this.players.filter((x) => x.id !== p.id);
    return { sockets: [...p.sockets] };
  }

  leave(id: string): void {
    const p = this.get(id);
    if (!p) return;
    p.sockets.clear();
    p.connected = false;
    p.disconnectedAt = Date.now();
    // En partie, sa grille reste sur la table : le pilote automatique la joue.
    if (this.phase === 'lobby' || p.status === 'spectator') this.players = this.players.filter((x) => x.id !== id);
    else p.left = true;
    if (this.hostId === id) this.transferHost();
  }

  private transferHost(): void {
    const next = this.players.find((p) => !p.isBot && !p.left && p.connected) ?? this.players.find((p) => !p.isBot && !p.left);
    this.hostId = next?.id ?? '';
  }

  connect(p: Player, socketId: string): void {
    p.sockets.add(socketId);
    p.connected = true;
    p.left = false;
    if (!this.hostId || !this.get(this.hostId) || this.get(this.hostId)?.left) this.hostId = p.id;
  }

  disconnect(id: string | undefined, socketId: string): void {
    const p = this.get(id);
    if (!p) return;
    p.sockets.delete(socketId);
    if (p.sockets.size === 0) {
      p.connected = false;
      p.disconnectedAt = Date.now();
    }
  }

  isAuto(p: Player): boolean {
    return p.isBot || p.left || (!p.connected && Date.now() - p.disconnectedAt >= GRACE_MS);
  }

  updateSettings(by: string, payload: Record<string, unknown>): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut changer les réglages.";
    if (this.phase !== 'lobby') return 'Les réglages se changent dans le salon.';
    if ((THINK_OPTIONS as readonly unknown[]).includes(payload.think)) this.settings.think = payload.think as ThinkTime;
    if ((LIMIT_OPTIONS as readonly unknown[]).includes(payload.limit)) this.settings.limit = payload.limit as Limit;
    return undefined;
  }

  // ───────────────────────────── Partie ─────────────────────────────

  start(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut lancer la partie.";
    if (this.phase !== 'lobby') return 'La partie est déjà lancée.';
    const seated = this.seated;
    if (seated.length < MIN_PLAYERS) return `Il faut au moins ${MIN_PLAYERS} joueurs (ajoute un bot si besoin).`;
    for (const p of seated) p.status = 'playing';
    // On s'assoit dans un ordre tiré au sort.
    const order = shuffle(seated.map((p) => p.id));
    const spectators = this.players.filter((p) => p.status === 'spectator');
    this.players = [...order.map((id) => this.get(id)!), ...spectators];
    this.game = new Game(order, { limit: this.settings.limit, eventMs: EVENT_MS });
    this.phase = 'playing';
    this.final = null;
    this.armSetup();
    return undefined;
  }

  restart(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut relancer une partie.";
    if (this.phase === 'lobby') return undefined;
    this.clearTimer();
    this.players = this.players.filter((p) => !p.left);
    let seats = 0;
    for (const p of this.players) {
      p.status = seats < MAX_PLAYERS ? 'lobby' : 'spectator';
      if (p.status === 'lobby') seats++;
    }
    this.phase = 'lobby';
    this.game = null;
    this.final = null;
    this.ready.clear();
    return undefined;
  }

  endEarly(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut arrêter la partie.";
    if (this.phase !== 'playing') return undefined;
    return this.restart(by);
  }

  /** Plus aucun humain présent à la table : les bots jouent vite. */
  private onlyBots(): boolean {
    return this.players.every((p) => p.status !== 'playing' || this.isAuto(p));
  }

  private botDelay(min: number, spread: number): number {
    if (FAST) return 15;
    if (this.onlyBots()) return 300;
    return min + Math.random() * spread;
  }

  /** Début de manche : chacun retourne deux cartes ; les bots le font à leur rythme. */
  private armSetup(): void {
    const now = Date.now();
    this.setupStartedAt = now;
    this.setupDue.clear();
    this.ready.clear();
    this.turnEndsAt = this.settings.think ? now + this.settings.think * 1000 : 0;
    for (const p of this.players) if (p.isBot && p.status === 'playing') this.setupDue.set(p.id, now + this.botDelay(900, 1600));
  }

  /** Prépare le tour du joueur suivant. */
  private armTurn(): void {
    const g = this.game;
    if (!g) return;
    const now = Date.now();
    if (g.stage === 'scores') {
      this.scoresAt = now;
      this.ready.clear();
      g.result!.nextAt = now + SCORES_MAX_MS;
      this.turnEndsAt = 0;
      return;
    }
    if (g.stage === 'setup') {
      this.armSetup();
      return;
    }
    this.turnStartedAt = now;
    this.turnEndsAt = FAST ? now + 900 : this.settings.think ? now + this.settings.think * 1000 : 0;
    this.botActAt = now + this.botDelay(1100, 1000);
  }

  private check(by: string, seq: unknown): string | undefined {
    if (this.phase !== 'playing' || !this.game) return "Aucune partie n'est en cours.";
    if (seq !== undefined && seq !== this.game.seq) return 'Le tour a changé entre-temps.';
    return undefined;
  }

  setupFlip(by: string, index: unknown): string | undefined {
    const err = this.check(by, undefined) ?? this.game!.setupFlip(by, index);
    if (err) return err;
    if (this.game!.stage === 'play') this.armTurn();
    return undefined;
  }

  draw(by: string, seq?: unknown): string | undefined {
    const err = this.check(by, seq) ?? this.game!.draw(by);
    if (err) return err;
    // Le temps de voir la carte piochée avant qu'un bot ne la pose.
    this.botActAt = Date.now() + this.botDelay(1000, 600);
    return undefined;
  }

  take(by: string, index: unknown, seq?: unknown): string | undefined {
    const err = this.check(by, seq) ?? this.game!.takeDiscard(by, index);
    if (err) return err;
    this.afterAction(by);
    return undefined;
  }

  swap(by: string, index: unknown, seq?: unknown): string | undefined {
    const err = this.check(by, seq) ?? this.game!.swapDrawn(by, index);
    if (err) return err;
    this.afterAction(by);
    return undefined;
  }

  flip(by: string, index: unknown, seq?: unknown): string | undefined {
    const err = this.check(by, seq) ?? this.game!.discardFlip(by, index);
    if (err) return err;
    this.afterAction(by);
    return undefined;
  }

  /** Entre deux manches : « je suis prêt ». L'hôte peut repartir sans attendre. */
  setReady(by: string, force: unknown): string | undefined {
    const g = this.game;
    if (this.phase !== 'playing' || !g || g.stage !== 'scores') return undefined;
    const p = this.get(by);
    if (!p || p.status !== 'playing') {
      if (force === true && by === this.hostId) return this.advanceRound(true);
      return undefined;
    }
    this.ready.add(by);
    if (force === true && by === this.hostId) return this.advanceRound(true);
    return undefined;
  }

  private allReady(): boolean {
    return this.players.every((p) => p.status !== 'playing' || this.isAuto(p) || this.ready.has(p.id));
  }

  private advanceRound(force = false): string | undefined {
    const g = this.game!;
    const now = Date.now();
    if (!force && now < this.scoresAt + SCORES_MIN_MS) return undefined;
    if (g.result!.gameOver) {
      this.finishGame();
      return undefined;
    }
    g.nextRound();
    this.armSetup();
    return undefined;
  }

  private afterAction(by: string): void {
    const g = this.game!;
    this.botReacts(by);
    this.armTurn();
    if (g.stage === 'scores') this.botReactsToRound();
  }

  /** De temps en temps, un bot réagit à ce qui vient de se passer. */
  private botReacts(by: string): void {
    if (FAST) return;
    const g = this.game!;
    const e = g.events[g.events.length - 1];
    if (!e) return;
    const bots = this.players.filter((p) => p.isBot && p.status === 'playing' && p.id !== by);
    if (!bots.length || Math.random() > 0.25) return;
    const bot = bots[crypto.randomInt(bots.length)];
    let pool: string[] = [];
    if (e.kind === 'column') pool = ['👏', 'Bien joué !', '😱'];
    else if (e.kind === 'last') pool = ['😱', '😅', '🤞'];
    else if (e.kind === 'swap' && e.wasHidden && (e.old ?? 0) >= 10) pool = ['😅', 'Aïe…'];
    else if (e.kind === 'swap' && e.value !== undefined && e.value <= -1) pool = ['😎', '🔥'];
    if (pool.length) this.onEmote(bot.id, pool[crypto.randomInt(pool.length)]);
  }

  private botReactsToRound(): void {
    if (FAST) return;
    const r = this.game!.result!;
    const ender = this.get(r.enderId);
    const line = r.lines.find((l) => l.id === r.enderId);
    if (ender?.isBot && line?.doubled) setTimeout(() => this.onEmote(ender.id, Math.random() < 0.5 ? 'Aïe…' : '😱'), 2200);
  }

  private finishGame(): void {
    const g = this.game;
    if (!g) return;
    const ranking = g.ranking();
    this.final = {
      limit: this.settings.limit,
      rounds: g.sheet.length,
      players: ranking.map(({ id, total, rank }) => {
        const p = this.get(id);
        const rounds = g.sheet.map((s) => s.scores[id] ?? 0);
        return {
          id,
          name: p?.name ?? '?',
          avatar: p?.avatar ?? AVATARS[0],
          total,
          rank,
          rounds,
          best: Math.min(...rounds),
          doubled: g.stats.get(id)?.doubled ?? 0,
        };
      }),
    };
    this.phase = 'finished';
    this.clearTimer();
  }

  // ───────────────────────────── Minuteries & pilote automatique ─────────────────────────────

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** À appeler après chaque changement : planifie la prochaine échéance puis diffuse l'état. */
  commit(): void {
    const g = this.game;
    // Tout le monde est prêt : on repart (après le temps minimum de lecture).
    if (this.phase === 'playing' && g?.stage === 'scores' && this.allReady() && Date.now() >= this.scoresAt + SCORES_MIN_MS) {
      if (!g.result!.gameOver || !this.onlyBots() || Date.now() >= this.scoresAt + FINISH_BOTS_MS) this.advanceRound();
    }
    this.reschedule();
    this.onChange();
  }

  /** Quand agir pour un joueur : bot → délai naturel, absent → fin du délai de grâce, sinon fin du chrono. */
  private dueAt(p: Player | undefined, botAt: number, startedAt: number): number {
    if (!p) return Date.now();
    const limit = this.turnEndsAt > 0 ? this.turnEndsAt : Infinity;
    if (p.isBot) return botAt;
    if (this.isAuto(p)) return Math.min(botAt, Math.max(startedAt + 1200, p.disconnectedAt + (p.left ? 0 : GRACE_MS)));
    if (!p.connected) return Math.min(limit, p.disconnectedAt + GRACE_MS);
    return limit;
  }

  private nextDue(): number {
    const g = this.game!;
    if (g.stage === 'scores') {
      let due = g.result!.nextAt;
      if (this.allReady()) due = Math.min(due, Math.max(this.scoresAt + SCORES_MIN_MS, g.result!.gameOver && this.onlyBots() ? this.scoresAt + FINISH_BOTS_MS : 0));
      // Un absent qui atteint la fin de son délai de grâce compte comme prêt.
      for (const p of this.players) if (p.status === 'playing' && !p.isBot && !p.connected && !p.left) due = Math.min(due, Math.max(Date.now(), p.disconnectedAt + GRACE_MS));
      return due;
    }
    if (g.stage === 'setup') {
      let due = Infinity;
      for (const p of this.players) {
        if (p.status !== 'playing' || !(g.setupLeft.get(p.id) ?? 0)) continue;
        due = Math.min(due, this.dueAt(p, this.setupDue.get(p.id) ?? Date.now(), this.setupStartedAt));
      }
      return due;
    }
    return this.dueAt(this.get(g.current ?? undefined), this.botActAt, this.turnStartedAt);
  }

  private reschedule(): void {
    this.clearTimer();
    const g = this.game;
    if (this.phase !== 'playing' || !g) return;
    const now = Date.now();
    let due = this.nextDue();
    // Un événement affiché doit disparaître des écrans à l'heure dite.
    for (const e of g.events) if (e.until > now) due = Math.min(due, e.until + 5);
    if (!Number.isFinite(due)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.tick();
      } catch (e) {
        console.error(`[room ${this.code}]`, e);
      }
      this.commit();
    }, Math.max(0, Math.min(due - now, 2_147_000_000)));
  }

  tick(): void {
    const g = this.game;
    if (this.phase !== 'playing' || !g) return;
    const now = Date.now();
    if (g.stage === 'scores') {
      if (now >= g.result!.nextAt) this.advanceRound(true);
      return;
    }
    if (g.stage === 'setup') {
      for (const p of [...this.players]) {
        if (g.stage !== 'setup') break;
        if (p.status !== 'playing' || !(g.setupLeft.get(p.id) ?? 0)) continue;
        if (now < this.dueAt(p, this.setupDue.get(p.id) ?? now, this.setupStartedAt)) continue;
        this.setupFlip(p.id, setupPick(botView(g, p.id).grid));
        this.setupDue.set(p.id, now + this.botDelay(500, 400));
      }
      return;
    }
    const id = g.current;
    if (id && now >= this.dueAt(this.get(id), this.botActAt, this.turnStartedAt)) this.autoPlay(id);
  }

  /** Le pilote automatique joue comme un bot, avec ce que voit le joueur. */
  autoPlay(id: string): void {
    const g = this.game!;
    const move = botMove(botView(g, id));
    const err = move.type === 'draw' ? this.draw(id) : move.type === 'take' ? this.take(id, move.index) : move.type === 'swap' ? this.swap(id, move.index) : this.flip(id, move.index);
    if (!err) return;
    // Filet de sécurité : la partie ne doit jamais se bloquer.
    console.error(`[room ${this.code}] coup refusé (${err})`, move);
    const grid = g.grid(id);
    const any = grid.findIndex((c) => c !== null);
    if (g.drawn === null) {
      if (this.draw(id)) this.take(id, any);
    } else this.swap(id, any);
  }

  dispose(): void {
    this.clearTimer();
  }

  // ───────────────────────────── Vue personnalisée ─────────────────────────────

  /** Une carte cachée ne circule jamais : personne ne la connaît, pas même son propriétaire. */
  private gridView(g: Game, id: string): Cell[] {
    return g.grid(id).map((c) => (c === null ? null : c.up ? c.value : 'hidden'));
  }

  private gameView(g: Game): GameView {
    const now = Date.now();
    return {
      round: g.round,
      stage: g.stage,
      order: [...g.order],
      turnId: g.current,
      turnEndsAt: g.stage === 'scores' ? 0 : this.turnEndsAt,
      seq: g.seq,
      deck: g.deck.length,
      discardTop: g.discardTop,
      drawn: g.drawn,
      enderId: g.enderId,
      lastTurns: [...g.lastTurns],
      events: g.events.filter((e) => e.until > now).map((e) => ({ ...e })),
      result: g.result ? { ...g.result, lines: g.result.lines.map((l) => ({ ...l })) } : null,
      sheet: g.sheet.map((s) => ({ round: s.round, scores: { ...s.scores }, doubled: [...s.doubled] })),
    };
  }

  viewFor(viewerId: string): RoomView {
    const g = this.phase === 'playing' ? this.game : null;
    return {
      code: this.code,
      phase: this.phase,
      me: viewerId,
      hostId: this.hostId,
      settings: { ...this.settings },
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        isBot: p.isBot,
        isHost: p.id === this.hostId,
        connected: p.isBot || p.connected,
        autopilot: !p.isBot && p.status === 'playing' && this.isAuto(p),
        status: p.status,
        grid: g && g.grids.has(p.id) ? this.gridView(g, p.id) : null,
        setupLeft: g ? (g.setupLeft.get(p.id) ?? 0) : 0,
        total: g ? (g.totals.get(p.id) ?? 0) : 0,
        ready: !!g && g.stage === 'scores' && (p.isBot || this.ready.has(p.id) || (p.status === 'playing' && this.isAuto(p))),
      })),
      game: g ? this.gameView(g) : null,
      final: this.final,
      serverNow: Date.now(),
    };
  }
}
