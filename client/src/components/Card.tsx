// Les cartes : une face de couleur selon la famille de la valeur (de la nuit pour -2 au soleil rouge pour 12), un dos rayé.
import type { CSSProperties } from 'react';
import { toneOf } from '../../../shared/protocol';
import { cls } from '../lib/util';

export function cardLabel(value: number): string {
  return value < 0 ? `−${-value}` : String(value);
}

interface CardProps {
  /** La valeur ; absente, la carte est face cachée. */
  value?: number | null;
  size?: 'mini' | 'sm' | 'md' | 'lg';
  className?: string;
  style?: CSSProperties;
}

export function SkyCard({ value, size = 'md', className, style }: CardProps) {
  if (value === undefined || value === null) {
    return (
      <span className={cls('card', 'card-back', `card-${size}`, className)} style={style} aria-hidden>
        <span className="back-sun" />
      </span>
    );
  }
  const label = cardLabel(value);
  return (
    <span className={cls('card', `tone-${toneOf(value)}`, `card-${size}`, label.length > 1 && 'is-wide', className)} style={style} aria-hidden>
      {size !== 'mini' && <span className="card-corner is-tl">{label}</span>}
      <span className="card-num">{label}</span>
      {size !== 'mini' && <span className="card-corner is-br">{label}</span>}
    </span>
  );
}
