# Finanzas Matrimonio 💸

App web instalable (PWA) para registrar gastos y ahorros en pareja, en MXN.
**Gratis**, en la nube, abre al instante, funciona sin conexión y se sincroniza en tiempo real entre los dos celulares.

## ¿Por qué no Streamlit + Sheets?

| Problema actual | Causa | Cómo lo resuelve esta app |
|---|---|---|
| Se reinicia cada vez que entras | Streamlit Cloud “duerme” la app y re-ejecuta todo el script en cada clic | Es una página estática instalada en el celular; no hay servidor que despertar |
| Tarda en cargar | Cada lectura va a Google Sheets por la API | Firestore guarda una copia local: los datos aparecen al instante y se sincronizan después |
| Poco intuitiva | Streamlit está pensado para dashboards, no para apps móviles | Interfaz móvil con botón ＋, hojas deslizables, navegación abajo y botón “atrás” del celular |
| Riesgo de sobrescribir datos | Edición por índice de fila | Cada movimiento es un documento con ID `TRX-XXXXXX`; editar nunca revive un registro borrado, y las reglas rechazan datos vacíos |

## Qué incluye

- **Inicio**: vista mensual o semanal, con presupuesto contra gasto real (saldo a favor o déficit a reponer), meta de ahorro contra ahorro real y progreso por categoría. Toca una categoría para ver sus movimientos.
- **Historial**: filtros por año, mes y categorías, búsqueda, movimientos agrupados por día con subtotales. Toca un movimiento para editarlo o borrarlo.
- **Gráficas**: balance anual separado entre gastos y ahorros, evolución mensual, distribución por categoría y tabla mes a mes.
- **Ajustes**: categorías con meta mensual y semanal (si no pones semanal se calcula sola), importación desde Sheets por CSV y exportación a CSV.
- Regla de siempre: cualquier categoría que contenga **“ahorro”** cuenta como ahorro.

---

## Puesta en marcha (unos 20 minutos, una sola vez)

### 1. Prueba primero el modo demo (opcional)
Si abres la app sin configurar Firebase, corre en **modo demo** con datos de ejemplo guardados solo en ese navegador. Sirve para ver cómo funciona.

### 2. Crea el proyecto en Firebase (gratis, sin tarjeta)
1. Entra a <https://console.firebase.google.com> y crea un proyecto (puedes desactivar Analytics).
2. **Authentication** › Comenzar › **Google** › Habilitar › Guardar.
3. **Firestore Database** › Crear base de datos › modo **producción** › región `nam5` (EE. UU.) o `eur3` (Europa) › Crear.
4. En Firestore › pestaña **Reglas**, pega el contenido de `firestore.rules` **con sus dos correos** y presiona Publicar.
5. ⚙️ **Configuración del proyecto** › Tus apps › icono **Web `</>`** › registra la app › copia el objeto `firebaseConfig`.

### 3. Configura la app
Abre `js/config.js` y:
- pega los valores de `firebaseConfig` en `FIREBASE_CONFIG`,
- pon sus dos correos de Google en `ALLOWED_EMAILS` (los mismos que pusiste en las reglas).

> La `apiKey` de Firebase **no es secreta**: identifica el proyecto. Lo que protege sus datos son las reglas de Firestore con sus correos.

### 4. Publícala (elige una opción)

**Opción A: Firebase Hosting (recomendada, el login con Google funciona mejor).** Necesitas una computadora con Node.js:
```bash
npm install -g firebase-tools
firebase login
cd finanzas-pareja
firebase use --add          # elige tu proyecto
firebase deploy             # sube la app y las reglas
```
Te dará una URL como `https://tu-proyecto.web.app`.

**Opción B: GitHub Pages (sin instalar nada).**
1. Crea un repositorio en GitHub y sube todos los archivos (Add file › Upload files).
2. Settings › Pages › Source: *Deploy from a branch* › `main` / `root` › Save.
3. En Firebase › Authentication › **Configuración › Dominios autorizados**, agrega `tu-usuario.github.io`.

### 5. Instálala en los dos celulares
Abre la URL y entra con Google.
- **Android (Chrome):** menú ⋮ › *Agregar a la pantalla principal* / *Instalar app*.
- **iPhone (Safari):** botón Compartir › *Agregar a inicio*.

La sesión se queda abierta; no tienen que volver a entrar cada vez.

### 6. Pasa sus datos de Google Sheets
1. En la hoja “Finanzas Matrimonio”, abre la pestaña **Configuracion** › Archivo › Descargar › **CSV**. En la app: Ajustes › *Importar categorías y metas*.
2. Haz lo mismo con la pestaña de transacciones (`sheet1`) › Ajustes › *Importar movimientos*.

La app entiende fechas tipo `14/03/2025` o `2025-03-14` y montos tipo `$1,234.50`. Si importas dos veces el mismo archivo, no se duplican los movimientos, porque se respetan sus IDs `TRX-…`.

---

## Límites gratuitos (plan Spark)
Firestore da 50,000 lecturas y 20,000 escrituras **al día**, más 1 GB de almacenamiento. Para dos personas es muchísimo: la app solo escucha el año que estás viendo y usa la caché local.

## Estructura
```
index.html               estructura de la app
css/styles.css           diseño (modo claro y oscuro automático)
js/config.js             ← lo único que editas
js/app.js                pantallas, formularios y lógica de balances
js/store.js              datos: Firebase (real) o localStorage (demo)
js/utils.js              formato MXN, fechas, CSV, validación
js/vendor/chart.umd.min.js  gráficas (Chart.js, incluido)
sw.js, manifest.webmanifest, icons/   para instalarla y que abra sin conexión
firestore.rules          seguridad: solo ustedes dos, sin datos vacíos
firebase.json            configuración para `firebase deploy`
```

## Actualizar la app
Si cambias archivos, sube el número de versión en `sw.js` (`finanzas-v1` → `finanzas-v2`) y vuelve a publicar. Los celulares tomarán la versión nueva la siguiente vez que abran la app.
