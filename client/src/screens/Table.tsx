// La table : les grilles des autres en haut, la pioche et la défausse au milieu, ta grille en grand en bas.
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, Bot, Flag, ListOrdered, LogOut, MoreHorizontal, Smile, Undo2, Volume2, VolumeX, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { EMOTES, TAUNTS, type Cell, type GameView, type PlayerView, type RoomView } from '../../../shared/protocol';
import { SkyCard } from '../components/Card';
import { Grid } from '../components/Grid';
import { RoundEnd } from '../components/RoundEnd';
import { ScoreSheet } from '../components/ScoreSheet';
import { Avatar, Button, Logo, Modal } from '../components/Ui';
import { sfx } from '../lib/sound';
import { eventText, eventTone, le, listing, nameOf, un } from '../lib/text';
import { cls, reducedMotion, useTick, vibrate } from '../lib/util';
import { leaveRoom, send, socket } from '../net';
import { useStore, type Emote } from '../store';

type Mode = null | 'take' | 'discard';

interface Flight {
  id: string;
  value: number;
  from: DOMRect;
  to: DOMRect;
  delay: number;
  /** Une carte qui sort de la pioche : elle se retourne en vol. */
  turn?: boolean;
}

function TurnTimer({ endsAt, think }: { endsAt: number; think: number }) {
  const now = useTick(250);
  if (!endsAt || !think) return null;
  const left = Math.max(0, endsAt - now);
  return (
    <span className={cls('turn-timer', left < 8000 && 'is-low')} role="timer" aria-label={`${Math.ceil(left / 1000)} secondes`}>
      <span style={{ width: `${Math.min(100, (left / (think * 1000)) * 100)}%` }} />
    </span>
  );
}

/**
 * Sons, vibrations et cartes qui volent : tout se déduit des événements reçus.
 * Les positions sont notées après chaque rendu : une carte qui vient de quitter la table garde ainsi son point de départ.
 */
