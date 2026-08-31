/**
 * ============================================================
 *  Diagnostics — Prueba qué endpoints responden en TU cuenta
 * ============================================================
 *
 *  CÓMO USARLO:
 *   1. Pega este archivo en Apps Script (➕ → Script → nombre: Diagnostics)
 *   2. Asegúrate de haber corrido setupCredentialsInline() antes
 *   3. Selecciona la función  runDiagnostics  y dale Ejecutar
 *   4. Abre el Log (Ver → Registros, o Ctrl+Enter) y pásame el resultado completo
 *
 *  No modifica nada. Solo lee y reporta.
 */

function runDiagnostics() {
  const out = [];
  const line = function(s){ out.push(s); Logger.log(s); };

  line('══════════════════════════════════════════════════');
  line(' DIAGNÓSTICO WALMART API — ' + new Date().toLocaleString('es-MX'));
  line('══════════════════════════════════════════════════');
  line(' Mercado:  ' + WM_CONFIG.MARKET);
  line(' Base URL: ' + getBaseUrl());
  line(' Versión:  ' + WM_CONFIG.API_VERSION);
  line('');

  /* ---------- 0. AUTH ---------- */
  line('── 0. AUTENTICACIÓN ──');
  let token = null;
  try {
    token = getAccessToken();
    line('✅ Token obtenido: ' + token.substring(0, 20) + '...');
  } catch (e) {
    line('❌ FALLÓ: ' + e.message);
    line('');
    line('⛔ Sin token no se puede probar nada más. Revisa setupCredentialsInline().');
    return out.join('\n');
  }
  line('');

  /* ---------- Pruebas de endpoints ---------- */
  const tests = [
    {
      id: 'A',
      name: 'WFS Inventory (bulk)  /v3/wfs/inventory',
      path: '/v3/wfs/inventory',
      params: { limit: 2, offset: 0 },
      why: 'Inventario WFS en masa — el que más nos sirve',
    },
    {
      id: 'B',
      name: 'WFS Inventory legacy  /v3/fulfillment/inventory',
      path: '/v3/fulfillment/inventory',
      params: { limit: 2 },
      why: 'Versión anterior del WFS, por si la nueva no aplica en MX',
    },
    {
      id: 'C',
      name: 'Inventario bulk       /v3/inventories',
      path: '/v3/inventories',
      params: { limit: 2 },
      why: 'Inventario normal en masa (doc dice US only — validamos)',
    },
    {
      id: 'D',
      name: 'Items catálogo        /v3/items',
      path: '/v3/items',
      params: { limit: 2 },
      why: 'Lista de SKUs — necesaria si el inventario normal es 1x1',
    },
    {
      id: 'E',
      name: 'Ship nodes            /v3/fulfillment/shipnodes',
      path: '/v3/fulfillment/shipnodes',
      params: {},
      why: 'Almacenes/nodos configurados en tu cuenta',
    },
  ];

  const results = {};

  tests.forEach(function(t) {
    line('── ' + t.id + '. ' + t.name + ' ──');
    line('   (' + t.why + ')');
    const r = probe_(t.path, t.params);
    results[t.id] = r;
    if (r.ok) {
      line('   ✅ HTTP ' + r.code);
      line('   Estructura: ' + describeShape_(r.data));
      line('   Muestra: ' + truncate_(JSON.stringify(r.data), 700));
    } else {
      line('   ❌ HTTP ' + r.code);
      line('   Error: ' + truncate_(r.body, 400));
    }
    line('');
    Utilities.sleep(400);
  });

  /* ---------- Prueba per-SKU (usa un SKU real del catálogo) ---------- */
  line('── F. Inventario por SKU  /v3/inventory?sku=… ──');
  line('   (Inventario normal de un SKU específico)');
  const sampleSku = extractSampleSku_(results);
  if (sampleSku) {
    line('   SKU de prueba: ' + sampleSku);
    const r = probe_('/v3/inventory', { sku: sampleSku });
    results['F'] = r;
    if (r.ok) {
      line('   ✅ HTTP ' + r.code);
      line('   Muestra: ' + truncate_(JSON.stringify(r.data), 700));
    } else {
      line('   ❌ HTTP ' + r.code + ' — ' + truncate_(r.body, 400));
    }
  } else {
    line('   ⚠ No se pudo obtener un SKU de muestra de las pruebas anteriores.');
  }
  line('');

  /* ---------- Conteo total de WFS ---------- */
  line('── G. VOLUMEN ──');
  const a = results['A'];
  if (a && a.ok && a.data && a.data.headers && a.data.headers.totalCount != null) {
    line('   Total de SKUs en WFS: ' + a.data.headers.totalCount);
    const n = Number(a.data.headers.totalCount);
    const pages = Math.ceil(n / 200);
    line('   Páginas a 200/req: ' + pages + '  →  ~' + (pages * 1.5).toFixed(0) + ' seg estimados');
    line('   ' + (pages * 1.5 < 300 ? '✅ Cabe holgado en el límite de 6 min' : '⚠ Puede acercarse al límite de 6 min'));
  } else {
    line('   ⚠ No se pudo determinar el total (revisa el resultado de A).');
  }
  line('');

  /* ---------- Resumen ---------- */
  line('══════════════════════════════════════════════════');
  line(' RESUMEN');
  line('══════════════════════════════════════════════════');
  tests.forEach(function(t){
    const r = results[t.id];
    line(' ' + t.id + '. ' + pad_(t.name, 46) + (r && r.ok ? '✅ OK' : '❌ ' + ((r && r.code) || '—')));
  });
  if (results['F']) {
    line(' F. ' + pad_('Inventario por SKU', 46) + (results['F'].ok ? '✅ OK' : '❌ ' + results['F'].code));
  }
  line('══════════════════════════════════════════════════');
  line('');
  line('👉 Copia TODO este log y pásamelo.');

  return out.join('\n');
}

