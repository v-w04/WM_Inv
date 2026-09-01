# Orden de pegado en Apps Script

Chuleta para copiar estos archivos al editor. Este archivo no se pega.

**Calibrado con el diagnóstico del 31/08/2026 sobre tu cuenta real.**

---

## 1 · Crear los archivos

En https://script.google.com → **Nuevo proyecto** → nombre `WM_Inv Dashboard`
→ borra el `Code.gs` que viene por default.

Luego, por cada uno: **➕** → **Script** → escribe el nombre **sin extensión** → pega.

| # | Nombre a escribir | Archivo local | Qué hace |
|---|---|---|---|
| 1 | `Config` | `Config.gs` | Constantes, SHEET_ID, presupuestos de tiempo |
| 2 | `Auth` | `Auth.gs` | Credenciales, OAuth, password, sesiones |
| 3 | `Api` | `Api.gs` | Cliente HTTP + reintentos + autodetección WFS |
| 4 | `Sync` | `Sync.gs` | Los dos procesos de sincronización |
| 5 | `WebAPI` | `WebAPI.gs` | Endpoint JSON para el frontend |
| 6 | `Triggers` | `Triggers.gs` | Programación automática |
| 7 | `Diagnostics` | `Diagnostics.gs` | Pruebas de endpoints (opcional) |

**Y el manifest**: ⚙️ Configuración del proyecto → activa **"Mostrar el archivo de manifiesto appsscript.json en el editor"** → regresa al editor → borra su contenido y pega el de `appsscript.json`.

---

## 2 · Configurar

### SHEET_ID

En `Config.gs`, línea ~30:

```js
SHEET_ID: 'PON_AQUI_EL_ID_DE_TU_SHEET',
```

De la URL del Sheet:
```
https://docs.google.com/spreadsheets/d/1a2B3c4D5e6F7g8H/edit
                                      └──── esto ────┘
```

### Credenciales y password

En `Auth.gs`, corre estas dos (una vez cada una) y **borra los valores después**:

| Función | Qué editar antes |
|---|---|
| `setupCredentialsInline` | `CLIENT_ID` y `CLIENT_SECRET` de Walmart |
| `setupDashboardPassword` | `PASSWORD` para entrar al dashboard |

---

## 3 · Verificar (en este orden)

| Orden | Función | Qué esperar |
|---|---|---|
| 1 | `testSheetAccess` | `✅ Sheet OK: "nombre"` |
| 2 | `testAuth` | `✅ Token OK: eyJ...` |
| 3 | `syncMain` | `✅ syncMain OK: 3271 SKUs (471 en WFS) en ~90s` |
| 4 | `syncRegularChunk` | `✅ Barrido: ~280 SKUs · 280/3271 (8.6%)` |
| 5 | `instalarTriggers` | Programa los dos procesos |

Después de `syncMain` revisa el Sheet: debe tener las pestañas **Inventario** (3,271 filas) e **Inv_Normal** (3,271 SKUs, cantidades vacías al inicio).

---

## 4 · Deploy

**Implementar → Nueva implementación**:

- Tipo: **Aplicación web**
- Ejecutar como: **Yo**
- Quién tiene acceso: **Cualquier persona** ← la seguridad la da el password
- **Implementar** → copia la URL que termina en `/exec`

Pega esa URL en `docs/config.js`:

```js
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/TU_ID/exec';
```

---

## Cómo funciona la sincronización

Son **dos procesos independientes**:

### `syncMain` — cada 10 min · ~90 segundos

Trae catálogo (3,271 items en 66 páginas) + WFS (471 SKUs en 3 páginas) y reescribe la hoja **Inventario** completa.

### `syncRegularChunk` — cada 5 min · ~4 minutos por corrida

El inventario normal solo se puede consultar **de uno en uno** (`/v3/inventory?sku=X`), y 3,271 llamadas serían ~54 min — muy por encima del límite de 6 minutos de Apps Script.

Por eso barre por partes: cada corrida procesa ~280 SKUs, guarda dónde se quedó, y la siguiente continúa desde ahí. Ciclo completo ≈ **2 horas**, y luego vuelve a empezar solo.

En la tabla, los SKUs aún no barridos muestran `—` en la columna *Inv. Normal*. La barra de progreso arriba muestra el avance.

---

## Funciones útiles

| Función | Para qué |
|---|---|
| `verProgreso` | En qué va el barrido, cuántas corridas faltan |
| `reiniciarBarrido` | Fuerza que empiece de cero |
| `verTriggers` | Lista los triggers activos |
| `quitarTriggers` | Los desinstala todos |
| `resetWfsEndpointMode` | Vuelve a probar el endpoint WFS avanzado |
| `runDiagnostics` | Reporte completo de qué endpoints responden |

---

## Sobre las columnas con 🔒

Tu cuenta responde `401 — "Program Eligibility is not enabled"` en `/v3/wfs/inventory`, el endpoint avanzado. Por eso estas columnas salen vacías:

- Aging (0-90d, 91-180d, 181-270d, 271-365d, 365+d)
- Proyección de ventas (S1-4, S5-8, S9-12)
- Sell-through rate, días de supply, fecha de agotamiento
- Unidades sugeridas y excedente
- Inbound (en tránsito)

El código **ya soporta ese endpoint**. Si algún día Walmart te habilita el programa:

1. Corre `resetWfsEndpointMode`
2. Corre `syncMain`

Las columnas se llenan solas — no hay que tocar código. El badge del header cambia de *"WFS básico"* a *"WFS completo"*.

Si quieres pedir el acceso, en el portal de Walmart busca la sección de **WFS / Program Eligibility**, o escríbele a tu account manager preguntando por el acceso a la *WFS Inventory API (new)*.

---

## Cuando cambies código

⚠️ Guardar en Apps Script **NO** actualiza la URL del web app.

Para que un cambio tome efecto:

**Implementar → Administrar implementaciones → ✏️ → Versión: Nueva versión → Implementar**

Si no haces eso, la URL sigue sirviendo la versión vieja.
