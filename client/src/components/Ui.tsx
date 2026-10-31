// Briques d'interface communes : boutons, fenêtres, pastilles, sélecteurs, logo, avatars et ciel du soir.
import { X } from 'lucide-react';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cls } from '../lib/util';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'soft';
  icon?: ReactNode;
}

export function Button({ variant = 'default', icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cls('btn', `btn-${variant}`, className)} {...rest}>
      {icon}
      {children && <span className="btn-label">{children}</span>}
    </button>
  );
}

/** Le titre : des lettres rondes qui flottent au-dessus d'un soleil couchant. */
export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={cls('logo', `logo-${size}`)} role="img" aria-label="Skyjo">
      {'Skyjo'.split('').map((l, i) => (
        <span key={i} className="logo-letter" style={{ '--i': i } as React.CSSProperties} aria-hidden>
          {l}
        </span>
      ))}
    </div>
  );
}

/** Le décor : un coucher de soleil rayé façon affiche des années 70, avec quelques nuages qui passent. */
export function Sky({ children, className, sun = false }: { children: ReactNode; className?: string; sun?: boolean }) {
  return (
    <div className={cls('sky', className)}>
      <div className="sky-grad" aria-hidden />
      {sun && (
        <svg className="sky-sun" viewBox="0 0 400 200" aria-hidden>
          <defs>
            <linearGradient id="sun-g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffe08a" />
              <stop offset="0.55" stopColor="#ffb347" />
              <stop offset="1" stopColor="#ff6a4d" />
            </linearGradient>
            <mask id="sun-cut">
              <rect width="400" height="200" fill="#fff" />
              {[118, 138, 154, 168, 180, 190].map((y, i) => (
                <rect key={y} x="0" y={y} width="400" height={3 + i * 1.6} fill="#000" />
              ))}
            </mask>
          </defs>
          <circle cx="200" cy="200" r="190" fill="url(#sun-g)" mask="url(#sun-cut)" />
        </svg>
      )}
      <div className="sky-clouds" aria-hidden>
        <Cloud className="cloud c1" />
        <Cloud className="cloud c2" />
        <Cloud className="cloud c3" />
      </div>
      <div className="sky-body">{children}</div>
    </div>
  );
}

export function Cloud({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 50" aria-hidden>
      <path d="M18 46h86a14 14 0 0 0 0-28 22 22 0 0 0-41-8A17 17 0 0 0 33 22 12 12 0 0 0 18 46Z" />
    </svg>
  );
}

export function Pill({ tone, children, className }: { tone?: 'sun' | 'sky' | 'rose' | 'mint'; children: ReactNode; className?: string }) {
  return <span className={cls('pill', tone && `pill-${tone}`, className)}>{children}</span>;
}

interface SegmentedOption<T> {
  value: T;
  label: string;
  sub?: string;
}

export function Segmented<T extends string | number | boolean>({ options, value, onChange, disabled, label }: { options: SegmentedOption<T>[]; value: T; onChange: (v: T) => void; disabled?: boolean; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled}
          className={cls('seg', o.value === value && 'is-on')}
          onClick={() => onChange(o.value)}
        >
          <b>{o.label}</b>
          {o.sub && <small>{o.sub}</small>}
        </button>
      ))}
    </div>
  );
}

/**
 * Une fenêtre, rendue à la racine du document pour ne dépendre d'aucun parent.
 * Elle s'ouvre avec un petit mouvement en CSS et se ferme d'un coup.
 */
export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => box.current?.querySelector<HTMLElement>('[data-autofocus], .modal-body button, .modal-body input')?.focus({ preventScroll: true }), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
      before?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="modal-back" onClick={onClose}>
      <div ref={box} className={cls('modal', wide && 'is-wide')} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Fermer" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export const AVATAR_EMOJI: Record<string, string> = {
  soleil: '☀️',
  nuage: '☁️',
  arcenciel: '🌈',
  montgolfiere: '🎈',
  cerfvolant: '🪁',
  avion: '✈️',
  oiseau: '🐦',
  papillon: '🦋',
  lune: '🌙',
  etoile: '⭐',
  perroquet: '🦜',
  ovni: '🛸',
};

export const AVATAR_LABELS: Record<string, string> = {
  soleil: 'Soleil',
  nuage: 'Nuage',
  arcenciel: 'Arc-en-ciel',
  montgolfiere: 'Ballon',
  cerfvolant: 'Cerf-volant',
  avion: 'Avion',
  oiseau: 'Oiseau',
  papillon: 'Papillon',
  lune: 'Lune',
  etoile: 'Étoile',
  perroquet: 'Perroquet',
  ovni: 'Soucoupe',
};

export function Avatar({ avatar, className }: { avatar: string; className?: string }) {
  return (
    <span className={cls('avatar', className)} aria-hidden>
      {AVATAR_EMOJI[avatar] ?? '☀️'}
    </span>
  );
}
