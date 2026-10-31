// Test de bout en bout : 3 humains (socket.io) + 2 bots jouent une partie complète sur le serveur compilé.
// Un spectateur arrive en cours de route, un joueur se déconnecte puis revient. Usage : npm run build && npm run e2e
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';

const PORT = 3900 + Math.floor(Math.random() * 90);
const URL = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['dist/server/index.mjs'], {
  env: { ...process.env, PORT: String(PORT), SK_FAST: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  server.kill();
  process.exit(1);
};
setTimeout(() => fail('délai dépassé (3 min)'), 180_000).unref();

await new Promise((resolve) => server.stdout.on('data', (d) => String(d).includes('prêt') && resolve()));

const stats = { states: 0, moves: 0, takes: 0, draws: 0, swaps: 0, flips: 0, columns: new Set(), rounds: new Set(), refused: 0, starters: [] };
const known = new Map();

function client(name, { player = true, avatar = 'soleil' } = {}) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { name, socket, view: null, avatar, player, session: null };
  socket.on('state', (v) => {
    c.view = v;
    audit(c, v);
    if (c.player) play(c);
  });
  c.call = (event, payload = {}) => new Promise((res) => socket.emit(event, payload, res));
  return c;
}

/** Vérifie ce que chaque client reçoit : jamais une carte cachée, jamais la pioche, jamais un historique. */
function audit(c, v) {
  stats.states++;
  const json = JSON.stringify(v);
  for (const word of ['"token"', '"up"', '"setupDue"', '"starterNext"']) if (json.includes(word)) fail(`la vue contient ${word}`);
  const g = v.game;
  if (v.phase !== 'playing' || !g) return;
  if (typeof g.deck !== 'number') fail('la pioche circule');
  if (g.events.length > 4) fail('trop d’événements : on dirait un historique');
  for (const e of g.events) if (e.until < v.serverNow - 50) fail('un événement expiré circule encore');
  for (const e of g.events) if (e.kind === 'column') stats.columns.add(`${g.round}:${e.id}`);
  for (const e of g.events) if (e.kind === 'start' && !stats.starters.some((x) => x.round === g.round)) stats.starters.push({ round: g.round, id: e.by, prevEnder: c.lastEnder });
  if (g.result) c.lastEnder = g.result.enderId;
  stats.rounds.add(g.round);
  for (const p of v.players) {
    if (!g.order.includes(p.id)) continue;
    if (!Array.isArray(p.grid) || p.grid.length !== 12) fail(`grille de ${p.name} invalide`);
    for (const cell of p.grid) if (!(cell === null || cell === 'hidden' || (Number.isInteger(cell) && cell >= -2 && cell <= 12))) fail(`case invalide ${cell}`);
    // Une carte visible ne redevient jamais cachée pendant une manche (chaque client reçoit ses états dans l'ordre).
    const key = `${c.name}:${g.round}:${p.id}`;
    const before = known.get(key);
    if (before && g.stage !== 'setup') before.forEach((cell, i) => typeof cell === 'number' && p.grid[i] === 'hidden' && fail(`une carte de ${p.name} s'est recachée`));
    known.set(key, [...p.grid]);
  }
  if (g.stage === 'scores' && g.result) {
    for (const p of v.players) if (g.order.includes(p.id) && p.grid.some((x) => x === 'hidden')) fail('une carte reste cachée au décompte');
    for (const l of g.result.lines) if (l.doubled && (l.raw <= 0 || !l.ended)) fail('doublement injustifié');
  }
}

const busy = new Set();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Un joueur pressé : il garde les petites cartes, chasse les grosses, et retourne au hasard. */
function play(c) {
  const v = c.view;
  const g = v?.game;
  if (!v || v.phase !== 'playing' || !g) return;
  const me = v.players.find((p) => p.id === v.me);
  if (!me || !g.order.includes(v.me)) return;
  const cells = me.grid.map((x, i) => ({ x, i }));
  const hidden = cells.filter((o) => o.x === 'hidden').map((o) => o.i);
  const filled = cells.filter((o) => o.x !== null).map((o) => o.i);
  const key = `${c.name}:${g.round}:${g.stage}:${g.seq}:${me.setupLeft}`;
  if (busy.has(key)) return;
  const send = (event, payload) => {
    busy.add(key);
    c.socket.emit(event, payload, (res) => {
      if (!res?.ok) stats.refused++;
    });
  };
  if (g.stage === 'setup' && me.setupLeft > 0) return send('game:setup', { index: pick(hidden) });
  if (g.stage === 'scores' && !me.ready) {
    // L'un des joueurs traîne : la table l'attend, puis repart sans lui.
    if (c.name === 'Chloé' && Math.random() < 0.5) return;
    return send('game:ready', {});
  }
  if (g.stage !== 'play' || g.turnId !== v.me) return;
  stats.moves++;
  const worst = filled.filter((i) => me.grid[i] !== 'hidden').sort((a, b) => me.grid[b] - me.grid[a])[0];
  const placeFor = (card) => (worst !== undefined && me.grid[worst] > card + 2 ? worst : card <= 4 && hidden.length ? pick(hidden) : null);
  if (g.drawn === null) {
    const spot = g.discardTop !== null ? placeFor(g.discardTop) : null;
    if (spot !== null && Math.random() < 0.8) {
      stats.takes++;
      return send('game:take', { index: spot, seq: g.seq });
    }
    stats.draws++;
    return send('game:draw', { seq: g.seq });
  }
  const spot = placeFor(g.drawn);
  if (spot === null && hidden.length) {
    stats.flips++;
    return send('game:flip', { index: pick(hidden), seq: g.seq });
  }
  stats.swaps++;
  return send('game:swap', { index: spot ?? pick(filled), seq: g.seq });
}

