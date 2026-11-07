// ==UserScript==
// @name         PokéSurvivor · Ayudante de cartas (PSG)
// @namespace    https://github.com/yeikoromeo2/proyecto-psg
// @version      0.5.0
// @description  Analiza tu colección (naturaleza, habilidad, combos) y te ayuda con las cartas de nivel: recomendación, elección automática y modo libre sin ranking.
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
 *    propone un plan de 4 ataques con sus combos de evolución, MT y movimiento inicial.
 *
 *  - Se inyecta en «document-start» para ejecutarse antes de que el juego
 *    declare su Content-Security-Policy (que bloquea scripts añadidos después).
 */
(function () {
  'use strict';

  const W = window;
  if (W.__psgMod) return;
  const VERSION = '0.5.0';

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
      const m = (pl.moves || []).find(x => x.id === id);
      let s = 420, why = 'Mejora un ataque que ya tienes';
      const inPlan = !!(plan && plan.ids.includes(id));
      if (m) {
        const max = (m.def && m.def.maxLvl) || 5, left = Math.max(0, max - (m.lvl || 1));
        if (m.kind === 'buff') { s -= 160; why = 'Mejora un potenciador'; }
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
      const dmgMoves = (pl.moves || []).filter(m => m.kind !== 'buff').length;
      // Plan: si los huecos libres no sobran, un ataque de fuera le quitaría el sitio a uno del
      // plan. Se castiga según lo peor que sea que el más flojo de los que faltan (el que se
      // quedaría fuera), y la mitad si aún tienes menos de 2 ataques (urge tener con qué pegar).
      const missing = plan ? plan.ids.filter(x => !(pl.moves || []).some(m => m.id === x)) : [];
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
        return [(dmgMoves >= 2 ? 230 : 120) - penalty, 'Potenciador: no hace daño por sí solo' + crowdWhy];
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

  function annotate(G, list, pl, plan) {
    const ctx = { waiting: waitingStats(G, pl), plan };
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

  function analyzerCore(G) {
    const save = () => G.DB && G.DB.save;
    const nm = n => { try { return G.Mons.name(n); } catch (e) { return String(n); } };
    const typeName = t => (G.U && G.U.TYPE_NAME && G.U.TYPE_NAME[t]) || t;
    const moveName = d => { try { return G.T(d.name, 'move'); } catch (e) { return d.name; } };
    // Velocidad de referencia: la mediana de todos los Pokémon del juego.
    let refSpdV = 0;
    const refSpd = () => refSpdV || (refSpdV = (() => {
      const l = (G.DEX || []).map(p => +p.spd).filter(v => v > 0).sort((a, b) => a - b);
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
      const pl = { hp: 100, maxHp: 100, level: 10, mon, moxie: 0, kills: 0, x: 0, y: 0, abil: fx, statsTaken: {}, moves: [] };
      const foe = { types: ['normal'], hp: 100, maxHp: 100, x: 0, y: 0, mon: { types: ['normal'] } };
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
      const monoK = base.types.length === 1 && d.type === base.types[0] ? 1.2 : 1;   // Player.MONO_K
      const idx = moveIndex(inst) * monoK;
      return {
        id, d, inst, name: moveName(d), type: d.type, cat: d.cat, kind: d.kind, buff: d.kind === 'buff',
        evo, evoName: evo && G.Moves.NEED_NAME ? G.Moves.NEED_NAME[evo] : '', fit: G.Stats.fit(mon, d.cat),
        tm: taught.has(id), val: idx * statK, val0: idx * statK0, abilK: 1, score: 0, score0: 0
      };
    }

    function analyze(dex) {
      const s = save(), base = G.DEX_BY[dex];
      if (!base) return null;
      const mon = G.Mons.monFor(dex);
      const nat = G.Mons.natureOf(dex), rolled = G.Mons.rolledNature(dex);
      const taught = new Set(G.Mons.taught(dex));
      const ab = G.Mons.abilityOf(dex);
      const abil = abilityInfo(ab.id, base, mon);

      const moves = G.Moves.poolFor(base).map(id => moveInfo(id, base, mon, taught)).filter(Boolean);
      for (const m of moves) { m.abilK = abil.mul(m.inst); m.score = m.val * m.abilK; m.score0 = m.val0 * m.abilK; }
      const attacks = moves.filter(m => !m.buff).sort((a, b) => b.score - a.score);
      const slotsN = 4;
      // Los fijados a mano van primero; los huecos que queden, con los mejores calculados.
      const pinned = pinsOf(dex).map(id => moves.find(m => m.id === id)).filter(Boolean);
      pinned.forEach(m => { m.pinned = true; });
      const plan = pinned.concat(attacks.filter(m => !m.pinned).slice(0, Math.max(0, slotsN - pinned.length)));
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
      const slots = G.Mons.slots(dex), seen = new Set(), abilOpts = [];
      slots.forEach((id, slot) => {
        if (!id || seen.has(id)) return;
        seen.add(id);
        const a = abilityInfo(id, base, mon);
        a.slot = slot; a.planK = mean(plan.map(m => a.mul(m.inst)));
        abilOpts.push(a);
      });
      const cur = abilOpts.find(a => a.id === ab.id) || Object.assign(abil, { slot: ab.slot, planK: mean(plan.map(m => abil.mul(m.inst))) });
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
      const autoPart = plan.filter(m => !m.pinned);
      const cut = plan.length < slotsN ? 0 : autoPart.length ? autoPart[autoPart.length - 1].score : Infinity;
      const tmBuy = [];
      try {
        for (const id of G.Mons.learnable(dex)) {
          const m = moveInfo(id, base, mon, new Set([id]));
          if (!m || m.buff) continue;
          m.abilK = abil.mul(m.inst); m.score = m.val * m.abilK;
          if (m.score > cut) tmBuy.push(m);
        }
      } catch (e) { /* sin MT */ }
      tmBuy.sort((a, b) => b.score - a.score);

      // ---- movimiento inicial ----
      let start = null, startRec = null;
      try {
        const sid = G.startMoveOf ? G.startMoveOf(dex) : G.Moves.startFor(base);
        start = moves.find(m => m.id === sid) || moveInfo(sid, base, mon, taught);
        const choices = G.startChoices ? G.startChoices(dex) : [];
        const bestStart = plan.find(m => choices.includes(m.id));
        if (bestStart && start && bestStart.id !== start.id && bestStart.score > start.score * 1.1) startRec = bestStart;
      } catch (e) { /* nada */ }
      // ---- mejoras compradas (Mejoras del menú) y aguante ----
      // (se leen sin G.DB.upgradesOf, que crea la entrada en la partida si no existe)
      const lv = (s && s.pupg && s.pupg[dex]) || {};
      let perks = {};
      try { perks = (G.Upgrades && G.Upgrades.perks(lv)) || {}; } catch (e) { /* nada */ }
      const tP = G.Stats.taken(mon, 'physical'), tS = G.Stats.taken(mon, 'special');
      const hpTot = (+mon.hp || 0) + (+perks.hp || 0);
      const takenAvg = ((tP + tS) / 2) * (1 - (+perks.dmgReduce || 0));     // enemigos físicos y especiales a medias
      const spd = (+mon.spd || 0) * (+perks.spdMul || 1);
      const spdK = Math.sqrt(Math.max(0.2, spd / refSpd()));               // correr ayuda a esquivar
      const defAbil = cur.kind === 'defensiva';
      const tough = (hpTot / Math.max(0.1, takenAvg) + (+perks.regen || 0) * 20) * spdK * (defAbil ? 1.08 : 1);
      const toughInfo = { hp: +mon.hp || 0, hpUp: +perks.hp || 0, df: mon.df, sd: mon.sd, tP, tS, spd, spdK,
        spdUp: +perks.spdMul || 1, regen: +perks.regen || 0, dmgReduce: +perks.dmgReduce || 0, defAbil };
      const perkK = (+perks.atkMul || 1) / Math.max(0.1, +perks.cdMul || 1) * (1 + (+perks.crit || 0) * 0.5);

      const hasStartUpg = !!(s && s.pupg && s.pupg[dex] && s.pupg[dex].start);
      const upgLv = Object.values((s && s.pupg && s.pupg[dex]) || {}).reduce((a, v) => a + (+v || 0), 0);

      return {
        dex, base, mon, name: base.name, types: base.types, side,
        nat, rolled, natChanged: !!(s && s.pnat && s.pnat[dex]), natV, natWhy, bestNat,
        abil: cur, abilOpts, abV, abWhy, abSlot: ab.slot,
        moves, attacks, plan, evoStats, tmBuy, start, startRec, hasStartUpg, upgLv, custom: pinned.length > 0,
        used: (s && s.pused && +s.pused[dex]) || 0,
        power: plan.reduce((a, m) => a + m.score, 0) * perkK, perkK, tough, toughInfo
      };
    }

    return { analyze, natName, typeName, togglePin, resetPins: dex => setPins(dex, []) };
  }

  function installAnalyzer(G, toast, core) {
    const A = core || analyzerCore(G);
    let el = null, rows = [], openDex = null, sortBy = 'power', query = '', allOpen = false;

    function addMenuButton() {
      if (document.getElementById('psg-an-btn')) return true;
      const list = document.querySelector('#scr-menu .menu-list');
      if (!list) return false;
      const b = document.createElement('button');
      b.id = 'psg-an-btn';
      b.className = 'menu-item';
      b.setAttribute('translate', 'no');
      b.innerHTML = 'Analizador PSG<small>Naturaleza, habilidad y combos</small>';
      const after = list.querySelector('[data-go="dex"]');
      list.insertBefore(b, after ? after.nextSibling : null);
      b.addEventListener('click', open);
      return true;
    }
    if (!addMenuButton()) { const t = setInterval(() => { if (addMenuButton()) clearInterval(t); }, 1000); }

    function open() {
      const s = G.DB && G.DB.save;
      if (!s || !s.owned || !Object.keys(s.owned).length) { toast('Entra con tu cuenta para analizar tu colección'); return; }
      rows = Object.keys(s.owned).map(Number).filter(d => G.DEX_BY[d]).map(d => {
        try { return A.analyze(d); } catch (e) { console.warn('[PSG] no se pudo analizar', d, e); return null; }
      }).filter(Boolean);
      rescale();
      if (!el) build();
      el.classList.remove('psg-hidden');
      paint();
    }
    function close() { if (el) el.classList.add('psg-hidden'); }
    function rescale() {
      const top = Math.max(1, ...rows.map(r => r.power)), topT = Math.max(1, ...rows.map(r => r.tough));
      rows.forEach(r => { r.pct = Math.round(100 * r.power / top); r.tpct = Math.round(100 * r.tough / topT); });
    }
    /** Vuelve a analizar un Pokémon (tras fijar o soltar un ataque) y repinta sin moverse. */
    function refresh(dex) {
      const i = rows.findIndex(r => r.dex === dex);
      if (i >= 0) { try { rows[i] = A.analyze(dex); } catch (e) { console.warn('[PSG]', e); } }
      rescale();
      paint(false);
    }

    function build() {
      el = document.createElement('div');
      el.id = 'psg-an';
      el.setAttribute('translate', 'no');
      el.innerHTML = `
        <div class="psg-an-head">
          <b>Analizador de colección</b><span class="psg-an-count"></span>
          <button type="button" class="psg-an-x" aria-label="Cerrar">✕</button>
        </div>
        <div class="psg-an-ctl">
          <input type="search" placeholder="Buscar Pokémon…" autocomplete="off">
          <select>
            <option value="power">Más potentes</option>
            <option value="tough">Más aguante</option>
            <option value="both">Potencia + aguante</option>
            <option value="fix">Naturaleza o habilidad a revisar</option>
            <option value="used">Más usados</option>
            <option value="dex">Nº de Pokédex</option>
          </select>
        </div>
        <p class="psg-an-help">⚔ Potencia: daño aproximado de sus 4 ataques del plan ya evolucionados, con su naturaleza,
          su habilidad y tus mejoras compradas. 🛡 Aguante: su vida entre el daño que recibe según sus defensas, con su
          velocidad, su habilidad y tus mejoras. Ambos comparados con el mejor de tu colección (100). Toca un Pokémon para ver el detalle.</p>
        <div class="psg-an-list"></div>`;
      document.body.appendChild(el);
      el.querySelector('.psg-an-x').addEventListener('click', close);
      el.querySelector('input').addEventListener('input', e => { query = fold(e.target.value); paint(); });
      el.querySelector('select').addEventListener('change', e => { sortBy = e.target.value; paint(); });
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
    }

    const VERD = {
      ideal: ['✅', 'Ideal'], buena: ['✅', 'Buena'], normal: ['➖', 'Normal'], neutra: ['➖', 'Neutra'],
      floja: ['⚠️', 'Floja'], mala: ['❌', 'Mala'], cambiar: ['💡', 'Mejorable']
    };
    const needsFix = r => (r.natV === 'mala' || r.natV === 'floja' ? 2 : 0) + (r.abV === 'cambiar' ? 1 : 0);
    const chip = t => `<span class="psg-type" style="background:${esc((G.U.TYPE_COLOR || {})[t] || '#666')}">${esc(A.typeName(t))}</span>`;
    const catTxt = c => (c === 'physical' ? 'Físico' : c === 'special' ? 'Especial' : '—');

    function paint(scroll = true) {
      const list = el.querySelector('.psg-an-list');
      let shown = rows.filter(r => !query || fold(r.name).includes(query));
      const by = {
        power: (a, b) => b.power - a.power,
        tough: (a, b) => b.tough - a.tough,
        both: (a, b) => (b.pct + b.tpct) - (a.pct + a.tpct) || b.power - a.power,
        fix: (a, b) => needsFix(b) - needsFix(a) || b.power - a.power,
        used: (a, b) => b.used - a.used || b.power - a.power,
        dex: (a, b) => a.dex - b.dex
      }[sortBy];
      shown = shown.slice().sort(by);
      el.querySelector('.psg-an-count').textContent = ' · ' + rows.length + ' Pokémon';
      list.innerHTML = shown.map(r => {
        const nv = VERD[r.natV] || VERD.normal, av = VERD[r.abV] || VERD.normal;
        return `<div class="psg-row${openDex === r.dex ? ' open' : ''}" data-dex="${r.dex}">
            <div class="psg-row-name"><small>#${r.dex}</small> ${esc(r.name)} ${r.types.map(chip).join('')}</div>
            <div class="psg-bars"><div class="psg-bar" title="Potencia"><i style="width:${r.pct}%"></i><span>⚔ ${r.pct}</span></div>
              <div class="psg-bar tough" title="Aguante"><i style="width:${r.tpct}%"></i><span>🛡 ${r.tpct}</span></div></div>
            <div class="psg-row-tags"><span title="Naturaleza">${nv[0]} ${esc(A.natName(r.nat))}</span>
              <span title="Habilidad">${av[0]} ${esc(r.abil.name)}</span></div>
          </div>${openDex === r.dex ? detail(r) : ''}`;
      }).join('') || '<p class="psg-an-help">Ningún Pokémon coincide.</p>';
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
      const plan = r.plan.map(m => `<li>${m.pinned ? '📌 ' : ''}${chip(m.type)} <b>${esc(m.name)}</b> <small>${catTxt(m.cat)}${m.tm ? ' · MT' : ''}${m.fit < 0.95 ? ' · rinde ' + Math.round(m.fit * 100) + ' %' : ''}</small>
          ${m.evo ? `<br><small>🔁 Al máximo + <b>${esc(m.evoName)}</b> → ${esc(m.name)} +</small>` : `<br><small>(${m.buff ? 'potenciador, ' : ''}no evoluciona)</small>`}</li>`).join('');
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
          <td>${catTxt(m.cat)}</td><td>${m.buff ? '—' : Math.round(m.score)}</td><td>${m.evo ? esc(m.evoName) : '—'}</td></tr>`).join('');
      return `<div class="psg-det">
        <div class="psg-sec"><h4>Naturaleza ${nv[0]} ${nv[1]}</h4>
          <p><b>${esc(A.natName(r.nat))}</b> (${natFx})${r.natChanged ? ' <small>· cambiada con Menta</small>' : ''}.
          Su plan pega sobre todo con <b>${r.side === 'special' ? 'Ataque Especial' : 'Ataque'}</b>. ${esc(r.natWhy)}</p>${natTip}</div>
        <div class="psg-sec"><h4>Habilidad ${av[0]} ${av[1]}</h4>
          <p><b>${esc(r.abil.name)}</b>${r.abSlot === 2 ? ' <small>(oculta)</small>' : ''}: ${esc(r.abil.desc)}</p>
          <p>${esc(r.abWhy)}</p>${abOpts}</div>
        <div class="psg-sec"><h4>Aguante 🛡 ${r.tpct}</h4>${toughHtml(r)}</div>
        <div class="psg-sec"><h4>Plan de 4 ataques${planHead}</h4><ol>${plan}</ol>${evo}${start}${tms}
          <p><small>Para elegir tú el plan, abre «Todos sus ataques» y toca 📌 (hasta 4). Los huecos que
          dejes se rellenan con los mejores calculados. Las cartas de nivel siguen este plan.</small></p>
          <p><small>Mejoras compradas para este Pokémon: ${r.upgLv}. Partidas jugadas con él: ${r.used}.</small></p></div>
        <details class="psg-sec psg-all"${allOpen ? ' open' : ''}><summary>Todos sus ataques (${r.moves.length}) · 📌 para fijar</summary>
          <table><tr><th></th><th>Ataque</th><th>Clase</th><th>Potencia</th><th>Evoluciona con</th></tr>${all}</table></details>
      </div>`;
    }

    const pctTxt = k => (k < 1 ? '−' + Math.round((1 - k) * 100) + ' %' : k > 1 ? '+' + Math.round((k - 1) * 100) + ' %' : 'igual');
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

    return { open, close, analyze: A.analyze, togglePin: A.togglePin, resetPins: A.resetPins };
  }

  function install(G) {
    W.__psgMod = { version: VERSION, cfg };

    const origOffer = G.LevelUp.offer;
    const origShow = G.RunUI.showLevelUp;

    let lastList = null, token = 0, autoT = 0, freeShift = 0, regenerating = false;
    let forcedFor = null;          // objeto jugador de la partida que ha usado el modo libre
    let shown = null;              // { level, cb, coop } de la pantalla de cartas abierta

    const core = analyzerCore(G);
    let planCache = { pl: null, v: null };
    /** Plan de 4 ataques del analizador para el Pokémon de esta partida (o null). */
    function planFor(pl) {
      if (!cfg.plan || !pl) return null;
      if (planCache.pl === pl) return planCache.v;
      let v = null;
      try {
        const dex = pl.dex != null ? pl.dex : pl.mon && pl.mon.dex;
        const r = dex != null ? core.analyze(dex) : null;
        if (r && r.plan.length) {
          const needs = {};
          for (const m of r.plan) if (m.evo) (needs[m.evo] = needs[m.evo] || []).push(m.name);
          v = { ids: r.plan.map(m => m.id), names: Object.fromEntries(r.plan.map(m => [m.id, m.name])), needs,
                scores: Object.fromEntries(r.attacks.map(m => [m.id, m.score])) };
        }
      } catch (e) { console.warn('[PSG] no se pudo calcular el plan', e); }
      planCache = { pl, v };
      return v;
    }

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
      annotate(G, pool, pl, planFor(pl));
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
      else { list = origOffer.apply(this, arguments); if (pl) annotate(G, list, pl, planFor(pl)); }
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
        const has = id => (pl.moves || []).some(m => m.id === id);
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
    W.__psgMod.score = (c, pl) => score(G, c, pl, { waiting: waitingStats(G, pl), plan: planFor(pl) });
    W.__psgMod.plan = () => planFor(G.Game.player);
    W.__psgMod.fullPool = () => (G.Game.player ? fullPool(G.Game.player) : []);
    Object.defineProperty(W.__psgMod, 'forced', { get: runForced });

    try { W.__psgMod.analyzer = installAnalyzer(G, toast, core); }
    catch (e) { console.error('[PSG] no se pudo instalar el analizador', e); }
    toast('Ayudante PSG ' + VERSION + ' activo');
  }
})();
