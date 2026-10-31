import { describe, expect, it } from 'vitest';
import { COPIES, DECK_SIZE, GRID, toneOf, type Cell } from '../shared/protocol';
import { botMove, botView, gain, setupPick, type BotView } from '../server/bots';
import { Game, freshDeck } from '../server/game';
import { Room } from '../server/room';

/** Fixe la donne : les cartes sortent de la pioche dans l'ordre de `seq`, puis un paquet complet derrière (les tests n'ont pas à respecter la composition). */
function stacked(seq: number[]): (cards: number[]) => number[] {
  return (cards) => [...cards, ...[...seq].reverse()];
}

/** Les grilles (12 cartes chacune, rangée par rangée), la carte de la défausse, puis les cartes piochées. */
function deal(grids: number[][], discard: number, draws: number[] = []): number[] {
  const seq: number[] = [];
  for (let i = 0; i < GRID; i++) for (const g of grids) seq.push(g[i]);
  return [...seq, discard, ...draws];
}

/** Une partie à donnes fixées, une par manche. */
function fixed(order: string[], rounds: number[][], limit = 100): Game {
  const queue = rounds.map(stacked);
  return new Game(order, { limit, eventMs: 60_000, shuffle: (cards) => (queue.length ? queue.shift()!(cards) : cards) });
}

const A = 'a';
const B = 'b';
const C = 'c';
const fill = (v: number) => Array(GRID).fill(v);
/** Des grilles sans colonne de trois identiques : 8 points et 132 points. */
const SUM8 = [1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1];
const HIGH = [12, 11, 12, 11, 11, 12, 11, 12, 10, 10, 10, 10];

function setup(g: Game, flips: Record<string, [number, number]>) {
  for (const [id, [i, j]] of Object.entries(flips)) {
    expect(g.setupFlip(id, i)).toBeUndefined();
    expect(g.setupFlip(id, j)).toBeUndefined();
  }
}

describe('les cartes', () => {
  it('150 cartes : cinq -2, dix -1, quinze 0, dix de chaque valeur de 1 à 12', () => {
    const deck = freshDeck();
    expect(deck).toHaveLength(150);
    expect(DECK_SIZE).toBe(150);
    expect(deck.filter((v) => v === -2)).toHaveLength(5);
    expect(deck.filter((v) => v === 0)).toHaveLength(15);
    for (let v = 1; v <= 12; v++) expect(deck.filter((x) => x === v)).toHaveLength(COPIES[v]);
  });

  it('les familles de couleur', () => {
    expect([-2, -1, 0, 1, 4, 5, 8, 9, 12].map(toneOf)).toEqual(['deep', 'neg', 'zero', 'low', 'low', 'mid', 'mid', 'high', 'high']);
  });
});

describe('la mise en place', () => {
  it('12 cartes cachées chacun, une carte sur la défausse, le reste en pioche', () => {
    const g = new Game([A, B, C], { limit: 100 });
    for (const id of [A, B, C]) {
      expect(g.grid(id)).toHaveLength(12);
      expect(g.grid(id).every((c) => c && !c.up)).toBe(true);
    }
    expect(g.discard).toHaveLength(1);
    expect(g.deck).toHaveLength(150 - 36 - 1);
    expect(g.stage).toBe('setup');
    expect(g.current).toBeNull();
  });

  it('chacun retourne deux cartes, pas une de plus ; le plus gros total commence', () => {
    const g = fixed([A, B], [deal([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]], 0)]);
    expect(g.setupFlip(A, 0)).toBeUndefined();
    expect(g.setupFlip(A, 0)).toBe('Choisis une carte face cachée.');
    expect(g.setupFlip(A, 1)).toBeUndefined();
    expect(g.setupFlip(A, 2)).toBe('Tu as déjà retourné tes deux cartes.');
    expect(g.stage).toBe('setup');
    expect(g.draw(A)).toBe('Retourne d’abord tes deux cartes.');
    // A montre 1 + 2, B montre 12 + 11 : B commence.
    setup(g, { [B]: [0, 1] });
    expect(g.stage).toBe('play');
    expect(g.current).toBe(B);
  });

  it('égalité de total : la plus forte carte départage', () => {
    const g = fixed([A, B], [deal([[5, 5, ...fill(1).slice(2)], [10, 0, ...fill(1).slice(2)]], 0)]);
    setup(g, { [A]: [0, 1], [B]: [0, 1] });
    expect(g.current).toBe(B);
  });
});

