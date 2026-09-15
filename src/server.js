const express = require('express');
const path = require('path');
const env = require('./config/env');
const { usuarioActual } = require('./middleware/usuarioActual');
const configRoutes = require('./routes/config');
const pendientesRoutes = require('./routes/pendientes');
const pautaRoutes = require('./routes/pauta');
const itemsRoutes = require('./routes/items');
const publicacionesRoutes = require('./routes/publicaciones');
const pedidosRoutes = require('./routes/pedidos');
const usuariosRoutes = require('./routes/usuarios');
const adminUsuariosRoutes = require('./routes/adminUsuarios');
const authRoutes = require('./routes/auth');
const ingestaRoutes = require('./routes/ingesta');
const { revisarHojas } = require('./services/ingestaSheets');
const { reintentarPendientes } = require('./services/tareasSheet');
const { programarEnvioDiario } = require('./services/alertasPresupuesto');
const codigosSheet = require('./services/codigosSheet');
const storage = require('./services/storage');

const app = express();

app.use(express.json());
// El browser no debería nunca servir un GET /api/* desde su caché HTTP —
// pasó en vivo: una pieza recién corregida seguía mostrando la matriz
// vieja hasta cerrar la pestaña, aunque el server ya devolvía bien.
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
// no-cache (no no-store): el browser revalida app.js/app.css en cada carga
// y toma la versión nueva apenas se deploya — sin esto quedaba JS viejo
// después de un cambio (visto 2026-09-14: canal Oficial seguía habilitado).
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
}));
// Preview de los materiales subidos a mano (ver routes/pedidos.js —
// POST /api/material/subir). Viven al lado de Tablas/, no adentro de
// public/, así que necesitan su propio static — solo sirve para mostrar la
// miniatura en el navegador, Meta nunca los pide por acá (los lee del disco
// directo, ver services/material.js).
// Con CREATIVIDADES_STORAGE=1 los archivos viven en el bucket privado de
// Supabase (preview con URL firmada) y esta carpeta deja de servirse — era
// pública sin auth. Con 0 sigue como siempre.
if (!storage.habilitado()) {
  app.use('/uploads', express.static(path.join(__dirname, '..', '..', 'uploads')));
}
// Webhook de la ingesta (Apps Script): sin usuario, se autentica con
// x-ingesta-secret — por eso va ANTES de usuarioActual y fuera de /api.
app.use(ingestaRoutes.webhook);
app.use('/api', usuarioActual);
// Registro de uso: toda request que cambia algo, con usuario y resultado
// (ver services/eventosUso.js; Panel Usuarios → Uso, solo superadmin).
app.use('/api', require('./services/eventosUso').registrarRequests);
app.use('/api', ingestaRoutes.api);
app.use('/api', configRoutes);
app.use('/api', pendientesRoutes);
app.use('/api', pautaRoutes);
app.use('/api', itemsRoutes);
app.use('/api', publicacionesRoutes);
app.use('/api', pedidosRoutes);
app.use('/api', usuariosRoutes);
app.use('/api', adminUsuariosRoutes);
// Sin prefijo /api a propósito: auth.js mezcla navegaciones de página
// completa (/auth/google...) con endpoints JSON (que ya traen su propio
// /api/auth/... adentro) — ver el comentario al principio de ese archivo.
app.use(authRoutes);

// Red de seguridad: cualquier throw que se escape de una ruta (o un JSON
// mal formado en el body) devuelve JSON con el status que corresponda en
// vez de dejar la request colgada o mandar el HTML de error de Express.
app.use('/api', (req, res) => res.status(404).json({ error: `No existe ${req.method} ${req.originalUrl}` }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[server] error no manejado:', err.stack || err.message);
  res.status(status).json({ error: err.type === 'entity.parse.failed' ? 'El cuerpo del pedido no es JSON válido.' : (err.message || 'Error interno') });
});

app.listen(env.port, () => {
  console.log(`PAUTADOR corriendo en http://localhost:${env.port} (fuente de datos: ${env.dataSource})`);

  // Polling de las hojas salida_manual_* — red de seguridad del webhook.
  // Apagado (0) hasta que haya Service Account con acceso a la planilla.
  if (env.ingestaMinutos > 0) {
    console.log(`[ingesta] revisando las hojas cada ${env.ingestaMinutos} min (estado inicial en Meta: ${env.ingestaEstadoInicial})`);
    setInterval(() => {
      revisarHojas()
        .then((r) => {
          const creadas = Object.values(r).reduce((a, v) => a + (Array.isArray(v) ? v.filter((x) => x.estado === 'creada').length : 0), 0);
          if (creadas) console.log(`[ingesta] ${creadas} pauta(s) nueva(s) creada(s)`);
        })
        .catch((e) => console.warn('[ingesta] falló la revisión:', e.message));
    }, env.ingestaMinutos * 60 * 1000);
  }

  // Resumen diario por mail del presupuesto restante de las cuentas
  // automatizadas (ALERTAS_MAIL_TO + SMTP_*, ver services/alertasPresupuesto.js).
  if (env.metaMode === 'real') programarEnvioDiario();

  // Copia diaria de las tablas de configuración a la planilla de insumos
  // (INSUMOS_SHEET_ID, ver services/insumosSheet.js).
  require('./services/insumosSheet').programarExportacionDiaria();

  // Creatividades vencidas (CREATIVIDADES_DIAS): una pasada al arrancar y
  // después una por día. Meta ya tiene su copia de lo publicado.
  if (storage.habilitado()) {
    const barrer = () => storage.borrarVencidas()
      .then((r) => { if (r.vencidas) console.log(`[creatividades] vencidas ${r.vencidas}, borradas ${r.borradas}`); })
      .catch((e) => console.warn('[creatividades] falló la limpieza:', e.message));
    setTimeout(barrer, 30 * 1000);
    setInterval(barrer, 24 * 60 * 60 * 1000);
  }

  // Réplica a la hoja "Tareas": reintenta cada 10 min lo que quedó sin
  // escribir (sin Service Account no hace nada).
  if (env.tareasSheetId) {
    setInterval(() => {
      reintentarPendientes()
        .then((r) => { if (r.reintentadas) console.log(`[tareas] reintentadas ${r.reintentadas}, ok ${r.ok}`); })
        .catch((e) => console.warn('[tareas] falló el reintento:', e.message));
    }, 10 * 60 * 1000);
  }

  // Hoja "CodigosContenido" de AppSheet: reintenta solo lo que falló en
  // esta sesión (cola en memoria, sin backfill de históricos).
  if (codigosSheet.configurada()) {
    console.log('[codigos] códigos nuevos siguen la hoja CodigosContenido y se insertan ahí');
    setInterval(() => {
      codigosSheet.reintentarPendientes()
        .then((r) => { if (r.reintentadas) console.log(`[codigos] reintentadas ${r.reintentadas}, ok ${r.ok}`); })
        .catch((e) => console.warn('[codigos] falló el reintento:', e.message));
    }, 10 * 60 * 1000);
  }
});
