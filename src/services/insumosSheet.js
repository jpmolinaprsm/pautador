// Volcado de las tablas de configuración de PAUTADOR (Supabase) a la
// planilla "MEDIA - AUTOMATIZACIONES" (INSUMOS_SHEET_ID), una pestaña por
// tabla, como copia de SOLO LECTURA: editar ahí no cambia nada (decisión
// del usuario, 2026-09-15: Supabase es la dueña de estas tablas; la hoja
// "Proyectos" de la misma planilla es la única que va al revés, ver
// proyectosCatalogo.js). Corre una vez por día a INSUMOS_EXPORT_HORA (AR) y
// a pedido (POST /api/admin/insumos/exportar). Nunca toca la hoja Proyectos.
const env = require('../config/env');
const sheets = require('./sheets');
const { readTable } = require('./dataSource');
const { COLUMNAS } = require('./db');

const INDICE = 'Tablas PAUTADOR';

// [tabla, descripción, claves de orden]
const TABLAS = [
  ['config_activos', 'Activos (cuentas/páginas de Meta) por Proyecto. activo_habilitado = se automatiza.', (r) => [r.proyecto, r.activo]],
  ['equiv_audiencia', 'Audiencias automatizables por activo (públicos guardados en Meta o geo provincia). Son las del Pedido Automatizado.', (r) => [r.activo_key, r.nombre_display]],
  ['audiencias_catalogo', 'Catálogo de audiencias por Proyecto × Canal (Excel IDs de Auds x Activos + Audiencias). Las ofrece el Pedido Normal.', (r) => [r.proyecto, r.canal, r.nombre]],
  ['equiv_eje', 'Ejes de comunicación y su código de 2 letras (va en el código de contenido).', (r) => [r.eje]],
  ['equiv_tipo', 'Tipos de campaña (letra del código): ecosistema, intensidad (define presupuesto) y monto fijo si aplica.', (r) => [r.ecosistema, r.codigo]],
  ['equiv_objetivo', 'Objetivos y su traducción a Meta (optimization_goal, objective, billing).', (r) => [r.appsheet_valor]],
  ['equiv_formato', 'Formatos (Imagen/Video/Carrusel) y cómo se arman en Meta.', (r) => [r.appsheet_valor]],
  ['escala_presupuestos', 'Presupuesto por tamaño de audiencia × intensidad del tipo.', (r) => [r.intensidad, r['tamaño']]],
  ['usuarios', 'Usuarios de PAUTADOR: rol, superadmin, habilitado. Los sin mail son de demo.', (r) => [r.rol, r.nombre]],
  ['usuario_accesos', 'Proyectos (y activos) que ve cada PM/implementador. activo_key vacío = todos los activos del proyecto.', (r) => [r.usuario_id, r.proyecto]],
  ['proyectos_estado', 'Prendido/apagado a mano por un admin (Panel Usuarios → Proyectos). Sin fila = automático por actividad.', (r) => [r.proyecto]],
  ['campanas_meta', 'Campañas ya creadas en Meta por activo × eje × objetivo (se reutilizan).', (r) => [r.activo_key, r.eje, r.objetivo]],
  ['eventos_uso', 'Registro de uso: quién hizo qué, cuándo y cómo salió (últimos 90 días).', (r) => [r.fecha], { filtro: (r) => r.fecha >= new Date(Date.now() - 90 * 86400000).toISOString(), desc: true }],
];

const cmp = (a, b) => String(a || '').localeCompare(String(b || ''), 'es');
const ahoraAr = () => new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

function configurado() {
  if (!(env.insumosSheetId && (env.credentialsJson || env.credentialsPath))) return false;
  try { sheets.verificarEscrituraPermitida(env.insumosSheetId); } catch (e) { return false; }
  return true;
}

async function exportarTablas() {
  if (!configurado()) throw new Error('Falta INSUMOS_SHEET_ID (o la Service Account) para volcar las tablas.');
  const resumen = [['Tabla', 'Filas', 'Qué es', 'Actualizado']];
  for (const [tabla, descripcion, clave, opciones = {}] of TABLAS) {
    if (tabla === env.proyectosHoja) continue; // nunca la hoja del catálogo
    let filas;
    try {
      // eslint-disable-next-line no-await-in-loop
      filas = await readTable(tabla);
    } catch (err) {
      resumen.push([tabla, 'ERROR', descripcion, err.message]);
      continue;
    }
    if (opciones.filtro) filas = filas.filter(opciones.filtro);
    const cols = [...COLUMNAS[tabla]];
    filas.forEach((f) => Object.keys(f).forEach((k) => { if (!cols.includes(k)) cols.push(k); }));
    filas.sort((a, b) => { const ka = clave(a); const kb = clave(b); for (let i = 0; i < ka.length; i += 1) { const c = cmp(ka[i], kb[i]); if (c) return opciones.desc ? -c : c; } return 0; });
    const valores = [cols, ...filas.map((f) => cols.map((c) => { const v = f[c]; return v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : v); }))];
    // eslint-disable-next-line no-await-in-loop
    await sheets.replaceSheetTo(env.insumosSheetId, tabla, valores);
    resumen.push([tabla, filas.length, descripcion, ahoraAr()]);
  }
  await sheets.replaceSheetTo(env.insumosSheetId, INDICE, [
    ['Tablas de configuración de PAUTADOR (copia de solo lectura de Supabase)', '', '', ''],
    ['Cada pestaña es una tabla tal cual está en la base. Editar acá NO cambia PAUTADOR: los cambios se hacen desde el producto (Agregar Activos / Audiencias, Panel Usuarios). La hoja "Proyectos" es la excepción: esa la edita el usuario y PAUTADOR la lee.', '', '', ''],
    ['', '', '', ''],
    ...resumen,
  ]);
  return { tablas: resumen.length - 1, actualizado: ahoraAr() };
}

// Una vez por día a INSUMOS_EXPORT_HORA (AR); se chequea cada 10 minutos.
let ultimoDia = '';
function programarExportacionDiaria() {
  if (!configurado()) return;
  console.log(`[insumos] volcado diario de tablas a la planilla a las ${env.insumosExportHora}:00 (AR)`);
  setInterval(async () => {
    const ahoraArDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
    const dia = ahoraArDate.toISOString().slice(0, 10);
    if (ahoraArDate.getHours() < env.insumosExportHora || ultimoDia === dia) return;
    ultimoDia = dia;
    try {
      const r = await exportarTablas();
      console.log(`[insumos] tablas volcadas (${r.tablas})`);
    } catch (err) {
      ultimoDia = '';
      console.warn('[insumos] falló el volcado:', err.message);
    }
  }, 10 * 60 * 1000);
}

module.exports = { configurado, exportarTablas, programarExportacionDiaria, TABLAS };
