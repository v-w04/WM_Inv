/**
 * WALMART DASHBOARD -- Organizar el libro (orden, colores, indice, guia del menu, formatos)
 *
 * Un solo boton del menu (Ordenar hojas e indice) que:
 *  1. BORRA hojas temporales y de respaldo (nombre con "respaldo", "_algo_tmp", "Copia de ...").
 *     Nunca borra las hojas del registro ni las del sistema (WM_CONFIG).
 *  2. Pone orden y color de pestana por grupo (el orden sale de orgHojas_()).
 *  3. Rehace "Indice" (links, para que sirve, filas, ultimo cambio visto) y "Guia del menu".
 *  4. Encabezados (fila 1) con el color del grupo y congelados; filtro si la hoja no trae uno;
 *     ancho de columnas; formato de precio y fecha buscando la columna por ENCABEZADO.
 *  5. Manda AL FINAL las hojas que parecen sin uso (no estan en el registro ni las usa el sistema
 *     Y estan vacias o llevan ORG_DIAS_SIN_USO dias sin cambios). Esas NO se borran: tu decides.
 *
 * Datos, formulas y formatos que ya pusiste NO se tocan: el formato es "suave" (solo celdas en General),
 * el ancho solo se ajusta la primera vez por columna, y un encabezado con color tuyo se respeta.
 *
 * Hoja nueva que el codigo crea -> UNA linea en orgHojas_().  Cambio el menu -> cambia ORG_GUIA_MENU.
 * El registro es una FUNCION (no un var) para leer WM_CONFIG ya cargado, sin depender del orden de archivos.
 */

var ORG_INDICE = '📑 Índice';
var ORG_GUIA   = '📖 Guía del menú';
var ORG_PROP_HUELLA = 'ORG_HUELLA';
var ORG_PROP_VISTO  = 'ORG_VISTO';
var ORG_DIAS_SIN_USO = 30;
var ORG_PROP_ANCHO = 'ORG_ANCHO';
var ORG_ANCHO_MAX = 280;      // tope en píxeles para columnas de contenido largo
var ORG_ANCHO_MIN = 60;

var ORG_GRUPOS = {
  GUIA:        { titulo: '📖 GUIA',                              color: '#00796b' },
  INVENTARIO:  { titulo: '📦 INVENTARIO Y WFS',                    color: '#1a73e8' },
  PUBLICACION: { titulo: '📋 PUBLICACION',                         color: '#188038' },
  SISTEMA:     { titulo: '🛠️ SISTEMA',                       color: '#e37400' },
  OCULTAS:     { titulo: '🙈 OCULTAS (a proposito)',               color: '#9aa0a6' },
  SINUSO:      { titulo: '🗑️ POSIBLEMENTE SIN USO — revisalas y borralas si no sirven', color: '#8d6e63' }
};

/**
 * [nombre de hoja, grupo, para que sirve, como se actualiza, filtro (true = ponerle filtro si no trae)].
 * El orden de aqui es el orden del libro. Los nombres salen de WM_CONFIG.
 */
function orgHojas_() {
  return [
    [ORG_GUIA, 'GUIA', 'Que hace cada opcion del menu WM Inventario y cual te toca', 'Auto (la rehace Ordenar)', false],

    [WM_CONFIG.SHEET_MASTER, 'INVENTARIO',
     'Catalogo completo de Walmart: una fila por SKU con su estado de publicacion, WFS e inventario propio. Lo reescribe el sync; no captures aqui.',
     'Auto: catalogo + WFS cada ' + WM_CONFIG.REFRESH_INTERVAL_MIN + ' min, inventario propio por lotes cada ' + WM_CONFIG.CHUNK_INTERVAL_MIN + ' min', true],
    [WM_CONFIG.SHEET_LLEGADAS, 'INVENTARIO',
     'Cada vez que sube el stock de WFS en un SKU: cuanto habia antes, cuanto despues y cuando lo actualizo Walmart',
     'Auto, con el sync de catalogo + WFS', true],

    [WM_CONFIG.SHEET_NOPUB, 'PUBLICACION',
     'SKUs sin publicar con su motivo, stock y desde cuando se ven; los de mas dinero parado arriba',
     'Menu: Refrescar lista de no publicados', true],
    [WM_CONFIG.SHEET_BLOQUEADOS, 'PUBLICACION',
     'Tu hoja: SKUs que decidiste no consultar mas (BLOQUEADO, MAL_PUBLICADO, REPUBLICADO). El motivo lo llena solo el script con lo que dice Walmart',
     'Manual (tu) + motivo automatico', true],

    [WM_CONFIG.SHEET_LOG, 'SISTEMA',
     'Bitacora de cada corrida del sync: hora, filas, segundos y nota. Se poda sola cuando pasa de ' + WM_CONFIG.LOG_MAX_FILAS + ' filas',
     'Auto', false]
  ];
}

