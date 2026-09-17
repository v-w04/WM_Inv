#!/usr/bin/env node
// ============================================================
//  LOGO ANIMADO - Electronics Mexico
//  Estilo parrot.live: frames ASCII + limpiar pantalla + colores
//
//  Uso:   node logo-animado.js [movimiento] [color] [segundos] [alto]
//  Movimiento: giro | rebote | latido | onda
//  Color:      arcoiris | parrot | marca
//  Segundos:   cuanto dura antes de cerrarse solo.
//              0 (o se omite) = gira hasta que se presione una tecla.
//              Asi lo usan los .bat: el logo hace de "pause".
//  Alto:       filas de alto del logo. Si se omite, ocupa la
//              pantalla completa (modo pantallazo).
//              Con un numero chico (10-14) se dibuja EN EL LUGAR,
//              sin borrar lo que ya estaba arriba: asi los .bat
//              conservan su reporte y el logo sale debajo.
//  Ejemplo:    node logo-animado.js giro marca 5 12
//  Salir:      Ctrl + C
// ============================================================

const MASK = [
  '0000000000000000003ffff80000000000000000',
  '00000000000000000fffffffe000000000000000',
  '0000000000000001fffffffffe00000000000000',
  '000000000000000fffffffffffe0000000000000',
  '000000000000007ffffffffffffc000000000000',
  '00000000000003ffffffffffffff800000000000',
  '0000000000000fffffffffffffffe00000000000',
  '0000000000007ffffffffffffffff80000000000',
  '000000000001fffffffffffffffffe0000000000',
  '000000000007ffffffffffffffffff8000000000',
  '00000000000fffffffffffffffffffe000000000',
  '00000000003ffffffffffffffffffff800000000',
  '0000000000fffffffffffffffffffffc00000000',
  '0000000001ffffffffffffffffffffff00000000',
  '0000000007ffffffffffffffffffffff80000000',
  '000000000fffffffffffffffffffffffe0000000',
  '000000001ffffffffffffffffffffffff0000000',
  '000000007ffffffffffffffffffffffff8000000',
  '00000000fffffffffffffffffffffffffc000000',
  '00000001ffffffffffffffffffffffffff000000',
  '00000003ffffffffffffffffffffffffff800000',
  '00000007fffffffffff0003fffffffffffc00000',
  '0000000ffffffffffc000000ffffffffffe00000',
  '0000001fffffffffe00000000ffffffffff00000',
  '0000003fffffffff0000000001fffffffff80000',
  '0000007ffffffff800000000003ffffffffc0000',
  '000000ffffffffe000000000000ffffffffe0000',
  '000001ffffffff80000000000003ffffffff0000',
  '000003fffffffe00000000000000ffffffff8000',
  '000007fffffff8000000000000007fffffff8000',
  '00000fffffffe0000000000000001fffffffc000',
  '00000fffffffc00000000000000007ffffffe000',
  '00001fffffff000000000000000003fffffff000',
  '00003ffffffe000000000000000001fffffff000',
  '00007ffffffc0000000000000000007ffffff800',
  '00007ffffff80000000000000000003ffffffc00',
  '0000fffffff00000000000000000001ffffffc00',
  '0000ffffffe00000000000000000000ffffffe00',
  '0001ffffff8000000000000000000003ffffff00',
  '0003ffffff8000000000000000000001ffffff00',
  '0003ffffff00000000000000000000007fffff80',
  '0007fffffe00000000000000000000003fffff80',
  '0007fffffc00000000000000000000000fffffc0',
  '000ffffff8000000000000000000000003ffffc0',
  '000ffffff0000000000000000000000000ffffe0',
  '001ffffff00000000000000000000000001fffe0',
  '001fffffe000000000000000000000000003fff0',
  '003fffffc0000000000000000000000000003ff0',
  '003fffff80000000000000000000000000000070',
  '007fffff80000000000000000000000000000000',
  '007fffff00000000000000000000000000000000',
  '00ffffff00000000000000000000000000000000',
  '00fffffe00000000000000000000000000000000',
  '00fffffe00000000000000000000000000000000',
  '01fffffc00000000000000000000000000000000',
  '01fffffc00000000000000000000000000000000',
  '01fffff800000000000000000000000000000000',
  '03fffff800000000000000000000000000000000',
  '03fffff000000000000000000000000000000000',
  '03fffff000000000000000000000000000000000',
  '03fffff000000000000000000000000000000000',
  '07ffffe000000000000000000000000000000000',
  '07ffffe000000000000000000000000000000000',
  '07ffffe000000000000000000000000000000000',
  '07ffffc000000000000000000000000000000000',
  '0fffffc000000000000000000000000000000000',
  '0fffffc000000000000000000000000000000000',
  '0fffffc000000000000000000000000000000000',
  '0fffff8000000000000000000000000000000000',
  '0fffff80000fffffffffffffffffffc000000000',
  '0fffff80000fffffffffffffffffffe000000000',
  '0fffff80000fffffffffffffffffffe000000000',
  '1fffff80000fffffffffffffffffffc000000000',
  '1fffff80000fffffffffffffffffffc000000000',
  '1fffff80000fffffffffffffffffffc000000000',
  '1fffff000007ffffffffffffffffffc000000000',
  '1fffff000007ffffffffffffffffff8000000000',
  '1fffff000007ffffffffffffffffff8000000000',
  '1fffff000003ffffffffffffffffff8000000000',
  '1fffff000003ffffffffffffffffff0000000000',
  '1fffff000001ffffffffffffffffff0000000000',
  '1fffff000000fffffffffffffffffe0000000000',
  '1fffff000000fffffffffffffffffc0000000000',
  '1fffff0000007ffffffffffffffff80000000000',
  '1fffff0000003ffffffffffffffff00000000000',
  '1fffff8000001fffffffffffffffe00000000000',
  '1fffff8000000fffffffffffffffc00000000000',
  '1fffff80000003ffffffffffffff800000000000',
  '0fffff80000000fffffffffffffe000000000000',
  '0fffff800000003ffffffffffff0000000000000',
  '0fffff8000000001ffffffffff00000000000000',
  '0fffff8000000000000000000000000000000000',
  '0fffffc000000000000000000000000000000000',
  '0fffffc000000000000000000000000000000000',
  '0fffffc000000000000000000000000000000000',
  '07ffffc000000000000000000000000000000000',
  '07ffffe000000000000000000000000000000000',
  '07ffffe000000000000000000000000000000000',
  '07ffffe000000000000000000000000000000000',
  '03fffff000000000000000000000000000000000',
  '03fffff000000000000000000000000000000000',
  '03fffff000000000000000000000000000000000',
  '03fffff800000000000000000000000000000000',
  '01fffff800000000000000000000000000000000',
  '01fffffc00000000000000000000000000000000',
  '01fffffc00000000000000000000000000000000',
  '00fffffe00000000000000000000000000000000',
  '00fffffe00000000000000000000000000000000',
  '00ffffff00000000000000000000000000000000',
  '007fffff00000000000000000000000000000000',
  '007fffff80000000000000000000000000000000',
  '003fffff80000000000000000000000000000070',
  '003fffffc0000000000000000000000000003ff0',
  '003fffffe000000000000000000000000003fff0',
  '001fffffe00000000000000000000000001fffe0',
  '001ffffff0000000000000000000000000ffffe0',
  '000ffffff8000000000000000000000003ffffe0',
  '000ffffffc00000000000000000000000fffffc0',
  '0007fffffe00000000000000000000003fffff80',
  '0003ffffff0000000000000000000000ffffff80',
  '0003ffffff0000000000000000000001ffffff00',
  '0001ffffff8000000000000000000007ffffff00',
  '0001ffffffc00000000000000000000ffffffe00',
  '0000fffffff00000000000000000001ffffffc00',
  '00007ffffff80000000000000000003ffffffc00',
  '00007ffffffc0000000000000000007ffffff800',
  '00003ffffffe000000000000000001fffffff000',
  '00001fffffff000000000000000003fffffff000',
  '00001fffffffc00000000000000007ffffffe000',
  '00000fffffffe0000000000000001fffffffc000',
  '000007fffffff8000000000000003fffffff8000',
  '000003fffffffe00000000000000ffffffff8000',
  '000001ffffffff00000000000003ffffffff0000',
  '000000ffffffffe000000000000ffffffffe0000',
  '0000007ffffffff800000000003ffffffffc0000',
  '0000007ffffffffe0000000001fffffffff80000',
  '0000003fffffffffc00000000ffffffffff00000',
  '0000001ffffffffffc000000ffffffffffe00000',
  '00000007fffffffffff0003fffffffffffc00000',
  '00000003ffffffffffffffffffffffffff800000',
  '00000001ffffffffffffffffffffffffff000000',
  '00000000fffffffffffffffffffffffffc000000',
  '000000007ffffffffffffffffffffffff8000000',
  '000000003ffffffffffffffffffffffff0000000',
  '000000000fffffffffffffffffffffffe0000000',
  '0000000007ffffffffffffffffffffff80000000',
  '0000000001ffffffffffffffffffffff00000000',
  '0000000000fffffffffffffffffffffc00000000',
  '00000000003ffffffffffffffffffff800000000',
  '00000000001fffffffffffffffffffe000000000',
  '000000000007ffffffffffffffffff8000000000',
  '000000000001fffffffffffffffffe0000000000',
  '0000000000007ffffffffffffffff80000000000',
  '0000000000001fffffffffffffffe00000000000',
  '00000000000003ffffffffffffff800000000000',
  '00000000000000fffffffffffffc000000000000',
  '000000000000001fffffffffffe0000000000000',
  '0000000000000001fffffffffe00000000000000',
  '00000000000000001fffffffe000000000000000',
  '0000000000000000007ffff80000000000000000'
];
const N = MASK.length;
const BITS = MASK.map(r => {
  const out = new Uint8Array(N);
  for (let i = 0; i < r.length; i++) {
    const v = parseInt(r[i], 16);
    for (let b = 0; b < 4; b++) out[i * 4 + b] = (v >> (3 - b)) & 1;
  }
  return out;
});