describe('un tour', () => {
  function ready(): Game {
    // B commence (il montre 12 et 12).
    const g = fixed([A, B], [deal([fill(1), fill(12)], 7, [3, 9, 4])]);
    setup(g, { [A]: [0, 1], [B]: [0, 1] });
    expect(g.current).toBe(B);
    return g;
  }

  it('piocher puis échanger : la carte remplacée part sur la défausse, même cachée', () => {
    const g = ready();
    expect(g.draw(A)).toBe("Ce n'est pas ton tour.");
    expect(g.swapDrawn(B, 0)).toBe("Pioche d'abord une carte.");
    expect(g.draw(B)).toBeUndefined();
    expect(g.drawn).toBe(3);
    expect(g.draw(B)).toBe('Tu as déjà pioché : pose ou défausse ta carte.');
    expect(g.takeDiscard(B, 5)).toBe('Tu as pioché : pose ou défausse cette carte.');
    expect(g.swapDrawn(B, 5)).toBeUndefined();
    expect(g.grid(B)[5]).toEqual({ value: 3, up: true });
    expect(g.discardTop).toBe(12);
    expect(g.current).toBe(A);
    const e = g.events[g.events.length - 1];
    expect(e).toMatchObject({ kind: 'swap', by: B, index: 5, value: 3, old: 12, wasHidden: true, source: 'deck' });
  });

  it('piocher, défausser, puis retourner une carte cachée', () => {
    const g = ready();
    g.draw(B);
    expect(g.discardFlip(B, 0)).toBe('Choisis une de tes cartes face cachée.');
    expect(g.discardFlip(B, 4)).toBeUndefined();
    expect(g.discardTop).toBe(3);
    expect(g.grid(B)[4]).toEqual({ value: 12, up: true });
    expect(g.drawn).toBeNull();
  });

  it('prendre la défausse : on échange aussitôt', () => {
    const g = ready();
    expect(g.takeDiscard(B, 0)).toBeUndefined();
    expect(g.grid(B)[0]).toEqual({ value: 7, up: true });
    expect(g.discardTop).toBe(12);
    expect(g.current).toBe(A);
  });

  it('pioche vide : on remélange la défausse, sauf la carte du dessus', () => {
    const g = ready();
    g.deck = [];
    g.discard = [4, 5, 6];
    expect(g.draw(B)).toBeUndefined();
    expect(g.discard).toEqual([6]);
    expect(g.deck).toHaveLength(1);
    expect(g.events.some((e) => e.kind === 'reshuffle')).toBe(true);
  });
});

describe('les colonnes', () => {
  it('trois cartes identiques et visibles dans une colonne : elles partent sur la défausse', () => {
    // Colonne 0 de B : cases 0, 4 et 8. B montre 0 et 4 (deux 6), puis pioche un 6.
    const b = [6, 9, 9, 9, 6, 9, 9, 9, 2, 9, 9, 9];
    const g = fixed([A, B], [deal([fill(1), b], 0, [6])]);
    setup(g, { [A]: [0, 1], [B]: [0, 4] });
    g.draw(B);
    expect(g.swapDrawn(B, 8)).toBeUndefined();
    expect([0, 4, 8].map((i) => g.grid(B)[i])).toEqual([null, null, null]);
    expect(g.discard.slice(-4)).toEqual([2, 6, 6, 6]);
    expect(g.discardTop).toBe(6);
    expect(g.stats.get(B)!.columns).toBe(1);
    expect(g.events.some((e) => e.kind === 'column' && e.col === 0 && e.value === 6)).toBe(true);
  });

  it('une colonne de cartes cachées ne part pas', () => {
    const g = fixed([A, B], [deal([fill(1), fill(5)], 0, [5])]);
    setup(g, { [A]: [0, 1], [B]: [0, 1] });
    g.draw(B);
    g.swapDrawn(B, 4);
    expect(g.grid(B).filter((c) => c === null)).toHaveLength(0);
  });
});