/* ============================================================
   Helpers
   ============================================================ */

function probe_(path, params) {
  try {
    const url = getBaseUrl() + path + toQs_(params);
    const resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: wmHeaders_(),
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    const body = resp.getContentText();
    let data = null;
    try { data = JSON.parse(body); } catch (_) {}
    return { ok: code >= 200 && code < 300, code: code, body: body, data: data };
  } catch (e) {
    return { ok: false, code: 'EXCEPTION', body: String(e && e.message || e), data: null };
  }
}

/** Describe las llaves de primer y segundo nivel, para entender la forma del JSON */
function describeShape_(obj) {
  if (!obj || typeof obj !== 'object') return String(obj);
  const parts = [];
  Object.keys(obj).slice(0, 8).forEach(function(k){
    const v = obj[k];
    if (Array.isArray(v)) {
      parts.push(k + '[' + v.length + ']');
    } else if (v && typeof v === 'object') {
      parts.push(k + '{' + Object.keys(v).slice(0, 6).join(',') + '}');
    } else {
      parts.push(k + '=' + truncate_(String(v), 30));
    }
  });
  return parts.join('  ');
}

/** Intenta sacar un SKU real de cualquiera de las respuestas exitosas */
function extractSampleSku_(results) {
  // Desde WFS inventory
  const a = results['A'];
  if (a && a.ok && a.data && a.data.payload && a.data.payload.inventory && a.data.payload.inventory.length) {
    const info = a.data.payload.inventory[0].itemInformation;
    if (info && info.sku) return info.sku;
  }
  // Desde items
  const d = results['D'];
  if (d && d.ok && d.data) {
    const items = d.data.ItemResponse || d.data.items || [];
    if (items.length && items[0].sku) return items[0].sku;
  }
  return null;
}

function truncate_(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.substring(0, n) + '…' : s;
}

