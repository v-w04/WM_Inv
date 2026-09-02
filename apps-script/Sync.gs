/**
 * ============================================================
 *  Sync — Dos procesos independientes
 * ============================================================
 *
 *  1) syncMain()          cada 10 min · catálogo (3,271) + WFS (471) ≈ 90 seg
 *     → escribe la hoja "Inventario" completa
 *
 *  2) syncRegularChunk()  cada 5 min · barre inventario normal por partes
 *     → escribe/actualiza la hoja "Inv_Normal", guarda su posición y continúa
 *       en la siguiente corrida. Ciclo completo ≈ 2 h para 3,271 SKUs.
 *
 *  Usan LockService para no pisarse.
 */

/* ============================================================
   1. SYNC PRINCIPAL — catálogo + WFS
   ============================================================ */
function syncMain() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log('⏭ syncMain: otra corrida en curso, se salta.');
    return { skipped: true };
  }

  try {
    const t0 = Date.now();
    const deadline = t0 + WM_CONFIG.BUDGET_MAIN_MS;
    Logger.log('▶ syncMain arrancando...');

    // WFS primero (rápido: 3 páginas)
    const wfsList = getAllWfsInventory();
    const wfsBySku = {};
    wfsList.forEach(function(w){ if (w.sku) wfsBySku[w.sku] = w; });

    // Catálogo (66 páginas)
    const items = getAllItems(deadline);
    if (!items.length) throw new Error('El catálogo regresó vacío — revisa el log.');

    // Merge: una fila por SKU del catálogo, con datos de WFS si aplica
    const rows = items.map(function(it){
      const w = wfsBySku[it.sku] || {};
      const enWfs = !!w.sku;
      return Object.assign({}, it, {
        esWFS:            enWfs ? 'SÍ' : 'NO',
        offerId:          w.offerId || '',
        // Sin WFS = 0 real, no celda vacía. Un hueco se lee como "no sé";
        // aquí sí sabemos: no está en WFS, así que no hay stock ahí.
        wfsDisponible:    enWfs ? (w.wfsAvailToSell != null ? w.wfsAvailToSell : 0) : 0,
        wfsEnMano:        enWfs ? (w.wfsOnHand != null ? w.wfsOnHand : 0) : 0,
        wfsReservado:     enWfs ? (w.wfsReserved != null ? w.wfsReserved : 0) : 0,
        wfsInbound:       w.wfsInbound != null ? w.wfsInbound : '',
        wfsEstado:        w.wfsStockStatus || '',
        wfsTipoNodo:      w.wfsShipNodeType || '',
        wfsActualizado:   w.wfsModifiedDate || '',
        wfsPrimerStock:   w.wfsFirstInStock || '',
        // Campos del endpoint nuevo (vacíos mientras siga el legacy)
        wfsEdad0_90:      w.wfsAge0_90 != null ? w.wfsAge0_90 : '',
        wfsEdad91_180:    w.wfsAge91_180 != null ? w.wfsAge91_180 : '',
        wfsEdad181_270:   w.wfsAge181_270 != null ? w.wfsAge181_270 : '',
        wfsEdad271_365:   w.wfsAge271_365 != null ? w.wfsAge271_365 : '',
        wfsEdad365plus:   w.wfsAgeOver365 != null ? w.wfsAgeOver365 : '',
        wfsProyS1_4:      w.wfsForecastW1_4 != null ? w.wfsForecastW1_4 : '',
        wfsProyS5_8:      w.wfsForecastW5_8 != null ? w.wfsForecastW5_8 : '',
        wfsProyS9_12:     w.wfsForecastW9_12 != null ? w.wfsForecastW9_12 : '',
        wfsSellThrough:   w.wfsSellThrough != null ? w.wfsSellThrough : '',
        wfsDiasSupply:    w.wfsDaysOfSupply != null ? w.wfsDaysOfSupply : '',
        wfsFechaOOS:      w.wfsOutOfStockDate || '',
        wfsSugeridas:     w.wfsSuggestedUnits != null ? w.wfsSuggestedUnits : '',
        wfsExcedente:     w.wfsSurplusUnits != null ? w.wfsSurplusUnits : '',
      });
    });

    writeMasterSheet_(rows);
    // Solo reinicia el barrido si la lista de SKUs cambió de tamaño
    // (si no, el cursor sigue siendo válido y no tiramos el avance).
    const cambioLista = ensureRegularSheet_(rows.map(function(r){ return r.sku; }));
    if (cambioLista) {
      resetInvCursor_();
      Logger.log('  ℹ La lista de SKUs cambió — barrido reiniciado.');
    }
    PropertiesService.getScriptProperties().setProperty(WM_CONFIG.PROP_LAST_MAIN, String(Date.now()));
    invalidateCache_();

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const conWfs = rows.filter(function(r){ return r.esWFS === 'SÍ'; }).length;
    Logger.log('✅ syncMain OK: ' + rows.length + ' SKUs (' + conWfs + ' en WFS) en ' + elapsed + 's');
    logRun_('syncMain', rows.length, elapsed, conWfs + ' en WFS');
    return { count: rows.length, wfs: conWfs, elapsedSec: elapsed };

  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
   2. BARRIDO POR PARTES — inventario normal (1 llamada por SKU)
   ============================================================ */
function syncRegularChunk() {
  // ── Cede el turno si syncMain lleva rato sin poder correr ──
  // Sin esto, el barrido acapara el lock 4 de cada 5 minutos y syncMain
  // se queda sin ejecutar (medido: pasó de 10 min a 123 min entre corridas).
  const lastMain = Number(PropertiesService.getScriptProperties()
                      .getProperty(WM_CONFIG.PROP_LAST_MAIN) || 0);
  const minsSinMain = lastMain ? (Date.now() - lastMain) / 60000 : 999;
  if (minsSinMain > WM_CONFIG.REFRESH_INTERVAL_MIN - 1) {
    Logger.log('⏭ Cediendo el turno a syncMain (lleva ' +
               minsSinMain.toFixed(0) + ' min sin correr).');
    return { skipped: true, reason: 'cede a syncMain' };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log('⏭ syncRegularChunk: otra corrida en curso, se salta.');
    return { skipped: true };
  }

  try {
    const t0 = Date.now();
    const deadline = t0 + WM_CONFIG.BUDGET_CHUNK_MS;

    const sh = getSheet_(WM_CONFIG.SHEET_REGULAR);
    const lastRow = sh.getLastRow();
    if (lastRow < 2) {
      Logger.log('⏭ Inv_Normal vacía. Corre syncMain() primero.');
      return { skipped: true, reason: 'sin SKUs' };
    }

    const totalSkus = lastRow - 1;
    let cursor = getInvCursor_();
    if (cursor >= totalSkus) cursor = 0;   // ciclo terminado → vuelve a empezar

    // Lee los SKUs pendientes desde el cursor
    const remaining = totalSkus - cursor;
    const skus = sh.getRange(cursor + 2, 1, remaining, 1).getValues();

    Logger.log('▶ Barrido inv. normal desde ' + cursor + ' / ' + totalSkus);

    const results = [];
    let errores = 0;
    let fallosSeguidos = 0;
    let throttled = false;

    for (let i = 0; i < skus.length; i++) {
      if (Date.now() > deadline) break;

      const sku = String(skus[i][0] || '').trim();
      if (!sku) { results.push(['', '', '', '']); continue; }

      const inv = getInventoryForSku(sku);

      if (inv.ok) {
        fallosSeguidos = 0;
        results.push([sku, inv.qty, inv.unit, new Date()]);
      } else {
        errores++;
        fallosSeguidos++;
        // Deja la celda intacta para que el siguiente ciclo lo reintente
        results.push([sku, '', '', '']);

        if (inv.throttled) throttled = true;

        // Circuit breaker: si Walmart nos está frenando, no tiene caso
        // seguir quemando el presupuesto. Guardamos el avance y salimos.
        if (fallosSeguidos >= 8) {
          Logger.log('  ⚠ ' + fallosSeguidos + ' fallos seguidos' +
                     (throttled ? ' (HTTP 429 — throttling)' : '') +
                     ' — se corta la corrida y se guarda el avance.');
          break;
        }
      }

      Utilities.sleep(throttled ? WM_CONFIG.SKU_PACING_MS * 4 : WM_CONFIG.SKU_PACING_MS);
    }

    // Escribe el bloque procesado
    if (results.length) {
      sh.getRange(cursor + 2, 1, results.length, 4).setValues(results);
      SpreadsheetApp.flush();
    }

    const newCursor = cursor + results.length;
    setInvCursor_(newCursor >= totalSkus ? 0 : newCursor);
    invalidateCache_();

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const pct = ((newCursor / totalSkus) * 100).toFixed(1);
    const ciclo = newCursor >= totalSkus ? ' · CICLO COMPLETO ✓' : '';
    Logger.log('✅ Barrido: ' + results.length + ' SKUs en ' + elapsed + 's · ' +
               newCursor + '/' + totalSkus + ' (' + pct + '%)' + ciclo +
               (errores ? ' · ' + errores + ' errores' : ''));
    logRun_('chunk', results.length, elapsed, newCursor + '/' + totalSkus + ' (' + pct + '%)');

    return { processed: results.length, cursor: newCursor, total: totalSkus, elapsedSec: elapsed };

  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
   Cursor del barrido
   ============================================================ */
function getInvCursor_() {
  const v = PropertiesService.getScriptProperties().getProperty(WM_CONFIG.PROP_INV_CURSOR);
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
function setInvCursor_(n) {
  PropertiesService.getScriptProperties().setProperty(WM_CONFIG.PROP_INV_CURSOR, String(n));
}
function resetInvCursor_() {
  setInvCursor_(0);
}

/** Fuerza que el barrido empiece de cero */
function reiniciarBarrido() {
  resetInvCursor_();
  Logger.log('✅ Barrido reiniciado desde el SKU 0.');
}

/* ============================================================
   Escritura de hojas
   ============================================================ */
/**
 * Orden de columnas en la hoja Inventario.
 * Las primeras 9 son las que se usan a diario — mismo orden que en el dashboard.
 */
const MASTER_COLS = [
  // ── Las de uso diario ──
  'sku', 'shelf', 'upc', 'gtin', 'price', 'currency',
  'publishedStatus', 'esWFS', 'wfsDisponible',
  // ── Resto del catálogo ──
  'productName', 'productType', 'shelfCompleto', 'wpid', 'mart',
  'lifecycleStatus', 'unpublishedReasons', 'offerId',
  // ── Resto de WFS ──
  'wfsEnMano', 'wfsReservado', 'wfsInbound',
  'wfsEstado', 'wfsTipoNodo', 'wfsActualizado', 'wfsPrimerStock',
  'wfsEdad0_90', 'wfsEdad91_180', 'wfsEdad181_270', 'wfsEdad271_365', 'wfsEdad365plus',
  'wfsProyS1_4', 'wfsProyS5_8', 'wfsProyS9_12',
  'wfsSellThrough', 'wfsDiasSupply', 'wfsFechaOOS', 'wfsSugeridas', 'wfsExcedente',
];

/** Columnas que Sheets debe tratar como TEXTO (si no, se come los ceros iniciales) */
const COLS_TEXTO = ['upc', 'gtin', 'sku'];

function writeMasterSheet_(rows) {
  if (!rows || !rows.length) return;
  const sh = getSheet_(WM_CONFIG.SHEET_MASTER);

  const values = [MASTER_COLS].concat(rows.map(function(r){
    return MASTER_COLS.map(function(c){ return r[c] != null ? r[c] : ''; });
  }));

  // ── REGLA: esta función escribe DATOS, no formato. ──
  // Nada de congelar filas/columnas, colores de encabezado, anchos ni
  // agrupaciones. El formato de la hoja es del usuario; si el script lo
  // reimpone en cada corrida, borra su trabajo cada 10 minutos.
  //
  // La única excepción es el formato TEXTO de upc/gtin: sin él Sheets
  // convierte "00063790259141" a 63790259141 y se pierden los ceros.
  // Eso es corrección de datos, no estética — y solo se aplica si hace falta.

  sh.clearContents();
  SpreadsheetApp.flush();

  COLS_TEXTO.forEach(function(col){
    const i = MASTER_COLS.indexOf(col);
    if (i < 0) return;
    const rango = sh.getRange(1, i + 1, Math.max(values.length, 2), 1);
    // Solo tocar si todavía no es texto, para no reescribir formato sin necesidad
    if (rango.getNumberFormat() !== '@') rango.setNumberFormat('@');
  });

  sh.getRange(1, 1, values.length, MASTER_COLS.length).setValues(values);
  SpreadsheetApp.flush();
}

/**
 * Prepara la hoja de inventario normal con la misma lista y orden de SKUs
 * que el master. Conserva las cantidades ya obtenidas de los SKUs que siguen existiendo.
 */
/**
 * Prepara la hoja de inventario normal con la lista de SKUs del master.
 * Conserva las cantidades ya obtenidas.
 * @return {boolean} true si la lista de SKUs cambió (hay que reiniciar el cursor)
 */
function ensureRegularSheet_(skus) {
  const sh = getSheet_(WM_CONFIG.SHEET_REGULAR);
  const headers = ['sku', 'cantidad', 'unidad', 'revisadoEn'];

  // Conserva lo ya barrido
  const previo = {};
  const lastRow = sh.getLastRow();
  const totalPrevio = Math.max(0, lastRow - 1);
  let mismoOrden = (totalPrevio === skus.length);

  if (lastRow > 1) {
    const old = sh.getRange(2, 1, lastRow - 1, 4).getValues();
    old.forEach(function(r, idx){
      const s = String(r[0] || '').trim();
      if (s) previo[s] = [r[1], r[2], r[3]];
      if (mismoOrden && s !== skus[idx]) mismoOrden = false;
    });
  }

  const values = [headers].concat(skus.map(function(s){
    const p = previo[s];
    return p ? [s, p[0], p[1], p[2]] : [s, '', '', ''];
  }));

  // Igual que arriba: solo datos, sin tocar el formato de la hoja.
  sh.clearContents();
  SpreadsheetApp.flush();
  sh.getRange(1, 1, values.length, 4).setValues(values);
  SpreadsheetApp.flush();

  return !mismoOrden;   // true = la lista cambió → reiniciar cursor
}

/* ============================================================
   LECTURA para el web app — merge de las dos hojas
   ============================================================ */
function loadRows_() {
  const cached = getCachedData();
  if (cached && cached.rows && cached.rows.length) return cached;

  const master = readSheetAsObjects_(WM_CONFIG.SHEET_MASTER);
  if (!master.length) return { rows: [], ts: 0, progress: null };

  // Merge con inventario normal
  const regular = {};
  try {
    const sh = getSheet_(WM_CONFIG.SHEET_REGULAR);
    const lastRow = sh.getLastRow();
    if (lastRow > 1) {
      const vals = sh.getRange(2, 1, lastRow - 1, 4).getValues();
      vals.forEach(function(r){
        const s = String(r[0] || '').trim();
        if (s) regular[s] = {
          invNormal:  r[1] === '' ? '' : Number(r[1]),
          invUnidad:  r[2] || '',
          invRevisado: r[3] instanceof Date ? r[3].toISOString() : (r[3] || ''),
        };
      });
    }
  } catch (e) {
    Logger.log('⚠ No se pudo leer Inv_Normal: ' + e.message);
  }

  const rows = master.map(function(m){
    const r = regular[m.sku] || {};
    return Object.assign({}, m, {
      invNormal:   r.invNormal !== undefined ? r.invNormal : '',
      invUnidad:   r.invUnidad || '',
      invRevisado: r.invRevisado || '',
    });
  });

  // Cobertura = cuántos SKUs YA tienen dato de inventario.
  // Es distinto del cursor: el cursor es la posición del recorrido actual
  // y vuelve a cero en cada ciclo, la cobertura solo sube.
  let conDato = 0;
  Object.keys(regular).forEach(function(s){
    if (regular[s].invNormal !== '' && regular[s].invNormal !== undefined) conDato++;
  });

  const cursor = getInvCursor_();
  const progress = {
    cubiertos: conDato,
    total: master.length,
    pctCobertura: master.length ? Math.round((conDato / master.length) * 100) : 0,
    cursor: cursor,
    pctPase: master.length ? Math.round((cursor / master.length) * 100) : 0,
  };

  const payload = { rows: rows, ts: Date.now(), progress: progress };
  cacheData_(payload);
  return payload;
}

function readSheetAsObjects_(sheetName) {
  try {
    const sh = getSpreadsheet_().getSheetByName(sheetName);
    if (!sh) return [];
    const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return [];

    const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = values[0].map(String);
    const out = [];
    for (let i = 1; i < values.length; i++) {
      const o = {};
      for (let j = 0; j < headers.length; j++) {
        const v = values[i][j];
        o[headers[j]] = (v instanceof Date) ? v.toISOString() : v;
      }
      out.push(o);
    }
    return out;
  } catch (e) {
    Logger.log('⚠ readSheetAsObjects_(' + sheetName + '): ' + e.message);
    return [];
  }
}

/* ============================================================
   Cache
   ============================================================ */
function cacheData_(payload) {
  try {
    const json = JSON.stringify(payload);
    if (json.length > WM_CONFIG.MAX_CACHE_BYTES) {
      Logger.log('  ℹ Dataset ' + Math.round(json.length/1024) + 'KB — se sirve desde Sheet');
      return;
    }
    const cache = CacheService.getScriptCache();
    const chunkSize = 90 * 1024;
    const chunks = [];
    for (let i = 0; i < json.length; i += chunkSize) chunks.push(json.substring(i, i + chunkSize));
    const put = {};
    put[WM_CONFIG.CACHE_INVENTORY + '_n'] = String(chunks.length);
    chunks.forEach(function(c, i){ put[WM_CONFIG.CACHE_INVENTORY + '_' + i] = c; });
    cache.putAll(put, WM_CONFIG.CACHE_TTL_SECONDS);
  } catch (e) {
    Logger.log('  ⚠ Cache falló (no crítico): ' + e.message);
  }
}

function getCachedData() {
  try {
    const cache = CacheService.getScriptCache();
    const nStr = cache.get(WM_CONFIG.CACHE_INVENTORY + '_n');
    if (!nStr) return null;
    const n = Number(nStr);
    let json = '';
    for (let i = 0; i < n; i++) {
      const c = cache.get(WM_CONFIG.CACHE_INVENTORY + '_' + i);
      if (c === null) return null;
      json += c;
    }
    return JSON.parse(json);
  } catch (e) { return null; }
}

function invalidateCache_() {
  try {
    const cache = CacheService.getScriptCache();
    const nStr = cache.get(WM_CONFIG.CACHE_INVENTORY + '_n');
    if (!nStr) return;
    const keys = [WM_CONFIG.CACHE_INVENTORY + '_n'];
    for (let i = 0; i < Number(nStr); i++) keys.push(WM_CONFIG.CACHE_INVENTORY + '_' + i);
    cache.removeAll(keys);
  } catch (e) {}
}

/* ============================================================
   Log
   ============================================================ */
function logRun_(tipo, count, elapsed, nota) {
  try {
    const sh = getSheet_(WM_CONFIG.SHEET_LOG);
    if (sh.getLastRow() === 0) {
      sh.appendRow(['Timestamp', 'Proceso', 'Filas', 'Segundos', 'Nota']);
    }
    sh.appendRow([new Date(), tipo, count, elapsed, nota || '']);
  } catch (e) {}
}

/* ============================================================
   Diagnóstico
   ============================================================ */
function testSheetAccess() {
  try {
    const ss = getSpreadsheet_();
    Logger.log('✅ Sheet OK: "' + ss.getName() + '"');
    Logger.log('   Pestañas: ' + ss.getSheets().map(function(s){ return s.getName(); }).join(', '));
    return true;
  } catch (e) {
    Logger.log('❌ ' + e.message);
    return false;
  }
}

/** Muestra en qué va el barrido de inventario normal */
function verProgreso() {
  try {
    const sh = getSheet_(WM_CONFIG.SHEET_REGULAR);
    const total = Math.max(0, sh.getLastRow() - 1);
    const cursor = getInvCursor_();
    const pct = total ? ((cursor / total) * 100).toFixed(1) : '0';

    let conDato = 0;
    if (total > 0) {
      const vals = sh.getRange(2, 2, total, 1).getValues();
      conDato = vals.filter(function(r){ return r[0] !== '' && r[0] !== null; }).length;
    }

    Logger.log('── PROGRESO DEL BARRIDO ──');
    Logger.log('  Total de SKUs:      ' + total);
    Logger.log('  Cursor actual:      ' + cursor + '  (' + pct + '%)');
    Logger.log('  SKUs con inventario: ' + conDato);
    Logger.log('  Endpoint WFS:       ' +
      (PropertiesService.getScriptProperties().getProperty(WM_CONFIG.PROP_WFS_ENDPOINT) || 'sin detectar'));
    const faltan = Math.max(0, total - cursor);
    const corridas = Math.ceil(faltan / 280);
    Logger.log('  Faltan ~' + corridas + ' corridas (~' + (corridas * WM_CONFIG.CHUNK_INTERVAL_MIN) + ' min)');
  } catch (e) {
    Logger.log('❌ ' + e.message);
  }
}