const MOV = (process.argv[2] || 'giro').toLowerCase();
const COL = (process.argv[3] || 'arcoiris').toLowerCase();
// Tercer argumento: segundos antes de cerrarse solo. 0 = para siempre.
const SEGS = Math.max(0, Number(process.argv[4]) || 0);
// Cuarto argumento: alto en filas. 0 = pantalla completa.
// Con alto fijo el logo se dibuja en su lugar, sin borrar nada.
const ALTO = Math.max(0, Number(process.argv[5]) || 0);
const ENLINEA = ALTO > 0;
const AVISO = '  Presione una tecla para continuar . . .';
const FPS_MS = 60;
const RAMP = ' .:-=+*#%@';

// ---- colores ----
const PARROT = [31, 33, 32, 34, 35, 36, 37]; // rojo amarillo verde azul magenta cyan blanco
let lastParrot = -1;
function hsl(h, s, l) {
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map(x => Math.round(x * 255));
}

// ---- muestreo del logo (u,v en -1..1) ----
function sample(u, v) {
  const x = Math.floor((u + 1) / 2 * N), y = Math.floor((v + 1) / 2 * N);
  if (x < 0 || y < 0 || x >= N || y >= N) return 0;
  return BITS[y][x];
}

// Transforma coordenadas de pantalla -> coordenadas del logo segun movimiento
function transform(u, v, t, row, rows) {
  switch (MOV) {
    case 'rebote': {
      const ph = Math.abs(Math.sin(t * 2.2));
      const squash = 1 + (1 - ph) * 0.25 * (ph < 0.25 ? 1 : 0);
      return { u: u * squash, v: (v + ph * 0.45 - 0.2) / (1 / squash), shade: 1 };
    }
    case 'latido': {
      const s = 1 + 0.18 * Math.pow(Math.abs(Math.sin(t * 2.5)), 6);
      return { u: u * 1.15 / s, v: v * 1.15 / s, shade: 1 };
    }
    case 'onda': {
      return { u: u + 0.12 * Math.sin(v * 5 + t * 5), v, shade: 1 };
    }
    default: { // giro: moneda girando sobre el eje Y
      const c = Math.cos(t * 2.4);
      if (Math.abs(c) < 0.04) return null;
      return { u: u / c, v, shade: 0.55 + 0.45 * Math.abs(c) };
    }
  }
}