function pad_(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

/* ============================================================
   DIAGNÓSTICO DE PAGINACIÓN DEL CATÁLOGO
   Corre esta función si el catálogo se queda en 50 items.
   ============================================================ */
function diagnosticarPaginacion() {
  Logger.log('══════════════════════════════════════════════════');
  Logger.log(' PAGINACIÓN DE /v3/items');
  Logger.log('══════════════════════════════════════════════════');
  Logger.log('');

  /* --- 1. ¿Qué llaves trae la respuesta? --- */
  Logger.log('── 1. Llaves de la respuesta ──');
  const r1 = probe_('/v3/items', { limit: 50 });
  if (!r1.ok) {
    Logger.log('❌ HTTP ' + r1.code + ': ' + truncate_(r1.body, 300));
    return;
  }
  const keys1 = Object.keys(r1.data);
  Logger.log('   Llaves: ' + keys1.join(', '));
  keys1.forEach(function(k){
    const v = r1.data[k];
    if (Array.isArray(v))       Logger.log('     · ' + k + ' → array de ' + v.length);
    else if (v && typeof v === 'object') Logger.log('     · ' + k + ' → objeto {' + Object.keys(v).join(',') + '}');
    else                        Logger.log('     · ' + k + ' → ' + truncate_(String(v), 80));
  });
  const items1 = r1.data.ItemResponse || r1.data.items || [];
  Logger.log('   Items recibidos: ' + items1.length);
  Logger.log('   Primer SKU: ' + (items1[0] ? items1[0].sku : '—'));
  Logger.log('   Último SKU: ' + (items1.length ? items1[items1.length-1].sku : '—'));
  Logger.log('');

  /* --- 2. ¿Existe algún campo de cursor? --- */
  Logger.log('── 2. Campo de cursor ──');
  const cursorField = findCursorField_(r1.data);
  if (cursorField) {
    Logger.log('   ✅ Encontrado: "' + cursorField + '" = ' + truncate_(String(r1.data[cursorField]), 80));
  } else {
    Logger.log('   ❌ No hay campo de cursor. Hay que paginar con offset.');
  }
  Logger.log('');

  /* --- 3. ¿Funciona offset? --- */
  Logger.log('── 3. Prueba de offset (includeDetails=true) ──');
  const rA = probe_('/v3/items', { limit: 50, offset: 0,  includeDetails: 'true' });
  Utilities.sleep(400);
  const rB = probe_('/v3/items', { limit: 50, offset: 50, includeDetails: 'true' });

  if (!rA.ok || !rB.ok) {
    Logger.log('   ❌ offset=0 → HTTP ' + rA.code + ' | offset=50 → HTTP ' + rB.code);
    if (!rB.ok) Logger.log('      ' + truncate_(rB.body, 300));
  } else {
    const iA = rA.data.ItemResponse || [];
    const iB = rB.data.ItemResponse || [];
    const skuA = iA.length ? iA[0].sku : '';
    const skuB = iB.length ? iB[0].sku : '';
    Logger.log('   offset=0  → ' + iA.length + ' items · primero: ' + skuA);
    Logger.log('   offset=50 → ' + iB.length + ' items · primero: ' + skuB);
    if (skuA && skuB && skuA !== skuB) {
      Logger.log('   ✅ OFFSET SÍ FUNCIONA (los SKUs son distintos)');
    } else if (skuA === skuB) {
      Logger.log('   ❌ offset ignorado — devuelve los mismos items');
    }
  }
  Logger.log('');

  /* --- 4. Offset sin includeDetails --- */
  Logger.log('── 4. Prueba de offset SIN includeDetails ──');
  const rC = probe_('/v3/items', { limit: 50, offset: 50 });
  if (rC.ok) {
    const iC = rC.data.ItemResponse || [];
    const skuC = iC.length ? iC[0].sku : '';
    const skuA2 = (rA.ok && rA.data.ItemResponse && rA.data.ItemResponse[0]) ? rA.data.ItemResponse[0].sku : '';
    Logger.log('   offset=50 sin includeDetails → primero: ' + skuC);
    Logger.log('   ' + (skuC && skuC !== skuA2 ? '✅ También funciona' : '❌ No avanza'));
  } else {
    Logger.log('   ❌ HTTP ' + rC.code);
  }
  Logger.log('');

  /* --- Veredicto --- */
  Logger.log('══════════════════════════════════════════════════');
  Logger.log(' VEREDICTO');
  Logger.log('══════════════════════════════════════════════════');
  if (cursorField) {
    Logger.log(' → Usar modo CURSOR con el campo "' + cursorField + '"');
  } else if (rA.ok && rB.ok) {
    const sA = (rA.data.ItemResponse && rA.data.ItemResponse[0]) ? rA.data.ItemResponse[0].sku : '';
    const sB = (rB.data.ItemResponse && rB.data.ItemResponse[0]) ? rB.data.ItemResponse[0].sku : '';
    Logger.log(sA !== sB
      ? ' → Usar modo OFFSET (ya está implementado en Api.gs) ✅'
      : ' → ⚠ Ninguno de los dos modos avanza. Pásame este log completo.');
  } else {
    Logger.log(' → ⚠ Las pruebas de offset fallaron. Pásame este log completo.');
  }
  Logger.log('');
  Logger.log('👉 Copia TODO este log y pásamelo.');
}
