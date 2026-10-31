// Fin de manche : les grilles se retournent, puis le décompte monte du bas de l'écran.
import { motion } from 'framer-motion';
import { Check, ChevronDown, ChevronUp, Flag, Play, Trophy } from 'lucide-react';
import { useState } from 'react';
import type { RoomView } from '../../../shared/protocol';
import { listing, nameOf, pts } from '../lib/text';
import { cls, secondsLeft, useTick } from '../lib/util';
import { send } from '../net';
import { Avatar, Button } from './Ui';

/** Ce qui est arrivé à celui qui a fini la manche. */
function enderLine(view: RoomView): string {
  const r = view.game!.result!;
  const line = r.lines.find((l) => l.id === r.enderId)!;
  const mine = r.enderId === view.me;
  const who = mine ? 'Tu' : nameOf(view, r.enderId);
  const others = r.lines.filter((l) => l.id !== r.enderId);
  if (line.doubled) return `${who} ${mine ? 'as' : 'a'} fini sans avoir le plus petit score : ${mine ? 'tes' : 'ses'} ${line.raw} points doublent !`;
  if (line.raw <= 0 && others.some((l) => l.raw <= line.raw)) return `${who} ${mine ? 'as' : 'a'} fini sans être seul en tête, mais un score de ${line.raw} ne double pas.`;
  return `${who} ${mine ? 'as' : 'a'} fini avec le plus petit score. Bien joué !`;
}

export function RoundEnd({ view }: { view: RoomView }) {
  const g = view.game!;
  const r = g.result!;
  const now = useTick(500);
  const [folded, setFolded] = useState(false);
  const isHost = view.hostId === view.me;
  const me = view.players.find((p) => p.id === view.me);
  const seated = g.order.includes(view.me);
  const lines = [...r.lines].sort((a, b) => a.score - b.score);
  const late = view.players.filter((p) => g.order.includes(p.id) && !p.ready);
  const waiting = late.map((p) => (p.id === view.me ? 'toi' : p.name));
  // Forcer le départ n'a de sens que si quelqu'un d'autre que l'hôte traîne.
  const othersLate = late.some((p) => p.id !== view.me);
  const leader = [...r.lines].sort((a, b) => a.total - b.total)[0];
  const left = secondsLeft(r.nextAt, now);

  return (
    <section className={cls('round-end', folded && 'is-folded')} aria-label="Fin de manche">
      <button type="button" className="round-fold" onClick={() => setFolded((x) => !x)} aria-expanded={!folded}>
        {folded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        {folded ? 'Voir le décompte' : 'Voir les grilles'}
      </button>
      <header className="round-head">
        <span className="eyebrow">{r.gameOver ? 'Dernière manche' : `Manche ${r.round}`}</span>
        <h2>{r.gameOver ? 'Partie terminée !' : 'Manche terminée'}</h2>
        <p className={cls('round-ender', r.lines.find((l) => l.id === r.enderId)?.doubled && 'is-doubled')}>
          <Flag size={15} aria-hidden /> {enderLine(view)}
        </p>
      </header>
      <ol className="round-lines">
        {lines.map((l, i) => {
          const p = view.players.find((x) => x.id === l.id);
          return (
            <motion.li key={l.id} className={cls('round-line', l.id === view.me && 'is-me', l.total >= view.settings.limit && 'is-over')} initial={{ x: -16 }} animate={{ x: 0 }} transition={{ delay: 0.15 + i * 0.06 }}>
              <Avatar avatar={p?.avatar ?? 'soleil'} className="round-avatar" />
              <span className="round-name">
                {l.id === view.me ? 'Toi' : (p?.name ?? '?')}
                {l.ended && <Flag size={13} className="round-flag" aria-label="a fini la manche" />}
              </span>
              <span className={cls('round-score', l.score < 0 && 'is-neg')}>
                {l.score > 0 ? `+${l.score}` : l.score}
                {l.doubled && <span className="stamp-x2">×2</span>}
              </span>
              <span className="round-total">
                <b>{l.total}</b>
                <span className="round-bar" aria-hidden>
                  <span style={{ width: `${Math.max(0, Math.min(100, (l.total / view.settings.limit) * 100))}%` }} />
                </span>
              </span>
            </motion.li>
          );
        })}
      </ol>
      {r.gameOver && (
        <p className="round-winner">
          <Trophy size={16} aria-hidden /> {leader.id === view.me ? 'Tu gagnes' : `${nameOf(view, leader.id)} gagne`} avec {pts(leader.total)} !
        </p>
      )}
      <footer className="round-foot">
        {seated && me ? (
          me.ready ? (
            <p className="round-wait" role="status">
              <Check size={16} aria-hidden /> {waiting.length ? `Prêt ! On attend ${listing(waiting)}.` : 'Tout le monde est prêt !'}
            </p>
          ) : (
            <Button variant="primary" className="btn-lg btn-wide" icon={r.gameOver ? <Trophy size={20} /> : <Play size={20} />} onClick={() => void send('game:ready')}>
              {r.gameOver ? 'Voir le podium' : `Prêt pour la manche ${r.round + 1}`}
            </Button>
          )
        ) : (
          <p className="round-wait">On attend que les joueurs soient prêts.</p>
        )}
        <div className="round-meta">
          {left > 0 && <span className="muted small">Départ automatique dans {left} s</span>}
          {isHost && othersLate && (
            <Button variant="ghost" className="btn-sm" onClick={() => void send('game:ready', { force: true })}>
              Lancer sans attendre
            </Button>
          )}
        </div>
      </footer>
    </section>
  );
}
