/**
 * ============================================================
 *  Triggers — Auto-refresh cada N min
 * ============================================================
 */

function installAutoRefresh() {
  uninstallAutoRefresh();
  ScriptApp.newTrigger('syncFullInventory')
    .timeBased()
    .everyMinutes(WM_CONFIG.REFRESH_INTERVAL_MIN)
    .create();
  Logger.log('✅ Auto-refresh cada ' + WM_CONFIG.REFRESH_INTERVAL_MIN + ' min instalado.');
}

function uninstallAutoRefresh() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  triggers.forEach(function(t){
    if (t.getHandlerFunction() === 'syncFullInventory') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  Logger.log('Removidos ' + removed + ' triggers previos.');
}
