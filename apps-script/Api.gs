/**
 * ============================================================
 *  Api — Cliente HTTP de Walmart Marketplace API (MX)
 * ============================================================
 *
 *  Incluye reintentos con backoff exponencial en 429/5xx,
 *  y autodetección del endpoint de WFS (nuevo vs legacy).
 */

function wmHeaders_() {
  return {
    'WM_SEC.ACCESS_TOKEN':   getAccessToken(),
    'WM_QOS.CORRELATION_ID': Utilities.getUuid(),
    'WM_SVC.NAME':           WM_CONFIG.SERVICE_NAME,
    'WM_MARKET':             WM_CONFIG.MARKET,
    'WM_GLOBAL_VERSION':     WM_CONFIG.API_VERSION,
    'Accept':                'application/json',
    'Content-Type':          'application/json',
  };
}

function toQs_(params) {
  if (!params) return '';
  const parts = [];
  Object.keys(params).forEach(function(k){
    const v = params[k];
    if (v !== null && v !== undefined && v !== '') {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
  });
  return parts.length ? '?' + parts.join('&') : '';
}

/**
 * GET con reintentos.
 * - 401 → refresca token y reintenta (una vez)
 * - 429 / 5xx → backoff exponencial
 * - Otros 4xx → falla de inmediato (no tiene caso reintentar)
 */
function wmGet_(path, params, opts) {
  opts = opts || {};
  const url = getBaseUrl() + path + toQs_(params);
  let lastErr = null;

  for (let attempt = 0; attempt <= WM_CONFIG.MAX_RETRIES; attempt++) {
    let resp;
    try {
      resp = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: wmHeaders_(),
        muteHttpExceptions: true,
      });
    } catch (e) {
      lastErr = 'NETWORK: ' + e.message;
      Utilities.sleep(WM_CONFIG.RETRY_BASE_MS * Math.pow(2, attempt));
      continue;
    }

    const code = resp.getResponseCode();
    const body = resp.getContentText();

    if (code >= 200 && code < 300) {
      try { return JSON.parse(body || '{}'); }
      catch (e) { throw new Error('JSON inválido de ' + path + ': ' + body.substring(0, 200)); }
    }

    // Token vencido a media corrida
    if (code === 401 && attempt === 0 && !opts.noTokenRetry) {
      CacheService.getScriptCache().remove(WM_CONFIG.CACHE_TOKEN);
      lastErr = 'HTTP 401: ' + body.substring(0, 200);
      continue;
    }

    // Throttling o error del servidor → backoff
    if (code === 429 || code >= 500) {
      lastErr = 'HTTP ' + code + ': ' + body.substring(0, 200);
      Utilities.sleep(WM_CONFIG.RETRY_BASE_MS * Math.pow(2, attempt));
      continue;
    }

    // 4xx definitivo
    const err = new Error('GET ' + path + ' → HTTP ' + code + ': ' + body.substring(0, 400));
    err.httpCode = code;
    err.body = body;
    throw err;
  }

  const err = new Error('GET ' + path + ' agotó reintentos. Último: ' + lastErr);
  err.exhausted = true;
  throw err;
}

/* ==============================================================
   WFS INVENTORY — autodetecta endpoint nuevo vs legacy
   ============================================================== */

/**
 * Decide qué endpoint de WFS usar. Se guarda en PropertiesService
 * para no re-probar el que falla en cada corrida.
 *
 * Si algún día Walmart te habilita "Program Eligibility", corre
 * resetWfsEndpointMode() y el código migra solo al endpoint nuevo
 * (que trae forecast, aging y sell-through).
 */
function detectWfsEndpoint_() {
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty(WM_CONFIG.PROP_WFS_ENDPOINT);
  if (cached) return cached;

  // Probar el nuevo primero (trae muchos más campos)
  try {
    wmGet_('/v3/wfs/inventory', { limit: 1, offset: 0 });
    props.setProperty(WM_CONFIG.PROP_WFS_ENDPOINT, 'new');
    Logger.log('  ✨ WFS endpoint NUEVO disponible — usando /v3/wfs/inventory');
    return 'new';
  } catch (e) {
    Logger.log('  ℹ WFS nuevo no disponible (' + (e.httpCode || '?') + '), usando legacy');
    props.setProperty(WM_CONFIG.PROP_WFS_ENDPOINT, 'legacy');
    return 'legacy';
  }
}

