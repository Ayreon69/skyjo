// Simulation : des bots entre eux, pour juger leur niveau (npx tsx test/sim.ts 200).
import { botMove, botView, setupPick } from '../server/bots';
import { Game } from '../server/game';

const N = Number(process.argv[2] ?? 200);
for (const players of [2, 3, 4, 6, 8]) {
  let rounds = 0;
  let raw = 0;
  let doubled = 0;
  let turns = 0;
  for (let k = 0; k < N; k++) {
    const order = Array.from({ length: players }, (_, i) => `p${i}`);
    const g = new Game(order, { limit: 100 });
    for (;;) {
      if (g.stage === 'setup') {
        for (const id of order) while ((g.setupLeft.get(id) ?? 0) > 0) g.setupFlip(id, setupPick(botView(g, id).grid));
        continue;
      }
      if (g.stage === 'scores') {
        rounds++;
        for (const l of g.result!.lines) raw += l.raw;
        if (g.result!.lines.some((l) => l.doubled)) doubled++;
        if (g.result!.gameOver) break;
        g.nextRound();
        continue;
      }
      const id = g.current!;
      const m = botMove(botView(g, id));
      if (m.type !== 'draw') turns++;
      const err = m.type === 'draw' ? g.draw(id) : m.type === 'take' ? g.takeDiscard(id, m.index) : m.type === 'swap' ? g.swapDrawn(id, m.index) : g.discardFlip(id, m.index);
      if (err) throw new Error(err);
    }
  }
  console.log(`${players} joueurs : ${(rounds / N).toFixed(1)} manches/partie, ${(raw / rounds / players).toFixed(1)} points/manche/joueur, doublé ${((doubled / rounds) * 100).toFixed(0)} % des manches, ${(turns / rounds / players).toFixed(1)} tours/joueur/manche`);
}
