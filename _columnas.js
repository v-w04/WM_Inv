// _columnas.js -- recordatorio: las columnas se leen por ENCABEZADO, no por posicion.
//
// Lo llaman 3-VERIFICAR.bat y 5-SUBIR-TODO.bat. No modifica nada.
//
// Busca en apps-script/*.gs lineas que leen una columna por numero:
//     fila[3]      datos[i][4]      getRange(r, 5, ...)
// y las compara con columnas-base.txt (las que ya existian y se van
// corrigiendo poco a poco). Solo avisa de las NUEVAS.
//
// Salida:  exit 0 = sin nuevas | exit 1 = hay nuevas (las lista) | exit 2 = no pude revisar
//
// Una linea que de verdad es posicional a proposito (una hoja que el propio
// codigo arma de cero y solo escribe) se marca con el comentario  // col-fija
// y se salta.
//
// Para aceptar lo que hay hoy como base:  node _columnas.js --base
//
// ASCII puro a proposito.

var fs = require('fs');
var path = require('path');

var DIR = path.join(__dirname, 'apps-script');
var BASE = path.join(__dirname, 'columnas-base.txt');

var PATRONES = [
  /\]\s*\[\s*[1-9]\d*\s*\]/,                                   // datos[i][4]
  /\b(fila|row|reg|rec|linea|ren|f|r|v|d)\s*\[\s*[1-9]\d*\s*\]/i,      // fila[3]
  /getRange\(\s*[^,()]+,\s*([2-9]|[1-9]\d+)\s*[,)]/            // getRange(r, 5, ...)
];

function limpia(l) { return l.replace(/\s+/g, ' ').trim(); }

function hallazgos() {
  var out = [];
  var archivos = fs.readdirSync(DIR).filter(function (f) { return /\.gs$/.test(f); }).sort();
  archivos.forEach(function (f) {
    var lineas = fs.readFileSync(path.join(DIR, f), 'utf8').split(/\r?\n/);
    lineas.forEach(function (l, i) {
      var t = limpia(l);
      if (!t || /^(\/\/|\*|\/\*)/.test(t)) return;           // comentarios
      if (/col-fija/.test(t)) return;                         // marcada a proposito
      if (PATRONES.some(function (p) { return p.test(t); })) {
        out.push({ archivo: f, linea: i + 1, texto: t, llave: f + '|' + t });
      }
    });
  });
  return out;
}

try {
  var hs = hallazgos();

  if (process.argv.indexOf('--base') !== -1) {
    fs.writeFileSync(BASE, hs.map(function (h) { return h.llave; }).join('\r\n') + '\r\n');
    console.log('base guardada: ' + hs.length + ' lineas heredadas');
    process.exit(0);
  }

  var base = {};
  if (fs.existsSync(BASE)) {
    fs.readFileSync(BASE, 'utf8').split(/\r?\n/).forEach(function (l) {
      if (l) base[l] = (base[l] || 0) + 1;
    });
  }
  var nuevas = [];
  hs.forEach(function (h) {
    if (base[h.llave] > 0) base[h.llave]--; else nuevas.push(h);
  });

  if (!nuevas.length) process.exit(0);

  nuevas.slice(0, 6).forEach(function (h) {
    console.log('         ' + h.archivo + ':' + h.linea + '  ' + h.texto.substring(0, 70));
  });
  if (nuevas.length > 6) console.log('         ... y ' + (nuevas.length - 6) + ' mas');
  process.exit(1);
} catch (e) {
  console.log('         ' + e.message);
  process.exit(2);
}