function useTableEffects(view: RoomView, setFlights: (f: (x: Flight[]) => Flight[]) => void, setLanding: (f: (x: Set<string>) => Set<string>) => void) {
  const g = view.game!;
  const rects = useRef(new Map<string, DOMRect>());
  const seen = useRef(-1);
  const turn = useRef<string | null>(null);
  const stage = useRef<string | null>(null);
  const round = useRef(0);

  useLayoutEffect(() => {
    const fresh = g.events.filter((e) => e.id > seen.current);
    const first = seen.current < 0;
    seen.current = Math.max(seen.current, 0, ...g.events.map((e) => e.id));
    const now = (key: string) => document.querySelector(`[data-${key.startsWith('pile:') ? 'pile' : 'cell'}="${key.replace(/^pile:/, '')}"]`)?.getBoundingClientRect();
    const before = (key: string) => rects.current.get(key) ?? now(key);
    const fly: Flight[] = [];
    const land = new Set<string>();
    let delay = 0;
    const add = (id: string, value: number, from: DOMRect | undefined, to: DOMRect | undefined, landKey: string, extra: Partial<Flight> = {}) => {
      if (!from || !to || reducedMotion()) return;
      fly.push({ id, value, from, to, delay, ...extra });
      land.add(landKey);
    };
    for (const e of fresh) {
      // Un événement déjà ancien à l'arrivée (reconnexion) ne rejoue pas le spectacle.
      if (first && view.serverNow - e.at > 1500) continue;
      const cell = e.index !== undefined ? `${e.by}:${e.index}` : '';
      switch (e.kind) {
        case 'draw':
          sfx.draw();
          add(`${e.id}`, e.value!, now('pile:deck'), now('pile:drawn'), 'pile:drawn', { turn: true });
          break;
        case 'swap':
          sfx.place();
          add(`${e.id}a`, e.value!, before(e.source === 'discard' ? 'pile:discard' : 'pile:drawn'), now(cell), cell);
          add(`${e.id}b`, e.old!, before(cell), now('pile:discard'), 'pile:discard', { turn: e.wasHidden });
          delay += 380;
          break;
        case 'flip':
          sfx.flip();
          if (!e.setup) {
            add(`${e.id}`, e.discarded!, before('pile:drawn'), now('pile:discard'), 'pile:discard');
            delay += 300;
          }
          break;
        case 'column':
          window.setTimeout(() => {
            sfx.column();
            if (e.by === view.me) vibrate([30, 40, 60]);
          }, delay);
          for (let r = 0; r < 3; r++) add(`${e.id}c${r}`, e.value!, before(`${e.by}:${r * 4 + e.col!}`), now('pile:discard'), 'pile:discard', { delay: delay + 120 + r * 70 });
          delay += 420;
          break;
        case 'last':
          window.setTimeout(() => sfx.last(), delay);
          if (e.by !== view.me) vibrate([40, 60, 40]);
          break;
        case 'start':
          break;
        case 'reshuffle':
          sfx.shuffle();
          break;
      }
    }
    if (fly.length) {
      setFlights((x) => [...x, ...fly]);
      setLanding((x) => new Set([...x, ...land]));
      const end = Math.max(...fly.map((f) => f.delay)) + 520;
      const ids = new Set(fly.map((f) => f.id));
      window.setTimeout(() => {
        setFlights((x) => x.filter((f) => !ids.has(f.id)));
        setLanding((x) => {
          const next = new Set(x);
          for (const k of land) next.delete(k);
          return next;
        });
      }, end);
    }
  });

  // Puis noter les positions actuelles pour le prochain coup.
  useLayoutEffect(() => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-cell]')) rects.current.set(el.dataset.cell!, el.getBoundingClientRect());
    for (const el of document.querySelectorAll<HTMLElement>('[data-pile]')) rects.current.set(`pile:${el.dataset.pile}`, el.getBoundingClientRect());
  });

  useEffect(() => {
    if (g.round !== round.current) {
      if (round.current !== 0 || g.seq <= 2) sfx.shuffle();
      round.current = g.round;
    }
    if (g.stage === 'scores' && stage.current && stage.current !== 'scores') {
      sfx.reveal();
      const line = g.result?.lines.find((l) => l.doubled);
      if (line) window.setTimeout(() => sfx.doubled(), 1900);
    }
    stage.current = g.stage;
    const t = g.turnId;
    if (t === view.me && turn.current !== view.me) {
      sfx.turn();
      vibrate(30);
    }
    turn.current = t;
  }, [g.turnId, g.stage, g.round, g.seq, g.result, view.me]);
}

function Flights({ flights }: { flights: Flight[] }) {
  return (
    <div className="flights" aria-hidden>
      {flights.map((f) => {
        const scale = f.to.width / f.from.width;
        return (
          <motion.div
            key={f.id}
            className="flight"
            style={{ width: f.from.width, height: f.from.height, '--card-w': `${f.from.width}px` } as CSSProperties}
            initial={{ x: f.from.left, y: f.from.top, scale: 1, rotateY: f.turn ? 180 : 0 }}
            animate={{ x: f.to.left + (f.to.width - f.from.width) / 2, y: f.to.top + (f.to.height - f.from.height) / 2, scale, rotateY: 0 }}
            transition={{ duration: 0.44, delay: f.delay / 1000, ease: [0.3, 0.7, 0.4, 1] }}
          >
            <SkyCard value={f.value} className="flight-face" />
            <SkyCard className="flight-back" />
          </motion.div>
        );
      })}
    </div>
  );
}