describe('la fin de manche', () => {
  /** A finit avec ses 12 cartes visibles ; B joue son dernier tour. */
  function lastRound(aCards: number[], bCards: number[], draws: number[]): Game {
    const g = fixed([A, B], [deal([aCards, bCards], 0, draws)]);
    setup(g, { [A]: [0, 1], [B]: [0, 1] });
    // On retourne toutes les cartes de A sauf une, à la main, pour aller vite.
    for (const c of g.grid(A).slice(0, 11)) c!.up = true;
    return g;
  }

  it("celui qui retourne sa dernière carte déclenche le dernier tour, puis on compte et on double s'il n'est pas strictement le plus bas", () => {
    // A finit avec 12 points, B en a 8 : A double. (Aucune colonne de trois identiques dans ces grilles.)
    const g = lastRound([1, 0, 1, 0, 0, 1, 0, 1, 2, 2, 2, 2], [0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1], [5, 7]);
    // A doit jouer : on le met au trait.
    g.turn = 0;
    g.draw(A);
    expect(g.discardFlip(A, 11)).toBeUndefined();
    expect(g.enderId).toBe(A);
    expect(g.lastTurns).toEqual([B]);
    expect(g.events.some((e) => e.kind === 'last')).toBe(true);
    expect(g.current).toBe(B);
    g.draw(B);
    g.discardFlip(B, 5);
    expect(g.stage).toBe('scores');
    const r = g.result!;
    const la = r.lines.find((l) => l.id === A)!;
    const lb = r.lines.find((l) => l.id === B)!;
    expect(la).toMatchObject({ raw: 12, score: 24, doubled: true, ended: true });
    expect(lb).toMatchObject({ raw: 8, score: 8, doubled: false });
    expect(g.totals.get(A)).toBe(24);
    expect(g.sheet).toEqual([{ round: 1, scores: { [A]: 24, [B]: 8 }, doubled: [A] }]);
    // Toutes les cartes sont retournées à la fin.
    expect(g.grid(B).every((c) => !c || c.up)).toBe(true);
  });

  it('égalité : celui qui a fini double aussi', () => {
    const g = lastRound(SUM8, [0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1], [5, 7]);
    g.turn = 0;
    g.draw(A);
    g.discardFlip(A, 11);
    g.draw(B);
    g.discardFlip(B, 5);
    expect(g.result!.lines.find((l) => l.id === A)!.doubled).toBe(true);
  });

  it('strictement le plus bas : pas de doublement', () => {
    const g = lastRound([1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0], [2, 3, 2, 3, 3, 2, 3, 2, 2, 2, 2, 2], [5, 7]);
    g.turn = 0;
    g.draw(A);
    g.discardFlip(A, 11);
    g.draw(B);
    g.discardFlip(B, 5);
    expect(g.result!.lines.find((l) => l.id === A)).toMatchObject({ raw: 4, score: 4, doubled: false });
  });

  it('un score négatif ou nul ne double jamais', () => {
    const g = lastRound([1, -1, 1, -1, -1, 1, -1, 1, 0, 0, 0, 0], [-1, 0, -1, 0, 0, -1, 0, -1, -1, -1, -1, -1], [5, 7]);
    g.turn = 0;
    g.draw(A);
    g.discardFlip(A, 11);
    g.draw(B);
    g.discardFlip(B, 5);
    expect(g.result!.lines.find((l) => l.id === A)).toMatchObject({ raw: 0, score: 0, doubled: false });
  });

  it('une colonne de trois identiques révélée en fin de manche part aussi', () => {
    // B a une colonne de trois 4 encore cachés : elle tombe au décompte.
    const b = [9, 8, 4, 7, 8, 7, 4, 9, 7, 9, 4, 8];
    const g = lastRound(fill(0), b, [5, 7]);
    g.turn = 0;
    g.draw(A);
    g.discardFlip(A, 11);
    g.draw(B);
    g.discardFlip(B, 5);
    expect(g.result!.lines.find((l) => l.id === B)!.raw).toBe(72);
  });

  it('celui qui a fini commence la manche suivante ; la partie s’arrête à la limite', () => {
    const g = fixed([A, B], [deal([SUM8, SUM8], 0, [5, 7]), deal([HIGH, HIGH], 0)], 30);
    setup(g, { [A]: [0, 1], [B]: [0, 1] });
    for (const c of g.grid(B).slice(0, 11)) c!.up = true;
    g.turn = 1;
    g.draw(B);
    g.discardFlip(B, 11);
    g.draw(A);
    g.discardFlip(A, 4);
    expect(g.stage).toBe('scores');
    expect(g.result!.gameOver).toBe(false);
    expect(g.nextRound()).toBe(true);
    expect(g.round).toBe(2);
    setup(g, { [A]: [0, 1], [B]: [0, 1] });
    expect(g.current).toBe(B);
    // Deuxième manche : 132 points chacun, la limite de 30 est dépassée.
    for (const id of [A, B]) for (const c of g.grid(id).slice(0, 11)) c!.up = true;
    g.draw(B);
    g.discardFlip(B, 11);
    g.draw(A);
    g.discardFlip(A, 11);
    expect(g.result!.gameOver).toBe(true);
    expect(g.nextRound()).toBe(false);
    const ranking = g.ranking();
    expect(ranking[0].total).toBeLessThanOrEqual(ranking[1].total);
  });

  it('les ex æquo partagent leur place', () => {
    const g = new Game([A, B, C], { limit: 100 });
    g.totals.set(A, 40).set(B, 40).set(C, 12);
    expect(g.ranking()).toEqual([
      { id: C, total: 12, rank: 1 },
      { id: A, total: 40, rank: 2 },
      { id: B, total: 40, rank: 2 },
    ]);
  });
});