function frame(t) {
  const anchoTerm = Math.max(20, Math.min((process.stdout.columns || 80) - 1, 160));
  // En modo en-linea el alto lo manda el argumento, no la terminal:
  // asi el logo ocupa solo su cachito y no se come el reporte.
  const rows = ENLINEA
    ? ALTO
    : Math.max(10, Math.min((process.stdout.rows || 40) - 1, 60));
  const cols = anchoTerm;
  // la celda de terminal mide ~2:1, usamos la dimension menor
  const size = Math.min(rows, Math.floor(cols / 2));
  const w = size * 2, h = size;
  const padL = Math.floor((cols - w) / 2), padT = Math.floor((rows - h) / 2);

  let frameColor = null;
  if (COL === 'parrot') {
    let i; do { i = Math.floor(Math.random() * PARROT.length); } while (i === lastParrot);
    lastParrot = i; frameColor = '\x1b[' + PARROT[i] + 'm';
  }

  // '\x1b[H' manda el cursor a la esquina de la pantalla. En modo
  // en-linea NO se usa: el loop reposiciona con cursor-arriba.
  let out = ENLINEA ? '' : '\x1b[H';
  for (let r = 0; r < rows; r++) {
    let line = '';
    let prev = '';
    for (let c = 0; c < cols; c++) {
      const sx = c - padL, sy = r - padT;
      let ch = ' ';
      if (sx >= 0 && sy >= 0 && sx < w && sy < h) {
        let hits = 0, tr = null;
        // supermuestreo 3x3 por celda para bordes suaves
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
          const u = ((sx + (b + 0.5) / 3) / w) * 2 - 1;
          const v = ((sy + (a + 0.5) / 3) / h) * 2 - 1;
          tr = transform(u * 1.05, v * 1.05, t, r, rows);
          if (tr) hits += sample(tr.u, tr.v);
        }
        if (hits && tr) {
          const d = (hits / 9) * tr.shade;
          ch = RAMP[Math.max(1, Math.min(RAMP.length - 1, Math.round(d * (RAMP.length - 1))))];
          if (!frameColor) {
            let rgb;
            if (COL === 'marca') {
              // azul de marca con brillo que barre en diagonal
              const sweep = Math.max(0, 1 - Math.abs(((sx / w + sy / h) / 2) - ((t * 0.5) % 1.6 - 0.3)) * 6);
              rgb = hsl(208, 0.95, 0.55 + 0.4 * sweep);
            } else {
              rgb = hsl((sx * 3 + sy * 6 - t * 220) % 360 + 360, 1, 0.58);
            }
            const code = '\x1b[38;2;' + rgb.join(';') + 'm';
            if (code !== prev) { line += code; prev = code; }
          }
        }
      }
      line += ch;
    }
    out += (frameColor || '') + line + '\x1b[0m' + (r < rows - 1 ? '\n' : '');
  }
  return out;
}

