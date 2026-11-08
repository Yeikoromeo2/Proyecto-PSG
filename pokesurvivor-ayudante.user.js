// ==UserScript==
// @name         PokéSurvivor · Ayudante de cartas (PSG)
// @namespace    https://github.com/yeikoromeo2/proyecto-psg
// @version      0.9.5
// @description  Analiza tu colección (naturaleza, habilidad, combos) y te ayuda con las cartas de nivel: recomendación, elección automática y modo libre sin ranking.
// @match        https://pokesurvivor.com/*
// @match        https://www.pokesurvivor.com/*
// @run-at       document-start
// @inject-into  auto
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Yeikoromeo2/Proyecto-PSG/ccr-75475d84-q4ixxt/pokesurvivor-ayudante.user.js
// @updateURL    https://raw.githubusercontent.com/Yeikoromeo2/Proyecto-PSG/ccr-75475d84-q4ixxt/pokesurvivor-ayudante.user.js
// ==/UserScript==

/*
 * Cómo funciona (resumen; detalles en README.md):
 *
 *  - El juego expone sus módulos en window.G. Este script espera a que existan
 *    y envuelve tres funciones, sin cambiar nada más del juego:
 *      G.LevelUp.offer      las 3 cartas de cada subida de nivel
 *      G.RunUI.showLevelUp  la pantalla de cartas (para poder volver a pintarla)
 *      G.Ranking.submit*    la subida al ranking (para bloquearla en modo libre)
 *      G.RunUI.showBond / showItemChoice  vínculo y objeto: marca el recomendado (y en
 *                           «Automático» lo elige)
 *
 *  - Selector: puntúa las cartas ofrecidas, marca la mejor con el motivo y, en
 *    modo «Automático», la elige sola tras un instante. Con «Plan: ON» sigue el
 *    plan de 4 ataques del analizador para tu Pokémon: prioriza esos ataques y
 *    las mejoras de stat que piden sus evoluciones, y evita llenar sus huecos.
 *    El plan se puede fijar a mano en el analizador (📌).
 *
 *  - Estilo (⚖️ Equilibrado / 🛡️ Aguante / ⚔️ Daño): cambia qué mejoras de stat
 *    y cuándo la Baya Zidra se priorizan.
 *
 *  - Modo libre: en vez del sorteo, junta todas las cartas posibles en ese
 *    momento y ofrece las 3 mejores (al «Cambiar opciones», las siguientes).
 *    La partida en la que se use queda marcada y NO se sube al ranking.
 *    En cooperativo no se usa.
 *
 *  - Analizador de colección: botón «Analizador PSG» en el menú principal.
 *    Para cada Pokémon tuyo: potencia y aguante, si su naturaleza y su habilidad le van bien,
 *    propone un plan de 4 para fusionar con vínculos (ataques + potenciadores como Maquinación,
 *    que sólo valen en el mismo hueco), el orden de los vínculos, el objeto que más le conviene,
 *    sus combos de evolución, MT y movimiento inicial.
 *    Incluye «Copia de seguridad»: exporta tu progreso a un archivo (sólo lectura; el juego no
 *    permite pasar Pokémon de una cuenta a otra a mano).
 *
 *  - Compatibilidad: el juego declara una Content-Security-Policy en su HTML que
 *    bloquea los scripts añadidos a la página. Si el gestor (Violentmonkey en
 *    Firefox, sobre todo en Android) no llega a tiempo, lo ejecuta en su espacio
 *    aislado («@inject-into auto» → modo content). Ahí los objetos del juego se
 *    ven a través de las «Xray» de Firefox: se leen con unsafeWindow, las funciones
 *    que el juego tiene que llamar se exportan con exportFunction, los objetos que
 *    el juego tiene que leer se copian con cloneInto y las listas del juego se
 *    copian (arr) antes de recorrerlas con funciones nuestras. En la página normal
 *    (Chrome, Tampermonkey) todo eso no hace nada.
 */
