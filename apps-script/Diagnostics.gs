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
   ¿POR QUÉ NO ESTÁ CORRIENDO?
   Revisa todo lo que puede estar frenando la sincronización
   y dice qué hacer en cada caso.
   ============================================================ */
function porQueNoCorre() {
  const props = PropertiesService.getScriptProperties();
  const L = [];
  const p = function(s){ L.push(s); Logger.log(s); };

  p('══════════════════════════════════════════════════');
  p(' ¿POR QUÉ NO CORRE? — ' + new Date().toLocaleString('es-MX'));
  p('══════════════════════════════════════════════════');
  p('');

  let culpable = null;

  /* 1 · Triggers */
  p('── 1. Triggers instalados ──');
  const ts = ScriptApp.getProjectTriggers();
  const nombres = ts.map(function(t){ return t.getHandlerFunction(); });
  p('   ' + (nombres.length ? nombres.join(', ') : 'NINGUNO'));
  if (nombres.indexOf('syncMain') < 0) {
    p('   ❌ Falta syncMain. Corre instalarTriggers().');
    culpable = culpable || 'sin triggers';
  } else {
    p('   ✅ syncMain está instalado');
  }
  p('');

  /* 2 · El candado del turno */
  p('── 2. Candado entre procesos ──');
  const lastMain = Number(props.getProperty(WM_CONFIG.PROP_LAST_MAIN) || 0);
  if (!lastMain) {
    p('   ⚠ syncMain nunca ha registrado una corrida.');
    p('     El barrido va a ceder el turno indefinidamente.');
    culpable = culpable || 'syncMain nunca completó';
  } else {
    const mins = Math.round((Date.now() - lastMain) / 60000);
    p('   Último turno de syncMain: hace ' + mins + ' min');
    if (mins > 60) {
      p('   ⚠ Lleva más de una hora sin correr.');
      culpable = culpable || 'syncMain lleva ' + mins + ' min sin correr';
    } else {
      p('   ✅ Dentro de lo normal');
    }
  }
  p('');

  /* 2b · ¿El barrido está avanzando de verdad? */
  p('── 2b. ¿El barrido avanza? ──');
  try {
    const shR = getSheet_(WM_CONFIG.SHEET_REGULAR);
    const totR = Math.max(0, shR.getLastRow() - 1);
    let conDato = 0, masReciente = null;
    if (totR > 0) {
      const v = shR.getRange(2, 2, totR, 3).getValues();
      v.forEach(function(r){
        if (r[0] !== '' && r[0] !== null) {
          conDato++;
          if (r[2] instanceof Date && (!masReciente || r[2] > masReciente)) masReciente = r[2];
        }
      });
    }
    const pctc = totR ? Math.round(conDato / totR * 100) : 0;
    p('   Cobertura: ' + conDato + ' de ' + totR + '  (' + pctc + '%)');
    if (masReciente) {
      const minsUlt = Math.round((Date.now() - masReciente.getTime()) / 60000);
      p('   Último SKU consultado: hace ' + minsUlt + ' min');
      if (minsUlt > WM_CONFIG.CHUNK_INTERVAL_MIN * 3) {
        p('   ⚠ El barrido lleva rato sin escribir nada.');
        culpable = culpable || 'el barrido no avanza';
      } else {
        p('   ✅ Avanzando');
      }
    } else if (conDato === 0) {
      p('   ⚠ Ningún SKU tiene dato todavía.');
      culpable = culpable || 'el barrido no ha escrito nada';
    }
  } catch (e) {
    p('   ❌ ' + e.message);
  }
  p('');

  /* 3 · Presupuesto propio */
  p('── 3. Presupuesto de llamadas (nuestro contador) ──');
  const restan = fetchRestantes_();
  const usadas = WM_CONFIG.DAILY_FETCH_BUDGET - restan;
  p('   Usadas hoy:  ' + usadas + ' de ' + WM_CONFIG.DAILY_FETCH_BUDGET);
  p('   Restantes:   ' + restan);
  if (restan < 120) {
    p('   ❌ Sin presupuesto propio. syncMain se salta las corridas.');
    culpable = culpable || 'presupuesto propio agotado';
  } else {
    p('   ✅ Hay presupuesto');
  }
  p('');

  /* 4 · La cuota real de Google */
  p('── 4. Cuota real de Google (la prueba de fuego) ──');
  try {
    const t = getAccessToken();
    p('   ✅ Una llamada real funcionó. Token: ' + t.substring(0, 18) + '…');
    p('      La cuota de Google NO está agotada.');
  } catch (e) {
    const m = String(e.message || e);
    p('   ❌ ' + m.substring(0, 180));
    if (m.indexOf('too many times') >= 0 || m.indexOf('demasiadas veces') >= 0) {
      p('');
      p('      La cuota diaria de Google sigue agotada.');
      p('      No hay nada que hacer en el código — se reinicia sola.');
      p('      Google la reinicia por la madrugada, hora del Pacífico');
      p('      (entre 1 y 3 de la mañana en México).');
      culpable = 'cuota de Google agotada';
    } else {
      culpable = culpable || 'falla de autenticación';
    }
  }
  p('');

  /* 5 · Estado de los datos */
  p('── 5. Datos en el Sheet ──');
  try {
    const ss = getSpreadsheet_();
    const inv = ss.getSheetByName(WM_CONFIG.SHEET_MASTER);
    const reg = ss.getSheetByName(WM_CONFIG.SHEET_REGULAR);
    p('   Inventario:  ' + (inv ? Math.max(0, inv.getLastRow() - 1) + ' filas' : 'no existe'));
    p('   Inv_Normal:  ' + (reg ? Math.max(0, reg.getLastRow() - 1) + ' filas' : 'no existe'));
  } catch (e) {
    p('   ❌ ' + e.message);
  }
  p('');

  /* Veredicto */
  p('══════════════════════════════════════════════════');
  if (!culpable) {
    p(' ✅ TODO EN ORDEN');
    p('');
    p(' No encuentro nada bloqueando. Si aun así no ves');
    p(' movimiento, corre syncMain a mano desde el menú');
    p(' y observa qué pasa.');
  } else {
    p(' 🔴 CAUSA: ' + culpable);
    p('');
    if (culpable.indexOf('cuota de Google') >= 0) {
      p(' QUÉ HACER: esperar. Se reinicia en la madrugada.');
      p(' Mientras tanto el dashboard sigue mostrando los');
      p(' últimos datos que alcanzó a guardar.');
    } else if (culpable.indexOf('presupuesto propio') >= 0) {
      p(' QUÉ HACER: si la cuota de Google ya se reinició,');
      p(' usa el menú → Configuración → Reiniciar contador.');
    } else if (culpable.indexOf('nunca completó') >= 0 || culpable.indexOf('sin correr') >= 0) {
      p(' QUÉ HACER: corre syncMain a mano desde el menú.');
      p(' Con que termine bien una vez, se destraba el barrido.');
    } else if (culpable.indexOf('sin triggers') >= 0) {
      p(' QUÉ HACER: menú → Configuración → Instalar triggers.');
    }
  }
  p('══════════════════════════════════════════════════');

  return L.join('\n');
}

