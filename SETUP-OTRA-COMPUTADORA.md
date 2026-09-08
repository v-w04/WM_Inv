# Montar el proyecto en otra computadora

Guía para dejar una segunda máquina lista para trabajar en WM_Inv.
Se hace una sola vez por computadora.

---

## ⚠️ Antes de irte de la computadora actual

**Corre `5-SUBIR-TODO.bat`.**

Lo que no esté subido a GitHub no existe para la otra máquina. Este es el
único paso que se puede olvidar y sí duele.

---

## Antes de empezar

**Nada del sistema depende de tu computadora.** El Apps Script, los triggers,
el Sheet y el dashboard viven en la nube y siguen corriendo aunque tengas todo
apagado. Esto es solo para poder *editar* el proyecto desde otra máquina.

### Las dos cuentas de Google, que hacen cosas distintas

Esto confunde. Son roles separados:

| Cuenta | Para qué |
|---|---|
| `victor.walmart.04` | **Dueña del código.** Es la del `clasp login`, la que abre el editor de Apps Script y la que sube cambios. |
| Soporte inventario | **Dueña de los triggers.** Ahí corre la sincronización y ahí se gasta la cuota diaria de 20,000 llamadas. |

En la computadora nueva solo importa la primera: `clasp` va con
`victor.walmart.04`. Los triggers ya están instalados en la nube bajo la
cuenta de soporte y no hay que volver a tocarlos.

---

## 1 · Traer el código

**GitHub Desktop** → *File → Clone repository* → pestaña **URL**

```
https://github.com/v-w04/WM_Inv
```

Elige dónde guardarlo (por default va a `Documentos\GitHub\WM_Inv`) → **Clone**

Con eso ya tienes todo: frontend, backend, los `.bat`, y hasta la configuración
de clasp (`.clasp.json` está versionado — solo trae el ID del script, no es un
secreto). No hay que copiar nada a mano.

---

## 2 · Instalar Node.js

Solo si no lo tienes: https://nodejs.org → versión **LTS** → siguiente-siguiente.

---

## 3 · Conectar clasp

Doble clic a **`1-INSTALAR-CLASP.bat`**

Instala clasp y abre tu navegador para autorizar. **Entra con
`victor.walmart.04`** — si entras con otra, clasp no encuentra el proyecto.

Esto crea `%USERPROFILE%\.clasprc.json`, que es un token de acceso a tu cuenta.
**Ese archivo nunca va a GitHub.** Por eso hay que hacer el login en cada
computadora: no se copia, se genera.

---

## 4 · Enlazar la computadora en Claude

En la app de escritorio de Claude, en esa computadora:

- Si abres una tarea existente: botón **"Link to this computer"**
- Si no aparece esa opción: empieza una tarea nueva desde la app de escritorio
  con esa computadora seleccionada

Luego conecta la carpeta `Documentos\GitHub\WM_Inv` para que yo pueda editar
los archivos directo.

**Lo que sí me sigue:** el proyecto Control EM (toda la documentación de
Walmart, cuotas, arquitectura) y lo que tengo guardado de cómo trabajas. Eso
vive en tu cuenta, no en la computadora. Llego sabiendo el contexto.

**Lo que no me sigue:** los archivos temporales de la sesión anterior. Por eso
el código tiene que estar en GitHub, no solo en mi espacio de trabajo.

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

- Credenciales de Walmart (Script Properties)
- Contraseña del dashboard (Script Properties)
- ID del Sheet
- Los triggers (instalados bajo la cuenta de soporte)
- El deployment del web app
- El contador de llamadas (va por cuenta de Google, no por máquina)

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

### Si te olvidaste de subir y ya estás en la otra compu

No hay forma de traer esos cambios por la red: viven en el disco de la primera
máquina. Opciones, en orden:

1. Prender la primera compu y correr `5-SUBIR-TODO.bat` ahí.
2. Si el cambio era chico, rehacerlo en la segunda. Cuando prendas la primera,
   `0-ACTUALIZAR.bat` te va a avisar del conflicto y ahí te quedas con la
   versión nueva.

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

Los tres que usan git (`0`, `4`, `5`) limpian solos el `.git\index.lock` que
queda colgado cuando un git anterior se murió a media operación. Si alguna vez
viste *"Another git process seems to be running"*, era eso.

---

## Recordatorio

Subir código con clasp **no** actualiza la URL del dashboard. Para eso hay que
publicar versión:

**Implementar → Administrar implementaciones → ✏️ → Versión: Nueva versión**

Solo aplica cuando cambias `apps-script/`. Si tocas `docs/`, GitHub Pages se
actualiza solo en 1-2 minutos.
