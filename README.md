# PAUTADOR — esqueleto (Tipo 0, MVP)

## Modo mock (por defecto) — sin Google Cloud

Con `DATA_SOURCE=mock` (ya viene así en `.env.example`), PAUTADOR lee directo de los Excel que están en `Tablas/` al lado de esta carpeta — nada de Google Cloud, nada de credenciales. Ideal para probar la UI ahora mismo.

```bash
cp .env.example .env
npm install
npm start
```

Abrí `http://localhost:3000`. La app tiene 4 pestañas (cuáles ves depende del
rol que elijas arriba a la derecha — ver `usuarios` en el Excel):

- **Pedido de Pauta** (PM/Cuentas) — carga individual o "Pedir múltiples anuncios".
- **Validación de Anuncios** (Implementador/Admin; PM lo ve de solo lectura) — la
  cola de pendientes + el reparto de presupuesto por objetivo × audiencia.
- **Crear Anuncios** (Implementador/Admin) — pautar algo sin pedido previo.
  Publica directo; el reparto por objetivo × audiencia se define en el preview.
- **Agregar Activos / Audiencias** (Admin) — alta de filas en `config_activos`
  y `equiv_audiencia` sin tocar el Excel a mano. El activo se carga sobre un
  proyecto existente (crear proyectos nuevos no está en el borrador).

Cargar una pieza son **dos pasos**: *Ver preview* (el servidor abre el material
y dice si sirve — imagen o video, tipo y peso) y después *Confirmar*. Un link
de Drive roto o privado se corta en el primer paso, con el motivo concreto.
Desde *Validación de Anuncios* también se puede **desestimar** un pedido con un
motivo escrito: no crea nada en Meta y queda en el Historial con el motivo.

**Cómo editar los datos de prueba:** directamente en los Excel de `Tablas/` (agregar filas a `cola_pautas`, `config_activos`, `equiv_audiencia`). Guardá el archivo y refrescá el navegador — el modo mock relee el Excel en cada request, no hace falta reiniciar el servidor.

> ⚠️ **"Confirmar" publica de verdad.** Con `META_MODE=real` (lo que está hoy en
> `.env`) el botón Confirmar crea campaña, conjunto de anuncios, creative y
> anuncio **en la cuenta publicitaria real** — siempre en PAUSED, nunca activa
> nada, pero los objetos quedan creados. Con `META_MODE=mock` solo genera IDs
> falsos con prefijo `MOCK-` y no toca Meta.

Para el detalle del producto, el flujo recomendado y qué falta para operar,
ver **`../PAUTADOR-producto.md`**.

## Pasar a datos reales (Google Sheets)

Cuando quieras conectar la Google Sheet de verdad en vez de los Excel locales, cambiá una sola línea en `.env`:

```
DATA_SOURCE=google
```

Y completá el resto de las variables de `.env` según los pasos de abajo — el resto del código (rutas, frontend) no cambia nada, todos hablan contra `src/services/dataSource.js`, que elige automáticamente entre Excel local y Sheets real según esta variable.

### 1. Preparar el Google Sheet

Subí `operaciones-pauta-meta.xlsx` a Google Sheets (Archivo → Importar, o abrilo con Google Sheets y guardalo como Sheet). Tiene que tener pestañas con los mismos nombres que usa el modo mock: `config_activos`, `equiv_objetivo`, `equiv_formato`, `equiv_plataforma`, `cola_pautas`, `registro`, y además `equiv_audiencia` y `escala_presupuestos` (de los otros dos Excel en `Tablas/`).

Copiá el ID de la hoja desde la URL:
```
https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit
```

### 2. Crear la cuenta de servicio de Google Cloud

1. Entrá a [Google Cloud Console](https://console.cloud.google.com/) y creá un proyecto (o usá uno existente).
2. Habilitá la **Google Sheets API** (Biblioteca de APIs → buscar "Google Sheets API" → Habilitar).
3. Andá a **IAM y administración → Cuentas de servicio → Crear cuenta de servicio**. Nombre sugerido: `pautador-sheets`.
4. Una vez creada, entrá a la cuenta → pestaña **Claves** → **Agregar clave → Crear clave nueva → JSON**. Se descarga un archivo.
5. Renombrá ese archivo a `service-account.json` y ponelo en la carpeta `credentials/` de este proyecto (ya está en `.gitignore`, no se sube a ningún repo).

### 3. Compartir el Sheet con la cuenta de servicio

Abrí `service-account.json` y copiá el valor de `client_email`. En tu Google Sheet, **Compartir** → agregá ese email con permiso de **Editor**.

### 4. Variables de entorno

En `.env`: `DATA_SOURCE=google`, `GOOGLE_SHEET_ID` (el ID del paso 1), `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` (dejalo como está si guardaste el JSON en `credentials/service-account.json`).

### 5. Reiniciar

```bash
npm start
```

## Estructura

```
src/
  server.js                 → arranca Express
  config/env.js             → variables de entorno (DATA_SOURCE, META_MODE, token)
  middleware/usuarioActual.js → resuelve el usuario "actuando como" + requireRol()

  services/dataSource.js    → elige entre sheets.js (Google) y sheetsMock.js (Excel)
  services/sheets.js        → lee/escribe Google Sheets real (sin probar)
  services/sheetsMock.js    → lee y escribe los Excel de Tablas/
  services/configActivos.js · audiencias.js · usuarios.js → tablas de configuración
  services/colaPautas.js    → arma la matriz objetivo × audiencia de cada pauta
  services/colaPautasWriter.js → inserta filas nuevas en cola_pautas
  services/codigoGenerator.js  → próximo código siguiendo la secuencia de AppSheet
  services/pedidos.js       → "Pedido de Pauta" y "Crear Anuncios" (mismo motor)
  services/publicarExistente.js · crearAnuncioDark.js → terminan de armar la pieza
  services/confirmar.js     → el "da OK": crea en Meta y registra matriz_distribucion
  services/items.js         → shape completo para la pantalla de Validación
  services/metaAdapter.js   → elige mock vs real según META_MODE
  services/metaAdapterReal.js · metaAdapterMock.js → creación de campaña/adset/ad
  services/metaApi.js       → cliente HTTP de la Graph API
  services/material.js      → resuelve y VERIFICA el material (Drive, tipo, peso)
  services/metaMedia.js     → sube el material (imagen o video) a Meta
  services/metaContent.js   → lista publicaciones existentes de FB/IG
  services/metaLimites.js   → mínimo de presupuesto real de la cuenta

  routes/items.js           → GET /api/items (Validación de Anuncios)
  routes/pauta.js           → POST /api/pauta/:id/confirmar · /marcar-manual ·
                              /presupuesto · /celda-hecha · /desestimar
  routes/pedidos.js         → POST /api/pedidos · /api/anuncios/crear-directo ·
                              /api/material/verificar
  routes/publicaciones.js   → proyectos, activos, ejes, tipos, formatos, objetivos,
                              audiencias (GET y POST), campañas, publicaciones, código
  routes/usuarios.js        → GET /api/usuarios (selector "actuando como")
  routes/pendientes.js · config.js → rutas viejas, ya no las usa el front
public/
  index.html                → las 4 pestañas
  css/nocturne.css, css/prosumia.css, css/app.css → sistema de diseño Nocturne
  js/app.js                 → toda la lógica de la UI, sin framework
```

Ningún service ni route habla con Google Sheets o con Excel directamente — todos pasan por `dataSource.js`. Cambiar la fuente de datos es una variable de entorno, no un cambio de código.