/* ============================================================
   ¿POR QUÉ ESTOS SKUs NO TIENEN INVENTARIO?
   Lista los que quedaron sin dato y prueba unos cuantos en vivo
   para ver qué contesta Walmart.
   ============================================================ */
function verSkusSinDato() {
  const L = [];
  const p = function(s){ L.push(s); Logger.log(s); };

  p('══════════════════════════════════════════════════');
  p(' SKUs SIN DATO DE INVENTARIO PROPIO');
  p('══════════════════════════════════════════════════');
  p('');

  const sh = getSheet_(WM_CONFIG.SHEET_REGULAR);
  const total = Math.max(0, sh.getLastRow() - 1);
  if (!total) { p('Inv_Normal está vacía.'); return L.join('\n'); }

  const datos = sh.getRange(2, 1, total, 4).getValues();
  const sinDato = [];
  datos.forEach(function(r){
    const sku = String(r[0] || '').trim();
    if (sku && (r[1] === '' || r[1] === null)) sinDato.push(sku);
  });

  p('   Sin dato: ' + sinDato.length + ' de ' + total +
    '  (' + (sinDato.length / total * 100).toFixed(1) + '%)');
  p('');

  if (!sinDato.length) {
    p('   ✅ Todos tienen dato. Nada que revisar.');
    return L.join('\n');
  }

  /* ¿Alguno se ve como número en vez de SKU? */
  const numericos = sinDato.filter(function(s){ return /^\d+(\.\d+)?$/.test(s); });
  if (numericos.length) {
    p('── SKUs que parecen números ──');
    p('   ' + numericos.length + ' de ellos son puros dígitos. Suele ser un');
    p('   código de barras que se coló, o un SKU al que Sheets le comió');
    p('   los ceros iniciales al guardarlo como número.');
    numericos.slice(0, 12).forEach(function(s){ p('     ' + s); });
    p('');
  }

  /* Probar en vivo unos cuantos */
  const muestra = sinDato.slice(0, 8);
  p('── Probando ' + muestra.length + ' en vivo contra Walmart ──');
  p('');
  const razones = {};

  muestra.forEach(function(sku){
    const inv = getInventoryForSku(sku);
    if (inv.ok) {
      p('   ✅ ' + sku);
      p('      Ahora sí respondió: ' + inv.qty + ' ' + inv.unit);
      p('      (fue un fallo pasajero — el barrido lo va a levantar solo)');
      razones['pasajero'] = (razones['pasajero'] || 0) + 1;
    } else {
      p('   ❌ ' + sku);
      p('      HTTP ' + inv.code);
      razones['HTTP ' + inv.code] = (razones['HTTP ' + inv.code] || 0) + 1;
    }
    Utilities.sleep(300);
  });

  p('');
  p('══════════════════════════════════════════════════');
  p(' RESUMEN DE LA MUESTRA');
  p('══════════════════════════════════════════════════');
  Object.keys(razones).forEach(function(k){
    p('   ' + k + ': ' + razones[k]);
  });
  p('');
  p(' Cómo leerlo:');
  p('   · "pasajero"  → red o timeout. Se arregla solo.');
  p('   · HTTP 404    → el SKU está en el catálogo pero no en el');
  p('                   endpoint de inventario. Suele pasar con');
  p('                   productos archivados o mal dados de alta.');
  p('   · HTTP 429    → Walmart nos está frenando. Bajar el ritmo.');
  p('   · HTTP 400    → el SKU tiene un formato que Walmart rechaza');
  p('                   (por ejemplo, si perdió ceros iniciales).');

  return L.join('\n');
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