/**
 * [seccion, opcion, que hace, cuando usarla, nivel]
 * nivel: DIARIO = lo usas en tu operacion | A VECES = cuando toca | SOPORTE = solo si algo falla o se configura | CUIDADO = borra o rehace cosas
 * Debe coincidir 1 a 1 con onOpenMenu (Menu.gs).
 */
var ORG_GUIA_MENU = [
  ['🔄 Sincronizar', 'Catálogo + WFS  (~80 seg)', 'Baja el catalogo de Walmart y el stock de WFS y actualiza la hoja Inventario. Es lo mismo que hace solo el trigger.', 'Cuando quieras datos frescos ya', 'A VECES'],
  ['🔄 Sincronizar', 'Inventario propio  (un lote)', 'Consulta el inventario propio de un lote de SKUs (los nuevos primero, luego los mas viejos).', 'Normalmente solo (cada 30 min)', 'A VECES'],
  ['🔄 Sincronizar', 'Forzar catálogo completo ahora', 'Baja el catalogo completo de la API, no solo lo que ya esta en la hoja. Gasta mas llamadas.', 'Si sospechas que faltan o sobran SKUs', 'A VECES'],

  ['📊 Estado', 'Avance del barrido', 'Cuantos SKUs ya tienen inventario revisado y cuantos faltan.', 'Para ver como va el barrido', 'DIARIO'],
  ['📊 Estado', 'Llamadas usadas hoy', 'Cuantas llamadas a la API van hoy y cuantas quedan.', 'Si el sync se saltea por presupuesto', 'A VECES'],
  ['📊 Estado', 'Triggers activos', 'Lista los triggers instalados y cada cuanto corren.', 'Si dudas de que algo este corriendo', 'SOPORTE'],
  ['📊 Estado', 'Seguridad del dashboard', 'Dice si el dashboard tiene contrasena puesta (solo lee, no muestra nada secreto).', 'Para confirmar que esta protegido', 'SOPORTE'],

  ['📋 Publicación', 'Refrescar lista de no publicados', 'Rehace No_Publicados desde Inventario y escribe en Bloqueados el motivo que da Walmart. No gasta llamadas.', 'Cuando quieras ver que sigue sin publicar', 'DIARIO'],
  ['📋 Publicación', '¿Dónde está el dinero parado?', 'Resumen de SKUs sin publicar por motivo y cuanto dinero hay parado. No gasta llamadas.', 'Para decidir que republicar primero', 'DIARIO'],

  ['🔧 Diagnóstico', '⚠️ ¿Por qué no está corriendo?', 'Revisa triggers, cuota y presupuesto y dice cual es el culpable.', 'Si el Sync_Log dejo de avanzar', 'SOPORTE'],
  ['🔧 Diagnóstico', 'SKUs sin dato de inventario', 'Lista los SKUs a los que todavia no se les consulta el inventario propio.', 'Si el barrido no avanza', 'SOPORTE'],
  ['🔧 Diagnóstico', 'Revisar columnas de las hojas', 'Comprueba que cada hoja traiga los encabezados que el sync necesita (los busca por nombre, no por lugar).', 'Despues de mover o renombrar columnas', 'SOPORTE'],
  ['🔧 Diagnóstico', 'Probar conexión al Sheet', 'Prueba que el script abra este libro y vea sus hojas.', 'Si algo no escribe', 'SOPORTE'],
  ['🔧 Diagnóstico', 'Probar login con Walmart', 'Prueba que las llaves de Walmart den un token.', 'Si la API falla', 'SOPORTE'],
  ['🔧 Diagnóstico', 'Probar todos los endpoints', 'Prueba cada endpoint de Walmart que usa el dashboard.', 'Si algo de Walmart deja de contestar', 'SOPORTE'],
  ['🔧 Diagnóstico', 'Probar paginación del catálogo', 'Prueba que el catalogo se baje completo, pagina por pagina.', 'Si faltan SKUs en Inventario', 'SOPORTE'],
  ['🔧 Diagnóstico', '¿Hay reporte masivo?  (ahorro)', 'Busca si Walmart ofrece un reporte masivo para ahorrar llamadas.', 'Solo para investigar', 'SOPORTE'],
  ['🔧 Diagnóstico', 'Reportes — ronda 2', 'Segunda prueba de reportes masivos de Walmart.', 'Solo para investigar', 'SOPORTE'],
  ['🔧 Diagnóstico', 'Reportes — ¿qué trae adentro?', 'Muestra que columnas trae un reporte masivo de Walmart.', 'Solo para investigar', 'SOPORTE'],

  ['⚙️ Configuración', 'Instalar / reinstalar triggers', 'Borra los triggers viejos y crea los del sync (catalogo + WFS y barrido de inventario).', 'Una vez, o si cambias la hora o dejaron de correr', 'SOPORTE'],
  ['⚙️ Configuración', 'Quitar triggers', 'Apaga el sync automatico.', 'Solo si quieres pararlo', 'CUIDADO'],
  ['⚙️ Configuración', 'Reintentar WFS avanzado', 'Vuelve a probar el endpoint avanzado de WFS (agrega columnas de analitica si Walmart ya lo habilito).', 'Si Walmart habilita WFS avanzado', 'SOPORTE'],
  ['⚙️ Configuración', 'Reiniciar barrido desde cero', 'Deja todos los SKUs como pendientes de consultar inventario. Gasta llamadas.', 'Casi nunca', 'CUIDADO'],
  ['⚙️ Configuración', 'Reiniciar contador de llamadas', 'Pone en cero el contador de llamadas del dia.', 'Solo si el contador quedo mal', 'CUIDADO'],
  ['⚙️ Configuración', 'Quitar marca de cuota agotada', 'Quita la marca que dice que Google agoto la cuota del dia.', 'Cuando ya paso la cuota y el sync sigue saltando', 'SOPORTE'],
  ['⚙️ Configuración', 'Limpiar contadores viejos (1 vez)', 'Migra contadores de una version anterior.', 'Una sola vez', 'SOPORTE'],

  ['General', '🗂️ Ordenar hojas e índice', 'Pone colores, orden, encabezados, filtros y formato de precio/fecha, rehace el Indice y esta guia, BORRA respaldos y temporales, y manda al final (sin borrarlas) las hojas que parecen sin uso.', 'Cuando aparezca una hoja nueva o de vez en cuando', 'CUIDADO'],
  ['General', '🔗 Abrir el dashboard', 'Abre la pagina del dashboard.', 'Cuando lo quieras ver', 'DIARIO']
];

