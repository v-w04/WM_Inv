# Montar el proyecto en otra computadora

Guía para dejar una segunda máquina lista para trabajar en WM_Inv.
Se hace una sola vez por computadora.

---

## Antes de empezar

**Nada del sistema depende de tu computadora.** El Apps Script, los triggers,
el Sheet y el dashboard viven en la nube y siguen corriendo aunque tengas todo
apagado. Esto es solo para poder *editar* el proyecto desde otra máquina.

Vas a necesitar la misma cuenta de Google: `victor.walmart.04@gmail.com`

---

## 1 · Traer el código

**GitHub Desktop** → *File → Clone repository* → pestaña **URL**

```
https://github.com/v-w04/WM_Inv
```

Elige dónde guardarlo (por default va a `Documentos\GitHub\WM_Inv`) → **Clone**

Con eso ya tienes todo: frontend, backend, los `.bat`, y hasta la configuración
de clasp. No hay que copiar nada a mano.

---

## 2 · Instalar Node.js

Solo si no lo tienes: https://nodejs.org → versión **LTS** → siguiente-siguiente.

---

## 3 · Conectar clasp

Doble clic a **`1-INSTALAR-CLASP.bat`**

Instala clasp y abre tu navegador para autorizar. **Usa la misma cuenta de
Google** donde vive el Apps Script — si entras con otra, no va a encontrar el
proyecto.

---

## 4 · Conectar la carpeta en Claude

En la app de Claude de esa computadora: botón **"Add folder"** apuntando a
la carpeta que clonaste.

---

## 5 · Verificar

Doble clic a **`3-VERIFICAR.bat`**. Debe mostrar:

```
[1] Node.js        v22.x.x  (o la que sea)
[2] clasp          3.x.x
[3] Sesion         iniciada
[4] .clasp.json    con el scriptId
[5] apps-script    los 8 archivos
```

Si algo dice "NO instalado", repite el paso correspondiente.

---

## Lo que NO hay que volver a configurar

Estas cosas viven en Google, no en archivos. Ya están configuradas y la
segunda computadora las hereda solas:

- Credenciales de Walmart
- Contraseña del dashboard
- ID del Sheet
- Los triggers
- El deployment del web app

---

## El ritmo de trabajo con dos computadoras

```
Al llegar a cualquier compu  →  0-ACTUALIZAR.bat
Trabajas normal              →  Claude edita los archivos
Al terminar                  →  5-SUBIR-TODO.bat
```

**Bajar al empezar, subir al terminar.** Si respetas eso, las dos máquinas se
sienten como una sola.

Si se te olvida y editas en las dos sin sincronizar, git marca un conflicto.
No se pierde nada, pero hay que resolverlo — GitHub Desktop lo hace más fácil
que la terminal.

---

## Los .bat, en orden de uso

| Archivo | Cuándo |
|---|---|
| `0-ACTUALIZAR.bat` | Al llegar a una compu |
| `5-SUBIR-TODO.bat` | Al terminar (sube a Apps Script y GitHub) |
| `3-VERIFICAR.bat` | Si algo se rompe |
| `1-INSTALAR-CLASP.bat` | Solo la primera vez |
| `2-SUBIR-A-APPSCRIPT.bat` | Si solo cambiaste backend |
| `4-SUBIR-A-GITHUB.bat` | Si solo cambiaste frontend |

---

## Recordatorio

Subir código con clasp **no** actualiza la URL del dashboard. Para eso hay que
publicar versión:

**Implementar → Administrar implementaciones → ✏️ → Versión: Nueva versión**

Solo aplica cuando cambias `apps-script/`. Si tocas `docs/`, GitHub Pages se
actualiza solo en 1-2 minutos.
