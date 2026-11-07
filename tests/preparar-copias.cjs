/*
 * Prepara copias del juego para probar el ayudante como si fuera la versión publicada.
 *
 *   node tests/preparar-copias.cjs /ruta/a/copia/del/juego /ruta/de/salida [--real]
 *
 * A partir de una copia con el código abierto (js/app.min.js empieza por window.G=window.G||{},):
 *   salida/cerrado   el juego ENCERRADO en una función (sin window.G), con Object.create(null)
 *   salida/cifrado   además, las claves de los módulos cifradas (RunUI → '_42939ce'…), también
 *                    en la lista de módulos que comprueba el arranque: como la versión publicada
 *   salida/real      (--real) el código que sirve hoy pokesurvivor.com (index.html, js y css),
 *                    con los gráficos de la copia. Necesita red hacia pokesurvivor.com.
 *
 * Después:  node tests/e2e.cjs salida/real   (y con PSG_SIM_XRAY=1 y 2)
 * Las copias son del juego de su autor: no se suben a este repositorio.
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');

const [SRC, OUT] = process.argv.slice(2).map(p => p && path.resolve(p));
const REAL = process.argv.includes('--real');
if (!SRC || !OUT || !fs.existsSync(path.join(SRC, 'js', 'app.min.js'))) {
  console.error('Uso: node tests/preparar-copias.cjs /ruta/a/copia/del/juego /ruta/de/salida [--real]');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

/** Copia la carpeta con enlaces duros (rápido y sin gastar disco) y quita los archivos que se cambian. */
function copy(name, drop) {
  const d = path.join(OUT, name);
  fs.rmSync(d, { recursive: true, force: true });
  execFileSync('cp', ['-al', SRC, d]);
  for (const f of drop) fs.rmSync(path.join(d, f), { force: true });
  return d;
}

const src = fs.readFileSync(path.join(SRC, 'js', 'app.min.js'), 'utf8');
const HEAD = 'window.G=window.G||{},';
if (!src.startsWith(HEAD)) { console.error('js/app.min.js no empieza por ' + HEAD + ' (¿no es la versión abierta?)'); process.exit(1); }
const closed = 'var G=Object.create(null);' + src.slice(HEAD.length);
const wrap = body => '(()=>{\n' + body + '\n})();\n';

// cerrado
fs.writeFileSync(path.join(copy('cerrado', ['js/app.min.js']), 'js', 'app.min.js'), wrap(closed));
console.log('ok  cerrado');

// cifrado
const NAMES = ('BUILT LIFT U LevelUp RunUI Game Moves Coop DB Mons AbilityFX Upgrades Icons NATURES NATURE_BY '
  + 'DEX DEX_BY I18n startMoveOf startChoices Weather Flow').split(' ');
const H = Object.fromEntries(NAMES.map(n => [n, '_' + crypto.createHash('md5').update('sal' + n).digest('hex').slice(0, 7)]));
let body = closed;
for (const n of NAMES) body = body.replace(new RegExp('\\bG\\.' + n + '\\b', 'g'), 'G.' + H[n]);
const list = body.match(/\[[^\[\]]*"Settings","DB","Audio"[^\]]*\]/) || body.match(/\[[^\[\]]*"Settings","_[0-9a-f]{7}","Audio"[^\]]*\]/);
if (list) body = body.replace(list[0], list[0].replace(/"([A-Za-z0-9_]+)"/g, (m, n) => '"' + (H[n] || n) + '"'));
else console.warn('aviso: no encuentro la lista de módulos del arranque; la copia cifrada puede no arrancar');
fs.writeFileSync(path.join(copy('cifrado', ['js/app.min.js']), 'js', 'app.min.js'), wrap(body));
console.log('ok  cifrado');

// real
if (REAL) {
  // Con curl: respeta el proxy del sistema (HTTPS_PROXY), cosa que el https de Node no hace.
  const get = async url => execFileSync('curl', ['-sSfL', '-m', '90', url], { maxBuffer: 64 * 1024 * 1024 });
  (async () => {
    const BASE = 'https://pokesurvivor.com/';
    const html = (await get(BASE)).toString('utf8');
    const refs = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"#]+)"/g)].map(m => m[1]);
    const d = copy('real', ['index.html', ...refs.map(r => r.split('?')[0])]);
    fs.writeFileSync(path.join(d, 'index.html'), html);
    for (const r of refs) {
      const file = path.join(d, r.split('?')[0]);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, await get(BASE + r));
      console.log('    ' + r);
    }
    console.log('ok  real (' + refs.length + ' archivos de pokesurvivor.com)');
  })().catch(e => { console.error('real: ' + e.message); process.exit(1); });
}
