// ==UserScript==
// @name         PokéSurvivor · Ayudante de cartas (PSG)
// @namespace    https://github.com/yeikoromeo2/proyecto-psg
// @version      0.1.0
// @description  Recomienda la mejor carta al subir de nivel, puede elegirla sola y trae un modo libre que no sube al ranking.
// @match        https://pokesurvivor.com/*
// @match        https://www.pokesurvivor.com/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

/*
 * Cómo funciona (resumen; detalles en README.md):
 *
 *  - El juego expone sus módulos en window.G. Este script espera a que existan
 *    y envuelve tres funciones, sin cambiar nada más del juego:
 *      G.LevelUp.offer      las 3 cartas de cada subida de nivel
 *      G.RunUI.showLevelUp  la pantalla de cartas (para poder volver a pintarla)
 *      G.Ranking.submit*    la subida al ranking (para bloquearla en modo libre)
 *
 *  - Selector: puntúa las cartas ofrecidas, marca la mejor con el motivo y, en
 *    modo «Automático», la elige sola tras un instante.
 *
 *  - Modo libre: en vez del sorteo, junta todas las cartas posibles en ese
 *    momento y ofrece las 3 mejores (al «Cambiar opciones», las siguientes).
 *    La partida en la que se use queda marcada y NO se sube al ranking.
 *    En cooperativo no se usa.
 *
 *  - Se inyecta en «document-start» para ejecutarse antes de que el juego
 *    declare su Content-Security-Policy (que bloquea scripts añadidos después).
 */
