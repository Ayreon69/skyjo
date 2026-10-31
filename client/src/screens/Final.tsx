// Fin de partie : le podium (le plus petit total gagne), la feuille de marque complète et la revanche.
import confetti from 'canvas-confetti';
import { motion } from 'framer-motion';
import { LogOut, RotateCcw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { FinalEntry, RoomView } from '../../../shared/protocol';
import { SheetTable } from '../components/ScoreSheet';
import { Avatar, Button, Logo, Sky } from '../components/Ui';
import { sfx } from '../lib/sound';
import { pts } from '../lib/text';
import { cls, reducedMotion } from '../lib/util';
import { leaveRoom, send } from '../net';

function Step({ e, place, me, delay }: { e: FinalEntry | undefined; place: 1 | 2 | 3; me: string; delay: number }) {
  if (!e) return <div className={`podium-step is-${place} is-empty`} />;
  return (
    <motion.div className={cls('podium-step', `is-${place}`, e.id === me && 'is-me')} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay, type: 'spring', stiffness: 160, damping: 16 }}>
      <Avatar avatar={e.avatar} className="podium-avatar" />
      <b className="podium-name">{e.id === me ? 'Toi' : e.name}</b>
      <span className="podium-total">{pts(e.total)}</span>
      <span className="podium-block">{e.rank}</span>
    </motion.div>
  );
}

export function Final({ view }: { view: RoomView }) {
  const final = view.final!;
  const isHost = view.hostId === view.me;
  const winners = final.players.filter((p) => p.rank === 1);
  const iWon = winners.some((p) => p.id === view.me);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    sfx.fanfare(iWon);
    if (reducedMotion()) return;
    const t = window.setTimeout(() => {
      void confetti({ particleCount: iWon ? 180 : 90, spread: 100, origin: { y: 0.35 }, colors: ['#ffc23d', '#ef4b3f', '#31b7e6', '#3dbb6b', '#5a6fe0', '#fff3d6'], scalar: 0.9, disableForReducedMotion: true });
    }, 500);
    return () => window.clearTimeout(t);
  }, [iWon]);

  const [first, second, third] = final.players;
  const title = winners.length > 1 ? `Égalité : ${winners.map((w) => (w.id === view.me ? 'toi' : w.name)).join(' et ')} !` : iWon ? 'Tu gagnes !' : `${first.name} gagne !`;

  return (
    <Sky className="is-quiet" sun>
      <div className="final">
        <header className="final-top">
          <Logo size="sm" />
          <Button variant="ghost" icon={<LogOut size={18} />} onClick={() => void leaveRoom()}>
            Quitter
          </Button>
        </header>

        <motion.section className="final-hero" initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5 }}>
          <span className="eyebrow">
            Partie terminée en {final.rounds} manche{final.rounds > 1 ? 's' : ''}
          </span>
          <h1>{title}</h1>
          <p className="muted">Le plus petit total l'emporte.</p>
        </motion.section>

        <div className="podium" aria-label="Podium">
          <Step e={second} place={2} me={view.me} delay={0.45} />
          <Step e={first} place={1} me={view.me} delay={0.25} />
          <Step e={third} place={3} me={view.me} delay={0.6} />
        </div>

        <section className="panel final-sheet">
          <h3>Feuille de marque</h3>
          <SheetTable view={view} />
          <ul className="final-notes">
            {final.players.map((p) => (
              <li key={p.id} className={cls(p.id === view.me && 'is-me')}>
                <b>{p.rank}.</b> {p.id === view.me ? 'Toi' : p.name} · meilleure manche : {p.best}
                {p.doubled > 0 && ` · doublé ${p.doubled} fois`}
              </li>
            ))}
          </ul>
        </section>

        <div className="lobby-cta">
          {isHost ? (
            <Button variant="primary" className="btn-lg btn-wide" icon={<RotateCcw size={20} />} onClick={() => void send('game:restart')}>
              Rejouer
            </Button>
          ) : (
            <div className="waiting" role="status">
              <span className="spinner" /> En attente de la revanche…
            </div>
          )}
        </div>
      </div>
    </Sky>
  );
}
