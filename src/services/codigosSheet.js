// Hoja "CodigosContenido" de AppSheet (Google Sheets, CODIGOS_SHEET_ID):
// es la planilla de carga de códigos que se mezcla con el histórico en
// BigQuery. Hasta que la lista de contenidos esté migrada a Supabase,
// PAUTADOR la usa para dos cosas (pedido del usuario, 2026-09-11):
//   1. generar el próximo código siguiendo la secuencia REAL de lo que hay
//      ahí (ver codigoGenerator.js: la hoja manda, el Excel local y
//      cola_pautas se siguen mirando por las dudas);
//   2. insertar una fila por cada pedido creado (mismas 30 columnas que la
//      hoja "Tareas", ver tareasSheet.js), una sola fila por pedido con las
//      plataformas juntas ("Meta, Youtube") como hace AppSheet.
// NUNCA se escriben pedidos de prueba (código TEST…) ni los que vienen de
// la ingesta (origen 'ingesta': esas filas ya las creó AppSheet). Si la
// escritura falla, se reintenta cada 10 min desde una cola en memoria —
// solo lo que falló en esta sesión, nunca un backfill de históricos
// (lección del incidente de Tareas).

const env = require('../config/env');
const { readTable } = require('./dataSource');
const { getActivoPorKey } = require('./configActivos');
const sheets = require('./sheets');
const { armarFila } = require('./tareasSheet');

const CACHE_MS = 60 * 1000;
let cache = { codigos: null, leidoEn: 0 };
const pendientes = new Map(); // correlationId -> último error

function configurada() {
  if (!(env.codigosSheetId && env.credentialsPath)) return false;
  try { sheets.verificarEscrituraPermitida(env.codigosSheetId); } catch (e) { return false; }
  return true;
}

// Todos los códigos de la hoja (columna "Codigo"), cacheados 60 s. Si la
// hoja no se puede leer, devuelve null y el generador sigue con lo local
// (avisa en consola: un código podría chocar con uno cargado en AppSheet
// mientras tanto).
async function leerHoja() {
  if (!configurada()) return null;
  if (cache.codigos && Date.now() - cache.leidoEn < CACHE_MS) return cache;
  try {
    const filas = await sheets.readRange(env.codigosSheetId, env.codigosHoja);
    cache = {
      codigos: filas.map((f) => String(f.Codigo || '').trim()).filter(Boolean),
      // Última fecha con código por Proyecto (para esconder los inactivos).
      ultimaFechaPorProyecto: filas.reduce((acc, f) => {
        const p = String(f.Proyecto || '').trim();
        const d = fechaHojaAIso(f.Fecha);
        if (p && d && (!acc[p] || d > acc[p])) acc[p] = d;
        return acc;
      }, {}),
      // (proyecto, fecha) de cada fila — para contar volumen por período.
      fechasPorProyecto: filas.map((f) => ({ p: String(f.Proyecto || '').trim(), d: fechaHojaAIso(f.Fecha) })).filter((x) => x.p && x.d),
      // Las filas completas (con fecha ISO) — el Historial se arma de acá.
      filas: filas.map((f) => ({ ...f, fechaIso: fechaHojaAIso(f.Fecha) })),
      leidoEn: Date.now(),
    };
    return cache;
  } catch (err) {
    console.warn('[codigos] no pude leer la hoja CodigosContenido — sigo con Excel + cola_pautas:', err.message);
    return null;
  }
}

async function codigosExistentes() {
  const c = await leerHoja();
  return c ? c.codigos : null;
}

// "15/08/2026" o "1/5/2026" (formato de la hoja) -> "2026-08-15".
function fechaHojaAIso(texto) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(texto || '').trim());
  if (!m) return '';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// Proyectos que tienen al menos un código en la hoja con Fecha >= desde
