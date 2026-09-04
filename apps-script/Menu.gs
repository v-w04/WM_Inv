/**
 * ============================================================
 *  Menu — Menú de herramientas en la hoja de cálculo
 * ============================================================
 *
 *  El script es standalone (no está pegado al Sheet), así que un onOpen
 *  normal nunca se dispara. Hay que instalar un trigger de apertura
 *  apuntado al spreadsheet.
 *
 *  INSTALACIÓN — una sola vez:
 *    Corre  instalarMenu()  desde el editor.
 *    Cierra y vuelve a abrir el Sheet. Ya aparece el menú.
 */

/** Crea el trigger de apertura para tu hoja */
function instalarMenu() {
  // Limpia los previos para no duplicar el menú
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === 'onOpenMenu') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('onOpenMenu')
    .forSpreadsheet(WM_CONFIG.SHEET_ID)
    .onOpen()
    .create();

  Logger.log('✅ Menú instalado.');
  Logger.log('   Cierra y vuelve a abrir el Sheet para verlo.');
}

function quitarMenu() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === 'onOpenMenu') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('Removidos ' + n + ' triggers de menú.');
}

/** Se dispara al abrir la hoja */
function onOpenMenu(e) {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('⚡ WM Inventario')
    .addSubMenu(ui.createMenu('🔄 Sincronizar')
      .addItem('Catálogo + WFS  (~80 seg)',        'mnu_syncMain')
      .addItem('Inventario propio  (un lote)',      'mnu_chunk'))

    .addSubMenu(ui.createMenu('📊 Estado')
      .addItem('Avance del barrido',                'mnu_progreso')
      .addItem('Llamadas usadas hoy',               'mnu_consumo')
      .addItem('Triggers activos',                  'mnu_triggers'))

    .addSubMenu(ui.createMenu('🔧 Diagnóstico')
      .addItem('⚠️ ¿Por qué no está corriendo?',     'mnu_porQueNoCorre')
      .addItem('SKUs sin dato de inventario',        'mnu_sinDato')
      .addSeparator()
      .addItem('Probar conexión al Sheet',          'mnu_testSheet')
      .addItem('Probar login con Walmart',          'mnu_testAuth')
      .addItem('Probar todos los endpoints',        'mnu_diagEndpoints')
      .addItem('Probar paginación del catálogo',    'mnu_diagPaginacion'))

    .addSeparator()

    // ⚠️ NO poner aquí nada que toque credenciales ni la contraseña del
    // dashboard. Este menú lo ve cualquiera con permiso de edición en la
    // hoja, que es un permiso mucho más repartido que el de administrar
    // accesos. Esas funciones viven en Auth.gs y solo se corren desde el
    // editor de Apps Script, que exige permiso sobre el script.
    .addSubMenu(ui.createMenu('⚙️ Configuración')
      .addItem('Instalar / reinstalar triggers',    'mnu_instalarTriggers')
      .addItem('Quitar triggers',                   'mnu_quitarTriggers')
      .addSeparator()
      .addItem('Reintentar WFS avanzado',           'mnu_resetWfs')
      .addItem('Reiniciar barrido desde cero',      'mnu_reiniciarBarrido')
      .addItem('Reiniciar contador de llamadas',    'mnu_reiniciarContador'))

    .addSeparator()
    .addItem('🔗 Abrir el dashboard',               'mnu_abrirDashboard')

    .addToUi();
}

/* ============================================================
   Helpers de interfaz
   ============================================================ */

function ss_() {
  const activa = SpreadsheetApp.getActiveSpreadsheet();
  return activa || getSpreadsheet_();
}

function aviso_(msg, seg) {
  try { ss_().toast(msg, 'WM Inventario', seg || 5); } catch (e) { Logger.log(msg); }
}