const host = client('Ana');
await new Promise((r) => host.socket.on('connect', r));
const created = await host.call('room:create', { name: 'Ana', avatar: 'soleil', bots: 2 });
if (!created.ok) fail(`création : ${created.error}`);
const code = created.data.code;
const bob = client('Bob');
const chloe = client('Chloé');
await Promise.all([bob, chloe].map((c) => new Promise((r) => c.socket.on('connect', r))));
for (const c of [bob, chloe]) {
  const res = await c.call('room:join', { code, name: c.name, avatar: 'nuage' });
  if (!res.ok) fail(`arrivée de ${c.name} : ${res.error}`);
  c.session = res.data;
}
const settings = await host.call('room:settings', { limit: 100, think: 30 });
if (!settings.ok) fail('réglages refusés');
const refused = await bob.call('room:settings', { limit: 100 });
if (refused.ok) fail("un invité a changé les réglages");
const start = await host.call('game:start');
if (!start.ok) fail(`lancement : ${start.error}`);

// Un spectateur arrive en cours de partie : il voit tout ce qui est visible, rien de caché.
await new Promise((r) => setTimeout(r, 400));
const watcher = client('Dora', { player: false });
await new Promise((r) => watcher.socket.on('connect', r));
const joined = await watcher.call('room:join', { code, name: 'Dora', avatar: 'lune' });
if (!joined.ok) fail(`spectateur : ${joined.error}`);
if (watcher.view && watcher.view.players.find((p) => p.name === 'Dora')?.status !== 'spectator') fail('le retardataire devrait regarder');

// Bob se déconnecte un moment, puis revient avec sa session.
await new Promise((r) => setTimeout(r, 600));
bob.socket.disconnect();
await new Promise((r) => setTimeout(r, 1200));
bob.socket.connect();
await new Promise((r) => bob.socket.on('connect', r));
const back = await bob.call('room:join', { code, playerId: bob.session.playerId, token: bob.session.token, resumeOnly: true });
if (!back.ok) fail(`retour de Bob : ${back.error}`);

await new Promise((resolve) => {
  const check = setInterval(() => {
    if (host.view?.phase === 'finished') {
      clearInterval(check);
      resolve();
    }
  }, 100);
});

const final = host.view.final;
if (!final || final.players.length !== 5) fail('classement incomplet');
const totals = final.players.map((p) => p.total);
if (totals.some((t, i) => i > 0 && t < totals[i - 1])) fail('classement mal trié');
if (!final.players.some((p) => p.total >= 100)) fail('la partie a fini avant la limite');
if (final.rounds < 2) fail('une seule manche : les transitions ne sont pas testées');
for (const s of stats.starters) if (s.round > 1 && s.prevEnder && s.id !== s.prevEnder) fail(`manche ${s.round} : ce n'est pas celui qui a fini qui commence`);
if (final.players.some((p) => p.rounds.reduce((a, b) => a + b, 0) !== p.total)) fail('la feuille de marque ne tombe pas juste');

const again = await host.call('game:restart');
if (!again.ok || (await new Promise((r) => setTimeout(() => r(host.view.phase), 200))) !== 'lobby') fail('la revanche ne ramène pas au salon');

console.log(
  `✓ partie complète : ${final.rounds} manches, ${stats.moves} coups joués par les humains (${stats.draws} pioches, ${stats.takes} défausses prises, ${stats.swaps} échanges, ${stats.flips} retournements), ${stats.columns.size} colonne(s) retirée(s), ${stats.refused} coups refusés (tour passé), ${stats.states} états vérifiés sans fuite.`,
);
console.log(`  classement : ${final.players.map((p) => `${p.rank}. ${p.name} (${p.total})`).join(', ')}`);
for (const c of [host, bob, chloe, watcher]) c.socket.close();
server.kill();
process.exit(0);