/** Posiciones dentro de cada fila del registro y de la guia (listas en memoria, no columnas de una hoja). */
var ORG_F = { NOMBRE: 0, GRUPO: 1, DESC: 2, ACT: 3, FILTRO: 4 };
var ORG_G = { SECCION: 0, OPCION: 1, QUE: 2, CUANDO: 3, NIVEL: 4 };

var ORG_NIVEL_COLOR = { 'DIARIO': '#d9ead3', 'A VECES': '#fff2cc', 'SOPORTE': '#eeeeee', 'CUIDADO': '#f4cccc' };

/** Hojas que no reciben estilo de encabezado ni se congelan (ninguna por ahora: todas traen encabezado en la fila 1). */
var ORG_SIN_ENCABEZADO = [];

var ORG_FMT_DINERO    = '$#,##0.00';
var ORG_FMT_FECHA     = 'dd/mm/yyyy';
var ORG_FMT_FECHAHORA = 'dd/mm/yyyy hh:mm';

/**
 * Columnas con formato, por ENCABEZADO exacto (sin importar en que letra esten).
 * dinero / fecha / fechaHora = lista de encabezados. Solo se aplica si las primeras celdas son
 * numeros / fechas reales; el texto se queda como texto. Los nombres de hoja salen de WM_CONFIG.
 */
