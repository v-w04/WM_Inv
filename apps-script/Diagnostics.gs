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