function dialogo_(titulo, cuerpo) {
  try { SpreadsheetApp.getUi().alert(titulo, cuerpo, SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (e) { Logger.log(titulo + '\n' + cuerpo); }
}

/** Corre algo largo mostrando aviso antes y resultado después */
function correr_(nombre, fn) {
  aviso_(nombre + ' — arrancando…', 8);
  try {
    const r = fn();
    return r;
  } catch (err) {
    dialogo_('❌ Falló ' + nombre, String(err && err.message || err));
    return null;
  }
}

/* ============================================================
   Sincronizar
   ============================================================ */

function mnu_syncMain() {
  const r = correr_('Catálogo + WFS', syncMain);
  if (!r) return;
  if (r.skipped) {
    dialogo_('Se saltó la corrida', 'Motivo: ' + (r.reason || 'desconocido') +
      '\n\nSi dice "sin presupuesto", ya se gastaron las llamadas del día.\n' +
      'Se reinicia a medianoche.');
    return;
  }
  dialogo_('✅ Sincronización lista',
    r.count + ' SKUs en catálogo\n' +
    r.wfs + ' de ellos en WFS\n\n' +
    'Tardó ' + r.elapsedSec + ' segundos.\n' +
    'Quedan ' + fetchRestantes_() + ' llamadas para hoy.');
}

function mnu_chunk() {
  const r = correr_('Barrido de inventario propio', syncRegularChunk);
  if (!r) return;
  if (r.skipped) {
    dialogo_('Se saltó el lote', 'Motivo: ' + (r.reason || 'desconocido'));
    return;
  }
  dialogo_('✅ Lote listo',
    r.processed + ' SKUs consultados en ' + r.elapsedSec + ' seg' +
    (r.errores ? '\n' + r.errores + ' con error (se reintentan en el siguiente lote)' : '') +
    '\n\nCobertura: ' + r.cubiertos + ' de ' + r.total + '  (' + r.pct + '%)\n' +
    'Quedan ' + fetchRestantes_() + ' llamadas para hoy.');
}

/* ============================================================
   Estado
   ============================================================ */

function mnu_progreso() {
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
    const pctCob = total ? Math.round(conDato / total * 100) : 0;
    const faltan = Math.max(0, total - conDato);
    const lotes = Math.ceil(faltan / WM_CONFIG.MAX_SKUS_POR_CHUNK);
    const horas = (lotes * WM_CONFIG.CHUNK_INTERVAL_MIN / 60).toFixed(1);

    dialogo_('📊 Avance del barrido',
      'SKUs con dato:  ' + conDato + ' de ' + total + '  (' + pctCob + '%)\n' +
      'Pendientes:     ' + faltan + '\n\n' +
      (faltan > 0
        ? 'Faltan ≈ ' + lotes + ' lotes ≈ ' + horas + ' horas.'
        : 'Cobertura completa. Los lotes ahora solo refrescan los datos más viejos.') +
      (masViejo ? '\n\nDato más viejo: ' + masViejo.toLocaleString('es-MX') : '') +
      '\n\nEndpoint WFS: ' +
      (PropertiesService.getScriptProperties().getProperty(WM_CONFIG.PROP_WFS_ENDPOINT) || 'sin detectar'));
  } catch (e) {
    dialogo_('❌ Error', String(e.message));
  }
}

function mnu_consumo() {
  const restan = fetchRestantes_();
  const usadas = WM_CONFIG.DAILY_FETCH_BUDGET - restan;
  const pct = Math.round(usadas / WM_CONFIG.DAILY_FETCH_BUDGET * 100);

  dialogo_('📞 Llamadas de hoy',
    'Usadas:      ' + usadas + '  (' + pct + '%)\n' +
    'Restantes:   ' + restan + '\n' +
    'Presupuesto: ' + WM_CONFIG.DAILY_FETCH_BUDGET + '\n\n' +
    'La cuota real de Google es 20,000/día. Nuestro tope es más bajo\n' +
    'a propósito, para que el dashboard siga respondiendo aunque los\n' +
    'triggers ya hayan gastado lo suyo.\n\n' +
    (restan < 2000
      ? '⚠️ Queda poco. Los triggers van a empezar a saltarse corridas.'
      : 'Se reinicia a medianoche, hora de México.'));
}

function mnu_triggers() {
  const ts = ScriptApp.getProjectTriggers();
  if (!ts.length) { dialogo_('Triggers', 'No hay ninguno instalado.'); return; }

  const lineas = ts.map(function(t){
    return '  · ' + t.getHandlerFunction();
  }).join('\n');

  dialogo_('⏱ Triggers activos',
    lineas + '\n\n' +
    'Intervalos configurados:\n' +
    '  syncMain          cada ' + WM_CONFIG.REFRESH_INTERVAL_MIN + ' min\n' +
    '  syncRegularChunk  cada ' + WM_CONFIG.CHUNK_INTERVAL_MIN + ' min');
}

/* ============================================================
   Diagnóstico
   ============================================================ */

function mnu_porQueNoCorre() {
  aviso_('Revisando qué está frenando…', 10);
  try {
    mostrarTexto_('¿Por qué no está corriendo?', porQueNoCorre());
  } catch (e) {
    dialogo_('❌ Error', String(e.message));
  }
}

function mnu_sinDato() {
  aviso_('Revisando cuáles no tienen dato…', 10);
  try {
    mostrarTexto_('SKUs sin dato de inventario', verSkusSinDato());
  } catch (e) {
    dialogo_('❌ Error', String(e.message));
  }
}

function mnu_testSheet() {
  try {
    const ss = getSpreadsheet_();
    dialogo_('✅ Sheet accesible',
      'Nombre: ' + ss.getName() + '\n\n' +
      'Pestañas:\n  ' + ss.getSheets().map(function(s){ return s.getName(); }).join('\n  '));
  } catch (e) {
    dialogo_('❌ No se pudo abrir', String(e.message));
  }
}

function mnu_testAuth() {
  try {
    const t = getAccessToken();
    dialogo_('✅ Login correcto',
      'Token: ' + t.substring(0, 28) + '…\n\n' +
      'Mercado: ' + WM_CONFIG.MARKET + '\n' +
      'URL: ' + getBaseUrl());
  } catch (e) {
    dialogo_('❌ Falló el login', String(e.message) +
      '\n\nRevisa las credenciales en el menú 🔑 Credenciales.');
  }
}

function mnu_diagEndpoints() {
  aviso_('Probando endpoints… puede tardar un minuto', 10);
  try {
    const out = runDiagnostics();
    mostrarTexto_('Diagnóstico de endpoints', out);
  } catch (e) {
    dialogo_('❌ Error', String(e.message));
  }
}

function mnu_diagPaginacion() {
  aviso_('Probando paginación…', 10);
  try {
    diagnosticarPaginacion();
    dialogo_('Diagnóstico de paginación',
      'Listo. El detalle quedó en el registro de ejecuciones.\n\n' +
      'Para verlo: en el editor de Apps Script, panel izquierdo →\n' +
      'Ejecuciones → la más reciente.');
  } catch (e) {
    dialogo_('❌ Error', String(e.message));
  }
}

/** Muestra texto largo en una ventana con scroll */
function mostrarTexto_(titulo, texto) {
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;' +
    'white-space:pre-wrap;padding:12px;line-height:1.45">' +
    String(texto).replace(/[&<>]/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;' }[c];
    }) + '</div>'
  ).setWidth(720).setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, titulo);
}

