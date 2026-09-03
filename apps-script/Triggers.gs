/**
 * ============================================================
 *  Triggers — Dos procesos programados
 * ============================================================
 *
 *   syncMain          cada 10 min · catálogo + WFS  (~90 seg)
 *   syncRegularChunk  cada  5 min · barrido inv. normal (~4 min por corrida)
 */

function instalarTriggers() {
  quitarTriggers();

  ScriptApp.newTrigger('syncMain')
    .timeBased()
    .everyMinutes(WM_CONFIG.REFRESH_INTERVAL_MIN)
    .create();

  ScriptApp.newTrigger('syncRegularChunk')
    .timeBased()
    .everyMinutes(WM_CONFIG.CHUNK_INTERVAL_MIN)
    .create();

  const corridasMain  = Math.floor(1440 / WM_CONFIG.REFRESH_INTERVAL_MIN);
  const corridasChunk = Math.floor(1440 / WM_CONFIG.CHUNK_INTERVAL_MIN);
  const costoMain  = corridasMain * 70;
  const costoChunk = corridasChunk * WM_CONFIG.MAX_SKUS_POR_CHUNK;

  Logger.log('✅ Triggers instalados:');
  Logger.log('   · syncMain          cada ' + WM_CONFIG.REFRESH_INTERVAL_MIN + ' min');
  Logger.log('   · syncRegularChunk  cada ' + WM_CONFIG.CHUNK_INTERVAL_MIN + ' min');
  Logger.log('');
  Logger.log('── PRESUPUESTO DIARIO DE LLAMADAS ──');
  Logger.log('   syncMain:   ' + corridasMain + ' corridas × ~70  = ' + costoMain);
  Logger.log('   chunk:      ' + corridasChunk + ' corridas × ' + WM_CONFIG.MAX_SKUS_POR_CHUNK + '  = ' + costoChunk);
  Logger.log('   TOTAL:      ' + (costoMain + costoChunk) +
             ' de ' + WM_CONFIG.DAILY_FETCH_BUDGET + ' presupuestadas');
  Logger.log('   (cuota real de Google: 20,000/día)');
  Logger.log('');
  const cicloHoras = ((3275 / WM_CONFIG.MAX_SKUS_POR_CHUNK) * WM_CONFIG.CHUNK_INTERVAL_MIN / 60).toFixed(1);
  Logger.log('   Ciclo completo de inventario propio ≈ ' + cicloHoras + ' horas.');
  Logger.log('   Más lento que antes, pero sostenible: la versión anterior');
  Logger.log('   gastaba ~82,000 llamadas/día y tumbaba el servicio.');
  Logger.log('');
  Logger.log('   verProgreso() → avance del barrido');
  Logger.log('   verConsumo()  → llamadas usadas hoy');
}

function quitarTriggers() {
  const objetivo = ['syncMain', 'syncRegularChunk', 'syncFullInventory'];
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (objetivo.indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
      n++;
    }
  });
  Logger.log('Removidos ' + n + ' triggers previos.');
}

function verTriggers() {
  const ts = ScriptApp.getProjectTriggers();
  if (!ts.length) { Logger.log('No hay triggers instalados.'); return; }
  Logger.log('── TRIGGERS ACTIVOS ──');
  ts.forEach(function(t){
    Logger.log('  · ' + t.getHandlerFunction() + '  [' + t.getEventType() + ']');
  });
}
