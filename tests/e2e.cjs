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
  // Con el juego «encerrado» (como el publicado) no hay window.G: el script lo deja en window.G sólo para las pruebas.
  await page.addInitScript(() => { window.__psgTest = true; });
  if (process.env.PSG_SIM_XRAY) {
    // Simula el «modo content» de Firefox (Violentmonkey con la CSP del juego): unsafeWindow distinto de
    // window y exportFunction/cloneInto presentes. No reproduce la seguridad real de las Xray, pero recorre
    // el mismo camino del código (exportar funciones, copiar listas, devolver listas del juego).
    //   PSG_SIM_XRAY=1  unsafeWindow es la ventana del juego (Tampermonkey en Firefox)
    //   PSG_SIM_XRAY=2  unsafeWindow es la ventana aislada y el juego sólo se ve por window.wrappedJSObject
    //                   (lo que pasó con Violentmonkey en Firefox Android con la 0.6.0)
    const src = fs.readFileSync(SCRIPT, 'utf8');
    const v2 = process.env.PSG_SIM_XRAY === '2';
    await page.addInitScript(`window.__psgSimXray = true;
      (function () {
        const real = window;
        const isolated = new Proxy(real, { get(t, k) {
          if (k === 'G' || k === '__psgMod' || k === '__psgModVersion') return undefined;   // la ventana aislada no ve lo del juego
          if (k === 'wrappedJSObject') return ${v2 ? 't' : 'undefined'};
          const v = Reflect.get(t, k, t); return typeof v === 'function' ? v.bind(t) : v; } });
        (function (window, unsafeWindow, exportFunction, cloneInto) {\n${src}\n})(isolated, ${v2 ? 'isolated' : 'real'}, f => f, (o, t, opt) => (opt && opt.cloneFunctions ? o : JSON.parse(JSON.stringify(o))));
      })();`);
    console.log('  (simulando el modo content de Firefox, variante ' + (v2 ? 2 : 1) + ')');
  } else await page.addInitScript({ path: SCRIPT });
  await page.goto(url);

  await page.waitForFunction(() => window.__psgMod && window.__psgMod.version, null, { timeout: 30000 });
  check(true, 'el ayudante se instala (' + await page.evaluate(() => window.__psgMod.version + ', modo ' + window.__psgMod.mode) + ')');
  const pillTxt = await page.evaluate(() => (document.querySelector('[data-psg-status]') || {}).textContent || '');
  check(/✓ funcionando/.test(pillTxt), 'indicador de estado: «' + pillTxt + '»');
  // Pantalla «toca para empezar» (la pide el navegador para el sonido).
  await page.locator('#tap-start').click({ timeout: 3000 }).catch(() => {});
  await page.waitForFunction(() => { const t = document.getElementById('tap-start'); return !t || t.offsetParent === null; }, null, { timeout: 5000 })
    .catch(() => page.evaluate(() => document.getElementById('tap-start').remove()));

  // Invitado con una pequeña colección.
  await page.evaluate(() => {
    G.DB.playAsGuest();
    const s = G.DB.save;
    for (const d of [1, 4, 7, 25, 94, 130, 143, 149, 448, 445, 658]) s.owned[d] = { at: Date.now(), from: 'gacha' };
    s.partner = 25;
  });
  // Naturaleza que baja justo el ataque con el que pega su plan (Firme si es especial, Modesta si es físico).
  await page.evaluate(() => {
    const side = window.__psgMod.analyzer.analyze(25).side;
    G.DB.save.pnat[25] = [side === 'special' ? 'adamant' : 'modest', Date.now()];
  });

  // 0) Analizador de colección.
  check(await page.evaluate(() => !!document.getElementById('psg-an-btn')), 'botón «Analizador PSG» en el menú principal');
  const migBtn = await page.evaluate(() => {
    const b = document.getElementById('psg-mig-btn');
    if (!b) return 'sin botón';
    b.click();
    const an = document.getElementById('psg-an'), d = document.querySelector('#psg-an .psg-mig');
    const ok = an && !an.classList.contains('psg-hidden') && d && d.open;
    window.__psgMod.analyzer.close();
    return ok ? 'ok' : 'no se abrió';
  });
  check(migBtn === 'ok', 'botón «⇄ Copia de partida» en el menú: abre la copia de seguridad desplegada (' + migBtn + ')');
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
  check(det.length === 7, 'detalle con stats de fábrica, combinación, naturaleza, habilidad, aguante, objetos y plan: ' + det.join(' | '));
  // Potenciadores, vínculos y objetos en el plan (Pikachu pega con especiales: Maquinación le sube todo).
  const fx = await page.evaluate(() => {
    const r = window.__psgMod.analyzer.analyze(25);
    const plain = r.plan.filter(m => !m.buff).reduce((a, m) => a + m.score, 0) * r.perkK;
    return { buffs: r.plan.filter(m => m.buff).map(m => m.id), bonds: r.bonds.length, steps: r.steps.map(Math.round),
      power: Math.round(r.power), plain: Math.round(plain), solo: Math.round(r.solo), items: r.items.map(i => i.id),
      top: r.items[0].name, html: document.querySelector('#psg-an .psg-det').textContent };
  });
  check(fx.buffs.includes('nasty-plot'), 'el plan de Pikachu (especial) lleva Maquinación: ' + fx.buffs.join(', '));
  check(fx.power > fx.plain, `Maquinación fusionada multiplica el daño del grupo (${fx.power} > ${fx.plain} sin ella)`);
  check(fx.bonds === 4 && fx.steps.every((v, i) => !i || v >= fx.steps[i - 1]) && fx.solo < fx.power,
    `orden de vínculos y daño con cada uno (${fx.steps.join(' → ')})`);
  check(fx.items.length === 11 && /Vínculos/.test(fx.html) && /Sólo funciona en el MISMO hueco/.test(fx.html) && /Objeto que más le conviene/.test(fx.html),
    'el detalle explica vínculos, potenciadores y objetos (mejor objeto: ' + fx.top + ')');
  const tough = await page.evaluate(() => {
    const A = window.__psgMod.analyzer;
    const sc = document.querySelector('#psg-an .psg-scale');           // barras sobre tu colección: el primero es 100
    sc.value = 'col'; sc.dispatchEvent(new Event('change', { bubbles: true }));
    const sel = document.querySelector('#psg-an .psg-sort');
    sel.value = 'tough'; sel.dispatchEvent(new Event('change'));
    const first = document.querySelector('#psg-an .psg-row');
    return { bars: document.querySelectorAll('#psg-an .psg-row .psg-bar.tough').length, rows: document.querySelectorAll('#psg-an .psg-row').length,
      firstT: first.querySelector('.psg-bar.tough span').textContent, snorlax: Math.round(A.analyze(143).tough), pika: Math.round(A.analyze(25).tough),
      firstName: first.querySelector('.psg-row-name').textContent.trim() };
  });
  check(tough.bars === tough.rows && /100/.test(tough.firstT), `barra de aguante en cada fila y orden «Más aguante» (primero: ${tough.firstName})`);
  check(tough.snorlax > tough.pika, `Snorlax aguanta más que Pikachu (${tough.snorlax} > ${tough.pika})`);
  await page.evaluate(() => { const sel = document.querySelector('#psg-an .psg-sort'); sel.value = 'power'; sel.dispatchEvent(new Event('change')); });

  // Todo el juego: puestos, filtros como los de la Pokédex y «de fábrica → combinación».
  await page.waitForFunction(() => !/calculando/.test(document.querySelector('#psg-an .psg-an-count').textContent), null, { timeout: 30000 })
    .then(() => check(true, 'calcula los 966 Pokémon del juego en segundo plano'), () => check(false, 'no terminó de calcular el juego'));
  const flt = await page.evaluate(() => {
    const click = (f, v) => document.querySelector(`#psg-an [data-f="${f}"][data-v="${v}"]`).click();
    const dexes = () => [...document.querySelectorAll('#psg-an .psg-row')].map(r => +r.dataset.dex);
    click('status', 'all'); click('gen', '4');
    const sinnoh = dexes();
    click('cat', 'myth');
    const myth = dexes();
    click('gen', '0'); click('cat', 'myth'); click('cat', 'leg');
    const leg = dexes();
    click('clear', '');
    const owned = dexes().length;
    const q = document.querySelector('#psg-an .psg-q');
    q.value = '#487'; q.dispatchEvent(new Event('input'));
    const gira = dexes();
    return { sinnoh: sinnoh.length, allSinnoh: sinnoh.every(d => G.DEX_BY[d].gen === 4), myth, leg: leg.length, legOk: leg.every(d => G.DEX_BY[d].leg && ![151, 251].includes(d)),
      hasGira: leg.includes(487), owned, gira, total: G.DEX.filter(p => p.gen === 4).length,
      gens: document.querySelectorAll('#psg-an .psg-an-gens .psg-fc').length };
  });
  check(flt.gens === 10 && flt.allSinnoh && flt.sinnoh === flt.total, `región Sinnoh con «Todos»: ${flt.sinnoh}/${flt.total} (y pestañas Todas + 9 regiones)`);
  check(flt.myth.slice().sort().join() === '489,490,491,492,493', 'Sinnoh + Singulares (míticos): ' + flt.myth.join(','));
  check(flt.legOk && flt.hasGira && flt.leg > 40, `Legendarios de todas las regiones (${flt.leg}, sin Mew ni Celebi)`);
  check(flt.owned === 11 && flt.gira.join() === '487', '«Quitar filtros» vuelve a tu colección y se busca por número (#487 → Giratina)');
  await page.click('#psg-an .psg-row[data-dex="487"]');
  const gira = await page.evaluate(() => {
    const r = window.__psgMod.analyzer.analyze(487), c = r.combo.chain;
    const det = document.querySelector('#psg-an .psg-det');
    return { steps: c.map(x => Math.round(100 * x.p / c[0].p)), tough: c.map(x => Math.round(100 * x.t / c[0].t)),
      ranks: det.querySelectorAll('table.psg-stats small').length, combo: det.querySelectorAll('table.psg-combo tr').length,
      txt: det.querySelector('.psg-combo').closest('.psg-sec').textContent.replace(/\s+/g, ' ').slice(0, 240) };
  });
  check(gira.steps[5] > gira.steps[0] && gira.steps[4] > gira.steps[3] && gira.combo === 7 && /🏆 #\d+\/966/.test(await page.evaluate(() => document.querySelector('#psg-an table.psg-stats').textContent)),
    `Giratina: de fábrica → combinación ⚔ ${gira.steps.join(' → ')} · 🛡 ${gira.tough.join(' → ')}`);
  console.log('       ' + gira.txt);
  if (SHOTS) {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.evaluate(() => document.querySelector('#psg-an .psg-row.open').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, 'analizador-giratina.png') });
    await page.evaluate(() => document.querySelector('#psg-an').scrollTop = 0);
    await page.screenshot({ path: path.join(SHOTS, 'analizador-filtros.png') });
    await page.setViewportSize({ width: 915, height: 412 });
  }
  await page.evaluate(() => { const q = document.querySelector('#psg-an .psg-q'); q.value = ''; q.dispatchEvent(new Event('input')); });
  console.log('       filas tras quitar la búsqueda:', await page.evaluate(() => [...document.querySelectorAll('#psg-an .psg-row')].map(r => r.dataset.dex).join(',')));
  await page.click('#psg-an .psg-row[data-dex="25"]').catch(() => {});
  if (!(await page.evaluate(() => !!document.querySelector('#psg-an .psg-row.open[data-dex="25"]')))) await page.click('#psg-an .psg-row[data-dex="25"]');
  if (SHOTS) {
    await page.screenshot({ path: path.join(SHOTS, 'analizador.png') });
    await page.setViewportSize({ width: 412, height: 915 });
    await page.screenshot({ path: path.join(SHOTS, 'analizador-vertical.png') });
    await page.evaluate(() => document.querySelectorAll('#psg-an .psg-det .psg-sec')[6].scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, 'analizador-plan.png') });
    await page.setViewportSize({ width: 915, height: 412 });
  }
  // Plan fijado a mano: 📌 en «Todos sus ataques».
  const other = await page.evaluate(() => { const r = window.__psgMod.analyzer.analyze(25); return r.attacks.find(m => !r.plan.some(p => p.id === m.id)).id; });
  await page.click('#psg-an details.psg-all summary');
  await page.click(`#psg-an [data-dex="25"][data-pin="${other}"]`);
  const pinned = await page.evaluate(() => ({ r: (r => ({ custom: r.custom, first: r.plan[0].id, n: r.plan.length }))(window.__psgMod.analyzer.analyze(25)),
    head: [...document.querySelectorAll('#psg-an .psg-det h4')].map(h => h.textContent).join(' | '),
    allOpen: !!document.querySelector('#psg-an details.psg-all[open]') }));
  check(pinned.r.custom && pinned.r.first === other && pinned.r.n === 4, 'fijar un ataque con 📌 lo pone primero en el plan (4 en total)');
  check(/fijado por ti/.test(pinned.head) && pinned.allOpen, 'el plan se marca como «fijado por ti» y la tabla sigue abierta');
  if (SHOTS) {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.evaluate(() => document.querySelectorAll('#psg-an .psg-det .psg-sec')[6].scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, 'analizador-fijado.png') });
    await page.setViewportSize({ width: 915, height: 412 });
  }
  const limit = await page.evaluate(id => {
    const A = window.__psgMod.analyzer, r = A.analyze(25), rest = r.attacks.filter(m => m.id !== id).slice(0, 4).map(m => m.id);
    const res = rest.map(x => A.togglePin(25, x));
    return res;
  }, other);
  check(limit.join() === 'true,true,true,false', 'como mucho 4 ataques fijados');
  await page.click('#psg-an [data-reset="25"]');
  check(await page.evaluate(() => !window.__psgMod.analyzer.analyze(25).custom), '«Volver al calculado» quita lo fijado');
  await page.evaluate(id => window.__psgMod.analyzer.togglePin(25, id), other);
  // Copia de seguridad (sólo lectura): exporta la partida y no cambia nada.
  const exp = await page.evaluate(() => {
    const A = window.__psgMod.analyzer;
    const before = JSON.stringify(G.DB.save);
    const text = A.exportSave();
    const back = JSON.parse(text);
    return { ok: typeof text === 'string' && text.length > 50, same: JSON.stringify(back.owned) === JSON.stringify(G.DB.save.owned),
      untouched: JSON.stringify(G.DB.save) === before, noImport: typeof A.importSave === 'undefined' && !document.getElementById('psg-mig-import') };
  });
  check(exp.ok && exp.same, 'exportar devuelve la partida completa');
  check(exp.untouched, 'exportar no cambia nada de la partida');
  check(exp.noImport, 'no hay importar (el juego trata como trampa añadir Pokémon a mano)');
  // Deja la partida como estaba para el resto de la prueba (y vuelve a fijar el ataque del plan,
  // que iba en la cuenta anterior: los planes fijados se guardan por cuenta).
  await page.evaluate(id => {
    G.DB.playAsGuest();
    const s = G.DB.save;
    for (const d of [1, 4, 7, 25, 94, 130, 143, 149, 448, 445, 658]) s.owned[d] = { at: Date.now(), from: 'gacha' };
    s.partner = 25;
    window.__psgMod.analyzer.togglePin(25, id);
  }, other);
  await page.evaluate(() => window.__psgMod.analyzer.close());

  // Partida con Pikachu.
  await page.evaluate(() => G.Game.startRun());
  await page.waitForFunction(() => G.Game.state === 'playing' && G.Game.player, null, { timeout: 15000 });

  const openCards = async () => {
    await page.evaluate(() => G.Game.debugLevelUp());
    await page.waitForFunction(() => document.querySelectorAll('#cards .card .psg-badge').length === document.querySelectorAll('#cards .card').length
      && document.querySelectorAll('#cards .card').length > 0, null, { timeout: 10000 });
  };

  // Plan del analizador para el Pokémon de la partida.
  const pc = await page.evaluate(() => {
    const pl = G.Game.player, plan = window.__psgMod.plan();
    const want = plan.ids.find(id => !pl.hasMove(id));
    const other = G.Moves.poolFor(pl.mon).find(id => !plan.ids.includes(id) && !pl.hasMove(id) && G.Moves.BY_ID[id].kind !== 'buff');
    const sc = id => window.__psgMod.score({ type: 'new', key: 'new:' + id }, pl);
    return { n: plan.ids.length, a: sc(want), b: other ? sc(other) : [0, ''] };
  });
  check(pc.n === 4, 'plan de 4 ataques para el Pokémon de la partida');
  check(await page.evaluate(id => window.__psgMod.plan().ids[0] === id, other), 'las cartas usan el plan fijado a mano');

  // Estilos: Aguante prioriza Coraza y Daño prioriza Potencia.
  const st = await page.evaluate(() => {
    const pl = G.Game.player, cfg = window.__psgMod.cfg, sc = k => window.__psgMod.score({ type: 'stat', key: 'stat:' + k }, pl)[0];
    const out = {};
    for (const x of ['equilibrado', 'aguante', 'dano']) { cfg.style = x; out[x] = { def: sc('def'), atk: sc('atk') }; }
    cfg.style = 'equilibrado';
    return out;
  });
  check(st.aguante.def > st.equilibrado.def && st.equilibrado.def > st.dano.def && st.dano.atk > st.equilibrado.atk && st.equilibrado.atk > st.aguante.atk,
    `estilos: Coraza ${st.aguante.def}/${st.equilibrado.def}/${st.dano.def} · Potencia ${st.aguante.atk}/${st.equilibrado.atk}/${st.dano.atk} (Aguante/Equilibrado/Daño)`);
  check(pc.a[0] > pc.b[0] && /^De tu plan/.test(pc.a[1]), `un ataque del plan puntúa más que uno de fuera (${Math.round(pc.a[0])} > ${Math.round(pc.b[0])})`);
  console.log('       plan:', pc.a[1], '| fuera:', pc.b[1]);

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
  const planLine = await page.evaluate(() => document.querySelector('#psg-bar .psg-plan').textContent);
  check(/^Plan: /.test(planLine) && (await page.locator('#psg-bar .psg-chip').count()) === 4, 'cuatro interruptores y la línea del plan');
  await page.click('#psg-bar [data-k="style"]');
  const styleTxt = await page.locator('#psg-bar [data-k="style"]').textContent();
  check(/Aguante/.test(styleTxt) && (await page.locator('#cards .psg-badge').count()) === 3, 'el estilo cambia con un toque y repuntúa las cartas');
  await page.click('#psg-bar [data-k="style"]');
  await page.click('#psg-bar [data-k="style"]');
  console.log('       ' + planLine);
  await page.click('#psg-bar [data-k="plan"]');
  const off = await page.evaluate(() => ({ line: document.querySelector('#psg-bar .psg-plan').textContent, plan: window.__psgMod.plan(),
    badges: document.querySelectorAll('#cards .psg-badge').length }));
  check(off.line === '' && off.plan === null && off.badges === 3, 'Plan OFF: sin línea de plan y cartas repuntuadas');
  await page.click('#psg-bar [data-k="plan"]');
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

  // Vínculo: marca los dos que pide el plan y, en «Automático», los fusiona solo.
  const bond = await page.evaluate(() => {
    const pl = G.Game.player, plan = window.__psgMod.plan();
    for (const id of plan.ids) if (!pl.hasMove(id)) pl.addMove(id);
    window.__psgMod.cfg.auto = true;
    pl.bonds = 1;
    G.Game.offerBond();
    return { want: plan.bonds.slice(0, 2).filter(id => pl.hasMove(id)), learned: pl.moves.map(m => m.id) };
  });
  await page.waitForFunction(() => document.querySelector('#bond-cards .card.psg-best .psg-badge'), null, { timeout: 5000 })
    .then(() => check(true, 'pantalla de vínculo: el ayudante marca el recomendado'),
          () => check(false, 'pantalla de vínculo: no se marcó ninguno'));
  const bondBadge = await page.evaluate(() => (document.querySelector('#bond-cards .psg-badge') || {}).textContent || '');
  await page.waitForFunction(() => document.getElementById('scr-bond').classList.contains('hidden'), null, { timeout: 8000 }).catch(() => {});
  const fused = await page.evaluate(() => {
    const g = G.Game.player.slots.find(s => s.length > 1);
    return g ? Array.prototype.map.call(g, m => m.id).sort().join(',') : '';
  });
  check(fused && (bond.want.length < 2 || fused === bond.want.slice().sort().join(',')),
    `modo automático: fusionó los del plan (${fused || 'nada'}; plan: ${bond.want.join(',')})`);
  console.log('       ' + bondBadge);

  // Objeto: con cuál quedarse (Cinta Elección mejor que Moneda Amuleto para pelear).
  await page.evaluate(() => { window.__psgMod.cfg.auto = false; window.__psgItem = null; G.RunUI.showItemChoice('amuletcoin', 'choiceband', id => { window.__psgItem = id; }); });
  await page.waitForFunction(() => document.querySelector('#item-cards .card.psg-best .psg-badge'), null, { timeout: 5000 }).catch(() => {});
  const itemBest = await page.evaluate(() => [...document.querySelectorAll('#item-cards .card')].findIndex(e => e.classList.contains('psg-best')));
  check(itemBest === 1, 'objeto: recomienda cambiar a Cinta Elección');
  await page.evaluate(() => { G.UI.hide('scr-item'); window.__psgMod.cfg.auto = true; G.RunUI.showItemChoice('amuletcoin', 'lifeorb', id => { window.__psgItem = id; }); });
  await page.waitForFunction(() => window.__psgItem === 'lifeorb', null, { timeout: 5000 })
    .then(() => check(true, 'objeto: en «Automático» se queda solo con el recomendado'),
          () => check(false, 'objeto: no eligió solo'));
  await page.evaluate(() => { window.__psgMod.cfg.auto = false; G.UI.hide('scr-item'); });

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
  console.log('       mejores puntuaciones posibles:', free.top.map(Math.round).join(', '), '|', free.shownBadges.join(' | '));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'cartas-modo-libre.png') });

  // 4) Ranking: en una partida marcada no se sube nada.
  const sent = await page.evaluate(() => G.Ranking.submitSolo({ t: 999, lv: 1, kills: 0, dmg: 0, dex: 25, shiny: false }));
  check(sent === null, 'modo libre: el ranking queda bloqueado para esta partida');

  // 5) Ajustes guardados.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('psg.mod.v1') || '{}'));
  check(saved.free === true && saved.plan === true && saved.style === 'equilibrado', 'los interruptores se recuerdan en el navegador');

  await browser.close();
  server.close();
  console.log(failed ? `\n${failed} comprobación(es) fallida(s)` : '\nTodo bien');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