function ReactionTray({ onClose }: { onClose: () => void }) {
  const emit = (emoji: string) => {
    socket.emit('emote', { emoji });
    onClose();
  };
  return (
    <motion.div className="reactions" role="menu" aria-label="Réactions" initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
      <div className="reaction-emojis">
        {EMOTES.map((e) => (
          <button key={e} type="button" role="menuitem" onClick={() => emit(e)} aria-label={`Réaction ${e}`}>
            {e}
          </button>
        ))}
      </div>
      <div className="reaction-taunts">
        {TAUNTS.map((t) => (
          <button key={t} type="button" role="menuitem" onClick={() => emit(t)}>
            {t}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

function Bubbles({ emotes }: { emotes: Emote[] }) {
  return (
    <AnimatePresence>
      {emotes.slice(-1).map((e) => (
        <motion.span key={e.id} className={cls('bubble', e.emoji.length > 3 && 'is-text')} initial={{ scale: 0.4, y: 6, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ opacity: 0, y: -6 }}>
          {e.emoji}
        </motion.span>
      ))}
    </AnimatePresence>
  );
}

/** Un adversaire : son avatar, son total, et sa grille en petit. */
function Opponent({ view, p, emotes, landing }: { view: RoomView; p: PlayerView; emotes: Emote[]; landing: Set<string> }) {
  const g = view.game!;
  const isTurn = g.turnId === p.id;
  const isEnder = g.enderId === p.id && g.stage === 'play';
  const ref = useRef<HTMLDivElement>(null);
  // Quand la bande défile, on garde en vue celui qui joue (sans faire bouger la page).
  useEffect(() => {
    const el = ref.current;
    const strip = el?.parentElement;
    if (!isTurn || !el || !strip || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollTo({ left: el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [isTurn]);
  let status: string | null = null;
  if (g.stage === 'setup') status = p.setupLeft > 0 ? 'retourne…' : 'prêt';
  else if (isTurn) status = g.drawn !== null ? 'réfléchit…' : 'joue…';
  else if (g.stage === 'scores') status = p.ready ? 'prêt' : null;
  return (
    <div ref={ref} className={cls('opp', isTurn && 'is-turn', isEnder && 'is-ender', !p.connected && 'is-off')} style={{ '--card-w': 'var(--mw)' } as CSSProperties}>
      <div className="opp-head">
        <span className="opp-avatar">
          <Avatar avatar={p.avatar} />
          <Bubbles emotes={emotes} />
        </span>
        <span className="opp-name">{p.name}</span>
      </div>
      {p.grid && <Grid owner={p.id} cells={p.grid} size="mini" label={`Grille de ${p.name}`} landing={landing} stagger={g.stage === 'scores'} />}
      <div className="opp-foot">
        <span className="opp-status">
          {isEnder ? (
            <span className="opp-flag">
              <Flag size={11} aria-hidden /> a fini
            </span>
          ) : p.autopilot ? (
            <span className="opp-auto">
              <Bot size={11} aria-hidden /> auto
            </span>
          ) : !p.connected ? (
            <span className="opp-auto">
              <WifiOff size={11} aria-hidden /> absent
            </span>
          ) : (
            status && <span className={cls('opp-state', isTurn && 'is-live')}>{status}</span>
          )}
        </span>
        <span className="opp-total" title="Total des manches précédentes">
          {p.total} pt{Math.abs(p.total) > 1 ? 's' : ''}
        </span>
      </div>
      {isTurn && <TurnTimer endsAt={g.turnEndsAt} think={view.settings.think} />}
    </div>
  );
}

/** La pioche, la carte piochée et la défausse. Chacune se touche quand c'est utile, et le dit. */
function Piles({ g, myTurn, mode, landing, onDeck, onDiscard }: { g: GameView; myTurn: boolean; mode: Mode; landing: Set<string>; onDeck: () => void; onDiscard: () => void }) {
  const canDraw = myTurn && g.drawn === null;
  const canTake = canDraw && g.discardTop !== null;
  const canDump = myTurn && g.drawn !== null;
  const depth = Math.min(6, Math.ceil(g.deck / 18));
  return (
    <div className="piles">
      <button type="button" className={cls('pile', 'pile-deck', canDraw && mode !== 'take' && 'is-live')} disabled={!canDraw} onClick={onDeck} aria-label="Piocher une carte" data-pile="deck">
        <span className="pile-stack" style={{ '--depth': depth } as CSSProperties}>
          <SkyCard />
        </span>
        <span className="pile-label">Pioche</span>
      </button>
      <div className={cls('pile', 'pile-drawn', g.drawn !== null && 'is-on')} aria-live="polite">
        {g.drawn !== null ? (
          <span className="pile-card" data-pile="drawn">
            <SkyCard value={g.drawn} className={cls(landing.has('pile:drawn') && 'is-landing')} />
          </span>
        ) : (
          <span className="pile-slot" data-pile="drawn" />
        )}
        <span className="pile-label">{g.drawn !== null ? 'Piochée' : ''}</span>
      </div>
      <button
        type="button"
        className={cls('pile', 'pile-discard', canTake && 'is-live', mode === 'take' && 'is-held', canDump && 'is-dump', mode === 'discard' && 'is-held')}
        disabled={!canTake && !canDump}
        onClick={onDiscard}
        aria-label={canDump ? 'Défausser la carte piochée' : g.discardTop !== null ? `Prendre ${le(g.discardTop)} de la défausse` : 'Défausse vide'}
        aria-pressed={mode !== null}
      >
        <span className="pile-card" data-pile="discard">
          {g.discardTop !== null ? <SkyCard key={g.discardTop} value={g.discardTop} className={cls(landing.has('pile:discard') && 'is-landing')} /> : <span className="pile-slot" />}
          {canDump && <span className="pile-drop">{mode === 'discard' ? 'Défaussée' : 'Défausser'}</span>}
        </span>
        <span className="pile-label">Défausse</span>
      </button>
    </div>
  );
}

/** La ligne qui dit quoi faire maintenant. */
function prompt(view: RoomView, mode: Mode, me: PlayerView | undefined): { text: string; live: boolean } {
  const g = view.game!;
  if (!me || !g.order.includes(view.me)) {
    if (g.stage === 'setup') return { text: 'Chacun retourne deux cartes…', live: false };
    return { text: g.turnId ? `Au tour de ${nameOf(view, g.turnId)}` : 'Tu regardes la partie.', live: false };
  }
  if (g.stage === 'setup') {
    if (me.setupLeft > 0) return { text: me.setupLeft === 2 ? 'Retourne deux cartes de ta grille.' : 'Encore une carte à retourner.', live: true };
    const slow = view.players.filter((p) => g.order.includes(p.id) && p.setupLeft > 0).map((p) => p.name);
    return { text: `On attend ${listing(slow)}…`, live: false };
  }
  if (g.stage === 'scores') return { text: 'Manche terminée !', live: false };
  if (g.turnId !== view.me) {
    const p = view.players.find((x) => x.id === g.turnId);
    if (g.drawn !== null) return { text: `${p?.name ?? '?'} a pioché ${un(g.drawn)}…`, live: false };
    return { text: `Au tour de ${p?.name ?? '?'}${p?.autopilot ? ' (pilote auto)' : ''}`, live: false };
  }
  const last = g.enderId ? 'Dernier tour ! ' : '';
  if (g.drawn === null) {
    if (mode === 'take' && g.discardTop !== null) return { text: `Où poses-tu ${le(g.discardTop)} ? Touche une de tes cartes.`, live: true };
    return { text: g.discardTop !== null ? `${last}À toi : pioche, ou prends ${le(g.discardTop)} de la défausse.` : `${last}À toi : pioche une carte.`, live: true };
  }
  if (mode === 'discard') return { text: 'Retourne une de tes cartes cachées.', live: true };
  return { text: `${last}Échange ${le(g.drawn)} avec une de tes cartes, ou défausse-le.`, live: true };
}

/** La dernière nouvelle de la table, le temps de la lire. */
function News({ view, now }: { view: RoomView; now: number }) {
  const g = view.game!;
  const live = g.events.filter((e) => e.until > now && eventText(view, e));
  const e = live[live.length - 1];
  return (
    <div className="news" role="status" aria-live="polite">
      <AnimatePresence mode="popLayout">
        {e && (
          <motion.span key={e.id} className={cls('news-pill', `is-${eventTone(e)}`)} initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            {eventText(view, e)}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Table({ view }: { view: RoomView }) {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const setRulesOpen = useStore((s) => s.setRulesOpen);
  const emotes = useStore((s) => s.emotes);
  const [menu, setMenu] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [react, setReact] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [landing, setLanding] = useState<Set<string>>(() => new Set());
  const [showResult, setShowResult] = useState(false);
  const now = useTick(300);
  const g = view.game!;
  useTableEffects(view, setFlights, setLanding);

  const me = view.players.find((p) => p.id === view.me);
  const seated = g.order.includes(view.me);
  const myTurn = seated && g.stage === 'play' && g.turnId === view.me;
  const isHost = view.hostId === view.me;
  const n = g.order.length;
  // On tourne la table : d'abord celui qui joue juste après toi.
  const start = seated ? g.order.indexOf(view.me) + 1 : 0;
  const others = Array.from({ length: seated ? n - 1 : n }, (_, i) => view.players.find((p) => p.id === g.order[(start + i) % n])!).filter(Boolean);
  // Un spectateur voit en grand la grille de celui qui joue.
  const focus = seated ? me : view.players.find((p) => p.id === (g.turnId ?? g.order[0]));

  // Le choix en cours s'efface dès que le tour avance.
  useEffect(() => setMode(null), [g.seq]);
  // Le décompte arrive une fois les grilles retournées.
  useEffect(() => {
    if (g.stage !== 'scores') {
      setShowResult(false);
      return;
    }
    const t = window.setTimeout(() => setShowResult(true), reducedMotion() ? 200 : 1900);
    return () => window.clearTimeout(t);
  }, [g.stage, g.round]);

  const act = useCallback(async (event: string, payload: Record<string, unknown> = {}) => {
    setBusy(true);
    await send(event, payload);
    setBusy(false);
  }, []);

  const myCells: Cell[] = focus?.grid ?? [];
  const targets = useMemo(() => {
    const t = new Set<number>();
    if (!seated || !me?.grid || busy) return t;
    const hidden = (c: Cell) => c === 'hidden';
    const any = (c: Cell) => c !== null;
    let ok: ((c: Cell) => boolean) | null = null;
    if (g.stage === 'setup' && me.setupLeft > 0) ok = hidden;
    else if (myTurn && g.drawn === null && mode === 'take') ok = any;
    else if (myTurn && g.drawn !== null) ok = mode === 'discard' ? hidden : any;
    if (ok) me.grid.forEach((c, i) => ok!(c) && t.add(i));
    return t;
  }, [seated, me, busy, g.stage, g.drawn, myTurn, mode]);

  const pick = (i: number) => {
    sfx.tap();
    if (g.stage === 'setup') return void act('game:setup', { index: i });
    if (!myTurn) return;
    if (g.drawn === null && mode === 'take') return void act('game:take', { index: i, seq: g.seq });
    if (g.drawn !== null) return void act(mode === 'discard' ? 'game:flip' : 'game:swap', { index: i, seq: g.seq });
  };
  const onDeck = () => {
    if (!myTurn || g.drawn !== null || busy) return;
    setMode(null);
    void act('game:draw', { seq: g.seq });
  };
  const onDiscard = () => {
    if (!myTurn || busy) return;
    sfx.tap();
    if (g.drawn === null) {
      if (g.discardTop !== null) setMode((m) => (m === 'take' ? null : 'take'));
      return;
    }
    if (!me?.grid?.some((c) => c === 'hidden')) {
      useStore.getState().showToast('Toutes tes cartes sont visibles : échange la carte piochée.', 'info');
      return;
    }
    setMode((m) => (m === 'discard' ? null : 'discard'));
  };

  const p = prompt(view, mode, me);
  const lastTurn = g.stage === 'play' && g.enderId !== null;

  return (
    <div className={cls('table-screen', `is-${n}p`, myTurn && 'is-my-turn', g.stage === 'scores' && 'is-scores')}>
      <div className="table-bg" aria-hidden />
      <header className="table-top">
        <span className="table-logo">
          <Logo size="sm" />
        </span>
        <span className="round-info">
          <b>Manche {g.round}</b>
          <small>jusqu'à {view.settings.limit} pts</small>
        </span>
        <div className="table-tools">
          <button type="button" className="icon-btn" aria-label="Feuille de marque" onClick={() => setSheet(true)}>
            <ListOrdered size={20} />
          </button>
          <button type="button" className={cls('icon-btn', react && 'is-on')} aria-label="Réagir" aria-expanded={react} onClick={() => setReact((x) => !x)}>
            <Smile size={20} />
          </button>
          <button type="button" className="icon-btn" aria-label="Menu" onClick={() => setMenu(true)}>
            <MoreHorizontal size={20} />
          </button>
        </div>
        {react && <ReactionTray onClose={() => setReact(false)} />}
      </header>

      <section className={cls('opps', `has-${others.length}`)} aria-label="Les autres joueurs">
        {others.map((o) =>
          o.id === focus?.id ? null : <Opponent key={o.id} view={view} p={o} emotes={emotes.filter((e) => e.playerId === o.id)} landing={landing} />,
        )}
      </section>

      <section className="middle">
        <News view={view} now={now} />
        {lastTurn && (
          <div className="last-banner" role="status">
            <Flag size={14} aria-hidden /> Dernier tour : {g.enderId === view.me ? 'tu as tout retourné' : `${nameOf(view, g.enderId)} a tout retourné`}
          </div>
        )}
        <Piles g={g} myTurn={myTurn && !busy} mode={mode} landing={landing} onDeck={onDeck} onDiscard={onDiscard} />
      </section>

      <section className={cls('me-zone', myTurn && 'is-turn', p.live && 'is-live')}>
        <div className={cls('prompt', p.live && 'is-live')} role="status" aria-live="polite">
          <span className="prompt-text">{p.text}</span>
          {mode && (
            <button type="button" className="prompt-undo" onClick={() => setMode(null)}>
              <Undo2 size={15} aria-hidden /> Annuler
            </button>
          )}
          {myTurn && <TurnTimer endsAt={g.turnEndsAt} think={view.settings.think} />}
        </div>
        {focus?.grid && (
          <div className="me-grid" style={{ '--card-w': 'var(--cw)' } as CSSProperties}>
            <Grid owner={focus.id} cells={myCells} size="big" targets={seated ? targets : undefined} onPick={seated ? pick : undefined} landing={landing} stagger={g.stage === 'scores'} label={seated ? 'Ta grille' : `Grille de ${focus.name}`} mine={seated} />
          </div>
        )}
        {focus && (
          <div className="me-foot">
            <span className="me-avatar">
              <Avatar avatar={focus.avatar} />
              <Bubbles emotes={emotes.filter((e) => e.playerId === focus.id)} />
            </span>
            <span className="me-name">{seated ? focus.name : `${focus.name} joue`}</span>
            {g.enderId === focus.id && g.stage === 'play' && (
              <span className="opp-flag">
                <Flag size={12} aria-hidden /> a tout retourné
              </span>
            )}
            <span className="me-total">
              <small>total</small> {focus.total}
            </span>
          </div>
        )}
        {!seated && <p className="me-off">Tu regardes la partie : tu joueras à la prochaine.</p>}
      </section>

      <Flights flights={flights} />

      {g.stage === 'scores' && g.result && showResult && <RoundEnd key={g.round} view={view} />}

      <ScoreSheet view={view} open={sheet} onClose={() => setSheet(false)} />

      <Modal
        open={menu}
        onClose={() => {
          setMenu(false);
          setConfirmStop(false);
        }}
        title="Menu"
      >
        <div className="menu-list">
          <Button icon={prefs.sound ? <Volume2 size={18} /> : <VolumeX size={18} />} onClick={() => setPrefs({ sound: !prefs.sound })}>
            Son : {prefs.sound ? 'activé' : 'coupé'}
          </Button>
          <Button
            icon={<ListOrdered size={18} />}
            onClick={() => {
              setMenu(false);
              setSheet(true);
            }}
          >
            Feuille de marque
          </Button>
          <Button
            icon={<BookOpen size={18} />}
            onClick={() => {
              setMenu(false);
              setRulesOpen(true);
            }}
          >
            Les règles
          </Button>
          {isHost && (
            <Button
              variant="danger"
              icon={<Flag size={18} />}
              onClick={() => {
                // Deux appuis : un geste malheureux ne doit pas couper la partie de toute la table.
                if (!confirmStop) {
                  setConfirmStop(true);
                  return;
                }
                setConfirmStop(false);
                setMenu(false);
                void send('game:end');
              }}
            >
              {confirmStop ? 'Confirmer : arrêter pour tout le monde' : 'Arrêter la partie'}
            </Button>
          )}
          <Button variant="ghost" icon={<LogOut size={18} />} onClick={() => void leaveRoom()}>
            Quitter la table
          </Button>
        </div>
      </Modal>
    </div>
  );
}
