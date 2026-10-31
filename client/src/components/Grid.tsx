// Une grille de 3 × 4 cartes : la tienne en grand, celles des autres en petit.
import { useEffect, useRef, type CSSProperties } from 'react';
import { ROWS, colOf, rowOf, type Cell } from '../../../shared/protocol';
import { cls } from '../lib/util';
import { SkyCard, cardLabel } from './Card';

interface GridProps {
  owner: string;
  cells: Cell[];
  size: 'big' | 'mini';
  /** Cases que l'on peut toucher maintenant. */
  targets?: Set<number>;
  onPick?: (index: number) => void;
  /** Cases sur lesquelles une carte est en train d'atterrir : on attend qu'elle arrive. */
  landing?: Set<string>;
  /** Fin de manche : les cartes se retournent l'une après l'autre. */
  stagger?: boolean;
  /** Pour les lecteurs d'écran : « Ta grille », « Grille de Léa ». */
  label: string;
  mine?: boolean;
}

function describe(cell: Cell, i: number, mine: boolean): string {
  const where = `rangée ${rowOf(i) + 1}, colonne ${colOf(i) + 1}`;
  if (cell === 'hidden') return `${mine ? 'Ta carte cachée' : 'Carte cachée'}, ${where}`;
  return `${cardLabel(cell as number)}, ${where}`;
}

function GridCell({ owner, cell, index, size, target, onPick, landing, stagger, mine }: { owner: string; cell: Cell; index: number; size: GridProps['size']; target: boolean; onPick?: (i: number) => void; landing: boolean; stagger?: boolean; mine: boolean }) {
  // Une carte qui passe de cachée à visible se retourne ; au premier affichage, elle est déjà posée.
  const prev = useRef(cell);
  const flipping = prev.current === 'hidden' && typeof cell === 'number';
  useEffect(() => {
    prev.current = cell;
  });
  const key = `${owner}:${index}`;
  if (cell === null) return <span className="cell is-gone" data-cell={key} aria-hidden />;
  const value = cell === 'hidden' ? undefined : cell;
  const delay = stagger ? (colOf(index) * ROWS + rowOf(index)) * 70 : 0;
  const card = <SkyCard key={String(cell)} value={value} size={size === 'big' ? 'lg' : 'mini'} className={cls(flipping && 'is-flip', landing && 'is-landing')} style={delay ? ({ animationDelay: `${delay}ms` } as CSSProperties) : undefined} />;
  if (!onPick) {
    return (
      <span className="cell" data-cell={key}>
        {card}
      </span>
    );
  }
  return (
    <button type="button" className={cls('cell', target && 'is-target')} data-cell={key} disabled={!target} aria-label={describe(cell, index, mine)} onClick={() => target && onPick(index)}>
      {card}
    </button>
  );
}

export function Grid({ owner, cells, size, targets, onPick, landing, stagger, label, mine = false }: GridProps) {
  return (
    <div className={cls('grid', `grid-${size}`, targets && targets.size > 0 && 'has-targets')} role={onPick ? 'group' : 'img'} aria-label={onPick ? label : `${label} : ${cells.map((c, i) => (c === null ? '' : describe(c, i, mine))).filter(Boolean).join(' ; ')}`}>
      {cells.map((cell, i) => (
        <GridCell key={i} owner={owner} cell={cell} index={i} size={size} target={!!targets?.has(i)} onPick={onPick} landing={!!landing?.has(`${owner}:${i}`)} stagger={stagger} mine={mine} />
      ))}
    </div>
  );
}