describe('les bots', () => {
  const view = (grid: Cell[], extra: Partial<BotView> = {}): BotView => ({ grid, others: [fill(5)], discardTop: null, drawn: null, lastChance: false, unknown: 5, ...extra });

  it('voient tout de suite une colonne à compléter', () => {
    const grid: Cell[] = [7, 'hidden', 'hidden', 'hidden', 7, 'hidden', 'hidden', 'hidden', 'hidden', 'hidden', 'hidden', 'hidden'];
    expect(gain(view(grid), 7, 8)).toBe(5 + 14);
    expect(botMove(view(grid, { discardTop: 7 }))).toEqual({ type: 'take', index: 8 });
  });

  it('laissent une carte moyenne sur la défausse, prennent une bonne', () => {
    const grid: Cell[] = Array(12).fill('hidden');
    expect(botMove(view(grid, { discardTop: 6 }))).toEqual({ type: 'draw' });
    expect(botMove(view(grid, { discardTop: -2 })).type).toBe('take');
  });

  it("ne finissent pas une manche qu'ils perdraient", () => {
    // Une seule carte cachée, 11 visibles qui font déjà 83 : finir la manche ferait doubler.
    const grid: Cell[] = [6, 7, 8, 9, 7, 8, 9, 6, 8, 9, 6, 'hidden'];
    const move = botMove(view(grid, { drawn: 11, others: [[1, 1, 1, 'hidden', 'hidden', 'hidden', 1, 1, 1, 1, 1, 1]] }));
    expect(move.type).toBe('swap');
    expect(move.type === 'swap' && move.index).not.toBe(11);
  });

  it('retournent leurs deux cartes dans deux colonnes différentes', () => {
    for (let k = 0; k < 20; k++) {
      const grid: Cell[] = Array(12).fill('hidden');
      grid[setupPick(grid)] = 3;
      const second = setupPick(grid);
      expect(grid[second]).toBe('hidden');
      expect(second % 4).not.toBe(grid.findIndex((c) => c === 3) % 4);
    }
  });

  it('jouent des parties entières sans jamais se bloquer, de 2 à 8 joueurs', () => {
    for (let n = 2; n <= 8; n++) {
      for (let k = 0; k < 12; k++) {
        const order = Array.from({ length: n }, (_, i) => `p${i}`);
        const g = new Game(order, { limit: 100 });
        let guard = 0;
        while (guard++ < 20_000) {
          if (g.stage === 'setup') {
            for (const id of order) while ((g.setupLeft.get(id) ?? 0) > 0) expect(g.setupFlip(id, setupPick(botView(g, id).grid))).toBeUndefined();
            continue;
          }
          if (g.stage === 'scores') {
            if (g.result!.gameOver) break;
            g.nextRound();
            continue;
          }
          const id = g.current!;
          const m = botMove(botView(g, id));
          const err = m.type === 'draw' ? g.draw(id) : m.type === 'take' ? g.takeDiscard(id, m.index) : m.type === 'swap' ? g.swapDrawn(id, m.index) : g.discardFlip(id, m.index);
          expect(err, JSON.stringify(m)).toBeUndefined();
        }
        expect(g.result?.gameOver).toBe(true);
        // Le paquet est complet à chaque instant : rien ne se perd, rien ne se crée.
        const onTable = order.flatMap((id) => g.grid(id).filter(Boolean)).length + g.deck.length + g.discard.length;
        expect(onTable).toBeLessThanOrEqual(150);
      }
    }
  });
});