(function () {
  'use strict';

  const W = window;
  if (W.__psgMod) return;
  const VERSION = '0.1.0';

  // ---------------- ajustes (sólo en este navegador) ----------------

  const KEY = 'psg.mod.v1';
  const DEF = { auto: false, free: false, delay: 900 };
  const cfg = (() => {
    try { return Object.assign({}, DEF, JSON.parse(W.localStorage.getItem(KEY) || '{}')); }
    catch (e) { return Object.assign({}, DEF); }
  })();
  function saveCfg() { try { W.localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* sin almacenamiento */ } }

  // ---------------- puntuación de cartas ----------------

  // Valor base de cada mejora de stat (ids de G.LevelUp.STATS).
  const STAT_BASE = { atk: 300, cd: 280, hp: 170, def: 170, rgn: 150, spd: 120, mag: 80, xp: 150 };

  /** stat -> movimiento al máximo que espera esa mejora para evolucionar. */
  function waitingStats(G, pl) {
    const out = {};
    for (const m of pl.moves || []) {
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
  function score(G, c, pl, ctx) {
    const id = String(c.key || '').split(':')[1] || '';
    const hpR = pl.maxHp ? pl.hp / pl.maxHp : 1;
    const evoTable = (G.Moves && G.Moves.EVO) || {};

    if (c.type === 'evo') return [1000, 'Evolución lista: el mayor salto de daño'];

    if (c.type === 'stat') {
      if (id === 'heal') {
        return hpR < 0.35 ? [900, 'Te queda poca vida'] : hpR < 0.6 ? [260, 'Recupera vida'] : [15, 'Tienes la vida casi llena'];
      }
      if (ctx.waiting[id]) return [850, 'Desbloquea la evolución de ' + moveName(G, ctx.waiting[id])];
      let s = STAT_BASE[id] != null ? STAT_BASE[id] : 100, why = 'Mejora para toda la partida';
      if (id === 'atk') why = '+10 % de daño a todos tus ataques';
      if (id === 'cd') why = 'Tus ataques salen más seguido';
      if ((id === 'hp' || id === 'def' || id === 'rgn') && hpR < 0.5) { s += 160; why = 'Te están dando: aguanta más'; }
      if (id === 'xp') {
        if ((pl.level || 1) < 10) { s += 80; why = 'Al principio, subir rápido rinde más'; } else s -= 70;
      }
      return [s, why];
    }

    if (c.type === 'up') {
      const m = (pl.moves || []).find(x => x.id === id);
      let s = 420, why = 'Mejora un ataque que ya tienes';
      if (m) {
        const max = (m.def && m.def.maxLvl) || 5, left = Math.max(0, max - (m.lvl || 1));
        if (m.kind === 'buff') { s -= 160; why = 'Mejora un potenciador'; }
        else if (evoTable[id]) {
          s += 120 + 40 * (max - left);
          why = left <= 1 ? 'Lo deja al máximo: listo para evolucionar'
                          : 'Le faltan ' + left + ' niveles para poder evolucionar';
        }
      }
      return [s, why];
    }

    if (c.type === 'new') {
      const d = (G.Moves && G.Moves.BY_ID && G.Moves.BY_ID[id]) || {};
      const dmgMoves = (pl.moves || []).filter(m => m.kind !== 'buff').length;
      if (d.kind === 'buff') return [dmgMoves >= 2 ? 230 : 120, 'Potenciador: no hace daño por sí solo'];
      let fit = 1;
      try { fit = G.Stats.fit(pl.mon, d.cat); } catch (e) { /* nada */ }
      let s = 360 * fit;
      let why = fit >= 0.999 ? 'Ataque nuevo de tu lado fuerte' : 'Rinde al ' + Math.round(fit * 100) + ' % con tu Pokémon';
      if (dmgMoves < 2) { s += 150; why += ' · te faltan ataques'; }
      if (evoTable[id]) s += 50;
      return [s, why];
    }

    return [0, ''];
  }

  function annotate(G, list, pl) {
    const ctx = { waiting: waitingStats(G, pl) };
    for (const c of list) {
      try { const r = score(G, c, pl, ctx); c.__psg = { s: r[0], w: r[1] }; }
      catch (e) { c.__psg = { s: 0, w: '' }; }
    }
  }

  function bestIndex(list) {
    let b = 0;
    list.forEach((c, i) => { if (((c.__psg && c.__psg.s) || 0) > ((list[b].__psg && list[b].__psg.s) || 0)) b = i; });
    return b;
  }

  // ---------------- arranque ----------------

  const ready = () => {
    const G = W.G;
    return G && G.LevelUp && typeof G.LevelUp.offer === 'function' && G.RunUI && typeof G.RunUI.showLevelUp === 'function'
      && typeof G.RunUI.pick === 'function' && G.Game && G.Moves && G.Ranking && G.UI;
  };
  let tries = 0;
  const boot = setInterval(() => {
    if (ready()) {
      clearInterval(boot);
      try { install(W.G); } catch (e) { console.error('[PSG] no se pudo instalar', e); }
    } else if (++tries > 240) {                 // ~60 s
      clearInterval(boot);
      notFound();
    }
  }, 250);

  /** El juego está en la página pero su window.G no se ve (script aislado). */
  function notFound() {
    if (!document.getElementById('cards')) return;   // no es la página del juego
    const d = document.createElement('div');
    d.textContent = 'Ayudante PSG: no encuentro el juego. En Violentmonkey/Tampermonkey pon el modo de inyección en «page».';
    d.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:99999;padding:8px 10px;border-radius:8px;'
      + 'background:#3a1010;color:#ffd0d0;font:13px/1.3 sans-serif;text-align:center';
    d.onclick = () => d.remove();
    document.body.appendChild(d);
  }

  function install(G) {
    W.__psgMod = { version: VERSION, cfg };

    const origOffer = G.LevelUp.offer;
    const origShow = G.RunUI.showLevelUp;

    let lastList = null, token = 0, autoT = 0, freeShift = 0, regenerating = false;
    let forcedFor = null;          // objeto jugador de la partida que ha usado el modo libre
    let shown = null;              // { level, cb, coop } de la pantalla de cartas abierta

    const coopActive = () => !!(G.Coop && G.Coop.active);
    const runForced = () => !!forcedFor && forcedFor === G.Game.player;
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
        try { l = origOffer.call(G.LevelUp, pl, 3); } catch (e) { break; }
        for (const c of l) if (!seen.has(c.key)) seen.set(c.key, c);
      }
      return [...seen.values()];
    }

    function freeOffer(pl, n) {
      const pool = fullPool(pl);
      annotate(G, pool, pl);
      pool.sort((a, b) => b.__psg.s - a.__psg.s);
      const pinned = pool.filter(c => c.type === 'evo');          // la evolución sale siempre, como en el juego
      const rest = pool.filter(c => c.type !== 'evo');
      const room = Math.max(0, n - pinned.length);
      // «Cambiar opciones» con el modo libre: las siguientes del ranking de cartas.
      freeShift = !regenerating && screenOpen() ? freeShift + room : 0;
      const start = rest.length > room ? freeShift % rest.length : 0;
      const rotated = rest.slice(start).concat(rest.slice(0, start));
      forcedFor = pl;
      return pinned.concat(rotated.slice(0, room)).slice(0, n);
    }

    G.LevelUp.offer = function (pl, n = 3) {
      let list;
      if (cfg.free && pl && !coopActive()) list = freeOffer(pl, n);
      else { list = origOffer.apply(this, arguments); if (pl) annotate(G, list, pl); }
      lastList = list;
      const my = ++token;
      setTimeout(() => decorate(my), 0);         // el juego pinta las cartas justo después
      return list;
    };

    G.RunUI.showLevelUp = function (level, list, cb, coop) {
      shown = { level, cb, coop: !!coop };
      return origShow.apply(this, arguments);
    };

    for (const fn of ['submitSolo', 'submitGroup']) {
      const orig = G.Ranking[fn];
      if (typeof orig !== 'function') continue;
      G.Ranking[fn] = function () {
        if (runForced()) { toast('Modo libre: esta partida no se sube al ranking'); return null; }
        return orig.apply(this, arguments);
      };
    }

    // ---------------- pantalla de cartas ----------------

    function decorate(my) {
      if (my !== token || !lastList) return;
      const box = document.getElementById('cards');
      if (!box) return;
      const els = box.querySelectorAll('.card');
      if (els.length !== lastList.length) return;
      const best = bestIndex(lastList);
      els.forEach((el, i) => {
        const p = lastList[i].__psg;
        if (!p || el.querySelector('.psg-badge')) return;
        el.classList.toggle('psg-best', i === best);
        const b = document.createElement('div');
        b.className = 'psg-badge';
        b.setAttribute('translate', 'no');       // el traductor del juego no debe tocarlo
        b.textContent = (i === best ? '★ Recomendada · ' : '') + p.w;
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

    /** Vuelve a sacar las cartas de la pantalla abierta (al activar el modo libre). */
    function regenerate() {
      const pl = G.Game.player;
      if (!shown || !pl || !screenOpen()) return;
      regenerating = true;
      let list;
      try { list = G.LevelUp.offer(pl); } finally { regenerating = false; }
      origShow.call(G.RunUI, shown.level, list, shown.cb, shown.coop);
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
          + '<button type="button" class="psg-chip" data-k="free"></button>'
          + '<div class="psg-note"></div>';
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
      }
      const a = bar.querySelector('[data-k="auto"]'), f = bar.querySelector('[data-k="free"]');
      a.textContent = cfg.auto ? '🤖 Automático' : '👆 Selección';
      a.classList.toggle('on', cfg.auto);
      f.textContent = '🔓 Modo libre: ' + (cfg.free ? 'ON' : 'OFF');
      f.classList.toggle('on', cfg.free);
      bar.querySelector('.psg-note').textContent = runForced() ? 'Esta partida ya no se subirá al ranking.' : '';
    }

    const css = document.createElement('style');
    css.textContent = `
      #psg-bar{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:4px 0 8px}
      #psg-bar .psg-chip{font-family:inherit;font-weight:600;font-size:13px;line-height:1;padding:7px 12px;border-radius:999px;border:1px solid #ffffff40;
        background:#00000055;color:#fff;cursor:pointer;touch-action:manipulation}
      #psg-bar .psg-chip.on{background:#ffd23f;color:#2a2000;border-color:#ffd23f}
      #psg-bar .psg-note{width:100%;text-align:center;font-size:12px;color:#ffaaaa;min-height:0}
      #psg-bar .psg-note:empty{display:none}
      .card.psg-best{outline:3px solid #ffd23f;outline-offset:2px;box-shadow:0 0 14px #ffd23f88}
      .psg-badge{margin-top:4px;font-size:12px;line-height:1.25;color:#ffe48a}
    `;
    (document.head || document.documentElement).appendChild(css);

    // Para depurar desde la consola (y para tests/e2e.cjs).
    W.__psgMod.score = (c, pl) => score(G, c, pl, { waiting: waitingStats(G, pl) });
    W.__psgMod.fullPool = () => (G.Game.player ? fullPool(G.Game.player) : []);
    Object.defineProperty(W.__psgMod, 'forced', { get: runForced });
    toast('Ayudante PSG ' + VERSION + ' activo');
  }
})();
