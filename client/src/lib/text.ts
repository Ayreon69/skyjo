// Les mots de la table : noms, ce qui vient de se passer, et la ligne qui dit quoi faire.
import type { GameEvent, RoomView } from '../../../shared/protocol';
import { cardLabel } from '../components/Card';

/** « un 7 », « un −2 », comme on le dit à la table. */
export function un(value: number): string {
  return `un ${cardLabel(value)}`;
}
export function le(value: number): string {
  return `le ${cardLabel(value)}`;
}

export function nameOf(view: RoomView, id: string | undefined | null): string {
  if (!id) return '?';
  if (id === view.me) return 'toi';
  return view.players.find((p) => p.id === id)?.name ?? '?';
}

/** « Léa, Zino et Sam ». */
export function listing(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}

/** Ce qui vient de se passer, en une phrase ; null pour ce qui n'a pas besoin d'être dit. */
export function eventText(view: RoomView, e: GameEvent): string | null {
  const mine = e.by === view.me;
  const who = mine ? 'Tu' : nameOf(view, e.by);
  const v = (x: number | undefined) => cardLabel(x ?? 0);
  switch (e.kind) {
    case 'start':
      return mine ? 'Tu commences !' : `${who} commence.`;
    case 'draw':
      // La carte piochée s'affiche déjà au milieu de la table, et la ligne du bas le dit.
      return null;
    case 'swap': {
      const verb = e.source === 'discard' ? (mine ? 'prends' : 'prend') : mine ? 'gardes' : 'garde';
      const what = e.source === 'discard' ? `${le(e.value!)} de la défausse` : le(e.value!);
      if (e.wasHidden) return `${who} ${verb} ${what} à la place d'une carte cachée : c'était ${un(e.old!)}.`;
      return `${who} ${verb} ${what} et ${mine ? 'défausses ton' : 'défausse son'} ${v(e.old)}.`;
    }
    case 'flip':
      if (e.setup) return null;
      return `${who} ${mine ? 'défausses' : 'défausse'} ${le(e.discarded!)} et ${mine ? 'retournes' : 'retourne'} ${un(e.value!)}.`;
    case 'column':
      return `Colonne de ${v(e.value)} ! ${mine ? 'Tu la retires' : `${who} la retire`}.`;
    case 'last':
      return mine ? 'Tu as tout retourné : chacun joue une dernière fois.' : `${who} a tout retourné : dernier tour !`;
    case 'reshuffle':
      return 'La pioche est vide : on remélange la défausse.';
  }
}

/** Le ton du bandeau pour un événement. */
export function eventTone(e: GameEvent): 'good' | 'bad' | 'hot' | 'plain' {
  if (e.kind === 'column') return 'good';
  if (e.kind === 'last') return 'hot';
  if ((e.kind === 'swap' || e.kind === 'flip') && e.value !== undefined && e.value <= 0) return 'good';
  if ((e.kind === 'swap' || e.kind === 'flip') && e.value !== undefined && e.value >= 9) return 'bad';
  return 'plain';
}

export function pts(n: number): string {
  return `${n} pt${Math.abs(n) > 1 ? 's' : ''}`;
}