/** Borra la detección para que se vuelva a probar el endpoint nuevo */
function resetWfsEndpointMode() {
  PropertiesService.getScriptProperties().deleteProperty(WM_CONFIG.PROP_WFS_ENDPOINT);
  Logger.log('✅ Modo WFS reseteado. La próxima corrida vuelve a probar /v3/wfs/inventory');
}

/**
 * Trae TODO el inventario WFS, normalizado a una forma común
 * sin importar si vino del endpoint nuevo o del legacy.
 *
 * Forma de salida por SKU:
 *   { sku, offerId, wfsAvailToSell, wfsOnHand, wfsReserved, wfsInbound,
 *     wfsShipNodeType, wfsModifiedDate, wfsFirstInStock,
 *     wfsAge0_90, ... , wfsDaysOfSupply, ... }
 */
function getAllWfsInventory() {
  const mode = detectWfsEndpoint_();
  return (mode === 'new') ? fetchWfsNew_() : fetchWfsLegacy_();
}

/* ---- Legacy: /v3/fulfillment/inventory (el que SÍ funciona hoy) ---- */
function fetchWfsLegacy_() {
  const out = [];
  let offset = 0, total = null, pages = 0;
  const limit = 200, maxPages = 200;

  while (pages++ < maxPages) {
    const data = wmGet_('/v3/fulfillment/inventory', { offset: offset, limit: limit });
    const items = (data && data.payload && data.payload.inventory) || [];
    if (total === null) {
      total = Number((data && data.headers && data.headers.totalCount) || items.length) || items.length;
    }

    items.forEach(function(it){
      // shipNodes es un array; para WFS normalmente trae un solo nodo.
      // Si trae varios, sumamos las cantidades.
      const nodes = it.shipNodes || [];
      let avail = 0, onhand = 0;
      let nodeType = '', modified = '', firstStock = '';
      nodes.forEach(function(n){
        avail  += Number(n.availToSellQty || 0);
        onhand += Number(n.onHandQty || 0);
        if (!nodeType   && n.shipNodeType)     nodeType   = n.shipNodeType;
        if (!modified   && n.modifiedDate)     modified   = n.modifiedDate;
        if (!firstStock && n.firstInStockDate) firstStock = n.firstInStockDate;
      });

      out.push({
        sku:              it.sku || '',
        offerId:          it.offerId || '',
        wfsAvailToSell:   avail,
        wfsOnHand:        onhand,
        wfsReserved:      Math.max(0, onhand - avail),  // derivado
        wfsInbound:       '',   // el legacy no lo trae
        wfsShipNodeType:  nodeType,
        wfsNodeCount:     nodes.length,
        wfsModifiedDate:  modified,
        wfsFirstInStock:  firstStock,
        // Campos del endpoint nuevo — vacíos en legacy
        wfsStockStatus:   avail > 0 ? 'In Stock' : 'Out of Stock',
        wfsAge0_90: '', wfsAge91_180: '', wfsAge181_270: '',
        wfsAge271_365: '', wfsAgeOver365: '',
        wfsForecastW1_4: '', wfsForecastW5_8: '', wfsForecastW9_12: '',
        wfsSellThrough: '', wfsDaysOfSupply: '', wfsOutOfStockDate: '',
        wfsSuggestedUnits: '', wfsSurplusUnits: '',
      });
    });

    offset += items.length;
    if (!items.length || offset >= total) break;
    Utilities.sleep(WM_CONFIG.PAGE_PACING_MS);
  }

  Logger.log('  WFS (legacy): ' + out.length + ' SKUs');
  return out;
}

