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

  Logger.log('✅ Triggers instalados:');
  Logger.log('   · syncMain          cada ' + WM_CONFIG.REFRESH_INTERVAL_MIN + ' min  (~78 seg por corrida)');
  Logger.log('   · syncRegularChunk  cada ' + WM_CONFIG.CHUNK_INTERVAL_MIN + ' min  (~340 SKUs por corrida)');
  Logger.log('');
  Logger.log('   Medido en esta cuenta: 0.71 seg por SKU.');
  Logger.log('   Barrido completo de 3,271 SKUs ≈ 10 corridas ≈ 50 minutos.');
  Logger.log('   Después se mantiene solo, reiniciando el ciclo.');
  Logger.log('');
  Logger.log('   Usa verProgreso() para checar el avance.');
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