// ---- loop ----
const t0 = Date.now();

if (ENLINEA) {
  // Modo en-linea: NO se borra nada. El logo se dibuja debajo de lo
  // que ya estaba y cada cuadro se pinta encima del anterior subiendo
  // el cursor. Asi el reporte del .bat sigue visible arriba.
  process.stdout.write('\x1b[?25l');
} else {
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H\x1b[?25l');
}

function salir() {
  // Devolver el teclado a su modo normal antes de irse, o la consola
  // se queda sin eco y el siguiente comando se escribe a ciegas.
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch (_) {}
  // En linea: deja el ultimo cuadro puesto y baja el cursor.
  // Pantalla completa: limpia, como antes.
  process.stdout.write(ENLINEA ? '\x1b[0m\x1b[?25h\n'
                               : '\x1b[0m\x1b[?25h\x1b[2J\x1b[H');
  process.exit(0);
}
process.on('SIGINT', salir);
if (!ENLINEA) process.stdout.on('resize', () => process.stdout.write('\x1b[2J'));

// Sin duracion fija, el logo hace de "pause": gira hasta que se
// presione cualquier tecla. El aviso va ARRIBA del logo porque el
// loop repinta hacia abajo desde aqui.
const ESPERA_TECLA = SEGS === 0 && process.stdin.isTTY;
if (ESPERA_TECLA) {
  process.stdout.write('\n' + AVISO + '\n\n');
  try {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', salir);   // cualquier tecla, Ctrl+C incluido
  } catch (_) {}
}

let primerCuadro = true;
const reloj = setInterval(() => {
  const cuadro = frame((Date.now() - t0) / 1000);
  if (ENLINEA) {
    const n = cuadro.split('\n').length;
    // Subir n lineas para repintar encima del cuadro anterior
    if (!primerCuadro) process.stdout.write('\x1b[' + n + 'A');
    primerCuadro = false;
    process.stdout.write(cuadro + '\n');
  } else {
    process.stdout.write(cuadro);
  }
}, FPS_MS);

// Sin esto el proceso vive para siempre y deja la ventana del .bat
// colgada esperando un Ctrl + C.
if (SEGS > 0) setTimeout(() => { clearInterval(reloj); salir(); }, SEGS * 1000);