// (ISO). null = no se pudo leer la hoja o no está configurada: no se
// esconde nada. Pedido del usuario (2026-09-11): "ocultá los proyectos sin
// códigos desde el 15 de agosto" — ver GET /api/proyectos.
async function proyectosConCodigosDesde(desdeIso) {
  const c = await leerHoja();
  if (!c) return null;
  return new Set(Object.entries(c.ultimaFechaPorProyecto).filter(([, d]) => d >= desdeIso).map(([p]) => p));
}

// Un código recién generado entra al caché de una: si hay varios pedidos
// seguidos (lote), el siguiente lo ve aunque la fila todavía no se escribió.
function recordarCodigo(codigo) {
  if (cache.codigos && codigo && !cache.codigos.includes(codigo)) cache.codigos.push(codigo);
}

async function escribirFila(correlationId) {
  const pauta = (await readTable('cola_pautas')).find((p) => p.correlation_id === correlationId);
  if (!pauta) return { ok: false, motivo: 'pauta inexistente' };
  if (pauta.origen === 'ingesta') return { ok: true, motivo: 'viene de AppSheet, ya está en la hoja' };
  if (/^TEST/i.test(String(pauta.codigo || ''))) return { ok: true, motivo: 'código de prueba, no se escribe' };

  const [activo, tipos] = await Promise.all([getActivoPorKey(pauta.activo), readTable('equiv_tipo')]);
  const tipo = tipos.find((t) => String(t.codigo) === String(pauta.codigo || '').charAt(6));
  const plataformas = String(pauta.plataforma || 'Meta').split(',').map((p) => p.trim()).filter(Boolean).join(', ');
  const fila = armarFila(pauta, plataformas, activo, tipo);
  // Modificacion: AppSheet guarda la fecha de alta con este formato.
  fila[17] = new Date().toString();
  await sheets.appendRowsTo(env.codigosSheetId, env.codigosHoja, [fila]);
  recordarCodigo(pauta.codigo);
  return { ok: true };
}

// Se llama en segundo plano desde crearPedido — nunca frena el pedido.
async function registrarCodigo(correlationId) {
  if (!configurada()) return { ok: false, motivo: 'no configurada' };
  try {
    const r = await escribirFila(correlationId);
    pendientes.delete(correlationId);
    return r;
  } catch (err) {
    pendientes.set(correlationId, err.message);
    console.warn('[codigos] no pude escribir', correlationId, 'en CodigosContenido (se reintenta):', err.message);
    return { ok: false, motivo: err.message };
  }
}

async function reintentarPendientes() {
  const ids = [...pendientes.keys()];
  let ok = 0;
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const r = await registrarCodigo(id);
    if (r.ok) ok += 1;
  }
  return { reintentadas: ids.length, ok };
}

// Cuántos códigos tiene cada Proyecto con Fecha >= desde (ISO). null si la
// hoja no está. Ordena la pantalla de Proyecto ("por volumen de contenidos
// de los últimos 15 días", pedido del usuario 2026-09-11).
async function volumenPorProyectoDesde(desdeIso) {
  const c = await leerHoja();
  if (!c) return null;
  return c.fechasPorProyecto.reduce((acc, x) => {
    if (x.d >= desdeIso) acc[x.p] = (acc[x.p] || 0) + 1;
    return acc;
  }, {});
}

// Última fecha con código por Proyecto ({proyecto: 'YYYY-MM-DD'}) — null si
// la hoja no está.
async function ultimasFechasPorProyecto() {
  const c = await leerHoja();
  return c ? c.ultimaFechaPorProyecto : null;
}

// Filas de la hoja con Fecha >= desde (ISO), tal cual (30 columnas de
// AppSheet + fechaIso). null si la hoja no está. Es la fuente del Historial
// (pedido del usuario 2026-09-12: "para el historial tomemos el AppSheet").
async function filasDesde(desdeIso) {
  const c = await leerHoja();
  if (!c) return null;
  return c.filas.filter((f) => f.fechaIso && f.fechaIso >= desdeIso);
}

module.exports = { configurada, codigosExistentes, proyectosConCodigosDesde, volumenPorProyectoDesde, ultimasFechasPorProyecto, filasDesde, recordarCodigo, registrarCodigo, reintentarPendientes };
