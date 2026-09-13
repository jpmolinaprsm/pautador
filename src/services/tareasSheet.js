// Réplica de cada pedido a la hoja "Tareas" (Google Sheets) — reemplazo del
// script de AppSheet (onChange en CodigosContenido + replicarATareas en
// BulkCarga.gs): Make lee esa hoja y crea las tareas de Asana. Si PAUTADOR
// no escribe ahí, Asana deja de recibir tareas. Una fila por Plataforma,
// con EXACTAMENTE las 30 columnas de CodigosContenido (confirmadas contra
// la hoja real con diagHeaders() el 2026-09-11).
//
// Nunca frena un pedido: se llama en segundo plano desde crearPedido; si la
// hoja falla (sin Service Account, sin permiso, caída), queda
// tareas_replicado=false + tareas_error y reintentarPendientes() (job
// periódico en server.js) lo vuelve a intentar.

const env = require('../config/env');
const { readTable, updateRow } = require('./dataSource');
const { getActivoPorKey } = require('./configActivos');
const sheets = require('./sheets');

// Orden EXACTO de columnas de la hoja "Tareas" (= CodigosContenido).
const HEADERS = ['Fecha', 'Proyecto', 'Codigo', 'Tipo', 'Activo', 'Eje', 'Campana',
  'Contenido', 'Gobernador', 'Departamento', 'Audiencia', 'Formato', 'Ministerio',
  'Plataforma', 'Visibilidad', 'Comentarios', 'Creador', 'Modificacion', 'Provincia',
  'Localidad', 'Linea', 'BulkID_ref', 'Row_ID', 'Objetivo', 'Categoría Pieza', 'Material', 'Copy',
  'Otras Audiencias', 'Refuerzo de Audiencia', 'Otras Refuerzo'];

function configurada() {
  if (!(env.tareasSheetId && env.credentialsPath)) return false;
  // Doble freno: si el .env apunta a la planilla de producción prohibida,
  // se comporta como "no configurada" (ver PLANILLAS_PROHIBIDAS en sheets.js).
  try { sheets.verificarEscrituraPermitida(env.tareasSheetId); } catch (e) { return false; }
  return true;
}

// "2026-09-11" -> "11/09/2026" (AppSheet guarda la fecha así en la hoja).
function fechaHoja(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}

function armarFila(pauta, plataforma, activo, tipo) {
  const valores = {
    Fecha: fechaHoja(pauta.fecha),
    Proyecto: pauta.proyecto || '',
    Codigo: pauta.codigo || '',
    Tipo: tipo ? tipo.tipo_campana : '',
    Activo: activo ? (activo.activo || activo.activo_key) : (pauta.activo || ''),
    Eje: pauta.eje || '',
    Campana: pauta.campana || '',
    Contenido: pauta.contenido || '',
    Gobernador: pauta.gobernador || '',
    Departamento: '',
    Audiencia: pauta.audiencia || '',
    Formato: pauta.formato || '',
    Ministerio: '',
    Plataforma: plataforma,
    Visibilidad: pauta.visibilidad === 'PUBLICO' ? 'Público' : 'Oculto / Dark',
    Comentarios: pauta.comentarios || '',
    Creador: pauta.creador || '',
    Modificacion: '',
    Provincia: pauta.provincia || '',
    Localidad: pauta.localidad || '',
    Linea: '',
    BulkID_ref: pauta.bulk_id || '',
    Row_ID: pauta.correlation_id || '',
    Objetivo: pauta.objetivo || '',
    'Categoría Pieza': pauta.categoria_pieza || '',
    Material: pauta.material || '',
    Copy: pauta.copy || '',
    'Otras Audiencias': pauta.otras_audiencias || '',
    'Refuerzo de Audiencia': pauta.refuerzo_audiencia || '',
    'Otras Refuerzo': pauta.otras_refuerzo || '',
  };
  return HEADERS.map((h) => (valores[h] !== undefined && valores[h] !== null ? valores[h] : ''));
}

async function marcar(correlationId, ok, error) {
  try {
    await updateRow('cola_pautas', 'correlation_id', correlationId, {
      tareas_replicado: ok,
      tareas_error: ok ? '' : String(error || '').slice(0, 500),
    });
  } catch (e) {
    // Columnas de migration_005 todavía no corridas: no hay dónde anotarlo,
    // se deja en el log y listo.
    console.warn('[tareas] no pude marcar', correlationId, e.message);
  }
}

// Escribe una fila por plataforma del pedido. Idempotente por dato: si ya
// está tareas_replicado=true no vuelve a escribir (Make crearía otra tarea).
async function replicarATareas(correlationId) {
  if (!configurada()) {
    await marcar(correlationId, false, 'Hoja Tareas no configurada (TAREAS_SHEET_ID / Service Account).');
    return { ok: false, motivo: 'no configurada' };
  }
  const pauta = (await readTable('cola_pautas')).find((p) => p.correlation_id === correlationId);
  if (!pauta) return { ok: false, motivo: 'pauta inexistente' };
  if (pauta.tareas_replicado === true) return { ok: true, motivo: 'ya replicada' };

  const [activo, tipos] = await Promise.all([getActivoPorKey(pauta.activo), readTable('equiv_tipo')]);
  // El Tipo va codificado en la 7ª posición del código (prefijo 6 + tipo 1).
  const tipoChar = String(pauta.codigo || '').charAt(6);
  const tipo = tipos.find((t) => String(t.codigo) === tipoChar);
  const plataformas = String(pauta.plataforma || 'Meta').split(',').map((p) => p.trim()).filter(Boolean);
  const filas = plataformas.map((p) => armarFila(pauta, p, activo, tipo));

  try {
    await sheets.appendRowsTo(env.tareasSheetId, env.tareasHoja, filas);
    await marcar(correlationId, true);
    return { ok: true, filas: filas.length };
  } catch (err) {
    await marcar(correlationId, false, err.message);
    return { ok: false, motivo: err.message };
  }
}

// Job periódico: SOLO lo que ya intentó replicarse y falló (tareas_error
// cargado). Las filas históricas anteriores a esta función tienen
// tareas_replicado=false por default pero tareas_error vacío — esas NO se
// tocan. (Lección 2026-09-11: la primera versión tomaba todo lo no
// replicado y mandó 61 pautas de prueba viejas a la hoja de producción,
// hubo que borrarlas a mano.)
async function reintentarPendientes() {
  if (!configurada()) return { reintentadas: 0 };
  const pendientes = (await readTable('cola_pautas'))
    .filter((p) => p.correlation_id && p.tareas_replicado !== true && p.tareas_error && p.estado && p.estado !== 'pendiente');
  let ok = 0;
  for (const p of pendientes) {
    // eslint-disable-next-line no-await-in-loop
    const r = await replicarATareas(p.correlation_id);
    if (r.ok) ok += 1;
  }
  return { reintentadas: pendientes.length, ok };
}

module.exports = { replicarATareas, reintentarPendientes, HEADERS, armarFila };
