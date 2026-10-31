// La feuille de marque, comme sur papier : une ligne par manche, une colonne par joueur, le total en bas.
import type { RoomView } from '../../../shared/protocol';
import { cls } from '../lib/util';
import { Avatar, Modal } from './Ui';

export function SheetTable({ view, compact }: { view: RoomView; compact?: boolean }) {
  const g = view.game;
  const final = view.final;
  const ids = final ? final.players.map((p) => p.id) : (g?.order ?? []);
  const rows = final ? final.players[0]?.rounds.map((_, r) => ({ round: r + 1, scores: Object.fromEntries(final.players.map((p) => [p.id, p.rounds[r]])), doubled: [] as string[] })) ?? [] : (g?.sheet ?? []);
  const doubled = new Set(g?.sheet.flatMap((s) => s.doubled.map((id) => `${s.round}:${id}`)) ?? []);
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? final?.players.find((p) => p.id === id)?.name ?? '?';
  const avatar = (id: string) => view.players.find((p) => p.id === id)?.avatar ?? final?.players.find((p) => p.id === id)?.avatar ?? 'soleil';
  const totals = Object.fromEntries(ids.map((id) => [id, rows.reduce((n, r) => n + (r.scores[id] ?? 0), 0)]));
  const best = Math.min(...ids.map((id) => totals[id]));
  const limit = view.settings.limit;

  if (!rows.length) return <p className="muted small sheet-empty">Aucune manche terminée pour l'instant. Les points s'inscrivent à la fin de chaque manche.</p>;
  return (
    <div className={cls('sheet-scroll', compact && 'is-compact')}>
      <table className="score-table">
        <thead>
          <tr>
            <th scope="col" className="sheet-round">
              <span className="sr-only">Manche</span>
            </th>
            {ids.map((id) => (
              <th key={id} scope="col" className={cls(id === view.me && 'is-me')}>
                <Avatar avatar={avatar(id)} className="sheet-avatar" />
                <span className="sheet-name">{id === view.me ? 'Toi' : name(id)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.round}>
              <th scope="row" className="sheet-round">
                M{r.round}
              </th>
              {ids.map((id) => (
                <td key={id} className={cls(id === view.me && 'is-me', doubled.has(`${r.round}:${id}`) && 'is-doubled')}>
                  {r.scores[id] ?? '–'}
                  {doubled.has(`${r.round}:${id}`) && <small className="x2">×2</small>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="sheet-round">
              Total
            </th>
            {ids.map((id) => (
              <td key={id} className={cls(id === view.me && 'is-me', totals[id] === best && 'is-best', totals[id] >= limit && 'is-over')}>
                {totals[id]}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function ScoreSheet({ view, open, onClose }: { view: RoomView; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Feuille de marque" wide>
      <SheetTable view={view} />
      <p className="muted small sheet-note">La partie s'arrête à la fin de la manche où quelqu'un atteint {view.settings.limit} points. Le plus petit total gagne.</p>
    </Modal>
  );
}