/* ---- Nuevo: /v3/wfs/inventory (si algún día se habilita) ---- */
function fetchWfsNew_() {
  const out = [];
  let offset = 0, total = null, pages = 0;
  const limit = 200, maxPages = 200;

  while (pages++ < maxPages) {
    const data = wmGet_('/v3/wfs/inventory', { offset: offset, limit: limit });
    const items = (data && data.payload && data.payload.inventory) || [];
    if (total === null) {
      total = Number((data && data.headers && data.headers.totalCount) || items.length) || items.length;
    }

    items.forEach(function(entry){
      const info = entry.itemInformation   || {};
      const d    = entry.inventoryData     || {};
      const ins  = entry.inventoryInsights || {};
      const age  = d.inventoryAge          || {};
      const unav = d.unavailableUnits      || {};

      out.push({
        sku:             info.sku || '',
        offerId:         info.offerID || '',
        wfsAvailToSell:  num_(d.availableUnits),
        wfsOnHand:       num_(d.onhandUnits),
        wfsReserved:     num_(d.reservedUnits),
        wfsInbound:      num_(d.inboundUnits),
        wfsShipNodeType: 'WFSFulfilled',
        wfsNodeCount:    1,
        wfsModifiedDate: '',
        wfsFirstInStock: d.firstInStockDate || '',
        wfsStockStatus:  d.stockStatus || '',
        wfsAge0_90:      num_(age.units0to90Days),
        wfsAge91_180:    num_(age.units91to180Days),
        wfsAge181_270:   num_(age.units181to270Days),
        wfsAge271_365:   num_(age.units271to365Days),
        wfsAgeOver365:   num_(age.unitsOver365Days),
        wfsForecastW1_4:  num_(ins.salesForecastWeek1to4),
        wfsForecastW5_8:  num_(ins.salesForecastWeek5to8),
        wfsForecastW9_12: num_(ins.salesForecastWeek9to12),
        wfsSellThrough:   num_(ins.sellThroughRate),
        wfsDaysOfSupply:  num_(ins.daysOfSupply),
        wfsOutOfStockDate: ins.outOfStockDate || '',
        wfsSuggestedUnits: num_(ins.suggestedUnits),
        wfsSurplusUnits:   num_(ins.surplusUnits),
        wfsReviewUnits:    num_(unav.inventoryReviewUnits),
        wfsMovementUnits:  num_(unav.inventoryMovementUnits),
      });
    });

    offset += items.length;
    if (!items.length || offset >= total) break;
    Utilities.sleep(WM_CONFIG.PAGE_PACING_MS);
  }

  Logger.log('  WFS (nuevo): ' + out.length + ' SKUs');
  return out;
}

/* ==============================================================
   CATÁLOGO — /v3/items  (~3,271 items)

   Walmart MX no regresa `nextCursor` en la respuesta, así que
   detectamos el modo de paginación en la primera página:
     · Si aparece algún campo tipo cursor → modo cursor
     · Si no → modo offset (requiere includeDetails=true)

   Protecciones contra ciclo infinito:
     · Dedupe por SKU
     · Si una página no aporta SKUs nuevos, corta
     · Tope de páginas y presupuesto de tiempo
   ============================================================== */
function getAllItems(deadlineMs) {
  const out = [];
  const seen = {};
  const limit = 50;
  const maxPages = 400;

  let pages = 0;
  let mode = null;          // 'cursor' | 'offset'
  let cursorField = null;
  let cursor = null;
  let offset = 0;
  let total = null;

  while (pages++ < maxPages) {
    if (deadlineMs && Date.now() > deadlineMs) {
      Logger.log('  ⏱ Catálogo cortado por tiempo en la página ' + pages +
                 ' (' + out.length + ' items). Sube BUDGET_MAIN_MS si pasa seguido.');
      break;
    }

    const params = { limit: limit, includeDetails: 'true' };
    if (mode === 'cursor' && cursor) params[cursorField] = cursor;
    if (mode === 'offset') params.offset = offset;

    const data = wmGet_('/v3/items', params);
    const items = data.ItemResponse || data.items || [];

    if (total === null) {
      const t = Number(data.totalItems || data.totalCount || 0);
      total = t > 0 ? t : null;
    }

    // Decidir el modo con la primera respuesta
    if (mode === null) {
      cursorField = findCursorField_(data);
      mode = cursorField ? 'cursor' : 'offset';
      Logger.log('  Paginación: modo ' + mode +
                 (cursorField ? ' (campo "' + cursorField + '")' : '') +
                 (total ? ' · total ' + total : ''));
    }

    let nuevos = 0;
    items.forEach(function(it){
      const sku = it && it.sku;
      if (sku && !seen[sku]) {
        seen[sku] = 1;
        out.push(normalizeItem_(it));
        nuevos++;
      }
    });

    if (!items.length) break;
    if (nuevos === 0) {
      Logger.log('  ⚠ La página ' + pages + ' no trajo SKUs nuevos — se corta ' +
                 'para no ciclar. Total: ' + out.length);
      break;
    }
    if (total && out.length >= total) break;

    if (mode === 'cursor') {
      cursor = data[cursorField];
      if (!cursor) break;
    } else {
      offset += items.length;
    }

    Utilities.sleep(WM_CONFIG.PAGE_PACING_MS);
  }

  const faltan = total ? (total - out.length) : 0;
  Logger.log('  Catálogo: ' + out.length + ' items' +
             (faltan > 0 ? '  ⚠ faltaron ' + faltan + ' de ' + total : ' ✓'));
  return out;
}