/* ============================================================
   Configuración
   ============================================================ */

function mnu_instalarTriggers() {
  try {
    instalarTriggers();
    const cm = Math.floor(1440 / WM_CONFIG.REFRESH_INTERVAL_MIN);
    const cc = Math.floor(1440 / WM_CONFIG.CHUNK_INTERVAL_MIN);
    dialogo_('✅ Triggers instalados',
      'syncMain          cada ' + WM_CONFIG.REFRESH_INTERVAL_MIN + ' min\n' +
      'syncRegularChunk  cada ' + WM_CONFIG.CHUNK_INTERVAL_MIN + ' min\n\n' +
      'Consumo estimado:\n' +
      '  ' + (cm * 70 + cc * WM_CONFIG.MAX_SKUS_POR_CHUNK) +
      ' llamadas al día, de ' + WM_CONFIG.DAILY_FETCH_BUDGET + ' presupuestadas.');
  } catch (e) {
    dialogo_('❌ Error', String(e.message));
  }
}

function mnu_quitarTriggers() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert('¿Quitar los triggers?',
    'La sincronización automática se detiene. El dashboard va a seguir\n' +
    'mostrando los últimos datos, pero ya no se actualizan solos.\n\n' +
    'El menú y el trigger de apertura no se tocan.',
    ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  quitarTriggers();
  aviso_('Triggers removidos.', 5);
}

function mnu_resetWfs() {
  resetWfsEndpointMode();
  dialogo_('Detección reiniciada',
    'En la próxima sincronización se vuelve a probar el endpoint WFS avanzado.\n\n' +
    'Si Walmart ya te habilitó el programa, se llenan solas las columnas de\n' +
    'antigüedad, proyección de ventas, sell-through y días de supply.\n\n' +
    'Si sigue bloqueado, cae al endpoint básico como hasta ahora — no se\n' +
    'rompe nada.');
}

function mnu_reiniciarBarrido() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert('¿Reiniciar el barrido?',
    'Se BORRAN las cantidades de inventario propio y todos los SKUs\n' +
    'quedan marcados como pendientes.\n\n' +
    'Los SKUs no se pierden, pero el dashboard va a mostrar "—" en esa\n' +
    'columna hasta que el barrido los vuelva a consultar (varias horas).\n\n' +
    'Úsalo solo si sospechas que los datos están mal.',
    ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  reiniciarBarrido();
  aviso_('Todos los SKUs quedaron pendientes de consultar.', 6);
}

function mnu_reiniciarContador() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert('¿Reiniciar el contador de llamadas?',
    'Esto pone nuestro contador en cero, pero NO reinicia la cuota real\n' +
    'de Google — esa se reinicia sola a medianoche.\n\n' +
    'Si la de Google sigue agotada, las llamadas van a fallar igual.\n' +
    'Úsalo solo si sabes que ya se reinició del lado de Google.',
    ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  reiniciarContadorFetch();
  aviso_('Contador en cero.', 5);
}

function mnu_abrirDashboard() {
  const url = 'https://v-w04.github.io/WM_Inv/';
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:20px;text-align:center">' +
    '<p style="font-size:13px;color:#333;margin:0 0 18px">Tu dashboard de inventario</p>' +
    '<a href="' + url + '" target="_blank" style="display:inline-block;background:#1a73e8;' +
    'color:#fff;padding:11px 22px;border-radius:5px;text-decoration:none;font-size:13px;' +
    'font-weight:500">Abrir en una pestaña nueva</a>' +
    '<p style="font-size:11px;color:#888;margin:18px 0 0;font-family:monospace">' + url + '</p>' +
    '</div>'
  ).setWidth(360).setHeight(190);
  SpreadsheetApp.getUi().showModalDialog(html, 'Dashboard');
}
