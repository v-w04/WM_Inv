/**
 * ============================================================
 *  Sync — Fetch → normaliza → Sheet (persistente) → Cache (rápido)
 * ============================================================
 *
 *  Estrategia de lectura para el web app:
 *    1) CacheService  (rápido, 6h TTL)
 *    2) Google Sheet  (persistente, sin límite práctico)
 *    3) Walmart API   (solo si las dos anteriores están vacías, o con refresh explícito)
 *
 *  Así un cache expirado NO dispara un re-sync completo contra Walmart.
 */

function syncFullInventory() {
  const t0 = Date.now();
  Logger.log('▶ Sync arrancando...');

  const wfs = getAllWfsInventory();
  Logger.log('  WFS inventory: ' + wfs.length);

  const itemsBySku = {};
  if (WM_CONFIG.FETCH_CATALOG_ITEMS) {
    try {
      const items = getAllItems();
      Logger.log('  Catalog items: ' + items.length);
      items.forEach(function(it){ if (it && it.sku) itemsBySku[it.sku] = it; });
    } catch (e) { Logger.log('  ⚠ Items omitido: ' + e.message); }
  }

  const rows = wfs.map(function(e){ return normalizeRow_(e, itemsBySku); });

  // 1) Sheet primero (fuente persistente de verdad)
  writeToSheet_(rows);
  // 2) Cache después (capa caliente)
  cacheData_(rows);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  Logger.log('✅ Sync OK: ' + rows.length + ' filas en ' + elapsed + 's');
  logRun_(rows.length, elapsed);
  return { count: rows.length, elapsedSec: elapsed };
}

/* ============================================================
   Normalización
   ============================================================ */
function normalizeRow_(entry, itemsBySku) {
  const info  = entry.itemInformation   || {};
  const data  = entry.inventoryData     || {};
  const ins   = entry.inventoryInsights || {};
  const age   = data.inventoryAge       || {};
  const unav  = data.unavailableUnits   || {};
  const item  = itemsBySku[info.sku]    || {};
  const price = item.price              || {};

  return {
    sku: info.sku || '',
    itemName: info.itemName || item.productName || '',
    brand: info.brand || '',
    gtin: info.gtin || '',
    upc: item.upc || '',
    wpid: item.wpid || info.itemID || '',
    offerID: info.offerID || '',
    itemCondition: info.itemCondition || '',
    productType: item.productType || '',
    shelf: item.shelf || '',
    mart: item.mart || '',
    publishingStatus: data.publishingStatus || item.publishedStatus || '',
    itemLifecycle: data.itemLifecycle || item.lifecycleStatus || '',
    stockStatus: data.stockStatus || '',
    availableUnits: n_(data.availableUnits),
    reservedUnits: n_(data.reservedUnits),
    inboundUnits: n_(data.inboundUnits),
    onhandUnits: n_(data.onhandUnits),
    inventoryReviewUnits: n_(unav.inventoryReviewUnits),
    inventoryMovementUnits: n_(unav.inventoryMovementUnits),
    age_0_90: n_(age.units0to90Days),
    age_91_180: n_(age.units91to180Days),
    age_181_270: n_(age.units181to270Days),
    age_271_365: n_(age.units271to365Days),
    age_over_365: n_(age.unitsOver365Days),
    firstInStockDate: data.firstInStockDate || '',
    forecast_w1_4: n_(ins.salesForecastWeek1to4),
    forecast_w5_8: n_(ins.salesForecastWeek5to8),
    forecast_w9_12: n_(ins.salesForecastWeek9to12),
    sellThroughRate: n_(ins.sellThroughRate),
    daysOfSupply: n_(ins.daysOfSupply),
    outOfStockDate: ins.outOfStockDate || '',
    suggestedUnits: n_(ins.suggestedUnits),
    surplusUnits: n_(ins.surplusUnits),
    price: price.amount || '',
    currency: price.currency || (price.amount ? 'MXN' : ''),
    unpublishedReasons: Array.isArray(item.unpublishedReasons) ? item.unpublishedReasons.join('; ') : (item.unpublishedReasons || ''),
    lastSync: new Date().toISOString(),
  };
}

