# WM_Inv — Walmart WFS Dashboard (Electronics MX)

Dashboard en tiempo real del inventario Walmart WFS.

- **Frontend**: GitHub Pages → https://v-w04.github.io/WM_Inv/
- **Backend**: Google Apps Script (llama a la API de Walmart, guarda credenciales cifradas)
- **Auth**: password del dashboard + session token (12h)

## Estructura

```
WM_Inv/
├── docs/                     ← GitHub Pages sirve esta carpeta
│   ├── index.html            ← Login screen + tabla
│   ├── app.js                ← Frontend logic (fetch a Apps Script, filtros, exports)
│   ├── style.css             ← Estilos
│   └── config.js             ← APPS_SCRIPT_URL (editar después del deploy)
├── apps-script/              ← Código para pegar en Apps Script (NO se publica en Pages)
│   ├── Config.gs
│   ├── Auth.gs               ← Credenciales Walmart + password + sesiones
│   ├── Api.gs                ← Cliente HTTP de Walmart API
│   ├── Sync.gs               ← Orquestador (fetch → normaliza → cache)
│   ├── Triggers.gs           ← Auto-refresh cada 10 min
│   ├── WebAPI.gs             ← Endpoint JSON (doGet/doPost)
│   └── appsscript.json
├── .gitignore
└── README.md
```

## Setup — orden exacto

### PASO 1 · Backend en Apps Script

1. https://script.google.com → **Nuevo proyecto** → nombre: `WM_Inv Dashboard`
2. Borra el `Code.gs` que viene por default.
3. Por cada archivo `.gs` de la carpeta `apps-script/`:
   - ➕ → **Script** → nombre exacto sin extensión (`Config`, `Auth`, `Api`, `Sync`, `Triggers`, `WebAPI`) → pega el contenido
4. `appsscript.json`: ⚙️ Configuración del proyecto → activa **"Mostrar el archivo de manifiesto appsscript.json en el editor"** → regresa al editor → pega el contenido
5. Abre `Auth.gs` y corre estas dos funciones (una vez cada una):
   - **`setupCredentialsInline`**: edita las 2 líneas con tu ClientId/ClientSecret nuevos → Ejecutar → **borra los valores** después
   - **`setupDashboardPassword`**: edita `PASSWORD` con la que quieras para entrar al dashboard → Ejecutar → **borra el valor** después
6. Ejecuta **`testAuth`** → debe imprimir `✅ Token OK`
7. Ejecuta **`syncFullInventory`** → tarda 1-3 min, trae todo el inventario WFS
8. Ejecuta **`installAutoRefresh`** → instala trigger cada 10 min
9. **Implementar → Nueva implementación**:
   - Tipo: **Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona** ← la seguridad la da el password, no el ACL
   - **Implementar**
10. **Copia la URL** (termina en `/exec`)

### PASO 2 · Pegar la URL en el frontend

Abre `docs/config.js` y reemplaza el placeholder:

```js
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/TU_ID_REAL/exec';
```

Guarda el archivo.

### PASO 3 · Subir a GitHub (GitHub Desktop)

1. Abre **GitHub Desktop**
2. Selecciona el repo **WM_Inv** (ya debe aparecer en tu lista)
3. Verás todos los archivos nuevos como cambios pendientes
4. Abajo escribe el mensaje: `Walmart WFS Dashboard v1`
5. **Commit to main** → luego **Push origin**

### PASO 4 · Activar GitHub Pages

1. Ve a https://github.com/v-w04/WM_Inv/settings/pages
2. **Source**: Deploy from a branch
3. **Branch**: `main` · **Folder**: `/docs` → **Save**
4. Espera 1-2 min

Tu dashboard queda en: **https://v-w04.github.io/WM_Inv/**

### PASO 5 · Probar

- Abre la URL
- Entra con el password del paso 1.5
- Debes ver la tabla con tus SKUs

## Seguridad

| Qué | Dónde vive | Visible en GitHub? |
|---|---|---|
| Credenciales Walmart | `PropertiesService` (cifrado) | ❌ Nunca |
| Password del dashboard | Hash SHA-256 en `PropertiesService` | ❌ Nunca |
| Session token | `CacheService`, 12h de vida | ❌ Nunca |
| URL del Apps Script | `docs/config.js` | ✅ Sí, pero sin password no da datos |

El repo puede ser público sin riesgo: no hay secretos en el código.

**Si sospechas acceso indebido**: cambia el password (corre `setupDashboardPassword` de nuevo) y re-deploya el Apps Script. Eso invalida todas las sesiones activas.

## Ciclo de trabajo

| Cambias… | Qué haces |
|---|---|
| **Frontend** (`docs/`) | Editas local → GitHub Desktop commit + push → Pages se actualiza en ~1 min |
| **Backend** (`apps-script/`) | Editas local → copy-paste al editor Apps Script → **Implementar → Administrar implementaciones → ✏️ → Nueva versión** |

⚠️ Importante: en Apps Script, si solo guardas el código pero NO creas una nueva versión del deployment, la URL sigue sirviendo la versión vieja.

## Endpoints de Walmart usados

| Recurso | Endpoint |
|---|---|
| Auth (OAuth 2.0) | `POST /v3/token` |
| WFS Inventory | `GET /v3/wfs/inventory` |
| Catalog Items | `GET /v3/items` |
| Prices | `GET /v3/price` |
| Orders | `GET /v3/orders` |

Base URL: `https://marketplace.walmartapis.com` · Mercado: `mx` · Version: `3.1`

Doc completa de campos en el proyecto Claude: `claude/walmart-api-reference.md`
