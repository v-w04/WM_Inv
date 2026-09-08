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

    // Marca el turno AL EMPEZAR, no al terminar.
    //
    // Si se marca solo cuando termina bien y syncMain falla (cuota, red),
    // nunca queda registro de que corrió. El barrido entonces cree que
    // syncMain lleva horas esperando turno y cede indefinidamente:
    // los dos se quedan bloqueados y no corre ninguno.
    PropertiesService.getScriptProperties()
      .setProperty(WM_CONFIG.PROP_LAST_MAIN, String(Date.now()));

    if (cuotaGoogleAgotada_()) {
      Logger.log('⏭ syncMain: Google reportó cuota agotada hoy. Se salta.');
      return { skipped: true, reason: 'cuota de Google agotada' };
    }

    /* ── ¿Toca bajar el catálogo completo? ───────────────────────
       El stock de WFS se mueve con cada venta, así que eso sí se
       refresca cada 15 min: son 3 llamadas.

       El catálogo (nombres, precios, publishedStatus) casi no cambia,
       y bajarlo cuesta ~17 llamadas. Repaginarlo 96 veces al día era
       el 65% de todo el consumo del proyecto para releer lo mismo.
       Ahora se baja una vez por hora; el resto de las corridas lo
       relee de la hoja, que no cuesta ni una llamada.               */
    const propsS = PropertiesService.getScriptProperties();
    const lastCat = Number(propsS.getProperty(WM_CONFIG.PROP_LAST_CATALOG) || 0);
    const minsSinCat = lastCat ? (Date.now() - lastCat) / 60000 : 999999;
    let tocaCatalogo = minsSinCat >= WM_CONFIG.CATALOG_REFRESH_MIN;

    // Si no alcanza el presupuesto, mejor no empezar a medias.
    const restan = fetchRestantes_();
    const costo = tocaCatalogo ? 60 : 15;
    if (restan < costo) {
      Logger.log('⏭ syncMain: solo quedan ' + restan + ' llamadas hoy ' +
                 '(esta corrida necesita ~' + costo + '). Se salta.');
      return { skipped: true, reason: 'sin presupuesto' };
    }

    Logger.log('▶ syncMain arrancando... (' + restan + ' llamadas disponibles hoy)');

    // WFS siempre (rápido: 3 páginas de 200)
    const wfsList = getAllWfsInventory();
    const wfsBySku = {};
    wfsList.forEach(function(w){ if (w.sku) wfsBySku[w.sku] = w; });

    // Catálogo: de la API si toca, de la hoja si no
    let items, origenCat;
    if (tocaCatalogo) {
      items = getAllItems(deadline);
      origenCat = 'API';
    } else {
      items = leerCatalogoDelMaster_();
      origenCat = 'hoja (catálogo de hace ' + minsSinCat.toFixed(0) + ' min)';

      // Guardarraíl: la hoja se reescribe entera con lo que aquí se lea.
      // Si por lo que sea vino incompleta (lectura a media escritura, alguien
      // borrando filas), escribirla de vuelta convertiría un accidente en
      // pérdida de datos. Ante la duda, se paga la API.
      const ultimoN = Number(propsS.getProperty(WM_CONFIG.PROP_MASTER_COUNT) || 0);
      if (ultimoN && items.length < ultimoN * 0.5) {
        Logger.log('  ⚠ La hoja solo trajo ' + items.length + ' SKUs de ~' + ultimoN +
                   '. No se reescribe con eso: se baja el catálogo de la API.');
        items = [];
      }

      if (!items.length) {
        // Primera corrida, hoja vacía, o el guardarraíl de arriba.
        // Esta corrida se presupuestó como "ligera" (~15 llamadas) y ahora
        // resulta que necesita el catálogo completo. Se revisa otra vez
        // antes de arrancarlo: dejarlo a medias sería peor.
        if (fetchRestantes_() < 60) {
          Logger.log('⏭ syncMain: hace falta el catálogo completo y ya no ' +
                     'alcanza el presupuesto. Se salta esta corrida.');
          return { skipped: true, reason: 'sin presupuesto para el catálogo' };
        }
        Logger.log('  ℹ No hay catálogo confiable que releer. Se baja de la API.');
        items = getAllItems(deadline);
        origenCat = 'API (la hoja no servía)';
        tocaCatalogo = true;
      }
    }

    if (!items.length) throw new Error('El catálogo regresó vacío — revisa el log.');
    if (tocaCatalogo) propsS.setProperty(WM_CONFIG.PROP_LAST_CATALOG, String(Date.now()));
    Logger.log('  Catálogo: ' + items.length + ' items desde ' + origenCat);

    // Inventario propio ya consultado, para pegarlo al master.
    // Se lee ANTES de reconstruir Inv_Normal para no perder nada.
    const propioBySku = leerInvNormal_();

    // Merge: una fila por SKU del catálogo, con WFS e inventario propio
    const rows = items.map(function(it){
      const w = wfsBySku[it.sku] || {};
      const pr = propioBySku[it.sku] || {};
      const enWfs = !!w.sku;
      const wfsDisp = enWfs ? (w.wfsAvailToSell != null ? Number(w.wfsAvailToSell) : 0) : 0;

      // El inventario propio se deja VACÍO si nunca se ha consultado.
      // Un 0 diría "no hay stock"; un hueco dice "todavía no sé", que
      // es la verdad mientras el barrido no llega a ese SKU.
      const tienePropio = pr.cantidad !== undefined && pr.cantidad !== '';
      const propio = tienePropio ? Number(pr.cantidad) : '';

      return Object.assign({}, it, {
        esWFS:            enWfs ? 'SÍ' : 'NO',
        offerId:          w.offerId || '',
        // Sin WFS = 0 real, no celda vacía. Un hueco se lee como "no sé";
        // aquí sí sabemos: no está en WFS, así que no hay stock ahí.
        wfsDisponible:    wfsDisp,
        invNormal:        propio,
        stockTotal:       tienePropio ? (wfsDisp + propio) : wfsDisp,
        invRevisado:      pr.revisado || '',
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
    propsS.setProperty(WM_CONFIG.PROP_MASTER_COUNT, String(rows.length));
    // ensureRegularSheet_ conserva por SKU lo ya consultado. El barrido
    // ya no usa cursor de posición, así que crecer el catálogo o que
    // Walmart devuelva otro orden ya no borra el avance.
    ensureRegularSheet_(rows.map(function(r){ return r.sku; }));
    invalidateCache_();

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const conWfs = rows.filter(function(r){ return r.esWFS === 'SÍ'; }).length;
    Logger.log('✅ syncMain OK: ' + rows.length + ' SKUs (' + conWfs + ' en WFS) en ' + elapsed + 's' +
               ' · quedan ' + fetchRestantes_() + ' llamadas hoy');
    logRun_('syncMain', rows.length, elapsed,
            conWfs + ' en WFS' + (tocaCatalogo ? ' · catálogo completo' : ' · solo WFS'));
    return {
      count: rows.length, wfs: conWfs, elapsedSec: elapsed,
      catalogoCompleto: tocaCatalogo,
    };

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

    if (cuotaGoogleAgotada_()) {
      Logger.log('⏭ Barrido: Google reportó cuota agotada hoy. Se salta.');
      return { skipped: true, reason: 'cuota de Google agotada' };
    }

    const restan = fetchRestantes_();
    const tope = Math.min(WM_CONFIG.MAX_SKUS_POR_CHUNK, Math.max(0, restan - 100));
    if (tope <= 0) {
      Logger.log('⏭ Barrido: sin presupuesto propio hoy (' + restan + ' restantes).');
      return { skipped: true, reason: 'sin presupuesto' };
    }

    /* ── Armar la cola de trabajo ──────────────────────────────
       Sin cursor de posición: se buscan las filas que faltan.
       Un cursor se corrompe cuando el catálogo crece o Walmart
       devuelve los items en otro orden — y entonces el avance
       se reinicia solo, sin que nadie se entere.

       Prioridad 1: los que nunca se han consultado
       Prioridad 2: los más viejos primero
       ────────────────────────────────────────────────────────── */
    const total = lastRow - 1;
    const datos = sh.getRange(2, 1, total, 4).getValues();

    const nuevos = [];
    const viejos = [];

    for (let i = 0; i < datos.length; i++) {
      const sku = String(datos[i][0] || '').trim();
      if (!sku) continue;
      const tieneDato = datos[i][1] !== '' && datos[i][1] !== null;
      if (!tieneDato) {
        nuevos.push(i);
      } else {
        const ts = datos[i][3] instanceof Date ? datos[i][3].getTime() : 0;
        viejos.push({ i: i, ts: ts });
      }
    }
    viejos.sort(function(a, b){ return a.ts - b.ts; });

    const cola = nuevos.concat(viejos.map(function(v){ return v.i; })).slice(0, tope);

    if (!cola.length) {
      Logger.log('⏭ Nada que barrer.');
      return { skipped: true, reason: 'cola vacía' };
    }

    Logger.log('▶ Barrido: ' + cola.length + ' SKUs de la cola  (' +
               nuevos.length + ' sin dato, ' + viejos.length + ' a refrescar)');

    /* ── Procesar ────────────────────────────────────────────── */
    let hechos = 0, errores = 0, fallosSeguidos = 0;
    let throttled = false, sinPresupuesto = false;

    for (let k = 0; k < cola.length; k++) {
      if (Date.now() > deadline) break;

      const idx = cola[k];
      const sku = String(datos[idx][0]).trim();
      const inv = getInventoryForSku(sku);

      if (inv.sinPresupuesto) {
        sinPresupuesto = true;
        Logger.log('  ⏹ Presupuesto agotado a media corrida. Se guarda el avance.');
        break;
      }

      if (inv.ok) {
        fallosSeguidos = 0;
        hechos++;
        datos[idx][1] = inv.qty;
        datos[idx][2] = inv.unit;
        datos[idx][3] = new Date();
      } else {
        errores++;
        fallosSeguidos++;
        if (inv.throttled) throttled = true;
        // No se toca la celda: queda en la cola para el siguiente intento
        if (fallosSeguidos >= 8) {
          Logger.log('  ⚠ ' + fallosSeguidos + ' fallos seguidos' +
                     (throttled ? ' (HTTP 429 — throttling)' : '') +
                     ' — se corta y se guarda el avance.');
          break;
        }
      }

      Utilities.sleep(throttled ? WM_CONFIG.SKU_PACING_MS * 4 : WM_CONFIG.SKU_PACING_MS);
    }

    /* ── Guardar de una sola escritura ───────────────────────── */
    if (hechos > 0) {
      sh.getRange(2, 1, total, 4).setValues(datos);
      SpreadsheetApp.flush();
      // Reflejarlo en la hoja principal de inmediato, para que no quede
      // desfasada hasta el siguiente syncMain (hasta 15 min después)
      actualizarStockEnMaster_(datos);
      invalidateCache_();
    }

    /* ── Reportar cobertura, no posición ─────────────────────── */
    let conDato = 0;
    for (let i = 0; i < datos.length; i++) {
      if (datos[i][1] !== '' && datos[i][1] !== null) conDato++;
    }
    const pct = total ? Math.round(conDato / total * 100) : 0;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    Logger.log('✅ Barrido: ' + hechos + ' SKUs en ' + elapsed + 's' +
               (errores ? ' · ' + errores + ' errores' : '') +
               '  →  cobertura ' + conDato + '/' + total + ' (' + pct + '%)' +
               ' · quedan ' + fetchRestantes_() + ' llamadas hoy');

    logRun_('chunk', hechos, elapsed,
            'cobertura ' + conDato + '/' + total + ' (' + pct + '%)' +
            (sinPresupuesto ? ' · sin presupuesto' : ''));

    return {
      processed: hechos, errores: errores,
      cubiertos: conDato, total: total, pct: pct,
      elapsedSec: elapsed,
    };

  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
   Barrido — sin cursor
   ============================================================
   El barrido ya no lleva posición: cada corrida busca las filas
   que le faltan. Estas funciones quedan por compatibilidad.
   ============================================================ */
function getInvCursor_() { return 0; }

/**
 * Borra las cantidades de Inv_Normal para forzar un barrido completo.
 * Los SKUs se conservan; solo se vacía el dato de inventario.
 */
function reiniciarBarrido() {
  const sh = getSheet_(WM_CONFIG.SHEET_REGULAR);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) { Logger.log('Inv_Normal está vacía.'); return; }

  const n = lastRow - 1;
  const vacias = [];
  for (let i = 0; i < n; i++) vacias.push(['', '', '']);
  sh.getRange(2, 2, n, 3).setValues(vacias);
  SpreadsheetApp.flush();
  invalidateCache_();

  Logger.log('✅ ' + n + ' SKUs marcados como pendientes.');
  Logger.log('   El barrido los va a consultar de nuevo.');
}

/* ============================================================
   Escritura de hojas
   ============================================================ */
/**
 * Orden de columnas en la hoja Inventario.
 * Las primeras 9 son las que se usan a diario — mismo orden que en el dashboard.
 */
/* ──────────────────────────────────────────────────────────────
   COLUMNAS DE LA HOJA "Inventario"

   Antes eran 40 fijas y 17 salían SIEMPRE vacías: son campos que
   solo existen en /v3/wfs/inventory (WFS avanzado), y esa cuenta
   todavía no tiene habilitado "Program Eligibility".

   Ahora la lista se arma sola:
     · modo legacy → solo las columnas que de verdad se llenan (23)
     · modo new    → se agregan las 15 de analítica WFS

   El día que Walmart habilite el endpoint nuevo, detectWfsEndpoint_()
   guarda 'new' y las columnas reaparecen sin tocar código.
   ────────────────────────────────────────────────────────────── */
const MASTER_COLS_BASE = [
  // ── Las de uso diario ──
  'sku', 'shelf', 'upc', 'gtin', 'price', 'currency',
  'publishedStatus', 'esWFS',
  'wfsDisponible',   // stock en bodega de Walmart (solo SKUs WFS)
  'invNormal',       // stock en TU bodega (los que envías tú)
  'stockTotal',      // la suma — el número que importa de un vistazo
  'invRevisado',     // cuándo se consultó invNormal por última vez
  // ── Resto del catálogo ──
  'productName', 'productType', 'shelfCompleto', 'wpid', 'mart', 'offerId',
  // ── Resto de WFS (esto sí lo trae el endpoint legacy) ──
  'wfsEnMano', 'wfsReservado', 'wfsEstado', 'wfsTipoNodo', 'wfsActualizado',
];

/** Solo con /v3/wfs/inventory habilitado. Con legacy vienen vacías. */
const MASTER_COLS_WFS_PRO = [
  'wfsInbound', 'wfsPrimerStock',
  'wfsEdad0_90', 'wfsEdad91_180', 'wfsEdad181_270', 'wfsEdad271_365', 'wfsEdad365plus',
  'wfsProyS1_4', 'wfsProyS5_8', 'wfsProyS9_12',
  'wfsSellThrough', 'wfsDiasSupply', 'wfsFechaOOS', 'wfsSugeridas', 'wfsExcedente',
];

function getMasterCols_() {
  const modo = PropertiesService.getScriptProperties()
                 .getProperty(WM_CONFIG.PROP_WFS_ENDPOINT);
  return (modo === 'new')
    ? MASTER_COLS_BASE.concat(MASTER_COLS_WFS_PRO)
    : MASTER_COLS_BASE.slice();
}

/** Campos que vienen de /v3/items — los únicos que se pueden releer de la hoja */
const CAMPOS_CATALOGO = [
  'sku', 'shelf', 'upc', 'gtin', 'price', 'currency', 'publishedStatus',
  'productName', 'productType', 'shelfCompleto', 'wpid', 'mart',
];

/** Columnas que Sheets debe tratar como TEXTO (si no, se come los ceros iniciales) */
const COLS_TEXTO = ['upc', 'gtin', 'sku'];

/**
 * Relee el catálogo desde la hoja "Inventario" en vez de la API.
 *
 * Devuelve la misma forma que getAllItems(), pero SOLO con los campos
 * que vienen de /v3/items. Todo lo de WFS y el inventario propio se
 * vuelve a calcular en syncMain con datos frescos, así que no se relee
 * nada que pueda estar viejo.
 *
 * Cuesta CERO llamadas HTTP. Ese es el punto.
 */
function leerCatalogoDelMaster_() {
  const out = [];
  try {
    const sh = getSpreadsheet_().getSheetByName(WM_CONFIG.SHEET_MASTER);
    if (!sh) return out;

    const last = sh.getLastRow();
    const ancho = sh.getLastColumn();
    if (last < 2 || ancho < 1) return out;

    const head = sh.getRange(1, 1, 1, ancho).getValues()[0]
                   .map(function(h){ return String(h).trim(); });
    const idx = {};
    head.forEach(function(h, i){ if (h && idx[h] === undefined) idx[h] = i; });
    if (idx['sku'] === undefined) {
      Logger.log('  ⚠ La hoja no tiene columna "sku". No se puede releer el catálogo.');
      return out;
    }

    const vals = sh.getRange(2, 1, last - 1, ancho).getValues();
    vals.forEach(function(r){
      const sku = String(r[idx['sku']] || '').trim();
      if (!sku) return;
      const o = {};
      CAMPOS_CATALOGO.forEach(function(c){
        o[c] = (idx[c] !== undefined && r[idx[c]] != null) ? r[idx[c]] : '';
      });
      o.sku = sku;
      // upc/gtin son texto con ceros a la izquierda: nunca como número.
      o.upc  = o.upc  === '' ? '' : String(o.upc);
      o.gtin = o.gtin === '' ? '' : String(o.gtin);
      out.push(o);
    });
  } catch (e) {
    Logger.log('  ⚠ No se pudo releer el catálogo de la hoja: ' + e.message);
    return [];
  }
  return out;
}

/**
 * Lee la hoja Inv_Normal a un mapa por SKU.
 * Se usa para pegar el inventario propio al master.
 */
function leerInvNormal_() {
  const mapa = {};
  try {
    const sh = getSpreadsheet_().getSheetByName(WM_CONFIG.SHEET_REGULAR);
    if (!sh) return mapa;
    const last = sh.getLastRow();
    if (last < 2) return mapa;

    const vals = sh.getRange(2, 1, last - 1, 4).getValues();
    vals.forEach(function(r){
      const sku = String(r[0] || '').trim();
      if (!sku) return;
      mapa[sku] = {
        cantidad: (r[1] === '' || r[1] === null) ? '' : Number(r[1]),
        unidad:   r[2] || '',
        revisado: r[3] instanceof Date ? r[3] : '',
      };
    });
  } catch (e) {
    Logger.log('  ⚠ No se pudo leer Inv_Normal: ' + e.message);
  }
  return mapa;
}

function writeMasterSheet_(rows) {
  if (!rows || !rows.length) return;
  const sh = getSheet_(WM_CONFIG.SHEET_MASTER);
  const MASTER_COLS = getMasterCols_();

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

  // Conserva por SKU lo ya consultado. Si un SKU sigue existiendo,
  // su cantidad y su fecha se mantienen aunque cambie de posición.
  const previo = {};
  const lastRow = sh.getLastRow();

  if (lastRow > 1) {
    const old = sh.getRange(2, 1, lastRow - 1, 4).getValues();
    old.forEach(function(r){
      const s = String(r[0] || '').trim();
      if (s) previo[s] = [r[1], r[2], r[3]];
    });
  }

  const values = [headers].concat(skus.map(function(s){
    const p = previo[s];
    return p ? [s, p[0], p[1], p[2]] : [s, '', '', ''];
  }));

  // Igual que arriba: solo datos, sin tocar el formato de la hoja.
  // La única excepción es la columna A como texto: hay SKUs que son
  // puros dígitos y Sheets los convierte a número, perdiendo ceros
  // iniciales — y entonces la consulta a Walmart falla.
  sh.clearContents();
  SpreadsheetApp.flush();

  const colSku = sh.getRange(1, 1, Math.max(values.length, 2), 1);
  if (colSku.getNumberFormat() !== '@') colSku.setNumberFormat('@');

  sh.getRange(1, 1, values.length, 4).setValues(values);
  SpreadsheetApp.flush();
}

/**
 * Copia el inventario propio a las columnas correspondientes de la hoja
 * principal, y recalcula stockTotal.
 *
 * Sin esto, Inventario se quedaría con el dato viejo hasta el siguiente
 * syncMain. Toca SOLO tres columnas — no reescribe la hoja entera.
 *
 * @param {Array} datosRegular filas [sku, cantidad, unidad, revisadoEn]
 */
function actualizarStockEnMaster_(datosRegular) {
  try {
    const sh = getSpreadsheet_().getSheetByName(WM_CONFIG.SHEET_MASTER);
    if (!sh) return;
    const last = sh.getLastRow();
    if (last < 2) return;

    // Las posiciones se leen del encabezado REAL de la hoja, no de la
    // constante: si el modo WFS cambia o alguien mueve una columna,
    // esto sigue escribiendo en el lugar correcto en vez de corromper datos.
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                   .map(function(h){ return String(h).trim(); });
    const cSku   = head.indexOf('sku') + 1;
    const cWfs   = head.indexOf('wfsDisponible') + 1;
    const cProp  = head.indexOf('invNormal') + 1;
    const cTotal = head.indexOf('stockTotal') + 1;
    const cRev   = head.indexOf('invRevisado') + 1;
    if (cSku < 1 || cWfs < 1 || cProp < 1 || cTotal < 1 || cRev < 1) {
      Logger.log('  ⚠ El encabezado de "' + WM_CONFIG.SHEET_MASTER +
                 '" no tiene las columnas de stock. Se salta la actualización.');
      return;
    }

    // Mapa de lo recién consultado
    const nuevo = {};
    datosRegular.forEach(function(r){
      const s = String(r[0] || '').trim();
      if (s) nuevo[s] = { cant: r[1], rev: r[3] };
    });

    const n = last - 1;
    const skus = sh.getRange(2, cSku, n, 1).getValues();
    const wfs  = sh.getRange(2, cWfs, n, 1).getValues();

    const salida = [];
    let cambios = 0;

    for (let i = 0; i < n; i++) {
      const s = String(skus[i][0] || '').trim();
      const d = nuevo[s];
      const wfsQty = Number(wfs[i][0]) || 0;

      if (d && d.cant !== '' && d.cant !== null) {
        const propio = Number(d.cant);
        salida.push([propio, wfsQty + propio, d.rev || '']);
        cambios++;
      } else if (d) {
        salida.push(['', wfsQty, '']);
      } else {
        salida.push([null, null, null]);   // null = no tocar
      }
    }

    if (!cambios) return;

    // Escribir las tres columnas juntas si son contiguas; si no, una por una
    if (cTotal === cProp + 1 && cRev === cProp + 2) {
      const actuales = sh.getRange(2, cProp, n, 3).getValues();
      for (let i = 0; i < n; i++) {
        if (salida[i][0] === null) salida[i] = actuales[i];
      }
      sh.getRange(2, cProp, n, 3).setValues(salida);
    } else {
      const cols = [cProp, cTotal, cRev];
      cols.forEach(function(col, j){
        const actual = sh.getRange(2, col, n, 1).getValues();
        const vals = salida.map(function(r, i){
          return [r[j] === null ? actual[i][0] : r[j]];
        });
        sh.getRange(2, col, n, 1).setValues(vals);
      });
    }
    SpreadsheetApp.flush();

  } catch (e) {
    // No es crítico: el siguiente syncMain lo corrige
    Logger.log('  ⚠ No se pudo reflejar el stock en la hoja principal: ' + e.message);
  }
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

  const progress = {
    cubiertos: conDato,
    total: master.length,
    pctCobertura: master.length ? Math.round((conDato / master.length) * 100) : 0,
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

    let conDato = 0, masViejo = null;
    if (total > 0) {
      const vals = sh.getRange(2, 2, total, 3).getValues();
      vals.forEach(function(r){
        if (r[0] !== '' && r[0] !== null) {
          conDato++;
          if (r[2] instanceof Date && (!masViejo || r[2] < masViejo)) masViejo = r[2];
        }
      });
    }
    const pct = total ? Math.round(conDato / total * 100) : 0;
    const faltan = total - conDato;
    const corridas = Math.ceil(faltan / WM_CONFIG.MAX_SKUS_POR_CHUNK);

    Logger.log('── PROGRESO DEL BARRIDO ──');
    Logger.log('  Total de SKUs:       ' + total);
    Logger.log('  Con dato:            ' + conDato + '  (' + pct + '%)');
    Logger.log('  Pendientes:          ' + faltan);
    if (faltan > 0) {
      Logger.log('  Faltan ~' + corridas + ' corridas ≈ ' +
                 (corridas * WM_CONFIG.CHUNK_INTERVAL_MIN / 60).toFixed(1) + ' horas');
    } else {
      Logger.log('  ✅ Cobertura completa. Ahora solo refresca los más viejos.');
    }
    if (masViejo) Logger.log('  Dato más viejo:      ' + masViejo.toLocaleString('es-MX'));
    Logger.log('  Endpoint WFS:        ' +
      (PropertiesService.getScriptProperties().getProperty(WM_CONFIG.PROP_WFS_ENDPOINT) || 'sin detectar'));
  } catch (e) {
    Logger.log('❌ ' + e.message);
  }
}