function orgFormatosDef_() {
  var d = {};
  d[WM_CONFIG.SHEET_MASTER]     = { dinero: ['price'], fecha: ['invRevisado'], fechaHora: ['wfsActualizado'] };
  d[WM_CONFIG.SHEET_NOPUB]      = { dinero: ['price'], fecha: ['vistoDesde'] };
  d[WM_CONFIG.SHEET_BLOQUEADOS] = { fecha: ['fecha'] };
  d[WM_CONFIG.SHEET_LLEGADAS]   = { fechaHora: ['fecha', 'walmartActualizado'] };
  return d;
}
function orgNorm_(t) {
  return String(t === null || t === undefined ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Reintenta etapas que Sheets agota por tiempo (4 intentos, 10 s × n). Otros errores salen de una vez. */
function orgReintentar_(fn) {
  var ultimo;
  for (var i = 1; i <= 4; i++) {
    try { return fn(); }
    catch (e) {
      ultimo = e;
      if (!/tiempo|timed? ?out|agot|servicio hojas|service/i.test(String(e && e.message || e))) throw e;
      Utilities.sleep(10000 * i);
    }
  }
  throw ultimo;
}

/** Temporal o respaldo: se BORRA al ordenar (si no es del sistema ni del registro). */
function orgEsTemporal_(nombre) {
  return /respaldo/i.test(nombre) || /^_.*tmp$/i.test(nombre) || /^copia de /i.test(nombre);
}

/** Hojas que el sistema usa: protegidas del proyecto + registro + las dos de guía. */
function orgProtegidas_() {
  var s = {};
  [WM_CONFIG.SHEET_MASTER, WM_CONFIG.SHEET_REGULAR, WM_CONFIG.SHEET_LOG, WM_CONFIG.SHEET_BLOQUEADOS,
   WM_CONFIG.SHEET_NOPUB, WM_CONFIG.SHEET_LLEGADAS].forEach(function (n) { if (n) s[n] = true; });
  orgHojas_().forEach(function (f) { s[f[ORG_F.NOMBRE]] = true; });
  s[ORG_INDICE] = true; s[ORG_GUIA] = true;
  return s;
}

/** Borra temporales y respaldos. Devuelve los nombres borrados. */
function orgLimpiar_(ss) {
  var prot = orgProtegidas_(), quitadas = [];
  ss.getSheets().forEach(function (h) {
    var n = h.getName();
    if (prot[n] || !orgEsTemporal_(n)) return;
    if (ss.getSheets().length <= 1) return;
    orgReintentar_(function () { ss.deleteSheet(h); });
    quitadas.push(n);
  });
  return quitadas;
}

/** Huella barata de una hoja: tamaño + primeras y últimas filas. */
function orgHuella_(h) {
  var nF = h.getLastRow(), nCtot = h.getLastColumn(), nC = Math.min(nCtot, 40);
  if (nF < 1 || nC < 1) return '0|0|0';
  var txt = [];
  h.getRange(1, 1, Math.min(2, nF), nC).getDisplayValues().forEach(function (f) { txt.push(f.join('\t')); });
  if (nF > 2) {
    var ini = Math.max(3, nF - 1);
    h.getRange(ini, 1, nF - ini + 1, nC).getDisplayValues().forEach(function (f) { txt.push(f.join('\t')); });
  }
  var s = txt.join('\n'), x = 0;
  for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
  return nF + '|' + nCtot + '|' + x;
}

function orgHoy_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

function orgDias_(fecha) {
  if (!fecha) return 0;
  var a = String(fecha).split('-'), b = orgHoy_().split('-');
  var d1 = Date.UTC(+a[0], +a[1] - 1, +a[2]), d2 = Date.UTC(+b[0], +b[1] - 1, +b[2]);
  return Math.max(0, Math.round((d2 - d1) / 86400000));
}

/** Actualiza la huella de cada hoja y devuelve {nombre: {h, d (último cambio visto), p (primera vez vista)}}. */
function orgVisto_(hojas) {
  var props = PropertiesService.getScriptProperties();
  var prev = {};
  try { prev = JSON.parse(props.getProperty(ORG_PROP_VISTO) || '{}'); } catch (e) {}
  var hoy = orgHoy_(), out = {}, limite = new Date().getTime() + 120 * 1000;
  hojas.forEach(function (h) {
    var n = h.getName(), a = prev[n];
    if (new Date().getTime() > limite) { out[n] = a || { h: '', d: hoy, p: hoy }; return; }
    var hu;
    try { hu = orgReintentar_(function () { return orgHuella_(h); }); }
    catch (e) { out[n] = a || { h: '', d: hoy, p: hoy }; return; }
    if (!a) out[n] = { h: hu, d: hoy, p: hoy };
    else if (a.h !== hu) out[n] = { h: hu, d: hoy, p: a.p || hoy };
    else out[n] = a;
  });
  props.setProperty(ORG_PROP_VISTO, JSON.stringify(out));
  return out;
}

/** Hojas que ni el sistema ni el registro conocen Y están vacías o llevan ORG_DIAS_SIN_USO días sin cambios. {nombre: motivo} */
function orgSinUso_(hojas, prot, visto) {
  var res = {};
  hojas.forEach(function (h) {
    var n = h.getName();
    if (prot[n]) return;
    var v = visto[n];
    if (h.getLastRow() < 2) { res[n] = 'vacía'; return; }
    var dias = v ? orgDias_(v.d) : 0;
    if (dias >= ORG_DIAS_SIN_USO) res[n] = 'sin cambios hace ' + dias + ' días';
  });
  return res;
}

/** Recorta una hoja nueva para no gastar celdas del libro (tope de 10 millones). */
function orgRecortar_(h, filas, cols) {
  if (h.getMaxColumns() > cols) h.deleteColumns(cols + 1, h.getMaxColumns() - cols);
  if (h.getMaxRows() > filas) h.deleteRows(filas + 1, h.getMaxRows() - filas);
}

function orgGuia_(ss) {
  var h = ss.getSheetByName(ORG_GUIA) || ss.insertSheet(ORG_GUIA);
  h.clear();
  var filas = [['SECCION DEL MENU', 'OPCION', 'QUE HACE', 'CUANDO USARLA', 'NIVEL']].concat(ORG_GUIA_MENU);
  var nF = filas.length;
  if (h.getMaxRows() < nF + 3) h.insertRowsAfter(h.getMaxRows(), nF + 3 - h.getMaxRows());
  if (h.getMaxColumns() < 5) h.insertColumnsAfter(h.getMaxColumns(), 5 - h.getMaxColumns());
  h.getRange(1, 1, nF, 5).setValues(filas);
  h.getRange(1, 1, 1, 5).setFontWeight('bold').setFontColor('#ffffff').setBackground(ORG_GRUPOS.GUIA.color);
  var bg = [];
  for (var i = 1; i < nF; i++) {
    var c = ORG_NIVEL_COLOR[filas[i][ORG_G.NIVEL]] || '#ffffff';
    bg.push([c, c, c, c, c]);
  }
  h.getRange(2, 1, nF - 1, 5).setBackgrounds(bg).setVerticalAlignment('top');
  h.getRange(2, 3, nF - 1, 2).setWrap(true);   // col-fija: hoja propia de la guia
  [170, 300, 520, 330, 90].forEach(function (w, i) { h.setColumnWidth(i + 1, w); });
  h.setFrozenRows(1);
  try { var f = h.getFilter(); if (f) f.remove(); } catch (e) {}
  h.getRange(1, 1, nF, 5).createFilter();
  h.getRange(1, 1).setNote('DIARIO = lo usas en tu operacion. A VECES = cuando toca. SOPORTE = solo si algo falla o se configura. CUIDADO = borra o rehace cosas.\nLo que no esta en el menu corre solo.');
  orgRecortar_(h, nF + 3, 5);
}

/** Formato suave: solo pone `porDefecto` a las celdas en General; si la columna ya trae un formato (el tuyo), lo respeta y lo extiende. */
function orgFormatoSuave_(sh, col, ini, n, porDefecto) {
  if (!col || !(n > 0)) return 0;
  var fs = sh.getRange(ini, col, n, 1).getNumberFormats();
  var libre = function (f) { return f === 'General' || f === ''; };
  var plantilla = libre(fs[0][0]) ? porDefecto : fs[0][0];
  if (!plantilla || plantilla === 'General') return 0;
  var tramos = 0, i = 0;
  while (i < n) {
    if (libre(fs[i][0]) && fs[i][0] !== plantilla) {
      var j = i;
      while (j + 1 < n && libre(fs[j + 1][0]) && fs[j + 1][0] !== plantilla) j++;
      sh.getRange(ini + i, col, j - i + 1, 1).setNumberFormat(plantilla);
      tramos++;
      i = j + 1;
    } else { i++; }
  }
  return tramos;
}

/** Formato de dinero y fecha, buscando la columna por ENCABEZADO; solo si sus celdas son numeros / fechas reales. */
function orgFormatos_(ss) {
  var total = 0, fallas = [];
  var limite = new Date().getTime() + 200 * 1000;
  var def = orgFormatosDef_();
  Object.keys(def).forEach(function (n) {
    var h = ss.getSheetByName(n);
    if (!h) return;
    if (new Date().getTime() > limite) { fallas.push('(tiempo) ' + n); return; }
    try { total += orgReintentar_(function () { return orgFormatosHoja_(h, def[n]); }); }
    catch (e) { fallas.push(n); console.log('Formatos ' + n + ': ' + e.message); }
  });
  orgFormatos_.fallas = fallas;
  return total;
}

function orgFormatosHoja_(h, def) {
  var nF = h.getLastRow(), nC = h.getLastColumn();
  if (nF < 2 || nC < 1) return 0;
  var muestra = h.getRange(1, 1, Math.min(nF, 40), nC).getValues();
  var enc = muestra[0].map(orgNorm_);
  var total = 0;
  [['dinero', ORG_FMT_DINERO, 'D'], ['fecha', ORG_FMT_FECHA, 'F'], ['fechaHora', ORG_FMT_FECHAHORA, 'F']].forEach(function (t) {
    (def[t[0]] || []).forEach(function (nombre) {
      var c = enc.indexOf(orgNorm_(nombre));
      if (c < 0) return;                       // la columna no esta (opcional): no pasa nada
      var hay = false;
      for (var r = 1; r < muestra.length; r++) {
        var x = muestra[r][c];
        if (t[2] === 'D' ? (typeof x === 'number') : (x instanceof Date)) { hay = true; break; }
      }
      if (!hay) return;
      total += orgFormatoSuave_(h, c + 1, 2, nF - 1, t[1]);
    });
  });
  return total;
}

/** Filtro en la fila 1 si la hoja no trae uno (el tuyo, si ya existe, no se toca). */
function orgFiltro_(h) {
  try {
    if (h.getFilter()) return false;
    if (h.getLastColumn() < 1 || h.getLastRow() < 2) return false;
    h.getRange(1, 1, h.getMaxRows(), h.getLastColumn()).createFilter();
    return true;
  } catch (e) { return false; }
}

/** Menú: limpia, ordena y avisa. */
function orgOrdenar() {
  var ui = SpreadsheetApp.getUi();
  var avisos = [], r = null, quitadas = [];
  try { quitadas = orgLimpiar_((SpreadsheetApp.getActive() || getSpreadsheet_())); } catch (e) { avisos.push('Limpieza de respaldos: ' + e.message); }
  try { r = orgAplicar_(true); } catch (e) { avisos.push('Orden/índice: ' + e.message); }
  if (!r) {
    ui.alert('🗂️ Ordenar hojas', 'No terminó:\n  ' + avisos.join('\n  ') +
      (quitadas.length ? '\n\nYa borré: ' + quitadas.join(', ') : '') +
      '\n\nEs Sheets ocupado (corridas automáticas). Espera 2 minutos sin tocar el libro y vuelve a correrlo: retoma donde se quedó.', ui.ButtonSet.OK);
    return;
  }
  var falt = (orgFormatos_.fallas || []);
  if (falt.length) avisos.push('Formatos pendientes en: ' + falt.join(', ') + ' (vuelve a correrlo y los termina)');
  var faltA = (orgAnchos_.faltan || []);
  if (faltA.length) avisos.push('Anchos pendientes en: ' + faltA.join(', ') + ' (vuelve a correrlo y los termina)');
  var sinUso = Object.keys(r.sinUso);
  ui.alert('🗂️ Libro ordenado',
    r.ordenadas + ' hojas con color y orden.\n' +
    r.encabezados + ' encabezados unificados.\n' +
    (r.filtros ? r.filtros + ' hojas con filtro nuevo.\n' : '') +
    r.formatos + ' columnas de precio/fecha con formato.\n' +
    r.anchos + ' hojas con ancho de columnas ajustado (encabezado completo).\n' +
    'Índice: hoja "' + ORG_INDICE + '" (la primera).\n' +
    (quitadas.length ? '\nBORRADAS (respaldos/temporales):\n  ' + quitadas.join('\n  ') + '\n' : '\nNo había respaldos ni temporales que borrar.\n') +
    (sinUso.length
      ? '\nPOSIBLEMENTE SIN USO (las mandé al final, NO las borré):\n  ' + sinUso.map(function (n) { return n + ' — ' + r.sinUso[n]; }).join('\n  ') + '\n'
      : '\nNinguna hoja parece sin uso (se vigilan cambios desde hoy; salen a los ' + ORG_DIAS_SIN_USO + ' días).\n') +
    (r.sinClasificar.length
      ? '\nSIN CLASIFICAR (nuevas, no están en el registro; las dejé donde estaban):\n  ' + r.sinClasificar.join('\n  ') + '\n'
      : '') +
    (avisos.length ? '\n⚠ ' + avisos.join('\n⚠ ') : ''),
    ui.ButtonSet.OK);
}

function orgAplicar_(completo) {
  var ss = (SpreadsheetApp.getActive() || getSpreadsheet_());
  var porNombre = {};
  ss.getSheets().forEach(function (h) { porNombre[h.getName()] = h; });

  var reg = {};
  orgHojas_().forEach(function (f) { reg[f[ORG_F.NOMBRE]] = { grupo: f[ORG_F.GRUPO], desc: f[ORG_F.DESC], act: f[ORG_F.ACT] }; });
  var prot = orgProtegidas_();

  var ind = porNombre[ORG_INDICE] || ss.insertSheet(ORG_INDICE);
  porNombre[ORG_INDICE] = ind;
  if (!porNombre[ORG_GUIA]) porNombre[ORG_GUIA] = ss.insertSheet(ORG_GUIA);

  var visto = completo ? orgVisto_(ss.getSheets()) : {};
  var sinUso = completo ? orgSinUso_(ss.getSheets(), prot, visto) : {};

  var ocultas = [], sinClas = [], sinUsoL = [], sistema = [];
  ss.getSheets().forEach(function (h) {
    var n = h.getName();
    if (n === ORG_INDICE || n === ORG_GUIA || reg[n]) return;
    if (sinUso[n]) { sinUsoL.push(n); return; }
    if (h.isSheetHidden()) { ocultas.push(n); return; }
    if (prot[n]) { sistema.push(n); return; }
    sinClas.push(n);
  });

  var deseado = [ORG_INDICE];
  orgHojas_().forEach(function (f) { if (ss.getSheetByName(f[ORG_F.NOMBRE])) deseado.push(f[ORG_F.NOMBRE]); });
  sistema.forEach(function (n) { deseado.push(n); });
  sinClas.forEach(function (n) { deseado.push(n); });
  ocultas.sort().forEach(function (n) { deseado.push(n); });
  sinUsoL.sort().forEach(function (n) { deseado.push(n); });

  var resumen = { ordenadas: 0, encabezados: 0, filtros: 0, formatos: 0, sinClasificar: sinClas, sinUso: sinUso };

  deseado.forEach(function (n, i) {
    var h = ss.getSheetByName(n);
    if (!h || h.isSheetHidden()) return;
    if (h.getIndex() !== i + 1) {
      orgReintentar_(function () { ss.setActiveSheet(h); ss.moveActiveSheet(i + 1); });
      SpreadsheetApp.flush();
    }
  });
  orgReintentar_(function () { ss.setActiveSheet(ind); });

  deseado.forEach(function (n) {
    var h = ss.getSheetByName(n);
    if (!h) return;
    var c = null;
    if (n === ORG_INDICE) c = '#202124';
    else if (reg[n]) c = ORG_GRUPOS[reg[n].grupo].color;
    else if (sinUso[n]) c = ORG_GRUPOS.SINUSO.color;
    else if (ocultas.indexOf(n) !== -1) c = ORG_GRUPOS.OCULTAS.color;
    try {
      var act = h.getTabColor();
      if ((act || null) !== c) orgReintentar_(function () { h.setTabColor(c); });
    } catch (e) {}
    resumen.ordenadas++;
  });

  orgReintentar_(function () { orgGuia_(ss); });
  SpreadsheetApp.flush();
  orgReintentar_(function () { orgIndice_(ind, ss, sinClas.concat(sistema), ocultas, sinUso, visto); });
  PropertiesService.getScriptProperties().setProperty(ORG_PROP_HUELLA, deseado.join('|'));

  orgHojas_().forEach(function (f) {
    var h = ss.getSheetByName(f[ORG_F.NOMBRE]);
    if (!h || ORG_SIN_ENCABEZADO.indexOf(f[ORG_F.NOMBRE]) !== -1) return;
    if (orgEncabezado_(h, ORG_GRUPOS[f[ORG_F.GRUPO]].color, completo)) resumen.encabezados++;
    if (completo && f[ORG_F.FILTRO] && orgReintentar_(function () { return orgFiltro_(h); })) resumen.filtros++;
  });
  resumen.formatos = completo ? orgFormatos_(ss) : 0;
  resumen.anchos = completo ? orgAnchos_(ss) : 0;
  return resumen;
}

/**
 * Ancho de columnas: nunca menor que el encabezado (se lee completo); si el contenido es corto se ajusta a él
 * y si es largo se corta en ORG_ANCHO_MAX. Se calcula con una muestra (encabezado + primeras 300 filas), no
 * con autoResize (muy lento en hojas grandes). Solo hojas del registro con encabezado en la fila 1; Índice y
 * Guía llevan su propio ancho. Una hoja ya ajustada se salta mientras no cambien sus encabezados
 * (firma en Script Properties ORG_ANCHO), así la segunda corrida casi no cuesta. Tiene tope de tiempo.
 */
function orgAnchos_(ss) {
  var props = PropertiesService.getScriptProperties();
  var hechas = {};
  try { hechas = JSON.parse(props.getProperty(ORG_PROP_ANCHO) || '{}'); } catch (e) {}
  var limite = new Date().getTime() + 150 * 1000, n = 0, faltan = [];
  orgHojas_().forEach(function (f) {
    var nombre = f[ORG_F.NOMBRE];
    if (nombre === ORG_GUIA || ORG_SIN_ENCABEZADO.indexOf(nombre) !== -1) return;
    var h = ss.getSheetByName(nombre);
    if (!h) return;
    var nC = Math.min(h.getLastColumn(), 60);
    if (nC < 1 || h.getLastRow() < 1) return;
    if (new Date().getTime() > limite) { faltan.push(nombre); return; }
    try {
      orgReintentar_(function () {
        var datos = h.getRange(1, 1, Math.min(h.getLastRow(), 301), nC).getDisplayValues();
        // Solo se ajustan las columnas que NO se habían ajustado antes (por encabezado). Si luego cambias
        // un ancho a mano, o mueves la columna, se respeta; una columna nueva sí se ajusta.
        var ya = Array.isArray(hechas[nombre]) ? hechas[nombre] : [];
        var nuevosEnc = datos[0].map(orgNorm_).filter(function (k) { return k && ya.indexOf(k) < 0; });
        if (!nuevosEnc.length) return;
        for (var c = 0; c < nC; c++) {
          if (ya.indexOf(orgNorm_(datos[0][c])) >= 0 || !orgNorm_(datos[0][c])) continue;
          var enc = String(datos[0][c] || ''), largo = 0;
          for (var r = 1; r < datos.length; r++) { var l = String(datos[r][c] || '').length; if (l > largo) largo = l; }
          var pxEnc = enc ? enc.length * 8 + 34 : 0;          // negrita + icono de filtro
          var pxCont = Math.min(largo * 6.6 + 16, ORG_ANCHO_MAX);
          h.setColumnWidth(c + 1, Math.round(Math.max(pxEnc, pxCont, ORG_ANCHO_MIN)));
        }
        hechas[nombre] = ya.concat(nuevosEnc);
        n++;
      });
    } catch (e) { faltan.push(nombre); console.log('Anchos ' + nombre + ': ' + e.message); }
  });
  props.setProperty(ORG_PROP_ANCHO, JSON.stringify(hechas));
  orgAnchos_.faltan = faltan;
  return n;
}

/** Estilo del encabezado (fila 1) y fila congelada. true si cambio algo. Un encabezado con color tuyo se respeta. */
function orgEncabezado_(h, color, forzar) {
  var nC = h.getLastColumn(), nF = h.getLastRow();
  if (nC < 1 || nF < 1) return false;
  var enc = h.getRange(1, 1, 1, nC);
  if (!String(h.getRange(1, 1).getValue() || '') && nC === 1) return false;
  var cambio = false;
  var bg = String(enc.getCell(1, 1).getBackground() || '').toLowerCase();
  var libre = (bg === '#ffffff' || bg === color);          // blanco (sin estilo) o ya del grupo
  if (libre && (forzar || bg !== color)) {
    enc.setFontWeight('bold').setFontColor('#ffffff').setBackground(color).setVerticalAlignment('middle');
    cambio = true;
  }
  if (h.getFrozenRows() === 0 && nF > 1) { h.setFrozenRows(1); cambio = true; }
  return cambio;
}

function orgUltimo_(visto, n) {
  var v = visto && visto[n];
  if (!v) return '';
  return v.d + (v.d === v.p ? ' (desde que la vigilo)' : '');
}

function orgIndice_(ind, ss, otras, ocultas, sinUso, visto) {
  ind.clear();
  var tz = Session.getScriptTimeZone();
  var filas = [], banners = [];
  var hoja = function (n) { return ss.getSheetByName(n); };
  var link = function (n) { return '=HYPERLINK("#gid=' + hoja(n).getSheetId() + '","' + n.replace(/"/g, '""') + '")'; };
  var nFilas = function (n) { return Math.max(hoja(n).getLastRow() - 1, 0); };

  filas.push(['📑 ÍNDICE DEL LIBRO', '', '', '', '']);
  filas.push(['Actualizado ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm') + '. Da clic en el nombre para ir a la hoja.', '', '', '', '']);
  filas.push(['', '', '', '', '']);

  ['GUIA', 'INVENTARIO', 'PUBLICACION', 'SISTEMA'].forEach(function (k) {
    var items = orgHojas_().filter(function (f) { return f[ORG_F.GRUPO] === k && hoja(f[ORG_F.NOMBRE]); });
    if (!items.length) return;
    filas.push([ORG_GRUPOS[k].titulo, 'PARA QUE SIRVE', 'SE ACTUALIZA', 'FILAS', 'ULTIMO CAMBIO VISTO']);
    banners.push({ fila: filas.length, color: ORG_GRUPOS[k].color });
    items.forEach(function (f) {
      filas.push([link(f[ORG_F.NOMBRE]), f[ORG_F.DESC], f[ORG_F.ACT], nFilas(f[ORG_F.NOMBRE]), orgUltimo_(visto, f[ORG_F.NOMBRE])]);
    });
    filas.push(['', '', '', '', '']);
  });
  if (otras.length) {
    filas.push(['❓ OTRAS (no están en el registro de Organizar.gs)', '', '', 'FILAS', 'ULTIMO CAMBIO VISTO']);
    banners.push({ fila: filas.length, color: '#202124' });
    otras.forEach(function (n) { filas.push([link(n), '', '', nFilas(n), orgUltimo_(visto, n)]); });
    filas.push(['', '', '', '', '']);
  }
  if (ocultas.length) {
    filas.push([ORG_GRUPOS.OCULTAS.titulo, '', '', 'FILAS', '']);
    banners.push({ fila: filas.length, color: ORG_GRUPOS.OCULTAS.color });
    ocultas.forEach(function (n) { filas.push([n, 'Oculta a propósito (clic derecho > Mostrar hoja si la necesitas)', '', nFilas(n), orgUltimo_(visto, n)]); });
    filas.push(['', '', '', '', '']);
  }
  var su = Object.keys(sinUso).sort();
  if (su.length) {
    filas.push([ORG_GRUPOS.SINUSO.titulo, 'MOTIVO', '', 'FILAS', 'ULTIMO CAMBIO VISTO']);
    banners.push({ fila: filas.length, color: ORG_GRUPOS.SINUSO.color });
    su.forEach(function (n) { filas.push([link(n), sinUso[n], 'No se borra sola', nFilas(n), orgUltimo_(visto, n)]); });
  }

  var nF = filas.length;
  if (ind.getMaxRows() < nF + 5) ind.insertRowsAfter(ind.getMaxRows(), nF + 5 - ind.getMaxRows());
  if (ind.getMaxColumns() < 5) ind.insertColumnsAfter(ind.getMaxColumns(), 5 - ind.getMaxColumns());
  ind.getRange(1, 1, nF, 5).setValues(filas.map(function (f) {
    return f.map(function (v) { return (typeof v === 'string' && v.charAt(0) === '=') ? '' : v; });
  }));
  filas.forEach(function (f, i) {
    if (typeof f[0] === 'string' && f[0].charAt(0) === '=') ind.getRange(i + 1, 1).setFormula(f[0]);
  });
  ind.getRange(1, 1).setFontSize(16).setFontWeight('bold');
  ind.getRange(2, 1).setFontColor('#5f6368').setFontStyle('italic');
  banners.forEach(function (b) {
    ind.getRange(b.fila, 1, 1, 5).setBackground(b.color).setFontColor('#ffffff').setFontWeight('bold');
  });
  ind.getRange(1, 4, nF, 1).setHorizontalAlignment('right').setNumberFormat('#,##0');   // col-fija: hoja propia del indice
  ind.setColumnWidth(1, 300); ind.setColumnWidth(2, 560); ind.setColumnWidth(3, 220); ind.setColumnWidth(4, 80); ind.setColumnWidth(5, 210);
  ind.setFrozenRows(0);
  ind.setHiddenGridlines(true);
  orgRecortar_(ind, nF + 5, 5);
}
