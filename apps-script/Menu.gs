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
      .addItem('Probar conexión al Sheet',          'mnu_testSheet')
      .addItem('Probar login con Walmart',          'mnu_testAuth')
      .addItem('Probar todos los endpoints',        'mnu_diagEndpoints')
      .addItem('Probar paginación del catálogo',    'mnu_diagPaginacion'))

    .addSeparator()

    .addSubMenu(ui.createMenu('🔑 Credenciales')
      .addItem('Credenciales de Walmart…',          'mnu_dlgCredenciales')
      .addItem('Contraseña del dashboard…',         'mnu_dlgPassword'))

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
  const pct = r.total ? Math.round(r.cursor / r.total * 100) : 0;
  dialogo_('✅ Lote listo',
    r.processed + ' SKUs consultados en ' + r.elapsedSec + ' seg\n\n' +
    'Posición del recorrido: ' + r.cursor + ' de ' + r.total + ' (' + pct + '%)\n' +
    'Quedan ' + fetchRestantes_() + ' llamadas para hoy.');
}

/* ============================================================
   Estado
   ============================================================ */

function mnu_progreso() {
  try {
    const sh = getSheet_(WM_CONFIG.SHEET_REGULAR);
    const total = Math.max(0, sh.getLastRow() - 1);
    const cursor = getInvCursor_();

    let conDato = 0;
    if (total > 0) {
      const vals = sh.getRange(2, 2, total, 1).getValues();
      for (let i = 0; i < vals.length; i++) {
        if (vals[i][0] !== '' && vals[i][0] !== null) conDato++;
      }
    }
    const pctCob = total ? Math.round(conDato / total * 100) : 0;
    const faltan = Math.max(0, total - conDato);
    const lotes = Math.ceil(faltan / WM_CONFIG.MAX_SKUS_POR_CHUNK);
    const horas = (lotes * WM_CONFIG.CHUNK_INTERVAL_MIN / 60).toFixed(1);

    dialogo_('📊 Avance del barrido',
      'SKUs con dato de inventario:  ' + conDato + ' de ' + total + '  (' + pctCob + '%)\n' +
      'Posición del recorrido:       ' + cursor + '\n\n' +
      (faltan > 0
        ? 'Faltan ' + faltan + ' SKUs ≈ ' + lotes + ' lotes ≈ ' + horas + ' horas.'
        : 'Cobertura completa. Los lotes ahora solo refrescan datos.') +
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
   Credenciales — por diálogo, no por código
   ============================================================ */

function mnu_dlgCredenciales() {
  const props = PropertiesService.getScriptProperties();
  const yaHay = !!props.getProperty(WM_CONFIG.PROP_CLIENT_ID);

  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:18px">' +
    '<h3 style="margin:0 0 4px">Credenciales de Walmart</h3>' +
    '<p style="color:#666;font-size:12px;margin:0 0 16px">' +
    (yaHay ? 'Ya hay credenciales guardadas. Si escribes nuevas, las reemplazan.'
           : 'Todavía no hay credenciales guardadas.') +
    '</p>' +

    '<label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px">Client ID</label>' +
    '<input id="cid" style="width:100%;padding:7px;font-family:monospace;font-size:12px;' +
    'border:1px solid #ccc;border-radius:4px;box-sizing:border-box">' +

    '<label style="display:block;font-size:12px;font-weight:600;margin:12px 0 4px">Client Secret</label>' +
    '<input id="csec" type="password" style="width:100%;padding:7px;font-family:monospace;' +
    'font-size:12px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box">' +

    '<div style="background:#e8f0fe;border-left:3px solid #1a73e8;padding:9px 11px;' +
    'margin:16px 0;font-size:11px;color:#333;line-height:1.5">' +
    'Se guardan cifradas en PropertiesService. No pasan por el código ni por el repo, ' +
    'así que no hay riesgo de que terminen en GitHub.' +
    '</div>' +

    '<button onclick="guardar()" style="background:#1a73e8;color:#fff;border:none;' +
    'padding:9px 18px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:500">' +
    'Guardar</button>' +
    '<span id="msg" style="margin-left:12px;font-size:12px"></span>' +

    '<script>' +
    'function guardar(){' +
    'var a=document.getElementById("cid").value.trim();' +
    'var b=document.getElementById("csec").value.trim();' +
    'var m=document.getElementById("msg");' +
    'if(!a||!b){m.style.color="#c00";m.textContent="Faltan datos.";return;}' +
    'm.style.color="#666";m.textContent="Guardando…";' +
    'google.script.run.withSuccessHandler(function(){' +
    'm.style.color="#0a0";m.textContent="Listo. Cerrando…";' +
    'setTimeout(google.script.host.close,900);})' +
    '.withFailureHandler(function(e){m.style.color="#c00";m.textContent=e.message;})' +
    '.saveCredentials_(a,b);}' +
    '</script></div>'
  ).setWidth(460).setHeight(400);

  SpreadsheetApp.getUi().showModalDialog(html, 'Credenciales de Walmart');
}

function mnu_dlgPassword() {
  const yaHay = !!PropertiesService.getScriptProperties()
                    .getProperty(WM_CONFIG.PROP_DASH_PASSWORD);

  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:18px">' +
    '<h3 style="margin:0 0 4px">Contraseña del dashboard</h3>' +
    '<p style="color:#666;font-size:12px;margin:0 0 16px">' +
    (yaHay ? 'Ya hay una configurada. Si escribes otra, la reemplaza y todas las sesiones abiertas se cierran.'
           : 'Todavía no hay contraseña. Sin ella el dashboard no deja entrar a nadie.') +
    '</p>' +

    '<label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px">Nueva contraseña</label>' +
    '<input id="p1" type="password" style="width:100%;padding:7px;font-size:13px;' +
    'border:1px solid #ccc;border-radius:4px;box-sizing:border-box">' +

    '<label style="display:block;font-size:12px;font-weight:600;margin:12px 0 4px">Repítela</label>' +
    '<input id="p2" type="password" style="width:100%;padding:7px;font-size:13px;' +
    'border:1px solid #ccc;border-radius:4px;box-sizing:border-box">' +

    '<div style="background:#fef7e0;border-left:3px solid #f9ab00;padding:9px 11px;' +
    'margin:16px 0;font-size:11px;color:#333;line-height:1.5">' +
    'Cuatro palabras sin relación entre sí resisten mucho más que símbolos raros, ' +
    'y se recuerdan mejor. Evita el nombre de la empresa, años o cualquier cosa ' +
    'adivinable: el dashboard está en internet abierto.' +
    '</div>' +

    '<button onclick="guardar()" style="background:#1a73e8;color:#fff;border:none;' +
    'padding:9px 18px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:500">' +
    'Guardar</button>' +
    '<span id="msg" style="margin-left:12px;font-size:12px"></span>' +

    '<script>' +
    'function guardar(){' +
    'var a=document.getElementById("p1").value;' +
    'var b=document.getElementById("p2").value;' +
    'var m=document.getElementById("msg");' +
    'if(a.length<8){m.style.color="#c00";m.textContent="Mínimo 8 caracteres.";return;}' +
    'if(a!==b){m.style.color="#c00";m.textContent="No coinciden.";return;}' +
    'm.style.color="#666";m.textContent="Guardando…";' +
    'google.script.run.withSuccessHandler(function(){' +
    'm.style.color="#0a0";m.textContent="Listo. Cerrando…";' +
    'setTimeout(google.script.host.close,900);})' +
    '.withFailureHandler(function(e){m.style.color="#c00";m.textContent=e.message;})' +
    '.guardarPasswordWeb_(a);}' +
    '</script></div>'
  ).setWidth(460).setHeight(420);

  SpreadsheetApp.getUi().showModalDialog(html, 'Contraseña del dashboard');
}

/** Llamada desde el diálogo. Guarda solo el hash. */
function guardarPasswordWeb_(pw) {
  if (!pw || String(pw).length < 8) throw new Error('Mínimo 8 caracteres.');
  PropertiesService.getScriptProperties()
    .setProperty(WM_CONFIG.PROP_DASH_PASSWORD, sha256_(String(pw)));
  return 'OK';
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
    'El recorrido del inventario propio vuelve al primer SKU.\n\n' +
    'Los datos que ya tienes NO se borran — solo se van refrescando\n' +
    'desde el principio.',
    ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  reiniciarBarrido();
  aviso_('Barrido reiniciado desde el SKU 0.', 5);
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
