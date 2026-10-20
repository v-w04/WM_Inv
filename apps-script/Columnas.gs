/**
 * ============================================================
 *  Columnas -- todo se busca por ENCABEZADO, nunca por posicion
 * ============================================================
 *
 * REGLA DEL PROYECTO: ninguna parte del codigo depende de que una columna
 * este en la letra C o en el indice 4. Si alguien mueve, inserta o borra una
 * columna, la logica tiene que seguir funcionando; y si falta una columna que
 * se necesita, avisa con un ERROR claro (log y fila en Sync_Log), no da datos
 * corridos en silencio.
 *
 *   var c = colsDe_(encabezados, ['sku', 'estado'], 'Bloqueados', ['motivo']);
 *   fila[c.estado]          // requeridas: si falta alguna -> ERROR y se detiene
 *                           // opcionales: quedan en -1 y el codigo decide
 *   colsHoja_(hoja, [...]) / colsDeHoja_(ss, 'Nombre', [...])  -> lo mismo, leyendo la hoja
 *
 * Una linea que a proposito es posicional se marca con  // col-fija
 * (node _columnas.js avisa de las lecturas por posicion nuevas).
 */

/** Encabezado normalizado: sin acentos, mayusculas, espacios simples. */
function normEnc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Mapa {nombre pedido -> indice 0-based} a partir de una fila de encabezados.
 * `requeridas`: si falta alguna, ERROR en el Log y throw.
 * `opcionales`: si faltan, quedan en -1 (el que llama decide).
 */
function colsDe_(encabezados, requeridas, nombreHoja, opcionales) {
  var idx = {};
  (encabezados || []).forEach(function (e, i) {
    var k = normEnc_(e);
    if (k && !(k in idx)) idx[k] = i;
  });

  var out = {}, faltan = [];
  (requeridas || []).forEach(function (n) {
    var k = normEnc_(n);
    if (k in idx) out[n] = idx[k]; else faltan.push(n);
  });
  (opcionales || []).forEach(function (n) {
    var k = normEnc_(n);
    out[n] = (k in idx) ? idx[k] : -1;
  });

  if (faltan.length) {
    var msg = 'En la hoja "' + nombreHoja + '" falta la columna ' +
              faltan.map(function (x) { return '"' + x + '"'; }).join(', ') +
              '. Revisa que nadie haya renombrado o borrado el encabezado.';
    Logger.log('\u26d4 ' + msg);
    try { logRun_('COLUMNAS', 0, 0, 'ERROR: ' + msg); } catch (e) {}   // sale en Sync_Log
    throw new Error(msg);
  }
  return out;
}

/** Lee la fila de encabezados de una hoja y devuelve el mapa. */
function colsHoja_(hoja, requeridas, opcionales, filaEnc) {
  filaEnc = filaEnc || 1;
  var nC = Math.max(1, hoja.getLastColumn());
  var enc = hoja.getRange(filaEnc, 1, 1, nC).getValues()[0];
  return colsDe_(enc, requeridas, hoja.getName(), opcionales);
}

/** Igual, pero la hoja por nombre. Si la hoja no existe, ERROR claro. */
function colsDeHoja_(ss, nombreHoja, requeridas, opcionales, filaEnc) {
  var h = ss.getSheetByName(nombreHoja);
  if (!h) {
    var msg = 'No existe la hoja "' + nombreHoja + '".';
    Logger.log('\u26d4 ' + msg);
    try { logRun_('COLUMNAS', 0, 0, 'ERROR: ' + msg); } catch (e) {}
    throw new Error(msg);
  }
  return colsHoja_(h, requeridas, opcionales, filaEnc);
}

/** Letra de una columna por su posicion 1-based (para formatos de la hoja propia). */
function colLetra_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/* ---------------- Esquemas ---------------- */

/**
 * Lo que cada hoja TIENE que traer para que el sync y el dashboard funcionen.
 * Los nombres salen de WM_CONFIG, no se escriben a mano.
 * `vaciaOk`: puede estar sin filas. `opcional`: puede no existir todavia.
 */
function esquemasRequeridos_() {
  return [
    { hoja: WM_CONFIG.SHEET_MASTER,
      cols: ['sku', 'shelf', 'upc', 'gtin', 'price', 'currency', 'publishedStatus', 'miEstado', 'esWFS',
             'wfsDisponible', 'invNormal', 'stockTotal', 'invRevisado', 'productName'] },
    { hoja: WM_CONFIG.SHEET_NOPUB,
      cols: ['sku', 'miEstado', 'publishedStatus', 'price', 'stockTotal', 'esWFS', 'productName', 'vistoDesde'],
      vaciaOk: true, opcional: true },
    { hoja: WM_CONFIG.SHEET_BLOQUEADOS,
      cols: ['sku', 'estado', 'motivo'], vaciaOk: true, opcional: true },
    { hoja: WM_CONFIG.SHEET_LLEGADAS,
      cols: ['fecha', 'sku', 'antes', 'despues', 'subio', 'enMano', 'walmartActualizado'],
      vaciaOk: true, opcional: true },
    { hoja: WM_CONFIG.SHEET_LOG,
      cols: ['Timestamp', 'Proceso', 'Filas', 'Segundos', 'Nota'], vaciaOk: true, opcional: true }
  ];
}

/**
 * Revisa todos los esquemas. Devuelve la lista de problemas (vacia = todo bien).
 * No truena: deja una fila ERROR por problema en Sync_Log.
 */
function revisarEsquemas_(ss) {
  ss = ss || getSpreadsheet_();
  var problemas = [];
  esquemasRequeridos_().forEach(function (e) {
    var h = ss.getSheetByName(e.hoja);
    if (!h) {
      if (!e.opcional) problemas.push('No existe la hoja "' + e.hoja + '"');
      return;
    }
    if (h.getLastRow() < 1) { if (!e.vaciaOk && !e.opcional) problemas.push('La hoja "' + e.hoja + '" esta vacia'); return; }
    var enc = h.getRange(1, 1, 1, Math.max(1, h.getLastColumn())).getValues()[0];
    var hay = {};
    enc.forEach(function (x) { hay[normEnc_(x)] = true; });
    var faltan = e.cols.filter(function (c) { return !hay[normEnc_(c)]; });
    if (faltan.length) problemas.push('Hoja "' + e.hoja + '": falta ' + faltan.join(', '));
  });
  problemas.forEach(function (p) {
    Logger.log('\u26d4 ' + p);
    try { logRun_('COLUMNAS', 0, 0, 'ERROR: ' + p); } catch (x) {}
  });
  return problemas;
}

/** Menu: revisar que todas las hojas traigan sus columnas. */
function revisarColumnas() {
  var p = revisarEsquemas_();
  var msg = p.length ? 'Problemas:\n\n  ' + p.join('\n  ') :
                       'Todas las hojas traen las columnas que necesitan.';
  try { SpreadsheetApp.getUi().alert('Columnas', msg, SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (e) { Logger.log(msg); }
  return msg;
}
