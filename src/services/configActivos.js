const { readTable } = require('./dataSource');

// Si la migración 008 (cliente / ecosistema_historico / codigo_proyecto) no
// corrió todavía, pedir esas columnas hace fallar la lectura entera — se
// reintenta sin ellas para no dejar la app caída (aviso una vez).
const COLUMNAS_SIN_008 = [
  'proyecto', 'activo', 'activo_key', 'activo_habilitado', 'bm_id', 'ad_account_id', 'page_id',
  'ig_actor_id', 'campaign_id', 'modo_default', 'plataformas_default', 'placements_fb', 'placements_ig',
  'presupuesto_piso', 'presupuesto_techo', 'presupuesto_default', 'duracion_dias',
  'authorization_category', 'credential_key', 'colaborador_email', 'slack_channel',
  'asana_project_gid', 'graph_api_version', 'provincia',
];
let aviso008 = false;
async function getActivos() {
  try {
    return await readTable('config_activos');
  } catch (err) {
    if (!/cliente|ecosistema_historico|codigo_proyecto/.test(err.message)) throw err;
    if (!aviso008) {
      aviso008 = true;
      console.warn('[configActivos] falta correr supabase/migration_008_cliente_activos.sql — leyendo sin cliente/ecosistema:', err.message);
    }
    return readTable('config_activos', COLUMNAS_SIN_008);
  }
}

async function getActivoPorKey(activoKey) {
  const activos = await getActivos();
  return activos.find((a) => a.activo_key === activoKey) || null;
}

module.exports = { getActivos, getActivoPorKey };