(function () {
  'use strict';

  const VERSION = '0.9.5';
  // Ventana del juego. En modo page es `window`. En el modo content de Firefox es la que hay debajo
  // de la Xray, y según el gestor se llega por un sitio u otro (en Violentmonkey, `unsafeWindow`
  // puede ser la propia ventana aislada): se prueban todos y se usa el que de verdad ve el juego.
  const safe = f => { try { return f(); } catch (e) { return undefined; } };
  const uw = safe(() => (typeof unsafeWindow !== 'undefined' ? unsafeWindow : undefined));
  const wj = safe(() => window.wrappedJSObject);
  const dv = safe(() => document.defaultView && document.defaultView.wrappedJSObject);
  const xn = safe(() => (typeof XPCNativeWrapper !== 'undefined' ? XPCNativeWrapper.unwrap(window) : undefined));
  const CANDIDATES = [uw, wj, dv, xn, window].filter((w, i, l) => w && l.indexOf(w) === i);
  if (CANDIDATES.some(w => safe(() => w.__psgMod || w.__psgModVersion))) return;   // ya está puesto
  const HAS_XF = typeof exportFunction === 'function' && typeof cloneInto === 'function';
  const READY_AT_START = safe(() => document.readyState) || '?';   // 'loading' = llegamos a tiempo

  // ---------------- captura del juego (versión publicada) ----------------
  // En la versión publicada el juego va ENCERRADO en una función (anti-trampas del autor): `G` no
  // existe en window, y además las claves de sus módulos van cifradas y cambian de una versión a
  // otra (p. ej. RunUI → '_37c9881'). Lo que sí se mantiene: el juego crea su objeto de módulos con
  // Object.create(null) nada más empezar, y los módulos conservan los nombres de sus funciones
  // (offer, showLevelUp, pick…). Así que:
  //   1) mientras carga la página, se apuntan los objetos creados con Object.create(null)
  //      (sin tocarlos: Object.create sigue haciendo lo mismo; se quita al acabar de cargar);
  //   2) después, cada módulo se reconoce por lo que contiene, no por su nombre (ver SIG/resolve).
  // Hay que ponerlo ANTES de que corra el juego: por eso va aquí, al principio del script.
  // En modo content (Firefox) se hace sobre la ventana de la página con exportFunction.
  const PW = wj || dv || xn || (uw && uw !== window ? uw : null) || window;   // ventana de la página
  const PX = PW !== window && HAS_XF;
  const born = [];       // objetos creados con Object.create(null) mientras carga el juego
  let trap = 'off';
  (function setTrap() {
    try {
      const O = PW.Object, nativeCreate = O.create;
      let armed = true;
      const wrapped = (f => (PX ? exportFunction(f, PW) : f))(function create(proto, props) {
        const o = nativeCreate.call(O, proto, props);
        if (armed && proto === null && born.length < 400) born.push(o);
        return o;
      });
      O.create = wrapped;
      // El juego es un script «defer»: cuando llega DOMContentLoaded ya ha corrido.
      const disarm = () => {
        if (!armed) return;
        armed = false;
        if (safe(() => O.create === wrapped)) O.create = nativeCreate;
        trap = 'puesto(' + born.length + ')';
      };
      document.addEventListener('DOMContentLoaded', disarm, { once: true });
      window.addEventListener('load', disarm, { once: true });
      trap = 'puesto';
    } catch (e) {
      trap = 'error: ' + ((e && e.message) || e);
    }
  })();

  // Se fijan al encontrar el juego (ver «arranque»):
  //   W     su ventana · XRAY  modo content con las herramientas de Firefox
  //   MODE  'page' | 'content' | 'limitado' (aislado sin esas herramientas: sólo el analizador, que sólo lee)
  let W = window, XRAY = false, MODE = 'page';
  /** Función nuestra que el juego tiene que poder llamar. */
  const exp = f => (XRAY ? exportFunction(f, W) : f);
  /** Objeto nuestro que el juego tiene que poder leer (sólo datos). */
  const share = o => { if (!XRAY) return o; try { return cloneInto(o, W); } catch (e) { return o; } };
  /** Objeto del juego visto sin Xray (argumentos que nos pasa el juego). */
  const unX = o => (o && typeof o === 'object' && o.wrappedJSObject) || o;
  /** Copia una lista (del juego o nuestra) en una lista nuestra, para recorrerla con nuestras funciones. */
  const arr = a => { const out = []; if (!a) return out; const n = a.length >>> 0; for (let i = 0; i < n; i++) out.push(a[i]); return out; };
  /** Lista nuestra → lista del juego (la que devolvemos al juego). */
  const toPage = a => { if (!XRAY) return a; const out = new W.Array(); for (const x of a) out.push(x); return out; };
  const movesOf = pl => arr(pl && pl.moves);

  // ---------------- ajustes (sólo en este navegador) ----------------

  const KEY = 'psg.mod.v1';
  const DEF = { auto: false, free: false, plan: true, style: 'equilibrado', delay: 900 };
  const cfg = (() => {
    try { return Object.assign({}, DEF, JSON.parse(W.localStorage.getItem(KEY) || '{}')); }
    catch (e) { return Object.assign({}, DEF); }
  })();
  function saveCfg() { try { W.localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* sin almacenamiento */ } }

  // Planes fijados a mano en el analizador: { cuenta: { dex: [hasta 4 ataques] } }.
  const PKEY = 'psg.plans.v1';
  function loadPins() { try { return JSON.parse(W.localStorage.getItem(PKEY) || '{}') || {}; } catch (e) { return {}; } }
  function savePins(p) { try { W.localStorage.setItem(PKEY, JSON.stringify(p)); } catch (e) { /* sin almacenamiento */ } }

  // ---------------- puntuación de cartas ----------------

  // Estilos de juego (interruptor en las cartas): cambian qué mejoras de stat se priorizan.
  //   stat  puntos de más (o de menos) para cada mejora · heal  umbrales de vida de la Baya Zidra
  //   up    puntos de más (o de menos) para mejorar un ataque que ya tienes
  const STYLES = {
    equilibrado: { label: '⚖️ Equilibrado', name: 'Equilibrado', stat: {}, heal: [0.35, 0.6], up: 0 },
    aguante: { label: '🛡️ Aguante', name: 'Aguante', stat: { hp: 130, def: 130, rgn: 120, spd: 40, atk: -40, cd: -20 }, heal: [0.5, 0.8], up: -20 },
    dano: { label: '⚔️ Daño', name: 'Daño', stat: { atk: 120, cd: 100, hp: -70, def: -70, rgn: -60 }, heal: [0.25, 0.45], up: 60 }
  };
  const STYLE_ORDER = ['equilibrado', 'aguante', 'dano'];
  const styleOf = () => STYLES[cfg.style] || STYLES.equilibrado;

  // Valor base de cada mejora de stat (ids de G.LevelUp.STATS).
  const STAT_BASE = { atk: 300, cd: 280, hp: 170, def: 170, rgn: 150, spd: 120, mag: 80, xp: 150 };

  /** stat -> movimiento al máximo que espera esa mejora para evolucionar. */
  function waitingStats(G, pl) {
    const out = {};
    for (const m of movesOf(pl)) {
      let ev = null;
      try { ev = G.Moves.evoInfo(m, pl.statsTaken); } catch (e) { /* nada */ }
      if (ev && !ev.ready) out[ev.needs] = m;
    }
    return out;
  }

  function moveName(G, m) {
    const n = (m && (m.name || (m.def && m.def.name))) || '';
    try { return G.T ? G.T(n, 'move') : n; } catch (e) { return n; }
  }

  /** [puntos, motivo] de una carta. Heurística v1: ver README. */
  /**
   * ctx.plan (opcional, del analizador): { ids: [4 ataques], names: {id: nombre},
   * needs: {stat: [ataques del plan que la piden para evolucionar]},
   * scores: {id: potencia de cada ataque posible} }.
   */
  function score(G, c, pl, ctx) {
    const id = String(c.key || '').split(':')[1] || '';
    const plan = ctx.plan || null;
    const hpR = pl.maxHp ? pl.hp / pl.maxHp : 1;
    const evoTable = (G.Moves && G.Moves.EVO) || {};

    if (c.type === 'evo') return [1000, 'Evolución lista: el mayor salto de daño'];

    const st = styleOf();
    if (c.type === 'stat') {
      if (id === 'heal') {
        return hpR < st.heal[0] ? [900, 'Te queda poca vida'] : hpR < st.heal[1] ? [260, 'Recupera vida'] : [15, 'Tienes la vida casi llena'];
      }
      if (ctx.waiting[id]) return [850, 'Desbloquea la evolución de ' + moveName(G, ctx.waiting[id])];
      let s = STAT_BASE[id] != null ? STAT_BASE[id] : 100, why = 'Mejora para toda la partida';
      if (id === 'atk') why = '+10 % de daño a todos tus ataques';
      if (id === 'cd') why = 'Tus ataques salen más seguido';
      if ((id === 'hp' || id === 'def' || id === 'rgn') && hpR < 0.5) { s += 160; why = 'Te están dando: aguanta más'; }
      if (id === 'xp') {
        if ((pl.level || 1) < 10) { s += 80; why = 'Al principio, subir rápido rinde más'; } else s -= 70;
      }
      const sb = st.stat[id] || 0;
      if (sb) { s += sb; if (sb > 0) why += ' · va con tu estilo ' + st.name; }
      // Plan: basta con cogerla una vez para que su evolución quede lista cuando llegue.
      if (plan && plan.needs[id] && !(pl.statsTaken || {})[id]) {
        s += 120; why = 'Tu plan la pide para evolucionar ' + plan.needs[id].join(' y ');
      }
      return [s, why];
    }

    if (c.type === 'up') {
      const m = movesOf(pl).find(x => x.id === id);
      let s = 420, why = 'Mejora un ataque que ya tienes';
      const inPlan = !!(plan && plan.ids.includes(id));
      if (m) {
        const max = (m.def && m.def.maxLvl) || 5, left = Math.max(0, max - (m.lvl || 1));
        if (m.kind === 'buff') {
          // +1 carga / +40 % de potencia: en el plan (fusionado con tus ataques) rinde mucho; fuera, poco.
          if (inPlan) { s += 20; why = 'Más cargas o potencia para tu ' + moveName(G, m); }
          else { s -= 160; why = 'Mejora un potenciador fuera de tu plan'; }
        }
        else if (evoTable[id]) {
          s += 120 + 40 * (max - left);
          why = left <= 1 ? 'Lo deja al máximo: listo para evolucionar'
                          : 'Le faltan ' + left + ' niveles para poder evolucionar';
        }
      }
      if (inPlan) { s += 100; why = 'De tu plan · ' + why; }
      s += st.up;
      return [s, why];
    }

    if (c.type === 'new') {
      const d = (G.Moves && G.Moves.BY_ID && G.Moves.BY_ID[id]) || {};
      const dmgMoves = movesOf(pl).filter(m => m.kind !== 'buff').length;
      // Plan: si los huecos libres no sobran, un ataque de fuera le quitaría el sitio a uno del
      // plan. Se castiga según lo peor que sea que el más flojo de los que faltan (el que se
      // quedaría fuera), y la mitad si aún tienes menos de 2 ataques (urge tener con qué pegar).
      const learned = movesOf(pl);
      const missing = plan ? plan.ids.filter(x => !learned.some(m => m.id === x)) : [];
      const free = (pl.maxMoves || 4) - ((pl.slots && pl.slots.length) || 0);
      let penalty = 0, crowdWhy = '';
      if (plan && !plan.ids.includes(id) && missing.length > 0 && free <= missing.length) {
        const weakest = missing.reduce((a, x) => ((plan.scores[x] || 0) < (plan.scores[a] || 0) ? x : a), missing[0]);
        const ratio = plan.scores[weakest] ? Math.min(1, (plan.scores[id] || 0) / plan.scores[weakest]) : 0;
        if (ratio < 0.9) {
          penalty = Math.min(200, Math.round(250 * (1 - ratio))) * (dmgMoves < 2 ? 0.5 : 1);
          crowdWhy = ' · fuera de tu plan: le quitaría el hueco a ' + plan.names[weakest];
        } else crowdWhy = ' · casi tan bueno como tu plan';
      }
      if (d.kind === 'buff') {
        if (plan && plan.ids.includes(id)) return [480, 'De tu plan (n.º ' + (plan.ids.indexOf(id) + 1) + ') · potenciador'];
        return [(dmgMoves >= 2 ? 230 : 120) - penalty, 'Potenciador: sólo sirve fusionado en el hueco de tus ataques' + crowdWhy];
      }
      let fit = 1;
      try { fit = G.Stats.fit(pl.mon, d.cat); } catch (e) { /* nada */ }
      let s = 360 * fit;
      let why = fit >= 0.999 ? 'Ataque nuevo de tu lado fuerte' : 'Rinde al ' + Math.round(fit * 100) + ' % con tu Pokémon';
      if (dmgMoves < 2) { s += 150; why += ' · te faltan ataques'; }
      if (evoTable[id]) s += 50;
      if (plan && plan.ids.includes(id)) { s += 250; why = 'De tu plan (n.º ' + (plan.ids.indexOf(id) + 1) + ') · ' + why; }
      else { s -= penalty; why += crowdWhy; }
      return [s, why];
    }

    return [0, ''];
  }

  // La puntuación va en la propia carta del juego, sólo con datos simples (número y texto).
  function annotate(G, list, pl, plan) {
    const ctx = { waiting: waitingStats(G, pl), plan };
    for (const c of arr(list)) {
      try { const r = score(G, c, pl, ctx); c.__psgS = r[0]; c.__psgW = r[1]; }
      catch (e) { c.__psgS = 0; c.__psgW = ''; }
    }
  }
  const sc = c => (c && +c.__psgS) || 0;

  function bestIndex(list) {
    let b = 0;
    for (let i = 1; i < (list.length >>> 0); i++) if (sc(list[i]) > sc(list[b])) b = i;
    return b;
  }

  // ---------------- arranque ----------------

  // ---------------- reconocer los módulos del juego por su contenido ----------------
  const isFn = (o, k) => !!safe(() => typeof o[k] === 'function');
  const has = (o, k) => !!safe(() => k in o);
  const SIG = {
    LevelUp: o => isFn(o, 'offer') && has(o, 'STATS'),
    RunUI: o => isFn(o, 'showLevelUp') && isFn(o, 'pick'),
    Game: o => isFn(o, 'startRun') && has(o, 'player') && has(o, 'state'),
    Moves: o => isFn(o, 'poolFor') && isFn(o, 'instance') && has(o, 'BY_ID'),
    Ranking: o => isFn(o, 'submitSolo'),
    UI: o => isFn(o, 'toast') && isFn(o, 'show') && isFn(o, 'hide'),
    Coop: o => isFn(o, 'levelStart') && isFn(o, 'localPicked'),
    Stats: o => isFn(o, 'fit') && isFn(o, 'sideOf') && isFn(o, 'taken'),
    DB: o => isFn(o, 'upgradesOf') && has(o, 'save'),
    Mons: o => isFn(o, 'natureOf') && isFn(o, 'monFor') && isFn(o, 'abilityOf'),
    AbilityFX: o => isFn(o, 'of') && has(o, 'FX'),
    Upgrades: o => isFn(o, 'perks') && has(o, 'LIST'),
    Items: o => isFn(o, 'roll') && has(o, 'BY') && has(o, 'LIST'),
    U: o => isFn(o, 'clamp') && has(o, 'TYPE_NAME'),
    Icons: o => isFn(o, 'html') && isFn(o, 'canvas') && isFn(o, 'draw'),
    NATURES: o => !!safe(() => o.length === 25 && o[0].id === 'hardy'),
    NATURE_BY: o => !!safe(() => !('length' in o) && o.hardy && 'up' in o.hardy),
    DEX: o => !!safe(() => o.length > 500 && 'dex' in o[0] && 'types' in o[0]),
    DEX_BY: o => !!safe(() => !('length' in o) && o[1].dex === 1 && 'types' in o[1] && !!o[25])
  };
  const NEEDED = ['LevelUp', 'RunUI', 'Game', 'Moves', 'Ranking', 'UI'];
  let missing = [];
  /** Fachada con los nombres de siempre (G.LevelUp, G.Moves…) apuntando a los módulos del juego. */
  function resolve(ns) {
    const G = {};
    const keys = safe(() => Object.keys(ns)) || [];
    for (const name in SIG) {
      let v = safe(() => ns[name]);                       // con nombre normal (dev.html, versiones antiguas)
      if (!(v && SIG[name](v))) {
        v = undefined;
        for (const k of keys) {                           // con nombre cifrado: por su contenido
          const x = safe(() => ns[k]);
          if (x && typeof x === 'object' && SIG[name](x)) { v = x; break; }
        }
      }
      if (v) G[name] = v;
    }
    const T = safe(() => ns.T);
    G.T = typeof T === 'function' ? T : (t => t);
    for (const k of ['startMoveOf', 'startChoices']) { const v = safe(() => ns[k]); if (typeof v === 'function') G[k] = v; }
    return G;
  }
  const gOk = G => !!safe(() => G && typeof G.LevelUp.offer === 'function' && typeof G.RunUI.showLevelUp === 'function'
    && typeof G.RunUI.pick === 'function' && G.Game && G.Moves && G.Ranking && G.UI);
  /** { G, w }: el juego y su ventana — el cazado (versión publicada) o window.G (dev.html y versiones antiguas). */
  function findGame() {
    const tryNs = (ns, w) => {
      if ((safe(() => Object.keys(ns).length) || 0) < 15) return null;
      const G = resolve(ns);
      if (gOk(G)) return { G, w };
      const m = NEEDED.filter(k => !G[k]);
      if (!missing.length || m.length < missing.length) missing = m;
      return null;
    };
    for (const ns of born) { const r = tryNs(ns, PW); if (r) return r; }
    for (const w of CANDIDATES) { const g = safe(() => w.G); if (g) { const r = tryNs(g, w); if (r) return r; } }
    return null;
  }
  // ---------------- indicador de estado ----------------
  // Sale arriba en el centro nada más cargar la página: si no lo ves, el gestor no está
  // ejecutando el script. Verde = funcionando (se oculta solo), rojo = no encuentra el juego.
  // Tocarlo lo cierra.
  let pill = null, pillT = 0;
  function status(text, kind, hideMs) {
    try {
      const host = document.body || document.documentElement;
      if (!host) return;
      if (!pill) {
        pill = document.createElement('div');
        pill.setAttribute('translate', 'no');
        pill.setAttribute('data-psg-status', '');
        pill.style.cssText = 'position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:2147483647;max-width:94vw;'
          + 'padding:5px 12px;border-radius:999px;font:12px/1.35 sans-serif;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.5);'
          + 'text-align:center;cursor:pointer;-webkit-user-select:none;user-select:none';
        pill.addEventListener('click', () => { pill.style.display = 'none'; });
      }
      if (!pill.isConnected) host.appendChild(pill);
      pill.textContent = text;
      pill.style.background = kind === 'ok' ? '#1f7a45' : kind === 'err' ? '#9a1d1d' : kind === 'warn' ? '#8a5a00' : '#2b3550';
      pill.style.display = '';
      clearTimeout(pillT);
      if (hideMs) pillT = setTimeout(() => { pill.style.display = 'none'; }, hideMs);
    } catch (e) { /* nada */ }
  }

  // ---------------- arranque: buscar el juego ----------------
  let tries = 0, warned = false;
  const boot = setInterval(() => {
    if (tries === 1) status('PSG ' + VERSION + ' · buscando el juego…', 'info');
    const found = findGame();
    if (found) {
      clearInterval(boot);
      W = found.w;
      XRAY = W !== window && HAS_XF;
      MODE = W === window ? 'page' : XRAY ? 'content' : 'limitado';
      try {
        install(found.G);
        if (MODE === 'limitado') status('PSG ' + VERSION + ' ⚠ modo limitado: sólo el analizador [' + diag() + '] · toca para cerrar', 'warn');
        else status('PSG ' + VERSION + ' ✓ funcionando' + (XRAY ? ' (modo compatible)' : '') + ' · en el menú: ⭐ Analizador y ⇄ Copia de partida', 'ok', 9000);
      } catch (e) {
        console.error('[PSG] no se pudo instalar', e);
        status('PSG ' + VERSION + ' ✗ error al instalar: ' + ((e && e.message) || e) + ' [' + diag() + '] · toca para cerrar', 'err');
      }
    } else if (++tries === 60 && !warned) {    // ~15 s: se avisa, pero se sigue buscando un rato
      warned = true;
      status('PSG ' + VERSION + ' ✗ no encuentro el juego' + (READY_AT_START !== 'loading' ? ' (el script llegó tarde: recarga la página)' : '')
        + ' [' + diag() + '] · sigo buscando · toca para cerrar', 'err');
    } else if (tries > 480) {                    // ~2 min
      clearInterval(boot);
    }
  }, 250);

  /** Qué ve el script (para el indicador): así una captura basta para saber qué pasa. */
  function diag() {
    const seesG = w => (safe(() => !!w.G) ? 'G' : '-');
    return 'trampa:' + trap + ' objetos:' + born.length + (missing.length ? ' faltan:' + missing.join(',') : '') + ' inicio:' + READY_AT_START
      + ' uw:' + (uw ? (uw === window ? '=w' : 'sí') + seesG(uw) : 'no') + ' wj:' + (wj ? 'sí' + seesG(wj) : 'no')
      + ' dv:' + (dv ? 'sí' + seesG(dv) : 'no') + ' xn:' + (xn ? 'sí' + seesG(xn) : 'no') + ' w:' + seesG(window)
      + ' xf:' + (HAS_XF ? 'sí' : 'no');
  }

  // =====================================================================
  //  ANALIZADOR DE COLECCIÓN (botón «Analizador PSG» en el menú principal)
  //  Para cada Pokémon tuyo: ¿su naturaleza y su habilidad le van bien?,
  //  plan de 4 ataques con sus combos de evolución, MT y movimiento inicial.
  //  Todo con las funciones del propio juego (G.Mons, G.Moves, G.AbilityFX…).
  // =====================================================================

  const STAT_ES = { pa: 'Ataque', sa: 'Ataque Especial', df: 'Defensa', sd: 'Defensa Especial', spd: 'Velocidad' };
  // Formas de ataque que dan a varios enemigos a la vez (en un survivor valen más).
  const AREA = new Set(['melee', 'nova', 'aura', 'spin', 'quake', 'shove', 'vortex', 'cone', 'meteor', 'chain',
    'mine', 'trail', 'beam', 'charge', 'stun', 'dash', 'orbit']);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 1);
  // Potenciadores: se relanzan cada ~0,85 s y cada carga dura 7 s, así que mientras estén en el
  // hueco que dispara llegan a su máximo de cargas y se quedan ahí (los primeros segundos, menos).
  const BUFF_RAMP = 0.9;
  // Regiones (como las pestañas de la Pokédex del juego: el campo gen de cada Pokémon).
  const GEN_NAMES = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Teselia', 'Kalos', 'Alola', 'Galar', 'Paldea'];
  const RARITY_NAME = { 1: 'Común', 2: 'Poco común', 3: 'Rara', 4: 'Épica', 5: 'Legendaria' };
  // El juego marca con «leg» a legendarios y singulares a la vez; los singulares (míticos) se separan aquí.
  const MYTHICAL = new Set([151, 251, 385, 386, 489, 490, 491, 492, 493, 494, 647, 648, 649, 719, 720, 721, 801, 802,
    807, 808, 809, 893, 1025]);
  const catOf = p => (p && p.leg ? (MYTHICAL.has(+p.dex) ? 'myth' : 'leg') : 'normal');
  const CAT_NAME = { normal: 'Normal', leg: 'Legendario', myth: 'Singular (mítico)' };
  const BUFF_TXT = { patk: 'Ataque (físico)', satk: 'Ataque Especial', spd: 'Velocidad', def: 'Defensa', regen: 'Regeneración' };
  // Reducción de daño típica de las cartas Coraza a mitad de partida (el juego la topa en 80 % con Fortaleza).
  const RUN_RED = 0.18;
  // Cuánto pesa el aguante frente al daño al elegir el plan y el objeto, según el estilo.
  const STYLE_W = { dano: 0, equilibrado: 0.25, aguante: 0.6 };
  // Objetos (uno por partida, en cofres y jefes): lo que cambian en daño (dmg), reducción (red),
  // regeneración en % de la vida (regenPct), velocidad (spd) y aguante en general (tk).
  const ITEM_FX = {
    choiceband: { name: 'Cinta Elección', dmg: 1.4, note: '+40 % de daño, pero no puedes cambiar de hueco: perfecta con el plan fusionado' },
    lifeorb: { name: 'Vidasfera', dmg: 1.3, tk: 0.85, note: '+30 % de daño; cada ataque te quita algo de vida' },
    quickclaw: { name: 'Garra Rápida', dmg: 1.25, note: '−20 % de recarga (también rellena antes los potenciadores)' },
    assaultvest: { name: 'Chaleco Asalto', red: 0.2, note: '+20 % de reducción de daño (suma con Coraza y Fortaleza)' },
    leftovers: { name: 'Restos', regenPct: 0.015, note: '+1,5 % de su vida por segundo' },
    choicescarf: { name: 'Pañuelo Elección', spd: 1.35, note: '+35 % de velocidad: esquivas más' },
    shellbell: { name: 'Cascabel Concha', tk: 1.12, note: 'se cura con el daño que hace' },
    focussash: { name: 'Banda Focus', tk: 1.1, note: 'aguanta un golpe mortal cada 60 s' },
    rockyhelmet: { name: 'Casco Dentado', dmg: 1.03, tk: 1.03, note: 'daña a los que le pegan cuerpo a cuerpo' },
    luckyegg: { name: 'Huevo Suerte', dmg: 1.06, tk: 1.06, note: '+30 % de experiencia: más cartas, sobre todo al principio' },
    amuletcoin: { name: 'Moneda Amuleto', note: '+50 % de monedas al acabar: no ayuda a pelear' }
  };

  function analyzerCore(G) {
    const save = () => G.DB && G.DB.save;
    const nm = n => { try { return G.Mons.name(n); } catch (e) { return String(n); } };
    const typeName = t => (G.U && G.U.TYPE_NAME && G.U.TYPE_NAME[t]) || t;
    const moveName = d => { try { return G.T(d.name, 'move'); } catch (e) { return d.name; } };
    // Velocidad de referencia: la mediana de todos los Pokémon del juego.
    let refSpdV = 0;
    const refSpd = () => refSpdV || (refSpdV = (() => {
      const l = arr(G.DEX).map(p => +p.spd).filter(v => v > 0).sort((a, b) => a - b);
      return l.length ? l[Math.floor(l.length / 2)] : 100;
    })());
    const natName = n => (n ? nm(n.n) : '');

    // Plan fijado a mano (por cuenta: la fecha de creación de la partida la identifica).
    const acct = () => String((save() && save().created) || 'local');
    function pinsOf(dex) { const a = loadPins()[acct()] || {}; return Array.isArray(a[dex]) ? a[dex].slice(0, 4) : []; }
    function setPins(dex, ids) {
      const all = loadPins(), k = acct();
      all[k] = all[k] || {};
      if (ids.length) all[k][dex] = ids.slice(0, 4); else delete all[k][dex];
      savePins(all);
    }
    /** Fija o suelta un ataque del plan. → false si ya hay 4 fijados. */
    function togglePin(dex, id) {
      const p = pinsOf(dex), i = p.indexOf(id);
      if (i >= 0) p.splice(i, 1); else { if (p.length >= 4) return false; p.push(id); }
      setPins(dex, p);
      return true;
    }

    /** Índice aproximado de daño por segundo de una instancia de movimiento. */
    function moveIndex(inst) {
      if (!inst || inst.kind === 'buff') return 0;
      const cd = Math.max(0.1, +inst.cd || 1);
      let v = (+inst.dmg || 0) * Math.max(1, +inst.count || 1) / cd;
      v *= 1 + 0.3 * (+inst.pierce || 0) + 0.3 * (+inst.bounce || 0);
      if (AREA.has(inst.kind)) v *= 1.4;
      return v;
    }

    /** Habilidad: nombre, texto, tipo y su multiplicador de daño sobre un movimiento. */
    function abilityInfo(id, base, mon) {
      const fx = (G.AbilityFX && G.AbilityFX.of(id, base)) || {};
      // Jugador y enemigo de mentira para preguntarle a la habilidad cuánto daño suma.
      // (el Pokémon, copiado como datos simples para que también se pueda compartir en modo content)
      const monD = { dex: mon.dex, name: mon.name, types: arr(mon.types), hp: mon.hp, pa: mon.pa, sa: mon.sa, atk: mon.atk,
        df: mon.df, sd: mon.sd, spd: mon.spd };
      const pl = share({ hp: 100, maxHp: 100, level: 10, mon: monD, moxie: 0, kills: 0, x: 0, y: 0, statsTaken: {}, moves: [] });
      const foe = share({ types: ['normal'], hp: 100, maxHp: 100, x: 0, y: 0, mon: { types: ['normal'] } });
      const mul = inst => {
        if (!fx.out || !inst) return 1;
        try { const k = +fx.out(pl, inst, foe); return isFinite(k) && k > 0 ? k : 1; } catch (e) { return 1; }
      };
      const kind = fx.generic ? 'genérica' : fx.out ? 'ofensiva'
        : (fx.inMul || fx.absorb || fx.dodge || fx.hurt || fx.contact || fx.sturdy) ? 'defensiva' : 'de utilidad';
      return { id, name: G.Mons.abilityName(id) || id, desc: [fx.d, fx.d2].filter(Boolean).join(' '), kind, mul };
    }

    function moveInfo(id, base, mon, taught) {
      const d = G.Moves.BY_ID[id];
      if (!d) return null;
      const max = d.maxLvl || 5;
      const evo = (G.Moves.EVO && G.Moves.EVO[id]) || null;
      let inst = G.Moves.instance(id, max);
      if (evo) { const e = G.Moves.instance(id, max); if (G.Moves.evolve(e)) inst = e; }
      const statK = d.cat === 'special' ? mon.sa : d.cat === 'physical' ? mon.pa : 0;
      const statK0 = d.cat === 'special' ? base.sa : d.cat === 'physical' ? base.pa : 0;   // sin naturaleza
      const types = arr(base.types);
      const monoK = types.length === 1 && d.type === types[0] ? 1.2 : 1;   // Player.MONO_K
      const idx = moveIndex(inst) * monoK;
      const buff = d.kind === 'buff';
      return {
        id, d, inst, name: moveName(d), type: d.type, cat: d.cat, kind: d.kind, buff,
        evo, evoName: evo && G.Moves.NEED_NAME ? G.Moves.NEED_NAME[evo] : '', fit: G.Stats.fit(mon, d.cat),
        tm: taught.has(id), idx, val: idx * statK, val0: idx * statK0, abilK: 1, score: 0, score0: 0,
        // Potenciador: qué stat sube y cuánto con todas sus cargas (a su nivel máximo).
        stat: buff ? d.stat : null, stacks: buff ? (+inst.stacks || 0) : 0, amount: buff ? (+inst.amount || 0) : 0,
        bk: buff ? (+inst.stacks || 0) * (+inst.amount || 0) * BUFF_RAMP : 0
      };
    }

    /**
     * Lo que hace un grupo de movimientos que se lanzan A LA VEZ (un hueco con vínculos):
     * la suma de sus ataques, cada uno con el potenciador de su lado (Danza Espada/Danza Dragón
     * a los físicos, Maquinación a los especiales), y lo que suben Fortaleza, Agilidad y Acua Aro.
     * Dos potenciadores del mismo stat no se suman: vale el mayor (como Player.addBuff).
     */
    function groupFx(list) {
      const k = { patk: 0, satk: 0, spd: 0, def: 0, regen: 0 };
      for (const m of list) if (m.buff && m.stat in k) k[m.stat] = Math.max(k[m.stat], m.bk);
      let dmg = 0;
      for (const m of list) if (!m.buff) dmg += m.score * (1 + (m.cat === 'physical' ? k.patk : m.cat === 'special' ? k.satk : 0));
      return { dmg, k };
    }
    /** Grupos de k elementos de una lista. */
    function combos(list, k, out = [], start = 0, cur = []) {
      if (cur.length === k) { out.push(cur.slice()); return out; }
      for (let i = start; i <= list.length - (k - cur.length); i++) { cur.push(list[i]); combos(list, k, out, i + 1, cur); cur.pop(); }
      return out;
    }

    function analyze(dex) {
      const s = save(), base = G.DEX_BY[dex];
      if (!base) return null;
      const mon = G.Mons.monFor(dex);
      const nat = G.Mons.natureOf(dex), rolled = G.Mons.rolledNature(dex);
      const taught = new Set(arr(G.Mons.taught(dex)));
      const ab = G.Mons.abilityOf(dex);
      const abil = abilityInfo(ab.id, base, mon);

      const moves = arr(G.Moves.poolFor(base)).map(id => moveInfo(id, base, mon, taught)).filter(Boolean);
      for (const m of moves) { if (m.buff) continue; m.abilK = abil.mul(m.inst); m.score = m.val * m.abilK; m.score0 = m.val0 * m.abilK; }
      const attacks = moves.filter(m => !m.buff).sort((a, b) => b.score - a.score);
      const slotsN = 4;          // Player.BOND_MAX: como mucho 4 movimientos en el hueco que se fusiona

      // ---- aguante (con lo que sumen los potenciadores y el objeto) ----
      // (las mejoras compradas se leen sin G.DB.upgradesOf, que crea la entrada en la partida si no existe)
      const lv = (s && s.pupg && s.pupg[dex]) || {};
      let perks = {};
      try { perks = (G.Upgrades && G.Upgrades.perks(lv)) || {}; } catch (e) { /* nada */ }
      const tP = G.Stats.taken(mon, 'physical'), tS = G.Stats.taken(mon, 'special');
      const hpTot = (+mon.hp || 0) + (+perks.hp || 0);
      const defAbil = abil.kind === 'defensiva';
      /** Aguante de un Pokémon (mx) con unas mejoras (pk), potenciadores (k) y objeto (it). */
      function toughFor(mx, pk, dA, k, it) {
        k = k || {}; it = it || {};
        const hpT = (+mx.hp || 0) + (+pk.hp || 0);
        const tp = mx === mon ? tP : G.Stats.taken(share(mx), 'physical'), ts = mx === mon ? tS : G.Stats.taken(share(mx), 'special');
        const red = Math.min(0.8, (+pk.dmgReduce || 0) + RUN_RED + (k.def || 0) + (it.red || 0));
        const takenAvg = ((tp + ts) / 2) * (1 - red);                       // enemigos físicos y especiales a medias
        const spdV = (+mx.spd || 0) * (+pk.spdMul || 1) * (1 + (k.spd || 0)) * (it.spd || 1);
        const spdK = Math.sqrt(Math.max(0.2, spdV / refSpd()));             // correr ayuda a esquivar
        const regen = (+pk.regen || 0) + (k.regen || 0) + (it.regenPct || 0) * hpT;
        return (hpT / Math.max(0.05, takenAvg) + regen * 20) * spdK * (dA ? 1.08 : 1) * (it.tk || 1);
      }
      const toughOf = (k, it) => toughFor(mon, perks, defAbil, k, it);
      const tough0 = toughOf();
      const sw = STYLE_W[cfg.style] != null ? STYLE_W[cfg.style] : STYLE_W.equilibrado;
      /** Valor de un grupo que se lanza a la vez: su daño, con un poco de aguante según el estilo. */
      const objOf = list => { const f = groupFx(list); return f.dmg * Math.pow(toughOf(f.k) / tough0, sw); };

      // ---- plan: el grupo de 4 que vas a fusionar con vínculos ----
      // Los fijados a mano van siempre; el resto, la mejor combinación de ataques y potenciadores
      // (como mucho 2 potenciadores: el juego no ofrece más).
      const pinned = pinsOf(dex).map(id => moves.find(m => m.id === id)).filter(Boolean);
      pinned.forEach(m => { m.pinned = true; });
      const cand = attacks.filter(m => !m.pinned).slice(0, 8).concat(moves.filter(m => m.buff && !m.pinned));
      const freeN = Math.min(Math.max(0, slotsN - pinned.length), cand.length);
      let plan = pinned.slice(), bestV = -1;
      for (const c of combos(cand, freeN)) {
        const list = pinned.concat(c);
        if (list.filter(m => m.buff).length > 2 || !list.some(m => !m.buff)) continue;
        const v = objOf(list);
        if (v > bestV) { bestV = v; plan = list; }
      }
      // Orden de los vínculos: el 1.º une los dos que más rinden juntos; cada uno siguiente, el que más suma.
      const bonds = [];
      if (plan.length >= 2) {
        let pair = [plan[0], plan[1]], pv = -1;
        for (const c of combos(plan, 2)) { const v = objOf(c); if (v > pv) { pv = v; pair = c; } }
        bonds.push(...pair);
        const rest = plan.filter(m => !pair.includes(m));
        while (rest.length) {
          let bi = 0, bv = -1;
          rest.forEach((m, i) => { const v = objOf(bonds.concat(m)); if (v > bv) { bv = v; bi = i; } });
          bonds.push(rest.splice(bi, 1)[0]);
        }
      } else bonds.push(...plan);
      // Se enseña en ese orden (los fijados, primero).
      plan = plan.filter(m => m.pinned).concat(bonds.filter(m => !m.pinned));
      const planFx = groupFx(plan);
      // Lo que aporta cada uno al grupo (lo que se perdería sin él): así se comparan ataques y potenciadores.
      for (const m of plan) m.gain = Math.max(0, objOf(plan) - objOf(plan.filter(x => x !== m)));
      // Daño por número de vínculos: sin ninguno sólo dispara el hueco activo (un movimiento).
      const soloBest = attacks.length ? attacks[0] : null;
      const steps = [soloBest ? soloBest.score : 0];
      for (let n = 2; n <= bonds.length; n++) steps.push(groupFx(bonds.slice(0, n)).dmg);
      const evoStats = [...new Set(plan.filter(m => m.evo).map(m => m.evoName))];

      // ---- naturaleza ----
      // El lado con el que pega se mira en su mejor plan SIN naturaleza (si no, la propia
      // naturaleza decidiría el lado: Pikachu Modesta saldría «especial» por ser Modesta).
      const plan0 = pinned.concat(moves.filter(m => !m.buff && !m.pinned).sort((a, b) => b.score0 - a.score0)
        .slice(0, Math.max(0, slotsN - pinned.length)));
      const tot0 = plan0.reduce((a, m) => a + m.score0, 0) || 1;
      const physShare = plan0.filter(m => m.cat === 'physical').reduce((a, m) => a + m.score0, 0) / tot0;
      const side = physShare >= 0.5 ? 'physical' : 'special';
      const sideStat = side === 'special' ? 'sa' : 'pa', offStat = side === 'special' ? 'pa' : 'sa';
      const usesOff = Math.min(physShare, 1 - physShare) > 0.2;     // plan mixto
      let natV, natWhy;
      if (nat.down === sideStat) { natV = 'mala'; natWhy = 'Baja su ' + STAT_ES[sideStat] + ', que es con lo que más pega.'; }
      else if (nat.up === sideStat && nat.down === offStat && usesOff) { natV = 'buena'; natWhy = 'Sube su ' + STAT_ES[sideStat] + ', pero baja el otro ataque y tu plan usa alguno de ese lado.'; }
      else if (nat.up === sideStat) { natV = 'ideal'; natWhy = 'Sube su ' + STAT_ES[sideStat] + ', que es con lo que más pega.'; }
      else if (nat.up === offStat && !usesOff) { natV = 'floja'; natWhy = 'Sube ' + STAT_ES[offStat] + ', que su plan casi no usa.'; }
      else if (!nat.up) { natV = 'neutra'; natWhy = 'No cambia ningún stat.'; }
      else {
        natV = 'normal';
        natWhy = 'Sube ' + STAT_ES[nat.up] + (['df', 'sd', 'spd'].includes(nat.up) ? ' (más aguante)' : '')
          + ' y baja ' + STAT_ES[nat.down] + ': no toca su ataque principal.';
      }
      const bestNat = G.NATURE_BY[side === 'special' ? (usesOff ? 'mild' : 'modest') : (usesOff ? 'lonely' : 'adamant')];

      // ---- habilidad: sus opciones comparadas sobre el plan ----
      const slots = arr(G.Mons.slots(dex)), seen = new Set(), abilOpts = [];
      slots.forEach((id, slot) => {
        if (!id || seen.has(id)) return;
        seen.add(id);
        const a = abilityInfo(id, base, mon);
        a.slot = slot; a.planK = mean(plan.filter(m => !m.buff).map(m => a.mul(m.inst)));
        abilOpts.push(a);
      });
      const cur = abilOpts.find(a => a.id === ab.id) || Object.assign(abil, { slot: ab.slot, planK: mean(plan.filter(m => !m.buff).map(m => abil.mul(m.inst))) });
      const bestAb = abilOpts.reduce((b, a) => (a.planK > b.planK ? a : b), cur);
      let abV, abWhy;
      if (bestAb !== cur && bestAb.planK > cur.planK + 0.04) {
        abV = 'cambiar';
        abWhy = bestAb.name + ' le da ×' + bestAb.planK.toFixed(2) + ' de daño en su plan (la actual, ×' + cur.planK.toFixed(2) + '). '
          + 'Cámbiala con ' + (bestAb.slot === 2 ? 'la Cápsula Habilidad Oculta' : 'una Cápsula Habilidad') + '.';
      } else if (cur.kind === 'ofensiva' && cur.planK > 1.01) { abV = 'buena'; abWhy = 'Sube el daño de su plan (×' + cur.planK.toFixed(2) + ').'; }
      else if (cur.kind === 'genérica') { abV = 'normal'; abWhy = 'Pasiva genérica de su tipo.' + (abilOpts.length > 1 ? ' Mira las otras opciones por si alguna te sirve más.' : ''); }
      else { abV = 'normal'; abWhy = 'Es ' + cur.kind + ': no se puede medir en daño, lee lo que hace.'; }

      // ---- MT que entrarían en el plan ----
      // (entra si, cambiándola por uno de los no fijados, el grupo rinde al menos un 3 % más)
      const planV = objOf(plan), tmBuy = [];
      try {
        for (const id of arr(G.Mons.learnable(dex))) {
          if (plan.some(p => p.id === id)) continue;
          const m = moveInfo(id, base, mon, new Set([id]));
          if (!m) continue;
          if (!m.buff) { m.abilK = abil.mul(m.inst); m.score = m.val * m.abilK; }
          let v = plan.length < slotsN ? objOf(plan.concat(m)) : 0;
          for (const out of plan) {
            if (out.pinned) continue;
            const list = plan.map(x => (x === out ? m : x));
            if (list.filter(x => x.buff).length > 2 || !list.some(x => !x.buff)) continue;
            v = Math.max(v, objOf(list));
          }
          if (v > planV * 1.03) { m.gain = v - planV; tmBuy.push(m); }
        }
      } catch (e) { /* sin MT */ }
      tmBuy.sort((a, b) => b.gain - a.gain);

      // ---- movimiento inicial ----
      let start = null, startRec = null;
      try {
        const sid = G.startMoveOf ? G.startMoveOf(dex) : G.Moves.startFor(base);
        start = moves.find(m => m.id === sid) || moveInfo(sid, base, mon, taught);
        const choices = G.startChoices ? arr(G.startChoices(dex)) : [];
        const bestStart = plan.find(m => choices.includes(m.id));
        if (bestStart && start && bestStart.id !== start.id && bestStart.score > start.score * 1.1) startRec = bestStart;
      } catch (e) { /* nada */ }
      // ---- aguante con su plan fusionado (Fortaleza, Agilidad y Acua Aro cuentan) ----
      const spd = (+mon.spd || 0) * (+perks.spdMul || 1);
      const spdK = Math.sqrt(Math.max(0.2, spd / refSpd()));
      const tough = toughOf(planFx.k);
      const toughInfo = { hp: +mon.hp || 0, hpUp: +perks.hp || 0, df: mon.df, sd: mon.sd, tP, tS, spd, spdK,
        spdUp: +perks.spdMul || 1, regen: +perks.regen || 0, dmgReduce: +perks.dmgReduce || 0, defAbil,
        buffK: planFx.k, buffTough: tough / tough0 };
      const perkK = (+perks.atkMul || 1) / Math.max(0.1, +perks.cdMul || 1) * (1 + (+perks.crit || 0) * 0.5);

      // ---- objetos: cuál le conviene más si te sale en un cofre (según el estilo) ----
      const iw = Math.max(0.1, sw);
      const items = Object.keys(ITEM_FX).map(id => {
        const it = ITEM_FX[id], dK = it.dmg || 1, tK = toughOf(planFx.k, it) / tough;
        let name = it.name;
        try { const g = G.Items && G.Items.BY && G.Items.BY[id]; if (g && g.name) name = String(g.name); } catch (e) { /* nada */ }
        return { id, name, note: it.note, dK, tK, v: dK * Math.pow(tK, iw) };
      }).sort((a, b) => b.v - a.v);

      // ---- de fábrica → con la combinación: cuánto suma cada cosa ----
      // «De fábrica»: los stats del juego tal cual (sin naturaleza), su primera habilidad, sin mejoras
      // compradas, sin vínculos (sólo dispara un movimiento) y sin objeto. Luego se añade, por orden:
      // la naturaleza recomendada, la mejor habilidad, tus mejoras, los vínculos con potenciadores y el objeto.
      const monWith = n => {
        const m = {};
        for (const k of ['dex', 'name', 'hp', 'spd', 'atk', 'pa', 'sa', 'df', 'sd']) m[k] = base[k];
        m.types = arr(base.types);
        if (n && n.up) m[n.up] = base[n.up] * 1.1;
        if (n && n.down) m[n.down] = base[n.down] * 0.9;
        m.atk = Math.max(m.pa, m.sa);
        return m;
      };
      const abCache = {};
      const abFor = (id, mx, key) => abCache[id + '|' + key] || (abCache[id + '|' + key] = abilityInfo(id, base, mx));
      function scen(o) {
        const mx = monWith(o.nat), a = abFor(o.abil, mx, o.nat ? o.nat.id : '-');
        const st = m => (m.cat === 'special' ? mx.sa : m.cat === 'physical' ? mx.pa : 0);
        const rs = m => (m.buff ? m : Object.assign({}, m, { score: m.idx * st(m) * a.mul(m.inst) }));
        const pk = o.perks ? perks : {}, it = (o.item && ITEM_FX[o.item]) || {};
        let dmg = 0, k = {};
        if (o.fused) { const f = groupFx(plan.map(rs)); dmg = f.dmg; k = f.k; }
        else for (const m of attacks) dmg = Math.max(dmg, rs(m).score);
        dmg *= (o.perks ? perkK : 1) * (it.dmg || 1);
        return { p: dmg, t: toughFor(mx, pk, a.kind === 'defensiva', k, it) };
      }
      const slot0 = arr(G.Mons.slots(dex))[0] || ab.id, bestItem = items[0] ? items[0].id : null;
      // Habilidad de la combinación: la que más rinde en daño y aguante (a igualdad, la que ya tiene).
      const abVal = id => { const x = scen({ nat: bestNat, abil: id }); return x.p * Math.pow(x.t, Math.max(0.1, sw)); };
      const comboAb = abilOpts.reduce((b, a) => (abVal(a.id) > abVal(b.id) * 1.001 ? a : b), cur);
      const NB = { nat: bestNat, abil: comboAb.id };
      const chain = [
        { key: 'fab', label: 'De fábrica', ...scen({ nat: null, abil: slot0 }) },
        { key: 'nat', label: 'Naturaleza ' + natName(bestNat), ...scen({ nat: bestNat, abil: slot0 }) },
        { key: 'abil', label: 'Habilidad ' + comboAb.name + (comboAb.id === slot0 ? ' (la de fábrica ya es la mejor)' : ''), ...scen(NB) },
        { key: 'perks', label: 'Tus mejoras compradas', ...scen({ ...NB, perks: true }) },
        { key: 'bonds', label: 'Vínculos + potenciadores (plan fusionado)', ...scen({ ...NB, perks: true, fused: true }) },
        { key: 'item', label: 'Objeto ' + (items[0] ? items[0].name : ''), ...scen({ ...NB, perks: true, fused: true, item: bestItem }) }
      ];
      const combo = {
        chain,
        now: scen({ nat, abil: ab.id, perks: true }),                         // tu Pokémon al empezar una partida
        // Potencial (para comparar con todo el juego): la combinación sin tus mejoras compradas.
        potential: scen({ ...NB, fused: true, item: bestItem }),
        bestAbSlot: comboAb.slot
      };

      const hasStartUpg = !!(s && s.pupg && s.pupg[dex] && s.pupg[dex].start);
      const upgLv = Object.values((s && s.pupg && s.pupg[dex]) || {}).reduce((a, v) => a + (+v || 0), 0);

      return {
        dex, base, mon, name: base.name, types: arr(base.types), side, combo,
        gen: +base.gen || 0, rarity: +base.rarity || 0, cat: catOf(base), owned: !!(s && s.owned && s.owned[dex]),
        nat, rolled, natChanged: !!(s && s.pnat && s.pnat[dex]), natV, natWhy, bestNat,
        abil: cur, abilOpts, abV, abWhy, abSlot: ab.slot,
        moves, attacks, plan, bonds, steps, planFx, items, style: cfg.style, evoStats, tmBuy, start, startRec, hasStartUpg, upgLv, custom: pinned.length > 0,
        used: (s && s.pused && +s.pused[dex]) || 0,
        power: planFx.dmg * perkK, solo: steps[0] * perkK, perkK, tough, toughInfo
      };
    }

    const monName = d => { try { return String(G.T(G.DEX_BY[d].name)); } catch (e) { return ''; } };
    return { analyze, natName, typeName, monName, togglePin, resetPins: dex => setPins(dex, []) };
  }

  function installAnalyzer(G, toast, core) {
    const A = core || analyzerCore(G);
    let el = null, rows = [], openDex = null, sortBy = 'power', query = '', allOpen = false;
    // Filtros como los de la Pokédex del juego: región, tengo/me faltan, categoría, rareza y tipo.
    // scale: 'game' = barras y puestos sobre los 966 Pokémon del juego · 'col' = sobre tu colección.
    const F0 = () => ({ gen: 0, status: 'own', cats: new Set(), rar: new Set(), type: '', scale: 'game' });
    let filt = F0();
    const cache = new Map();          // dex → análisis (de esta apertura del analizador)
    let job = 0, gameDone = false, ranks = null;
    const ownedSet = () => { const s = G.DB && G.DB.save; return new Set((s && s.owned ? Object.keys(s.owned) : []).map(Number)); };
    const DEXL = () => arr(G.DEX).filter(p => p && G.DEX_BY[p.dex]);

    function addMenuButton() {
      if (document.getElementById('psg-an-btn')) return true;
      const list = document.querySelector('#scr-menu .menu-list');
      if (!list) return false;
      const b = document.createElement('button');
      b.id = 'psg-an-btn';
      b.className = 'menu-item';
      b.setAttribute('translate', 'no');
      // Igual que los botones del juego: icono (columna 1) + título + subtítulo (columna 2).
      let ico = '';
      try { ico = G.Icons && G.Icons.html ? String(G.Icons.html('star', 26)) : ''; } catch (e) { /* nada */ }
      b.innerHTML = '<span class="mi-ico">' + (ico || '<span style="font-size:22px;line-height:26px">📊</span>') + '</span>'
        + 'Analizador<small>PSG · naturaleza, habilidad y combos</small>';
      const after = list.querySelector('[data-go="dex"]');
      list.insertBefore(b, after ? after.nextSibling : null);
      b.addEventListener('click', open);
      // Segundo botón, a la vista: abre directamente la copia de seguridad / mover de cuenta.
      const m = document.createElement('button');
      m.id = 'psg-mig-btn';
      m.className = 'menu-item';
      m.setAttribute('translate', 'no');
      m.innerHTML = '<span class="mi-ico"><span style="font-size:22px;line-height:26px">⇄</span></span>'
        + 'Copia de partida<small>PSG · guarda una copia de tu progreso</small>';
      list.insertBefore(m, b.nextSibling);
      m.addEventListener('click', openMigration);
      return true;
    }
    /** Abre el Analizador con la copia de seguridad desplegada y a la vista. */
    function openMigration() {
      open();
      const d = el && el.querySelector('.psg-mig');
      if (!d) return;
      d.open = true;
      try { d.scrollIntoView({ block: 'start' }); } catch (e) { /* nada */ }
    }
    if (!addMenuButton()) { const t = setInterval(() => { if (addMenuButton()) clearInterval(t); }, 1000); }

    function analyzeOne(d) {
      try { const r = A.analyze(d); if (r) cache.set(d, r); return r; } catch (e) { console.warn('[PSG] no se pudo analizar', d, e); return null; }
    }
    function open() {
      // Se abre siempre (aunque la cuenta esté vacía). Primero tu colección; el resto del juego, en segundo plano.
      cache.clear(); gameDone = false; ranks = null;
      for (const d of ownedSet()) if (G.DEX_BY[d]) analyzeOne(d);
      if (!el) build();
      el.classList.remove('psg-hidden');
      collect(); rescale(); paint();
      startJob();
    }
    function close() { if (el) el.classList.add('psg-hidden'); job++; }
    /** Analiza los 966 del juego poco a poco (sin parar la pantalla) para los puestos y la escala del juego. */
    function startJob() {
      const my = ++job, todo = DEXL().map(p => +p.dex).filter(d => !cache.has(d));
      let i = 0;
      const step = () => {
        if (my !== job) return;
        const t0 = performance.now();
        while (i < todo.length && performance.now() - t0 < 25) analyzeOne(todo[i++]);
        paintCount();
        if (i < todo.length) { setTimeout(step, 0); return; }
        gameDone = true;
        computeRanks(); collect(); rescale(); paint(false);
      };
      setTimeout(step, 0);
    }
    /** Puesto de cada Pokémon entre todos los del juego, en cada medida (1 = el mejor). */
    function computeRanks() {
      const all = [...cache.values()];
      const rk = val => { const m = new Map(); all.slice().sort((a, b) => val(b) - val(a)).forEach((r, i) => m.set(r.dex, i + 1)); return m; };
      const st = k => r => +r.base[k] || 0;
      ranks = {
        n: all.length, power: rk(r => r.power), tough: rk(r => r.tough),
        fab: rk(r => r.combo.chain[0].p), fabT: rk(r => r.combo.chain[0].t),
        pot: rk(r => r.combo.potential.p), potT: rk(r => r.combo.potential.t),
        hp: rk(st('hp')), spd: rk(st('spd')), pa: rk(st('pa')), sa: rk(st('sa')), df: rk(st('df')), sd: rk(st('sd')), bst: rk(st('bst'))
      };
    }
    /** Los que pasan los filtros (sin la búsqueda, que va aparte). */
    function collect() {
      const own = ownedSet();
      rows = DEXL().filter(p => {
        const d = +p.dex, o = own.has(d);
        if (filt.status === 'own' && !o) return false;
        if (filt.status === 'miss' && o) return false;
        if (filt.gen && +p.gen !== filt.gen) return false;
        if (filt.cats.size && !filt.cats.has(catOf(p))) return false;
        if (filt.rar.size && !filt.rar.has(+p.rarity)) return false;
        if (filt.type && !arr(p.types).includes(filt.type)) return false;
        return true;
      }).map(p => cache.get(+p.dex)).filter(Boolean);
    }
    function rescale() {
      const base = filt.scale === 'game' && gameDone ? [...cache.values()] : [...cache.values()].filter(r => r.owned);
      const top = Math.max(1, ...base.map(r => r.power)), topT = Math.max(1, ...base.map(r => r.tough));
      for (const r of cache.values()) {
        r.pct = Math.min(100, Math.round(100 * r.power / top)); r.tpct = Math.min(100, Math.round(100 * r.tough / topT));
      }
    }
    /** Vuelve a analizar un Pokémon (tras fijar o soltar un ataque) y repinta sin moverse. */
    function refresh(dex) {
      analyzeOne(dex);
      if (gameDone) computeRanks();
      collect(); rescale(); paint(false);
    }

    // =============== copia de seguridad de la partida (SÓLO LECTURA) ===============
    // Exporta tu partida (G.DB.save) como archivo/texto de respaldo. NO hay importar: el juego publicado
    // trata como trampa los Pokémon añadidos a mano a una cuenta (su servidor manda: GET /save,
    // /eco/pull, lista de sospechosos y baneos) y los quita. No intentar saltarse eso.

    function curSave() { return G.DB && G.DB.save; }
    /** La partida actual como texto (JSON). Lee con el JSON de la página (vale también en Firefox aislado). */
    function exportText() {
      const s = curSave();
      if (!s) return null;
      try { return W.JSON.stringify(s); } catch (e) { try { return JSON.stringify(s); } catch (e2) { return null; } }
    }

    function doExport() {
      const text = exportText();
      if (!text) { toast('Entra con tu cuenta (o como invitado) para exportar'); return; }
      try {
        const blob = new Blob([text], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        const d = new Date(), p = n => String(n).padStart(2, '0');
        a.download = 'pokesurvivor-partida-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch (e) { /* nada */ } }, 5000);
      } catch (e) { /* si no deja descargar, queda el texto para copiar */ }
      const ta = el.querySelector('#psg-mig-out');
      if (ta) { ta.value = text; ta.style.display = ''; try { ta.focus(); ta.select(); } catch (e) { /* nada */ } }
      try {
        (W.navigator || navigator).clipboard.writeText(text)
          .then(() => toast('Partida exportada: copiada y descargada'), () => toast('Partida exportada: cópiala del recuadro'));
      } catch (e) { toast('Partida exportada: cópiala del recuadro o usa el archivo'); }
    }

    function build() {
      el = document.createElement('div');
      el.id = 'psg-an';
      el.setAttribute('translate', 'no');
      el.innerHTML = `
        <div class="psg-an-head">
          <b>Analizador de colección</b><span class="psg-an-count"></span>
          <button type="button" class="psg-an-mig" title="Copia de seguridad de tu partida">⇄ Copia</button>
          <button type="button" class="psg-an-x" aria-label="Cerrar">✕</button>
        </div>
        <div class="psg-an-ctl">
          <input type="search" class="psg-q" placeholder="Buscar por nombre o nº…" autocomplete="off">
          <select class="psg-sort">
            <option value="power">Más potentes (plan fusionado)</option>
            <option value="pot">Más potencial (combinación ideal)</option>
            <option value="fab">Más fuertes de fábrica</option>
            <option value="gain">Más mejora con la combinación</option>
            <option value="solo">Más potentes sin vínculos</option>
            <option value="tough">Más aguante</option>
            <option value="both">Potencia + aguante</option>
            <option value="fix">Naturaleza o habilidad a revisar</option>
            <option value="used">Más usados</option>
            <option value="dex">Nº de Pokédex</option>
            <option value="rar">Rareza</option>
          </select>
        </div>
        <div class="psg-an-gens"></div>
        <details class="psg-fbox"><summary>Filtros <span class="psg-fsum"></span></summary><div class="psg-an-filt"></div></details>
        <details class="psg-fbox"><summary>ℹ️ Qué significan ⚔ 🛡 🏆</summary><p class="psg-an-help">⚔ Potencia: daño aproximado de su plan de 4 FUSIONADO con vínculos (todos a la vez), ya
          evolucionado, con sus potenciadores (Maquinación, Danza Espada…), su naturaleza, su habilidad y tus mejoras compradas.
          Sin vínculos sólo dispara el hueco activo: lo ves en el detalle. 🛡 Aguante: su vida entre el daño que recibe según sus defensas, con su
          velocidad, su habilidad y tus mejoras. 100 = el mejor de todo el juego (o de tu colección, si lo cambias en «Escala»);
          🏆 es su puesto entre los 966 del juego. Toca un Pokémon para ver sus stats de fábrica y cuánto sube con la combinación.</p></details>
        <details class="psg-mig">
          <summary>⇄ Copia de seguridad de tu partida</summary>
          <p>Guarda una <b>copia de tu progreso</b> (Pokémon, mejoras, naturalezas, MT…) en un archivo, para tenerla de
            respaldo. Sólo lee tu partida: no cambia nada.</p>
          <button type="button" id="psg-mig-export">⬇️ Exportar mi partida</button>
          <textarea id="psg-mig-out" readonly placeholder="(aquí sale tu partida al exportar)" style="display:none"></textarea>
          <p><b>¿Pasar la partida a otra cuenta?</b> No se puede hacer desde aquí: el juego guarda tu partida en su servidor
            y quita los Pokémon que se añaden a mano a una cuenta (lo trata como trampa). Para mover o recuperar una cuenta,
            pídeselo al autor en el Discord oficial: él sí puede hacerlo.</p>
        </details>
        <div class="psg-an-list"></div>`;
      document.body.appendChild(el);
      el.querySelector('.psg-an-x').addEventListener('click', close);
      el.querySelector('.psg-an-mig').addEventListener('click', () => {
        const d = el.querySelector('.psg-mig');
        d.open = true;
        try { d.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* nada */ }
      });
      el.querySelector('.psg-q').addEventListener('input', e => { query = fold(e.target.value).trim(); paint(); });
      el.querySelector('.psg-sort').addEventListener('change', e => { sortBy = e.target.value; paint(); });
      // Filtros (región, tengo/me faltan, categoría, rareza, tipo, escala).
      const onFilt = e => {
        const b = e.target.closest('[data-f]');
        if (!b) return;
        const f = b.dataset.f, v = b.dataset.v;
        if (f === 'gen') filt.gen = +v;
        else if (f === 'status') filt.status = v;
        else if (f === 'cat') { if (filt.cats.has(v)) filt.cats.delete(v); else filt.cats.add(v); }
        else if (f === 'rar') { if (filt.rar.has(+v)) filt.rar.delete(+v); else filt.rar.add(+v); }
        else if (f === 'clear') { filt = F0(); query = ''; el.querySelector('.psg-q').value = ''; }
        else return;
        collect(); rescale(); paint();
      };
      el.querySelector('.psg-an-gens').addEventListener('click', onFilt);
      el.querySelector('.psg-an-filt').addEventListener('click', onFilt);
      el.querySelector('.psg-an-filt').addEventListener('change', e => {
        if (e.target.matches('.psg-type-sel')) filt.type = e.target.value;
        else if (e.target.matches('.psg-scale')) filt.scale = e.target.value;
        else return;
        collect(); rescale(); paint();
      });
      el.querySelector('.psg-an-list').addEventListener('toggle', e => {
        if (e.target.matches && e.target.matches('details.psg-all')) allOpen = e.target.open;
      }, true);
      el.querySelector('.psg-an-list').addEventListener('click', e => {
        const pin = e.target.closest('[data-pin]');
        if (pin) {
          const dex = +pin.dataset.dex;
          if (!A.togglePin(dex, pin.dataset.pin)) toast('Ya tienes 4 ataques fijados: suelta uno primero');
          refresh(dex);
          return;
        }
        const reset = e.target.closest('[data-reset]');
        if (reset) { A.resetPins(+reset.dataset.reset); refresh(+reset.dataset.reset); return; }
        const r = e.target.closest('.psg-row');
        if (!r) return;
        const d = +r.dataset.dex;
        openDex = openDex === d ? null : d;
        paint();
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && el && !el.classList.contains('psg-hidden')) { e.stopPropagation(); e.preventDefault(); close(); }
      }, true);

      // --- copia de seguridad (sólo lectura) ---
      el.querySelector('#psg-mig-export').addEventListener('click', doExport);
    }

    const VERD = {
      ideal: ['✅', 'Ideal'], buena: ['✅', 'Buena'], normal: ['➖', 'Normal'], neutra: ['➖', 'Neutra'],
      floja: ['⚠️', 'Floja'], mala: ['❌', 'Mala'], cambiar: ['💡', 'Mejorable']
    };
    const needsFix = r => (r.natV === 'mala' || r.natV === 'floja' ? 2 : 0) + (r.abV === 'cambiar' ? 1 : 0);
    const chip = t => `<span class="psg-type" style="background:${esc((G.U.TYPE_COLOR || {})[t] || '#666')}">${esc(A.typeName(t))}</span>`;
    const catTxt = c => (c === 'physical' ? 'Físico' : c === 'special' ? 'Especial' : '—');

    function paintCount() {
      const c = el && el.querySelector('.psg-an-count');
      if (c) c.textContent = ' · ' + rows.length + ' Pokémon' + (gameDone ? '' : ' · calculando el juego ' + cache.size + '/' + DEXL().length + '…');
    }
    function paintFilters() {
      const own = ownedSet(), all = DEXL();
      const fc = (f, v, on, html) => `<button type="button" class="psg-fc${on ? ' on' : ''}" data-f="${f}" data-v="${esc(v)}">${html}</button>`;
      el.querySelector('.psg-an-gens').innerHTML = ['Todas'].concat(GEN_NAMES).map((n, g) => {
        const l = g ? all.filter(p => +p.gen === g) : all;
        return fc('gen', g, filt.gen === g, `<b>${n}</b><small>${l.filter(p => own.has(+p.dex)).length}/${l.length}</small>`);
      }).join('');
      const types = Object.keys((G.U && G.U.TYPE_NAME) || {});
      el.querySelector('.psg-an-filt').innerHTML =
        [['own', 'Tengo'], ['miss', 'Me faltan'], ['all', 'Todos']].map(([k, t]) => fc('status', k, filt.status === k, t)).join('')
        + '<span class="psg-fsep"></span>'
        + ['normal', 'leg', 'myth'].map(k => fc('cat', k, filt.cats.has(k), CAT_NAME[k])).join('')
        + '<span class="psg-fsep"></span>'
        + [5, 4, 3, 2, 1].map(r => fc('rar', r, filt.rar.has(r), '★'.repeat(r) + ' ' + RARITY_NAME[r])).join('')
        + `<select class="psg-type-sel"><option value="">Todos los tipos</option>${types.map(t =>
            `<option value="${esc(t)}"${filt.type === t ? ' selected' : ''}>${esc(A.typeName(t))}</option>`).join('')}</select>`
        + `<select class="psg-scale" title="Con quién se comparan las barras"><option value="game"${filt.scale === 'game' ? ' selected' : ''}>Escala: todo el juego</option>
            <option value="col"${filt.scale === 'col' ? ' selected' : ''}>Escala: tu colección</option></select>`
        + fc('clear', '', false, '✕ Quitar filtros');
      const on = [{ own: 'Tengo', miss: 'Me faltan', all: 'Todos' }[filt.status]].concat([...filt.cats].map(k => CAT_NAME[k]),
        [...filt.rar].sort().reverse().map(r => '★' + r), filt.type ? [A.typeName(filt.type)] : [], filt.scale === 'col' ? ['escala: colección'] : []);
      el.querySelector('.psg-fsum').textContent = '· ' + on.join(' · ');
    }
    const gainOf = r => r.combo.chain[r.combo.chain.length - 1].p / Math.max(1e-9, r.combo.chain[0].p);

    function paint(scroll = true) {
      const list = el.querySelector('.psg-an-list');
      paintFilters();
      // Búsqueda como la del juego: por número (#487) o por nombre, en todas las regiones.
      const num = /^#?\d+$/.test(query) ? +query.replace('#', '') : null;
      let shown = !query ? rows : num != null ? [...cache.values()].filter(r => r.dex === num)
        : rows.filter(r => fold(r.name).includes(query) || fold(A.monName(r.dex)).includes(query));
      const by = {
        pot: (a, b) => b.combo.potential.p - a.combo.potential.p,
        fab: (a, b) => b.combo.chain[0].p - a.combo.chain[0].p,
        gain: (a, b) => gainOf(b) - gainOf(a),
        rar: (a, b) => b.rarity - a.rarity || a.dex - b.dex,
        power: (a, b) => b.power - a.power,
        solo: (a, b) => b.solo - a.solo || b.power - a.power,
        tough: (a, b) => b.tough - a.tough,
        both: (a, b) => (b.pct + b.tpct) - (a.pct + a.tpct) || b.power - a.power,
        fix: (a, b) => needsFix(b) - needsFix(a) || b.power - a.power,
        used: (a, b) => b.used - a.used || b.power - a.power,
        dex: (a, b) => a.dex - b.dex
      }[sortBy];
      shown = shown.slice().sort(by);
      paintCount();
      list.innerHTML = shown.map(r => {
        const nv = VERD[r.natV] || VERD.normal, av = VERD[r.abV] || VERD.normal;
        const rk = ranks && ranks.power.get(r.dex);
        return `<div class="psg-row${openDex === r.dex ? ' open' : ''}${r.owned ? '' : ' miss'}" data-dex="${r.dex}">
            <div class="psg-row-name"><small>#${r.dex}</small> ${esc(r.name)} ${r.types.map(chip).join('')}
              <small class="psg-meta">${GEN_NAMES[r.gen - 1] || ''} · ${'★'.repeat(r.rarity)}${r.cat !== 'normal' ? ' · ' + CAT_NAME[r.cat] : ''}${rk ? ' · 🏆 #' + rk : ''}${r.owned ? '' : ' · no lo tienes'}</small></div>
            <div class="psg-bars"><div class="psg-bar" title="Potencia"><i style="width:${r.pct}%"></i><span>⚔ ${r.pct}</span></div>
              <div class="psg-bar tough" title="Aguante"><i style="width:${r.tpct}%"></i><span>🛡 ${r.tpct}</span></div></div>
            <div class="psg-row-tags"><span title="Naturaleza">${nv[0]} ${esc(A.natName(r.nat))}</span>
              <span title="Habilidad">${av[0]} ${esc(r.abil.name)}</span></div>
          </div>${openDex === r.dex ? detail(r) : ''}`;
      }).join('') || (rows.length || cache.size > ownedSet().size || filt.status !== 'own'
        ? '<p class="psg-an-help">Ningún Pokémon coincide' + (gameDone ? '' : ' (todavía estoy calculando el resto del juego)') + '.</p>'
        : '<p class="psg-an-help">Esta cuenta no tiene Pokémon todavía. Si vienes de otra cuenta (por ejemplo de Google), '
          + 'ten en cuenta que el juego no deja pasar Pokémon entre cuentas: pídeselo al autor en el Discord oficial.</p>');
      const opened = list.querySelector('.psg-row.open');
      if (scroll && opened && opened.scrollIntoView) opened.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    function detail(r) {
      const nv = VERD[r.natV] || VERD.normal, av = VERD[r.abV] || VERD.normal;
      const natFx = r.nat.up ? `+${STAT_ES[r.nat.up]} · −${STAT_ES[r.nat.down]}` : 'sin efecto';
      const natTip = (r.natV === 'mala' || r.natV === 'floja' || r.natV === 'neutra' || r.natV === 'normal') && r.bestNat && r.bestNat.id !== r.nat.id
        ? `<p>💡 Menta recomendada: <b>${esc(A.natName(r.bestNat))}</b> (+${STAT_ES[r.bestNat.up]} · −${STAT_ES[r.bestNat.down]}).</p>` : '';
      const abOpts = r.abilOpts.length > 1 ? '<ul class="psg-opts">' + r.abilOpts.map(a =>
        `<li${a.id === r.abil.id ? ' class="cur"' : ''}><b>${esc(a.name)}</b>${a.slot === 2 ? ' <small>(oculta)</small>' : ''}
          · ${a.kind}${a.planK !== 1 ? ' · ×' + a.planK.toFixed(2) + ' en su plan' : ''}<br><small>${esc(a.desc)}</small></li>`).join('') + '</ul>' : '';
      const plan = r.plan.map(m => `<li>${m.pinned ? '📌 ' : ''}${chip(m.type)} <b>${esc(m.name)}</b> <small>${m.buff ? 'Potenciador' : catTxt(m.cat)}${m.tm ? ' · MT' : ''}${!m.buff && m.fit < 0.95 ? ' · rinde ' + Math.round(m.fit * 100) + ' %' : ''}</small>
          ${m.buff ? `<br><small>⬆️ ${esc(buffTxt(m))}</small>` : ''}
          ${m.evo ? `<br><small>🔁 Al máximo + <b>${esc(m.evoName)}</b> → ${esc(m.name)} +</small>` : m.buff ? '' : '<br><small>(no evoluciona)</small>'}</li>`).join('');
      const bondTxt = bondsHtml(r);
      const itemTxt = r.items.length ? `<p>🎒 Objeto que más le conviene (estilo ${esc((STYLES[r.style] || STYLES.equilibrado).name)}), si te sale en un cofre:</p><ol class="psg-opts">`
        + r.items.slice(0, 3).map(it => `<li><b>${esc(it.name)}</b>${it.dK > 1.001 ? ' · daño ' + pctTxt(it.dK) : ''}${Math.abs(it.tK - 1) > 0.01 ? ' · aguante ' + pctTxt(it.tK) : ''}<br><small>${esc(it.note)}</small></li>`).join('')
        + '</ol><p><small>El ayudante marca el objeto con el que quedarte cuando te salga otro (y lo elige solo en «Automático»).</small></p>' : '';
      const planHead = r.custom
        ? ` <small>· 📌 fijado por ti</small> <button type="button" class="psg-mini" data-reset="${r.dex}">↺ Volver al calculado</button>`
        : ' <small>· calculado</small>';
      const evo = r.evoStats.length ? `<p>⭐ Mejoras de stat a priorizar para sus evoluciones: <b>${r.evoStats.map(esc).join(', ')}</b>.</p>` : '';
      let start = '';
      if (r.start) {
        start = `<p>Movimiento inicial: <b>${esc(r.start.name)}</b>${r.plan.some(m => m.id === r.start.id) ? ' ✅ está en su plan.' : '.'}</p>`;
        if (r.startRec) {
          start += r.hasStartUpg
            ? `<p>💡 Cámbialo por <b>${esc(r.startRec.name)}</b> en Mejoras → Movimiento inicial.</p>`
            : `<p>💡 Con la mejora «Movimiento inicial» podrías empezar con <b>${esc(r.startRec.name)}</b>.</p>`;
        }
      }
      const tms = r.tmBuy.length ? `<p>📀 MT que entrarían en su plan: ${r.tmBuy.slice(0, 3).map(m => '<b>' + esc(m.name) + '</b>').join(', ')}.</p>` : '';
      const all = r.attacks.concat(r.moves.filter(m => m.buff)).map(m => `<tr><td><button type="button" class="psg-pin${m.pinned ? ' on' : ''}"
            data-dex="${r.dex}" data-pin="${esc(m.id)}" title="${m.pinned ? 'Soltar del plan' : 'Fijar en el plan'}">📌</button></td>
          <td>${chip(m.type)} ${esc(m.name)}${m.tm ? ' <small>MT</small>' : ''}</td>
          <td>${m.buff ? 'Potenciador' : catTxt(m.cat)}</td><td>${m.buff ? '<small>' + esc(buffShort(m)) + '</small>' : Math.round(m.score)}</td><td>${m.evo ? esc(m.evoName) : '—'}</td></tr>`).join('');
      return `<div class="psg-det">
        ${r.owned ? '' : '<p class="psg-an-help">Aún no lo tienes: la naturaleza y la habilidad son las que te tocarían en esta cuenta (salen fijas por cuenta y Pokémon).</p>'}
        <div class="psg-sec"><h4>Stats de fábrica 📊</h4>${statsHtml(r)}</div>
        <div class="psg-sec"><h4>De fábrica → combinación 🧪</h4>${comboHtml(r)}</div>
        <div class="psg-sec"><h4>Naturaleza ${nv[0]} ${nv[1]}</h4>
          <p><b>${esc(A.natName(r.nat))}</b> (${natFx})${r.natChanged ? ' <small>· cambiada con Menta</small>' : ''}.
          Su plan pega sobre todo con <b>${r.side === 'special' ? 'Ataque Especial' : 'Ataque'}</b>. ${esc(r.natWhy)}</p>${natTip}</div>
        <div class="psg-sec"><h4>Habilidad ${av[0]} ${av[1]}</h4>
          <p><b>${esc(r.abil.name)}</b>${r.abSlot === 2 ? ' <small>(oculta)</small>' : ''}: ${esc(r.abil.desc)}</p>
          <p>${esc(r.abWhy)}</p>${abOpts}</div>
        <div class="psg-sec"><h4>Aguante 🛡 ${r.tpct}</h4>${toughHtml(r)}</div>
        <div class="psg-sec"><h4>Objetos 🎒</h4>${itemTxt}</div>
        <div class="psg-sec"><h4>Plan de 4 (para fusionar)${planHead}</h4><ol>${plan}</ol>${bondTxt}${evo}${start}${tms}
          <p><small>Para elegir tú el plan, abre «Todos sus ataques» y toca 📌 (hasta 4). Los huecos que
          dejes se rellenan con la mejor combinación calculada. Las cartas de nivel y los vínculos siguen este plan.</small></p>
          <p><small>Mejoras compradas para este Pokémon: ${r.upgLv}. Partidas jugadas con él: ${r.used}.</small></p></div>
        <details class="psg-sec psg-all"${allOpen ? ' open' : ''}><summary>Todos sus ataques (${r.moves.length}) · 📌 para fijar</summary>
          <table><tr><th></th><th>Ataque</th><th>Clase</th><th>Potencia</th><th>Evoluciona con</th></tr>${all}</table></details>
      </div>`;
    }

    const pctTxt = k => (k < 1 ? '−' + Math.round((1 - k) * 100) + ' %' : k > 1 ? '+' + Math.round((k - 1) * 100) + ' %' : 'igual');
    const rkTxt = (k, dex) => (ranks && ranks[k] && ranks[k].get(dex) ? ` <small>🏆 #${ranks[k].get(dex)}/${ranks.n}</small>` : '');
    /** Los stats del juego tal cual (sin naturaleza ni mejoras) y su puesto entre todos los Pokémon. */
    function statsHtml(r) {
      const b = r.base, x = v => '×' + (+v).toFixed(2);
      const row = (label, v, k) => `<tr><td>${label}</td><td><b>${v}</b></td><td>${rkTxt(k, r.dex) || '<small>…</small>'}</td></tr>`;
      return `<p>Región <b>${GEN_NAMES[r.gen - 1] || '—'}</b> · rareza ${'★'.repeat(r.rarity)} ${RARITY_NAME[r.rarity] || ''} · categoría <b>${CAT_NAME[r.cat]}</b></p>
        <table class="psg-stats">
          ${row('❤️ Vida', Math.round(b.hp), 'hp')}
          ${row('👟 Velocidad', Math.round(b.spd), 'spd')}
          ${row('⚔ Ataque (daño físico)', x(b.pa), 'pa')}
          ${row('✨ Ataque Especial (daño especial)', x(b.sa), 'sa')}
          ${row('🛡 Defensa', Math.round(b.df), 'df')}
          ${row('🛡 Defensa Especial', Math.round(b.sd), 'sd')}
          ${row('Σ Total de stats base', Math.round(b.bst || 0), 'bst')}
        </table>
        <p><small>Así viene en el juego, sin naturaleza, sin habilidad y sin mejoras. ⚔/✨ multiplican el daño de sus ataques
          de cada lado. 🏆 = puesto entre los ${ranks ? ranks.n : DEXL().length} Pokémon del juego${ranks ? '' : ' (calculando…)'}.</small></p>`;
    }
    /** De fábrica → combinación: cuánto suma cada paso, en daño y en aguante. */
    function comboHtml(r) {
      const c = r.combo.chain, p0 = c[0].p || 1e-9, t0 = c[0].t || 1e-9;
      const n = v => Math.round(v);
      const rows = c.map((st, i) => {
        const pv = 100 * st.p / p0, tv = 100 * st.t / t0;
        const dp = i ? st.p / (c[i - 1].p || 1e-9) : 1, dt = i ? st.t / (c[i - 1].t || 1e-9) : 1;
        const d = (k, base) => (i && Math.abs(k - 1) > 0.005 ? ` <small class="${k > 1 ? 'up' : 'dn'}">${pctTxt(k)}</small>` : base);
        return `<tr${i === c.length - 1 ? ' class="tot"' : ''}><td>${i ? '+ ' : ''}${esc(st.label)}${st.key === 'abil' && r.combo.bestAbSlot === 2 ? ' <small>(oculta)</small>' : ''}</td>
          <td>⚔ <b>${n(pv)}</b>${d(dp, '')}</td><td>🛡 <b>${n(tv)}</b>${d(dt, '')}</td></tr>`;
      }).join('');
      const last = c[c.length - 1], now = r.combo.now;
      const toGo = last.p / (now.p || 1e-9);
      return `<table class="psg-combo"><tr><th></th><th>Daño</th><th>Aguante</th></tr>${rows}</table>
        <p>Con la combinación completa: daño <b>×${(last.p / p0).toFixed(1)}</b> y aguante <b>×${(last.t / t0).toFixed(1)}</b> respecto a como viene de fábrica.
          ${rkTxt('pot', r.dex) ? 'Potencial en el juego:' + rkTxt('pot', r.dex) + ' · de fábrica:' + rkTxt('fab', r.dex) : ''}</p>
        <p>${r.owned ? 'Tu ' + esc(r.name) + ' ahora' : 'Si lo consigues, al empezar'} (su naturaleza y habilidad${r.upgLv ? ', tus mejoras' : ''}, sin vínculos ni objeto):
          ⚔ <b>${n(100 * now.p / p0)}</b> · 🛡 <b>${n(100 * now.t / t0)}</b>. Con la combinación llegaría a <b>×${toGo.toFixed(1)}</b> de daño.</p>
        <p><small>De fábrica = 100. Cada paso se suma al anterior: naturaleza (Menta), habilidad (Cápsula), tus mejoras compradas,
          el plan de 4 fusionado con sus potenciadores (en partida, con los vínculos) y el objeto. Valores aproximados, para comparar.</small></p>`;
    }
    /** Lo que da un potenciador con todas sus cargas (a su nivel máximo). */
    function buffShort(m) {
      const tot = m.stacks * m.amount;
      if (m.stat === 'regen') return '+' + tot.toFixed(1) + ' vida/s';
      if (m.stat === 'def') return '−' + Math.round(tot * 100) + ' % daño recibido';
      return '+' + Math.round(tot * 100) + ' % ' + (BUFF_TXT[m.stat] || m.stat);
    }
    function buffTxt(m) {
      const who = m.stat === 'patk' ? ' a los ataques físicos de su grupo' : m.stat === 'satk' ? ' a los ataques especiales de su grupo' : '';
      return buffShort(m) + who + ' (' + m.stacks + ' cargas de ' + (m.stat === 'regen' ? m.amount.toFixed(1)
        : Math.round(m.amount * 100) + ' %') + ', al máximo de nivel). Sólo funciona en el MISMO hueco que tus ataques: fusiónalo.';
    }
    /** Orden de los vínculos y cuánto rinde el plan con cada uno. */
    function bondsHtml(r) {
      if (r.bonds.length < 2 || !r.power) return '';
      const full = r.planFx.dmg || 1, pc = v => Math.round(100 * v / full) + ' %';
      const li = ['<li>Sin vínculos (sólo dispara el hueco activo): <b>' + pc(r.steps[0]) + '</b> de su daño fusionado</li>'];
      li.push('<li>1.º vínculo: une <b>' + esc(r.bonds[0].name) + '</b> + <b>' + esc(r.bonds[1].name) + '</b> → <b>' + pc(r.steps[1]) + '</b></li>');
      for (let i = 2; i < r.bonds.length; i++) li.push('<li>' + i + '.º vínculo: añade <b>' + esc(r.bonds[i].name) + '</b> → <b>' + pc(r.steps[i]) + '</b></li>');
      const buffs = r.plan.filter(m => m.buff);
      const note = buffs.length ? '<p><small>💡 ' + buffs.map(m => esc(m.name)).join(' y ') + ' no hace' + (buffs.length > 1 ? 'n' : '')
        + ' daño, pero fusionado' + (buffs.length > 1 ? 's' : '') + ' multiplica lo de su grupo. Suelto, en otro hueco, se apaga al cambiar.</small></p>' : '';
      return '<p>🔗 Vínculos (uno por legendario vencido; el ayudante marca cuál elegir y en «Automático» lo elige solo):</p><ul class="psg-opts">'
        + li.join('') + '</ul>' + note;
    }
    function toughHtml(r) {
      const t = r.toughInfo;
      const up = [];
      if (t.hpUp) up.push('+' + t.hpUp + ' de vida');
      if (t.dmgReduce) up.push('−' + Math.round(t.dmgReduce * 100) + ' % de daño recibido');
      if (t.regen) up.push('+' + t.regen.toFixed(1) + ' de vida/s');
      if (t.spdUp > 1) up.push('+' + Math.round((t.spdUp - 1) * 100) + ' % de velocidad');
      return `<p>❤️ Vida: <b>${t.hp + t.hpUp}</b>${t.hpUp ? ` <small>(${t.hp} + ${t.hpUp} de mejoras)</small>` : ''}</p>
        <p>🛡 Defensa ${Math.round(t.df)}: daño físico recibido <b>${pctTxt(t.tP)}</b> ·
          Def. Esp. ${Math.round(t.sd)}: daño especial <b>${pctTxt(t.tS)}</b> <small>(con 75 es igual; el juego lo deja entre −22 % y +25 %)</small></p>
        <p>👟 Velocidad ${Math.round(t.spd)}: ${t.spdK >= 1 ? 'por encima' : 'por debajo'} de la media de los Pokémon del juego.</p>
        ${up.length ? `<p>⬆️ Tus mejoras: ${up.join(' · ')}.</p>` : ''}
        ${t.defAbil ? '<p>✨ Su habilidad es defensiva (cuenta un poco).</p>' : ''}
        ${t.buffTough > 1.01 ? `<p>⬆️ Con los potenciadores de su plan (${[t.buffK.def ? '−' + Math.round(t.buffK.def * 100) + ' % daño' : '',
          t.buffK.spd ? '+' + Math.round(t.buffK.spd * 100) + ' % velocidad' : '', t.buffK.regen ? '+' + t.buffK.regen.toFixed(1) + ' vida/s' : '']
          .filter(Boolean).join(', ')}): aguante <b>${pctTxt(t.buffTough)}</b>.</p>` : ''}
        <p><small>Para aguantar más en partida: estilo 🛡️ Aguante en las cartas (Vigor, Coraza, Síntesis).</small></p>`;
    }

    const css = document.createElement('style');
    css.textContent = `
      #psg-an{position:fixed;inset:0;z-index:9000;overflow:auto;-webkit-overflow-scrolling:touch;padding:12px 14px 40px;
        background:rgba(12,18,36,.97);color:#e8eefc;font-family:inherit;font-size:14px;line-height:1.35}
      #psg-an.psg-hidden{display:none}
      #psg-an .psg-an-head{display:flex;align-items:center;gap:6px;font-size:18px;position:sticky;top:-12px;padding:6px 0;background:rgba(12,18,36,.97);z-index:1}
      #psg-an .psg-an-count{color:#9fb1c9;font-size:13px;flex:1}
      #psg-an .psg-an-x{font-size:20px;background:none;border:0;color:#fff;padding:4px 10px;cursor:pointer}
      #psg-an .psg-an-ctl{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0}
      #psg-an input,#psg-an select{font-family:inherit;font-size:14px;padding:7px 9px;border-radius:8px;border:1px solid #ffffff33;background:#0b1328;color:#fff}
      #psg-an input{flex:1;min-width:150px}
      #psg-an .psg-an-help{color:#9fb1c9;font-size:12px;margin:4px 0 10px}
      #psg-an .psg-an-gens{display:flex;gap:6px;overflow-x:auto;padding:2px 0 6px;-webkit-overflow-scrolling:touch}
      #psg-an .psg-an-gens .psg-fc{display:flex;flex-direction:column;align-items:center;min-width:64px;flex:0 0 auto}
      #psg-an .psg-an-filt{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}
      #psg-an .psg-fbox{margin:0 0 6px}
      #psg-an .psg-fbox>summary{cursor:pointer;font-size:13px;color:#cfd8ea;padding:3px 0}
      #psg-an .psg-fsum{color:#ffd23f;font-size:12px}
      #psg-an .psg-fc{font-family:inherit;font-size:12px;padding:5px 9px;border-radius:999px;border:1px solid #ffffff33;background:#0b1328;color:#dfe7f7;cursor:pointer}
      #psg-an .psg-fc small{font-size:10px;color:#9fb1c9}
      #psg-an .psg-fc.on{background:#ffd23f;color:#2a2000;border-color:#ffd23f}
      #psg-an .psg-fc.on small{color:#4a3a00}
      #psg-an .psg-fsep{width:1px;height:18px;background:#ffffff22;margin:0 2px}
      #psg-an .psg-an-filt select{font-size:12px;padding:5px 7px}
      #psg-an .psg-meta{display:block;font-size:11px;color:#9fb1c9;margin-top:2px}
      #psg-an .psg-row.miss{opacity:.72}
      #psg-an table.psg-stats td,#psg-an table.psg-combo td,#psg-an table.psg-combo th{padding:3px 6px;text-align:left}
      #psg-an table.psg-combo tr.tot td{border-top:1px solid #ffffff33;color:#ffe48a}
      #psg-an small.up{color:#7be495}
      #psg-an small.dn{color:#ff9a9a}
      #psg-an .psg-an-mig{font-family:inherit;font-size:12px;font-weight:600;padding:5px 10px;border-radius:999px;
        border:1px solid #ffd23f;background:#ffd23f;color:#2a2000;cursor:pointer}
      #psg-an .psg-mig{scroll-margin-top:56px;margin:0 0 10px;background:#ffffff0a;border-radius:10px;padding:6px 10px}
      #psg-an .psg-mig>summary{cursor:pointer;color:#ffd23f;font-weight:600}
      #psg-an .psg-mig p{font-size:12px;color:#cfd8ea;margin:6px 0}
      #psg-an .psg-mig textarea{width:100%;box-sizing:border-box;min-height:54px;margin:4px 0;border-radius:8px;
        border:1px solid #ffffff33;background:#0b1328;color:#cfe0ff;font-size:11px;font-family:monospace;padding:6px}
      #psg-an .psg-mig button{font-family:inherit;font-size:13px;font-weight:600;padding:8px 12px;border-radius:8px;
        border:1px solid #ffd23f;background:#ffd23f;color:#2a2000;cursor:pointer;margin:2px 0}
      #psg-an .psg-mig input[type=file]{color:#9fb1c9;font-size:12px;margin:4px 0}
      #psg-an .psg-row{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(70px,1fr) minmax(0,1.6fr);gap:8px;align-items:center;
        padding:8px 10px;margin:4px 0;border-radius:10px;background:#ffffff0d;cursor:pointer;scroll-margin-top:56px}
      #psg-an .psg-row.open{background:#ffd23f22;outline:1px solid #ffd23f88}
      #psg-an .psg-row-name small{color:#9fb1c9}
      #psg-an .psg-row-tags{display:flex;flex-direction:column;font-size:12px;color:#cfd8ea}
      #psg-an .psg-type{display:inline-block;font-size:10px;padding:1px 6px;border-radius:999px;color:#fff;margin-left:3px;vertical-align:middle;text-shadow:0 1px 1px #0008}
      #psg-an .psg-bar{position:relative;height:16px;border-radius:8px;background:#ffffff14;overflow:hidden}
      #psg-an .psg-bar i{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#3f8cff,#ffd23f)}
      #psg-an .psg-bar.tough i{background:linear-gradient(90deg,#1f9d6a,#9be15d)}
      #psg-an .psg-bars{display:flex;flex-direction:column;gap:3px}
      #psg-an .psg-bar span{position:relative;font-size:11px;padding-left:6px;color:#fff;text-shadow:0 1px 2px #000}
      #psg-an .psg-det{padding:4px 6px 10px;margin:0 0 8px;display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
      #psg-an .psg-sec{background:#ffffff0a;border-radius:10px;padding:8px 10px}
      #psg-an .psg-sec h4{margin:0 0 6px;font-size:14px;color:#ffd23f}
      #psg-an .psg-sec p{margin:4px 0}
      #psg-an .psg-sec ol{margin:4px 0;padding-left:20px}
      #psg-an .psg-sec li{margin:4px 0}
      #psg-an .psg-opts{list-style:none;padding:0;margin:6px 0}
      #psg-an .psg-opts li{padding:4px 6px;border-radius:6px}
      #psg-an .psg-opts li.cur{background:#ffffff12}
      #psg-an details{grid-column:1/-1}
      #psg-an summary{cursor:pointer;color:#ffd23f}
      #psg-an table{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}
      #psg-an td,#psg-an th{padding:3px 4px;border-bottom:1px solid #ffffff14;text-align:left}
      #psg-an small{color:#9fb1c9}
      #psg-an .psg-pin{background:none;border:1px solid #ffffff22;border-radius:6px;padding:2px 5px;cursor:pointer;filter:grayscale(1);opacity:.45}
      #psg-an .psg-pin.on{filter:none;opacity:1;border-color:#ffd23f;background:#ffd23f22}
      #psg-an .psg-mini{font-family:inherit;font-size:11px;padding:3px 8px;border-radius:999px;border:1px solid #ffd23f88;background:none;color:#ffd23f;cursor:pointer;margin-left:4px}
      @media (max-width:560px){#psg-an .psg-row{grid-template-columns:1fr 70px}#psg-an .psg-row-tags{grid-column:1/-1;flex-direction:row;gap:12px}}
    `;
    (document.head || document.documentElement).appendChild(css);

    return { open, close, analyze: A.analyze, togglePin: A.togglePin, resetPins: A.resetPins,
             exportSave: exportText };
  }

  function install(G) {
    // Objeto para depurar desde la consola (y para tests/e2e.cjs). En modo content el juego no
    // puede leer objetos nuestros: sólo se deja una marca con la versión.
    const mod = { version: VERSION, mode: MODE, cfg };
    if (W !== window && !W.__psgSimXray) W.__psgModVersion = VERSION; else W.__psgMod = mod;   // (__psgSimXray: tests/e2e.cjs)
    if (W.__psgTest && !safe(() => W.G)) W.G = G;     // sólo para tests/e2e.cjs (el juego publicado no tiene window.G)

    const origOffer = G.LevelUp.offer;
    const origShow = G.RunUI.showLevelUp;

    let lastList = null, token = 0, autoT = 0, freeShift = 0, regenerating = false, runSeq = 0;
    let shown = null;              // { level, cb, coop } de la pantalla de cartas abierta
    // Si algo nuestro falla, se avisa en pantalla (para poder mandar una captura) y el juego sigue como siempre.
    let lastErr = 0;
    const report = (where, e) => {
      console.error('[PSG] ' + where, e);
      if (Date.now() - lastErr < 8000) return;
      lastErr = Date.now();
      try { G.UI.toast('Ayudante PSG (' + MODE + ') · error en ' + where + ': ' + ((e && e.message) || e), 6000); } catch (x) { /* nada */ }
    };

    const core = analyzerCore(G);
    let planCache = { run: 0, v: null };
    /** Nº de partida (se apunta en el propio jugador, que es nuevo en cada partida). */
    const runOf = pl => (pl.__psgRun || (pl.__psgRun = ++runSeq));
    /** Plan de 4 ataques del analizador para el Pokémon de esta partida (o null). */
    function planFor(pl) {
      if (!cfg.plan || !pl) return null;
      if (planCache.run && planCache.run === runOf(pl)) return planCache.v;
      let v = null;
      try {
        const dex = pl.dex != null ? pl.dex : pl.mon && pl.mon.dex;
        const r = dex != null ? core.analyze(dex) : null;
        if (r && r.plan.length) {
          const needs = {};
          for (const m of r.plan) if (m.evo) (needs[m.evo] = needs[m.evo] || []).push(m.name);
          // scores: lo que vale cada ataque suelto; los del plan, lo que aportan al grupo fusionado
          // (así un potenciador del plan no cuenta como 0).
          const scores = Object.fromEntries(r.attacks.map(m => [m.id, m.score]));
          for (const m of r.plan) scores[m.id] = Math.max(scores[m.id] || 0, m.gain || 0);
          v = { ids: r.plan.map(m => m.id), names: Object.fromEntries(r.plan.map(m => [m.id, m.name])), needs, scores,
                bonds: r.bonds.map(m => m.id), items: Object.fromEntries(r.items.map((it, i) => [it.id, { v: it.v, rank: i + 1, note: it.note }])) };
        }
      } catch (e) { console.warn('[PSG] no se pudo calcular el plan', e); }
      planCache = { run: runOf(pl), v };
      return v;
    }

    const coopActive = () => !!(G.Coop && G.Coop.active);
    // La partida que usa el modo libre se marca en su propio jugador (nuevo en cada partida).
    const runForced = () => { const p = G.Game.player; return !!(p && p.__psgForced); };
    const toast = msg => { try { G.UI.toast(msg, 2600); } catch (e) { /* nada */ } };
    const screenOpen = () => {
      const el = document.getElementById('scr-levelup');
      return !!el && !el.classList.contains('hidden') && !!document.querySelector('#cards .card');
    };

    /** Todas las cartas que puede ofrecer el juego ahora (muestreando el sorteo original). */
    function fullPool(pl) {
      const seen = new Map();
      for (let i = 0; i < 48; i++) {
        let l;
        try { l = arr(origOffer.call(G.LevelUp, pl, 3)); } catch (e) { break; }
        for (const c of l) if (!seen.has(c.key)) seen.set(c.key, c);
      }
      return [...seen.values()];
    }

    function freeOffer(pl, n) {
      const pool = fullPool(pl);
      annotate(G, pool, pl, planFor(pl));
      pool.sort((a, b) => sc(b) - sc(a));
      const pinned = pool.filter(c => c.type === 'evo');          // la evolución sale siempre, como en el juego
      const rest = pool.filter(c => c.type !== 'evo');
      const room = Math.max(0, n - pinned.length);
      // «Cambiar opciones» con el modo libre: las siguientes del ranking de cartas.
      freeShift = !regenerating && screenOpen() ? freeShift + room : 0;
      const start = rest.length > room ? freeShift % rest.length : 0;
      const rotated = rest.slice(start).concat(rest.slice(0, start));
      pl.__psgForced = true;
      return pinned.concat(rotated.slice(0, room)).slice(0, n);
    }

    if (MODE !== 'limitado') {
    G.LevelUp.offer = exp(function (plArg, n) {
      try {
        const pl = unX(plArg), k = n || 3;
        let list;
        if (cfg.free && pl && !coopActive()) list = toPage(freeOffer(pl, k));
        else { list = unX(origOffer.call(G.LevelUp, pl, k)); if (pl) annotate(G, list, pl, planFor(pl)); }
        lastList = list;
        const my = ++token;
        setTimeout(() => { try { decorate(my); } catch (e) { report('las cartas', e); } }, 0);   // el juego pinta las cartas justo después
        return list;
      } catch (e) {
        report('el sorteo', e);
        return origOffer.call(G.LevelUp, plArg, n);              // pase lo que pase, el juego sigue
      }
    });

    // (Siempre con argumentos sueltos, nunca `arguments`: en modo content el juego no podría leerlo.)
    G.RunUI.showLevelUp = exp(function (level, list, cb, coop) {
      shown = { level, cb, coop: !!coop };
      return origShow.call(G.RunUI, level, list, cb, coop);
    });

    // Vínculo (al vencer a un legendario): qué movimientos fusionar. Se marca el que pide el plan y,
    // en «Automático», se elige solo (en dos pasos si hay que unir dos sueltos).
    if (isFn(G.RunUI, 'showBond')) {
      const origBond = G.RunUI.showBond;
      G.RunUI.showBond = exp(function (opt, cb) {
        const r = origBond.call(G.RunUI, opt, cb);
        try { bondOpt = unX(opt); watchBond(); setTimeout(() => { try { decorateBond(); } catch (e) { report('el vínculo', e); } }, 0); }
        catch (e) { report('el vínculo', e); }
        return r;
      });
    }
    // Objeto nuevo llevando ya otro: ¿con cuál te quedas?
    if (isFn(G.RunUI, 'showItemChoice')) {
      const origItem = G.RunUI.showItemChoice;
      G.RunUI.showItemChoice = exp(function (cur, next, cb) {
        const r = origItem.call(G.RunUI, cur, next, cb);
        try { const c = String(cur), n = String(next); setTimeout(() => { try { decorateItem(c, n); } catch (e) { report('el objeto', e); } }, 0); }
        catch (e) { report('el objeto', e); }
        return r;
      });
    }

    for (const fn of ['submitSolo', 'submitGroup']) {
      const orig = G.Ranking[fn];
      if (typeof orig !== 'function') continue;
      G.Ranking[fn] = exp(function (a, b, c) {
        let blocked = false;
        try { blocked = runForced(); } catch (e) { report('el ranking', e); }
        if (blocked) { toast('Modo libre: esta partida no se sube al ranking'); return null; }
        return orig.call(G.Ranking, a, b, c);
      });
    }
    }   // (fin de los ganchos: en modo «limitado» el juego no podría llamar a funciones nuestras)

    // ---------------- pantalla de cartas ----------------

    function decorate(my) {
      if (my !== token || !lastList) return;
      const box = document.getElementById('cards');
      if (!box) return;
      const els = box.querySelectorAll('.card');
      if (els.length !== lastList.length) return;
      const best = bestIndex(lastList);
      els.forEach((el, i) => {
        const c = lastList[i];
        if (!c || c.__psgW == null || el.querySelector('.psg-badge')) return;
        el.classList.toggle('psg-best', i === best);
        const b = document.createElement('div');
        b.className = 'psg-badge';
        b.setAttribute('translate', 'no');       // el traductor del juego no debe tocarlo
        b.textContent = (i === best ? '★ Recomendada · ' : '') + c.__psgW;
        (el.querySelector('.txt') || el).appendChild(b);
      });
      paintBar();
      scheduleAuto(my, best);
    }

    function scheduleAuto(my, best) {
      clearTimeout(autoT);
      if (!cfg.auto) return;
      const delay = Math.max(750, +cfg.delay || DEF.delay);    // el juego bloquea las cartas 0,6 s al abrirlas
      autoT = setTimeout(() => {
        if (my !== token || !cfg.auto || !screenOpen()) return;
        G.RunUI.pick(best);
      }, delay);
    }

    // ---------------- vínculos y objetos ----------------

    let bondOpt = null, bondObs = null, bondT = 0, itemT = 0;
    const isShown = id => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden'); };
    /** En el paso 2 de «unir dos sueltos» el juego vuelve a pintar las cartas: se vuelven a marcar. */
    function watchBond() {
      const box = document.getElementById('bond-cards');
      if (!box || bondObs) return;
      bondObs = new MutationObserver(() => { try { decorateBond(); } catch (e) { report('el vínculo', e); } });
      bondObs.observe(box, { childList: true });
    }
    /** Movimientos del jugador en el orden de las cartas del vínculo (se reconocen por su nombre). */
    function bondCards() {
      const loose = arr(bondOpt && bondOpt.loose);
      return [...document.querySelectorAll('#bond-cards .card')].map(el => {
        const t = ((el.querySelector('.nm') || el).textContent || '').trim();
        const m = loose.filter(x => t.startsWith(moveName(G, x))).sort((a, b) => moveName(G, b).length - moveName(G, a).length)[0];
        return { el, m };
      });
    }
    function decorateBond() {
      if (!bondOpt || !isShown('scr-bond')) return;
      const cards = bondCards();
      if (!cards.length || cards.some(c => c.el.querySelector('.psg-badge'))) return;
      const plan = planFor(G.Game.player);
      // Primero, los del plan en el orden de sus vínculos; si no, el que más daño hace.
      const rank = m => {
        if (!m) return 1e9;
        const i = plan && plan.bonds ? plan.bonds.indexOf(m.id) : -1;
        const v = (plan && plan.scores[m.id]) || +m.dmg || 0;
        return i >= 0 ? i : 100 + 1 / (1 + v);
      };
      let best = 0;
      cards.forEach((c, i) => { if (rank(c.m) < rank(cards[best].m)) best = i; });
      cards.forEach((c, i) => {
        c.el.classList.toggle('psg-best', i === best);
        if (i !== best || !c.m) return;
        const k = plan && plan.bonds ? plan.bonds.indexOf(c.m.id) : -1;
        const b = document.createElement('div');
        b.className = 'psg-badge';
        b.setAttribute('translate', 'no');
        b.textContent = '★ Recomendado · ' + (k >= 0 ? 'va en el grupo de tu plan (n.º ' + (k + 1) + ' de ' + plan.bonds.length + ')'
          : 'el que más suma al grupo');
        (c.el.querySelector('.txt') || c.el).appendChild(b);
      });
      clearTimeout(bondT);
      if (!cfg.auto || !isFn(G.RunUI, 'pickBond')) return;
      bondT = setTimeout(() => {
        if (!cfg.auto || !isShown('scr-bond')) return;
        try { G.RunUI.pickBond(best); } catch (e) { report('el vínculo', e); }
      }, Math.max(750, +cfg.delay || DEF.delay));
    }
    function decorateItem(cur, next) {
      if (!isShown('scr-item')) return;
      const els = [...document.querySelectorAll('#item-cards .card')];
      if (els.length !== 2 || els.some(e => e.querySelector('.psg-badge'))) return;
      const plan = planFor(G.Game.player), it = plan && plan.items;
      if (!it || !it[cur] || !it[next]) return;
      const best = it[next].v > it[cur].v * 1.01 ? 1 : 0, id = best ? next : cur;
      els.forEach((e, i) => e.classList.toggle('psg-best', i === best));
      const b = document.createElement('div');
      b.className = 'psg-badge';
      b.setAttribute('translate', 'no');
      b.textContent = '★ Recomendado · n.º ' + it[id].rank + ' de los objetos para tu Pokémon (' + styleOf().name + ')';
      (els[best].querySelector('.txt') || els[best]).appendChild(b);
      clearTimeout(itemT);
      if (!cfg.auto) return;
      itemT = setTimeout(() => { if (cfg.auto && isShown('scr-item')) els[best].click(); }, Math.max(750, +cfg.delay || DEF.delay));
    }

    /** Vuelve a sacar las cartas de la pantalla abierta (al activar el modo libre). */
    function regenerate() {
      const pl = G.Game.player;
      if (!shown || !pl || !screenOpen()) return;
      regenerating = true;
      let list;
      try { list = G.LevelUp.offer(pl); } finally { regenerating = false; }
      try { origShow.call(G.RunUI, shown.level, list, shown.cb, shown.coop); } catch (e) { report('las cartas', e); }
    }

    function onTap(el, fn) {
      let fired = -1e9;
      el.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') { fired = performance.now(); fn(); } });
      el.addEventListener('click', () => { if (performance.now() - fired > 700) fn(); });
    }

    function paintBar() {
      const scr = document.getElementById('scr-levelup');
      const cards = document.getElementById('cards');
      if (!scr || !cards) return;
      let bar = document.getElementById('psg-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'psg-bar';
        bar.setAttribute('translate', 'no');
        bar.innerHTML = '<button type="button" class="psg-chip" data-k="auto"></button>'
          + '<button type="button" class="psg-chip" data-k="style"></button>'
          + '<button type="button" class="psg-chip" data-k="plan"></button>'
          + '<button type="button" class="psg-chip" data-k="free"></button>'
          + '<div class="psg-plan"></div><div class="psg-note"></div>';
        cards.parentNode.insertBefore(bar, cards);
        onTap(bar.querySelector('[data-k="auto"]'), () => {
          cfg.auto = !cfg.auto; saveCfg(); paintBar();
          if (cfg.auto && lastList && screenOpen()) scheduleAuto(token, bestIndex(lastList));
          else clearTimeout(autoT);
        });
        onTap(bar.querySelector('[data-k="free"]'), () => {
          if (!cfg.free && coopActive()) { toast('El modo libre no se usa en cooperativo'); return; }
          cfg.free = !cfg.free; saveCfg(); paintBar();
          // Al encenderlo se cambian las cartas abiertas; al apagarlo se quedan las que hay
          // (si no, apagar y encender sería un «cambiar opciones» gratis).
          if (cfg.free) regenerate();
        });
        onTap(bar.querySelector('[data-k="style"]'), () => {
          cfg.style = STYLE_ORDER[(STYLE_ORDER.indexOf(cfg.style) + 1) % STYLE_ORDER.length]; saveCfg();
          if (cfg.free && !coopActive()) regenerate(); else rescore();
          paintBar();
        });
        onTap(bar.querySelector('[data-k="plan"]'), () => {
          cfg.plan = !cfg.plan; saveCfg();
          // Con el modo libre las cartas salen del plan: se vuelven a sacar; si no, sólo se repuntúan.
          if (cfg.free && !coopActive()) regenerate(); else rescore();
          paintBar();
        });
      }
      const a = bar.querySelector('[data-k="auto"]'), f = bar.querySelector('[data-k="free"]');
      a.textContent = cfg.auto ? '🤖 Automático' : '👆 Selección';
      a.classList.toggle('on', cfg.auto);
      f.textContent = '🔓 Modo libre: ' + (cfg.free ? 'ON' : 'OFF');
      f.classList.toggle('on', cfg.free);
      const sb = bar.querySelector('[data-k="style"]');
      sb.textContent = styleOf().label;
      sb.classList.toggle('on', cfg.style !== 'equilibrado');
      const pb = bar.querySelector('[data-k="plan"]');
      pb.textContent = '📋 Plan: ' + (cfg.plan ? 'ON' : 'OFF');
      pb.classList.toggle('on', cfg.plan);
      const pl = G.Game.player, plan = planFor(pl);
      let line = '';
      if (plan && pl) {
        const learned = movesOf(pl), has = id => learned.some(m => m.id === id);
        line = 'Plan: ' + plan.ids.map(id => (has(id) ? '✔ ' : '') + plan.names[id]).join(' · ');
        const st = Object.keys(plan.needs);
        if (st.length) {
          const nn = (G.Moves && G.Moves.NEED_NAME) || {};
          line += ' — mejoras: ' + st.map(k => ((pl.statsTaken || {})[k] ? '✔ ' : '') + (nn[k] || k)).join(', ');
        }
      }
      bar.querySelector('.psg-plan').textContent = line;
      bar.querySelector('.psg-note').textContent = runForced() ? 'Esta partida ya no se subirá al ranking.' : '';
    }

    /** Vuelve a puntuar las cartas abiertas sin cambiarlas (al encender o apagar el plan). */
    function rescore() {
      const pl = G.Game.player;
      if (!lastList || !pl || !screenOpen()) return;
      annotate(G, lastList, pl, planFor(pl));
      document.querySelectorAll('#cards .psg-badge').forEach(b => b.remove());
      document.querySelectorAll('#cards .psg-best').forEach(b => b.classList.remove('psg-best'));
      decorate(token);
    }

    const css = document.createElement('style');
    css.textContent = `
      #psg-bar{display:flex;flex-wrap:wrap;gap:6px 8px;justify-content:center;margin:4px 0 8px;
        width:0;min-width:100%;box-sizing:border-box}  /* ocupa el ancho de las cartas sin ensancharlas */
      #psg-bar .psg-chip{font-family:inherit;font-weight:600;font-size:13px;line-height:1;padding:6px 11px;border-radius:999px;border:1px solid #ffffff40;
        background:#00000055;color:#fff;cursor:pointer;touch-action:manipulation}
      #psg-bar .psg-chip.on{background:#ffd23f;color:#2a2000;border-color:#ffd23f}
      #psg-bar .psg-note{width:100%;text-align:center;font-size:12px;color:#ffaaaa;min-height:0}
      #psg-bar .psg-note:empty,#psg-bar .psg-plan:empty{display:none}
      #psg-bar .psg-plan{width:100%;text-align:center;font-size:12px;line-height:1.3;color:#cfe0ff}
      .card.psg-best{outline:3px solid #ffd23f;outline-offset:2px;box-shadow:0 0 14px #ffd23f88}
      .psg-badge{margin-top:4px;font-size:12px;line-height:1.25;color:#ffe48a}
    `;
    (document.head || document.documentElement).appendChild(css);

    // Para depurar desde la consola (y para tests/e2e.cjs).
    mod.score = (c, pl) => score(G, c, pl, { waiting: waitingStats(G, pl), plan: planFor(pl) });
    mod.plan = () => planFor(G.Game.player);
    mod.fullPool = () => (G.Game.player ? fullPool(G.Game.player) : []);
    Object.defineProperty(mod, 'forced', { get: runForced });

    try { mod.analyzer = installAnalyzer(G, toast, core); }
    catch (e) { console.error('[PSG] no se pudo instalar el analizador', e); }
    // (el aviso de «funcionando» lo da el indicador de estado, ver «arranque»)
  }
})();