/** Busca cómo se llama el campo de cursor en la respuesta */
function findCursorField_(data) {
  const candidatos = ['nextCursor', 'nextCursorValue', 'cursor', 'nextPageToken', 'nextPage'];
  for (let i = 0; i < candidatos.length; i++) {
    if (data[candidatos[i]]) return candidatos[i];
  }
  return null;
}

function normalizeItem_(it) {
  const price = it.price || {};
  return {
    sku:             it.sku || '',
    productName:     it.productName || '',
    productType:     it.productType || '',
    shelf:           parseShelf_(it.shelf),
    wpid:            it.wpid || '',
    upc:             it.upc || '',
    gtin:            it.gtin || '',
    mart:            it.mart || '',
    price:           price.amount != null ? price.amount : '',
    currency:        price.currency || '',
    publishedStatus: it.publishedStatus || '',
    lifecycleStatus: it.lifecycleStatus || '',
    unpublishedReasons: Array.isArray(it.unpublishedReasons)
      ? it.unpublishedReasons.join('; ')
      : (it.unpublishedReasons || ''),
  };
}

/** shelf viene como string JSON: "[\"Home Page\",\"Computadoras\",...]" */
function parseShelf_(shelf) {
  if (!shelf) return '';
  if (Array.isArray(shelf)) return shelf.join(' > ');
  try {
    const arr = JSON.parse(shelf);
    return Array.isArray(arr) ? arr.join(' > ') : String(shelf);
  } catch (e) {
    return String(shelf);
  }
}

/* ==============================================================
   INVENTARIO NORMAL — /v3/inventory?sku=X  (uno por uno)
   ============================================================== */
/**
 * Consulta el inventario de UN SKU.
 *
 * A diferencia del resto, aquí NO usamos reintentos agresivos: son miles
 * de llamadas y un SKU problemático con 4 intentos + backoff se come el
 * presupuesto entero de la corrida (medido: hasta 96 seg en un solo SKU).
 * Un SKU que falla se marca y se reintenta en el siguiente ciclo.
 */
function getInventoryForSku(sku) {
  const url = getBaseUrl() + '/v3/inventory' + toQs_({ sku: sku });
  try {
    const resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: wmHeaders_(),
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();

    if (code >= 200 && code < 300) {
      const data = JSON.parse(resp.getContentText() || '{}');
      const q = (data && data.quantity) || {};
      return { ok: true, qty: num_(q.amount), unit: q.unit || 'EACH' };
    }

    // 401: el token venció. Lo refrescamos y damos UN solo reintento.
    if (code === 401) {
      CacheService.getScriptCache().remove(WM_CONFIG.CACHE_TOKEN);
      const r2 = UrlFetchApp.fetch(url, {
        method: 'get', headers: wmHeaders_(), muteHttpExceptions: true,
      });
      if (r2.getResponseCode() < 300) {
        const d2 = JSON.parse(r2.getContentText() || '{}');
        const q2 = (d2 && d2.quantity) || {};
        return { ok: true, qty: num_(q2.amount), unit: q2.unit || 'EACH' };
      }
      return { ok: false, qty: '', unit: '', code: 401 };
    }

    // 429 = throttling. Se lo avisamos al llamador para que frene la corrida.
    return { ok: false, qty: '', unit: '', code: code, throttled: (code === 429) };

  } catch (e) {
    return { ok: false, qty: '', unit: '', code: 'NET' };
  }
}

function num_(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
