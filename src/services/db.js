// Misma interfaz que sheetsMock.js/sheets.js (readTable / appendRow /
// updateRow / updateRowWhere), pero contra Supabase (Postgres real, vía
// PostgREST) en vez de un Excel. Se activa con DATA_SOURCE=supabase en
// .env — dataSource.js es el único archivo que importa este, nadie más
// habla con Supabase directo (ver esa nota en dataSource.js).
//
// Usa la service_role key a propósito, no la anon key: este es un backend
// de confianza (no un cliente de browser) que necesita leer/escribir todas
// las tablas sin que Row Level Security se lo bloquee.

const { createClient } = require('@supabase/supabase-js');
const env = require('../config/env');

// Creado recién al primer uso real (no al importar el módulo): dataSource.js
// requiere los tres backends siempre, así que si esto creara el cliente acá
// arriba, DATA_SOURCE=mock/google también explotaría por falta de
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY aunque nunca se use Supabase.
let client = null;
function getClient() {
  if (!client) {
    if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
      throw new Error('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env (DATA_SOURCE=supabase los necesita).');
    }
    client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false } });
  }
  return client;
}

// Mismo orden de columnas que supabase/schema.sql — hace falta acá porque
// varios services todavía llaman appendRow(tabla, arrayPosicional) directo
// (confirmar.js, metaAdapterReal.js/Mock.js) en vez de pasar por
// insertarFila con un objeto con nombres. Si se agrega una columna nueva a
// una tabla, hay que sumarla ACÁ y en schema.sql, en el mismo lugar de la
// lista (el orden es lo único que importa para el positional array).
const COLUMNAS = {
  cola_pautas: [
    'correlation_id', 'estado', 'fecha', 'proyecto', 'codigo', 'activo', 'objetivo', 'audiencia',
    'otras_audiencias', 'formato', 'plataforma', 'material', 'copy', 'campana', 'contenido', 'eje',
    'provincia', 'localidad', 'visibilidad', 'refuerzo_audiencia', 'otras_refuerzo', 'link_destino',
    'placements', 'presupuesto', 'post_id', 'fecha_inicio', 'fecha_fin', 'creador', 'confirmado_por',
    'confirmado_en', 'bulk_id', 'row_id', 'nomenclatura_preview', 'presupuesto_resuelto',
    'audiencia_resuelta', 'plataformas_resueltas', 'optimization_goal', 'modo', 'errores_preview',
    'adset_id', 'creative_id', 'ad_id', 'publicado_en', 'n8n_execution_id', 'error_publicacion',
    'activo_solicitado', 'imagen_preview', 'desestimado_por', 'desestimado_en', 'motivo_desestimacion', 'redes',
    'material_stories', 'comentarios', 'combos_excluidos',
  ],
  config_activos: [
    'proyecto', 'activo', 'activo_key', 'activo_habilitado', 'bm_id', 'ad_account_id', 'page_id',
    'ig_actor_id', 'campaign_id', 'modo_default', 'plataformas_default', 'placements_fb', 'placements_ig',
    'presupuesto_piso', 'presupuesto_techo', 'presupuesto_default', 'duracion_dias',
    'authorization_category', 'credential_key', 'colaborador_email', 'slack_channel',
    'asana_project_gid', 'graph_api_version', 'provincia',
  ],
  equiv_audiencia: ['activo_key', 'codigo_audiencia', 'nombre_display', 'tamaño', 'saved_audience_id'],
  equiv_objetivo: [
    'appsheet_valor', 'meta_optimization_goal', 'meta_campaign_objective', 'meta_billing_event',
    'meta_bid_strategy', 'meta_frequency_max', 'meta_frequency_dias', 'notas',
  ],
  equiv_formato: [
    'appsheet_valor', 'modo', 'aspecto', 'aspecto_label', 'placement', 'requiere_material',
    'requiere_post_id', 'creative_type', 'notas',
  ],
  equiv_tipo: ['codigo', 'tipo_campana', 'ecosistema', 'modo_validacion', 'intensidad', 'monto_fijo', 'notas'],
  equiv_eje: ['codigo', 'eje', 'descripcion'],
  matriz_distribucion: [
    'correlation_id', 'objetivo', 'audiencia_key', 'audiencia_nombre', 'tipo_audiencia', 'porcentaje',
    'monto_resuelto', 'campaign_id', 'adset_id', 'creative_id', 'ad_id', 'estado_celda', 'confirmado_en', 'nomenclatura',
  ],
  campanas_meta: ['activo_key', 'eje', 'objetivo', 'campaign_id', 'creado_en'],
  usuarios: ['id', 'nombre', 'rol', 'proyectos', 'email'],
  escala_presupuestos: ['tamaño', 'intensidad', 'monto'],
};