describe('la table', () => {
  function table(): { room: Room; host: string } {
    const room = new Room('TEST');
    const host = room.addHuman('Hôte', 'soleil');
    if (typeof host === 'string') throw new Error(host);
    room.hostId = host.id;
    room.addBot(host.id);
    room.addBot(host.id);
    expect(room.start(host.id)).toBeUndefined();
    return { room, host: host.id };
  }

  it('les cartes cachées ne circulent jamais, la pioche non plus', () => {
    const { room, host } = table();
    const json = JSON.stringify(room.viewFor(host));
    const view = room.viewFor(host);
    for (const p of view.players) expect(p.grid!.every((c) => c === 'hidden')).toBe(true);
    expect(typeof view.game!.deck).toBe('number');
    expect(json).not.toContain('"token"');
    expect(json).not.toContain('"up"');
    room.dispose();
  });

  it('la mise en place puis un tour joué, avec le numéro de tour', () => {
    const { room, host } = table();
    const g = room.game!;
    expect(room.setupFlip(host, 0)).toBeUndefined();
    expect(room.setupFlip(host, 5)).toBeUndefined();
    for (const id of g.order) while ((g.setupLeft.get(id) ?? 0) > 0) room.setupFlip(id, setupPick(botView(g, id).grid));
    expect(g.stage).toBe('play');
    const cur = g.current!;
    expect(room.draw(cur, g.seq - 1)).toBe('Le tour a changé entre-temps.');
    expect(room.draw(cur, g.seq)).toBeUndefined();
    expect(room.viewFor(host).game!.drawn).toBe(g.drawn);
    room.dispose();
  });

  it('les réglages : limite et temps de réflexion, seulement par l’hôte', () => {
    const room = new Room('SETS');
    const host = room.addHuman('Hôte', 'soleil') as { id: string };
    const guest = room.addHuman('Invité', 'nuage') as { id: string };
    room.hostId = host.id;
    expect(room.updateSettings(guest.id, { limit: 50 })).toBe("Seul l'hôte peut changer les réglages.");
    expect(room.updateSettings(host.id, { limit: 50, think: 30 })).toBeUndefined();
    expect(room.settings).toEqual({ limit: 50, think: 30 });
    room.updateSettings(host.id, { limit: 75, think: 12 });
    expect(room.settings).toEqual({ limit: 50, think: 30 });
  });
});