function n_(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/* ============================================================
   LECTURA para el web app: cache → sheet → (nada)
   ============================================================ */
function loadRows_() {
  const cached = getCachedData();
  if (cached && cached.length) return { rows: cached, source: 'cache', ts: getCachedTimestamp() };

  const fromSheet = readFromSheet_();
  if (fromSheet && fromSheet.length) {
    // repuebla el cache para las siguientes lecturas
    cacheData_(fromSheet);
    return { rows: fromSheet, source: 'sheet', ts: getSheetTimestamp_() };
  }
  return { rows: [], source: 'empty', ts: 0 };
}

/* ============================================================
   Cache (capa caliente)
   ============================================================ */
function cacheData_(rows) {
  try {
    const json = JSON.stringify(rows);
    if (json.length > WM_CONFIG.MAX_CACHE_BYTES) {
      Logger.log('  ⚠ Dataset ' + Math.round(json.length/1024) + 'KB excede cache; se servirá desde Sheet.');
      return;
    }
    const cache = CacheService.getScriptCache();
    const chunkSize = 90 * 1024;
    const chunks = [];
    for (let i = 0; i < json.length; i += chunkSize) chunks.push(json.substring(i, i + chunkSize));
    const payload = {};
    payload[WM_CONFIG.CACHE_INVENTORY + '_chunks'] = String(chunks.length);
    payload[WM_CONFIG.CACHE_INVENTORY + '_ts'] = String(Date.now());
    chunks.forEach(function(c, i){ payload[WM_CONFIG.CACHE_INVENTORY + '_' + i] = c; });
    cache.putAll(payload, WM_CONFIG.CACHE_TTL_SECONDS);
  } catch (e) {
    Logger.log('  ⚠ Cache falló (no es crítico): ' + e.message);
  }
}

function getCachedData() {
  try {
    const cache = CacheService.getScriptCache();
    const nStr = cache.get(WM_CONFIG.CACHE_INVENTORY + '_chunks');
    if (!nStr) return null;
    const n = Number(nStr);
    let json = '';
    for (let i = 0; i < n; i++) {
      const c = cache.get(WM_CONFIG.CACHE_INVENTORY + '_' + i);
      if (c === null) return null;   // chunk perdido → cache inválido
      json += c;
    }
    return JSON.parse(json);
  } catch (e) { return null; }
}

function getCachedTimestamp() {
  const ts = CacheService.getScriptCache().get(WM_CONFIG.CACHE_INVENTORY + '_ts');
  return ts ? Number(ts) : 0;
}

/* ============================================================
   Sheet (fuente persistente)
   ============================================================ */
function writeToSheet_(rows) {
  if (!rows || !rows.length) return;
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(WM_CONFIG.SHEET_INVENTORY);
  if (!sh) sh = ss.insertSheet(WM_CONFIG.SHEET_INVENTORY);

  const headers = Object.keys(rows[0]);
  const values = [headers].concat(rows.map(function(r){
    return headers.map(function(h){ return r[h]; });
  }));

  // clearContents antes de escribir (evita residuos de corridas más grandes)
  sh.clearContents();
  SpreadsheetApp.flush();
  sh.getRange(1, 1, values.length, headers.length).setValues(values);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold').setBackground('#0071dc').setFontColor('#ffffff');
  SpreadsheetApp.flush();
}

function readFromSheet_() {
  try {
    const ss = getSpreadsheet_();
    const sh = ss.getSheetByName(WM_CONFIG.SHEET_INVENTORY);
    if (!sh) return null;
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return null;

    const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = values[0].map(String);
    const rows = [];
    for (let i = 1; i < values.length; i++) {
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        const v = values[i][j];
        obj[headers[j]] = (v instanceof Date) ? v.toISOString() : v;
      }
      rows.push(obj);
    }
    return rows;
  } catch (e) {
    Logger.log('  ⚠ readFromSheet_ falló: ' + e.message);
    return null;
  }
}

function getSheetTimestamp_() {
  try {
    const ss = getSpreadsheet_();
    const log = ss.getSheetByName(WM_CONFIG.SHEET_LOG);
    if (!log || log.getLastRow() < 2) return 0;
    const v = log.getRange(log.getLastRow(), 1).getValue();
    return (v instanceof Date) ? v.getTime() : 0;
  } catch (e) { return 0; }
}

function logRun_(count, elapsed) {
  try {
    const ss = getSpreadsheet_();
    let log = ss.getSheetByName(WM_CONFIG.SHEET_LOG);
    if (!log) {
      log = ss.insertSheet(WM_CONFIG.SHEET_LOG);
      log.appendRow(['Timestamp', 'Rows', 'Elapsed (s)']);
      log.getRange(1, 1, 1, 3).setFontWeight('bold');
    }
    log.appendRow([new Date(), count, elapsed]);
  } catch (e) { Logger.log('  ⚠ logRun_ falló: ' + e.message); }
}

/* ============================================================
   Utilidad de diagnóstico
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