function columnasDe(tabla) {
  const cols = COLUMNAS[tabla];
  if (!cols) {
    throw new Error(`services/db.js no sabe qué columnas tiene la tabla "${tabla}" — sumala a COLUMNAS.`);
  }
  return cols;
}

// Excel nunca devuelve null (devuelve ''), y el resto del código ya asume
// eso en un montón de lugares (`if (!fila.creative_id)`, etc.) — se
// normaliza acá para que cambiar DATA_SOURCE no cambie ese comportamiento.
function normalizarFila(fila) {
  const out = {};
  Object.keys(fila).forEach((k) => { out[k] = fila[k] === null ? '' : fila[k]; });
  return out;
}

async function readTable(sheetName) {
  const cols = columnasDe(sheetName);
  const { data, error } = await getClient().from(sheetName).select(cols.join(','));
  if (error) throw new Error(`Supabase: no pude leer "${sheetName}": ${error.message}`);
  return (data || []).map(normalizarFila);
}

// '' se manda como null en TODA escritura (insert y update): columnas
// numeric/date/timestamptz de Postgres rechazan '' con un error de tipo
// ("invalid input syntax for type date"), y Excel usa '' como "vacío" en
// todas, así que el resto del código manda '' con total naturalidad (ej.
// fecha_fin: fechaFin || pedido.fecha_fin || '' cuando no hay fecha de fin).
function sanearParaEscritura(obj) {
  const out = {};
  Object.keys(obj).forEach((k) => { out[k] = obj[k] !== undefined && obj[k] !== '' ? obj[k] : null; });
  return out;
}

// rowValues es un array posicional (mismo orden que COLUMNAS[sheetName]).
async function appendRow(sheetName, rowValues) {
  const cols = columnasDe(sheetName);
  const fila = {};
  cols.forEach((col, i) => { fila[col] = rowValues[i]; });
  const { error } = await getClient().from(sheetName).insert(sanearParaEscritura(fila));
  if (error) throw new Error(`Supabase: no pude insertar en "${sheetName}": ${error.message}`);
}

// Igual que appendRow, pero por nombre de columna en vez de posición —
// insertarFila (dataSource.js) la usa cuando existe para no tener que
// ADIVINAR el orden de columnas leyendo una fila ya existente (bug real:
// con la tabla vacía, esa adivinanza usaba el orden de declaración del
// objeto JS pasado por el caller, que no tiene por qué coincidir con
// COLUMNAS[sheetName] — mandaba valores a columnas equivocadas sin avisar,
// salvo que el tipo de dato chocara feo como pasó acá con un timestamptz).
async function insertObjeto(sheetName, campos) {
  const { error } = await getClient().from(sheetName).insert(sanearParaEscritura(campos));
  if (error) throw new Error(`Supabase: no pude insertar en "${sheetName}": ${error.message}`);
}

async function updateRow(sheetName, matchColumn, matchValue, updates) {
  const { error } = await getClient().from(sheetName).update(sanearParaEscritura(updates)).eq(matchColumn, matchValue);
  if (error) {
    throw new Error(`Supabase: no pude actualizar "${sheetName}" (${matchColumn}=${matchValue}): ${error.message}`);
  }
}

// Igual que updateRow pero matcheando por VARIAS columnas — una celda de
// matriz_distribucion no se identifica con una sola (hace falta
// correlation_id + objetivo + audiencia_key).
async function updateRowWhere(sheetName, criterios, updates) {
  let query = getClient().from(sheetName).update(sanearParaEscritura(updates));
  Object.entries(criterios).forEach(([col, val]) => { query = query.eq(col, val); });
  const { error } = await query;
  if (error) {
    const detalle = Object.entries(criterios).map(([c, v]) => `${c}=${v}`).join(', ');
    throw new Error(`Supabase: no pude actualizar "${sheetName}" (${detalle}): ${error.message}`);
  }
}

// COLUMNAS también se exporta para supabase/migrar.js: necesita la misma
// lista para descartar columnas que están en el Excel (ej. la nota
// "DÓNDE ENCONTRAR ESTE DATO" de config_activos) pero no en el esquema real.
module.exports = { readTable, appendRow, insertObjeto, updateRow, updateRowWhere, COLUMNAS };
