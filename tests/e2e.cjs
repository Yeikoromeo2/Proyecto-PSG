/*
 * Prueba de punta a punta del ayudante contra una copia local del juego.
 *
 *   node tests/e2e.cjs /ruta/a/pokesurvivor [carpeta-capturas]
 *
 * La copia del juego NO va en este repositorio (es de su autor, ver README).
 * Sirve la carpeta en un servidor local, carga el userscript antes que la página
 * (como «document-start»), empieza una partida como invitado, abre cartas de nivel
 * y comprueba el selector, el modo automático, el modo libre y el bloqueo del ranking.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const GAME = path.resolve(process.argv[2] || '');
const SHOTS = process.argv[3] ? path.resolve(process.argv[3]) : null;
const SCRIPT = path.join(__dirname, '..', 'pokesurvivor-ayudante.user.js');
if (!fs.existsSync(path.join(GAME, 'index.html'))) { console.error('Uso: node tests/e2e.cjs /ruta/a/pokesurvivor'); process.exit(2); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
                '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let f = path.join(GAME, p);
  if (!f.startsWith(GAME)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
});

let failed = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FALLO ') + msg); if (!ok) failed++; };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: SHOTS ? 2 : 1, hasTouch: true, locale: 'es-ES' });
  page.on('pageerror', e => console.log('  [error de la página]', e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());       // sin red: modo local
  await page.addInitScript({ path: SCRIPT });
  await page.goto(url);

  await page.waitForFunction(() => window.__psgMod && window.__psgMod.version, null, { timeout: 30000 });
  check(true, 'el ayudante se instala (' + await page.evaluate(() => window.__psgMod.version) + ')');
  // Pantalla «toca para empezar» (la pide el navegador para el sonido).
  await page.locator('#tap-start').click({ timeout: 3000 }).catch(() => {});
  await page.waitForFunction(() => { const t = document.getElementById('tap-start'); return !t || t.offsetParent === null; }, null, { timeout: 5000 })
    .catch(() => page.evaluate(() => document.getElementById('tap-start').remove()));

  // Invitado con una pequeña colección.
  await page.evaluate(() => {
    G.DB.playAsGuest();
    const s = G.DB.save;
    for (const d of [1, 4, 7, 25, 94, 130, 149, 448, 445, 658]) s.owned[d] = { at: Date.now(), from: 'gacha' };
    s.partner = 25;
  });
  // Naturaleza que baja justo el ataque con el que pega su plan (Firme si es especial, Modesta si es físico).
  await page.evaluate(() => {
    const side = window.__psgMod.analyzer.analyze(25).side;
    G.DB.save.pnat[25] = [side === 'special' ? 'adamant' : 'modest', Date.now()];
  });

  // 0) Analizador de colección.
  check(await page.evaluate(() => !!document.getElementById('psg-an-btn')), 'botón «Analizador PSG» en el menú principal');
  await page.evaluate(() => window.__psgMod.analyzer.open());
  const an = await page.evaluate(() => ({
    rows: document.querySelectorAll('#psg-an .psg-row').length,
    owned: Object.keys(G.DB.save.owned).length,
    pika: (() => { const r = window.__psgMod.analyzer.analyze(25); return { natV: r.natV, side: r.side, best: r.bestNat.id, plan: r.plan.length, evo: r.evoStats, ab: r.abV }; })()
  }));
  check(an.rows === an.owned, `una fila por Pokémon de la colección (${an.rows}/${an.owned})`);
  check(an.pika.plan === 4, 'plan de 4 ataques');
  const goodFor = an.pika.side === 'special' ? ['modest', 'mild'] : ['adamant', 'lonely'];
  check(an.pika.natV === 'mala' && goodFor.includes(an.pika.best),
    `naturaleza que baja su ataque principal → «mala» y Menta que lo sube (${an.pika.side}: ${an.pika.natV}, ${an.pika.best})`);
  console.log('       Pikachu → mejoras para evolucionar:', an.pika.evo.join(', '), '· habilidad:', an.pika.ab);
  await page.click('#psg-an .psg-row[data-dex="25"]');
  const det = await page.evaluate(() => [...document.querySelectorAll('#psg-an .psg-det h4')].map(h => h.textContent.trim()));
  check(det.length === 3, 'detalle con naturaleza, habilidad y plan: ' + det.join(' | '));
  if (SHOTS) {
    await page.screenshot({ path: path.join(SHOTS, 'analizador.png') });
    await page.setViewportSize({ width: 412, height: 915 });
    await page.screenshot({ path: path.join(SHOTS, 'analizador-vertical.png') });
    await page.evaluate(() => document.querySelectorAll('#psg-an .psg-det .psg-sec')[2].scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, 'analizador-plan.png') });
    await page.setViewportSize({ width: 915, height: 412 });
  }
  await page.evaluate(() => window.__psgMod.analyzer.close());

  // Partida con Pikachu.
  await page.evaluate(() => G.Game.startRun());
  await page.waitForFunction(() => G.Game.state === 'playing' && G.Game.player, null, { timeout: 15000 });

  const openCards = async () => {
    await page.evaluate(() => G.Game.debugLevelUp());
    await page.waitForFunction(() => document.querySelectorAll('#cards .card .psg-badge').length === document.querySelectorAll('#cards .card').length
      && document.querySelectorAll('#cards .card').length > 0, null, { timeout: 10000 });
  };

  // 1) Selector: cada carta lleva su motivo y una sale recomendada.
  await openCards();
  const info = await page.evaluate(() => ({
    cards: document.querySelectorAll('#cards .card').length,
    best: document.querySelectorAll('#cards .card.psg-best').length,
    badges: [...document.querySelectorAll('#cards .psg-badge')].map(b => b.textContent),
    bar: !!document.getElementById('psg-bar')
  }));
  check(info.cards === 3 && info.best === 1, `3 cartas y 1 recomendada (${info.cards}/${info.best})`);
  check(info.bar, 'barra con los interruptores en la pantalla de cartas');
  console.log('       motivos:', info.badges.join(' | '));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'cartas-seleccion.png') });

  // 2) Automático: al encenderlo elige sola la recomendada.
  const before = await page.evaluate(() => ({ moves: G.Game.player.moves.length, stats: JSON.stringify(G.Game.player.statsTaken),
    lv: G.Game.player.moves.map(m => m.lvl).join(',') }));
  await page.click('#psg-bar [data-k="auto"]');
  await page.waitForFunction(() => document.getElementById('scr-levelup').classList.contains('hidden'), null, { timeout: 5000 })
    .then(() => check(true, 'modo automático: eligió la carta y cerró la pantalla'),
          () => check(false, 'modo automático: no eligió la carta'));
  const after = await page.evaluate(() => ({ moves: G.Game.player.moves.length, stats: JSON.stringify(G.Game.player.statsTaken),
    lv: G.Game.player.moves.map(m => m.lvl).join(',') }));
  check(JSON.stringify(before) !== JSON.stringify(after), 'la carta elegida se aplicó al Pokémon');
  await page.click('body').catch(() => {});
  await page.evaluate(() => { window.__psgMod.cfg.auto = false; });

  // 3) Modo libre: ofrece las mejores cartas posibles y marca la partida.
  await openCards();
  check(!(await page.evaluate(() => window.__psgMod.forced)), 'sin modo libre, la partida no está marcada');
  await page.click('#psg-bar [data-k="free"]');
  await page.waitForFunction(() => document.querySelector('#psg-bar .psg-note').textContent.length > 0, null, { timeout: 5000 });
  const free = await page.evaluate(() => {
    const pool = window.__psgMod.fullPool().map(c => window.__psgMod.score(c, G.Game.player)[0]).sort((a, b) => b - a);
    const shownBadges = [...document.querySelectorAll('#cards .psg-badge')].map(b => b.textContent);
    return { forced: window.__psgMod.forced, pool: pool.length, top: pool.slice(0, 3), shownBadges };
  });
  check(free.forced, 'modo libre: la partida queda marcada');
  check(free.pool >= 3, `modo libre: conoce todas las cartas posibles (${free.pool})`);
  console.log('       mejores puntuaciones posibles:', free.top.join(', '), '|', free.shownBadges.join(' | '));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'cartas-modo-libre.png') });

  // 4) Ranking: en una partida marcada no se sube nada.
  const sent = await page.evaluate(() => G.Ranking.submitSolo({ t: 999, lv: 1, kills: 0, dmg: 0, dex: 25, shiny: false }));
  check(sent === null, 'modo libre: el ranking queda bloqueado para esta partida');

  // 5) Ajustes guardados.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('psg.mod.v1') || '{}'));
  check(saved.free === true, 'los interruptores se recuerdan en el navegador');

  await browser.close();
  server.close();
  console.log(failed ? `\n${failed} comprobación(es) fallida(s)` : '\nTodo bien');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
