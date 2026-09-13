// Qué proyectos se ofrecen para elegir (pantalla de Proyecto) y por qué.
// Regla del usuario (2026-09-12): un proyecto sin pedidos (códigos en la
// hoja CodigosContenido) en el último mes y medio no aparece, salvo que un
// administrador lo active; y un administrador puede desactivar cualquiera.
// La decisión manual vive en `proyectos_estado` (migración 011): sin fila =
// automático (manda la actividad).

const env = require('../config/env');
const { readTable, insertarFila, updateRow } = require('./dataSource');
const { getActivos } = require('./configActivos');
const { ultimasFechasPorProyecto, volumenPorProyectoDesde } = require('./codigosSheet');

let avisoEstado = false;
async function leerEstados() {
  try {
    return await readTable('proyectos_estado');
  } catch (err) {
    if (!avisoEstado) {
      avisoEstado = true;
      console.warn('[proyectos] no pude leer proyectos_estado (¿falta correr migration_011?):', err.message);
    }
    return [];
  }
}

function desdeIso() {
  if (env.proyectosInactividadDias > 0) {
    return new Date(Date.now() - env.proyectosInactividadDias * 86400000).toISOString().slice(0, 10);
  }
  return env.proyectosActividadDesde || '';
}

// [{proyecto, cliente, ultimaFecha, volumen, estadoManual, activoPorUso,
//   visible, motivo}] para TODOS los proyectos de config_activos.
async function resumenProyectos() {
  const [activos, estados, ultimas, desde] = await Promise.all([getActivos(), leerEstados(), ultimasFechasPorProyecto(), Promise.resolve(desdeIso())]);
  const volumen = desde ? (await volumenPorProyectoDesde(desde)) || {} : {};
  const estadoDe = new Map(estados.map((e) => [e.proyecto, e]));
  const clienteDe = {};
  activos.forEach((a) => { if (a.proyecto && a.cliente && !clienteDe[a.proyecto]) clienteDe[a.proyecto] = a.cliente; });
  const proyectos = [...new Set(activos.map((a) => a.proyecto).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  return proyectos.map((p) => {
    const e = estadoDe.get(p);
    const ultimaFecha = ultimas ? (ultimas[p] || '') : '';
    // Sin regla (o sin hoja) todos cuentan como activos por uso.
    const activoPorUso = !desde || !ultimas ? true : (!!ultimaFecha && ultimaFecha >= desde);
    const estadoManual = e ? e.estado : 'automatico';
    let visible; let motivo;
    if (estadoManual === 'desactivado') { visible = false; motivo = 'Desactivado por ' + (e.modificado_por || 'un administrador'); }
    else if (estadoManual === 'activado') { visible = true; motivo = 'Activado por ' + (e.modificado_por || 'un administrador'); }
    else if (activoPorUso) { visible = true; motivo = ultimaFecha ? 'Con pedidos (último: ' + ultimaFecha + ')' : 'Sin regla de actividad'; }
    else { visible = false; motivo = ultimaFecha ? 'Sin pedidos desde ' + ultimaFecha : 'Sin pedidos en la hoja'; }
    return {
      proyecto: p,
      cliente: clienteDe[p] || '',
      ultimaFecha,
      volumen: volumen[p] || 0,
      estadoManual,
      activoPorUso,
      visible,
      motivo,
      desde,
    };
  });
}

// Set de nombres visibles — lo usa GET /api/proyectos.
async function proyectosVisibles() {
  const resumen = await resumenProyectos();
  return new Set(resumen.filter((r) => r.visible).map((r) => r.proyecto));
}

async function fijarEstado(proyecto, estado, usuario) {
  const nombre = String(proyecto || '').trim();
  if (!nombre) { const err = new Error('Falta el proyecto.'); err.status = 400; throw err; }
  if (!['activado', 'desactivado', 'automatico'].includes(estado)) { const err = new Error('Estado inválido.'); err.status = 400; throw err; }
  const estados = await readTable('proyectos_estado');
  const existe = estados.find((e) => e.proyecto === nombre);
  if (estado === 'automatico') {
    if (existe) await updateRow('proyectos_estado', 'proyecto', nombre, { estado: 'automatico', modificado_por: usuario ? usuario.nombre : '', modificado_en: new Date().toISOString() });
    return { proyecto: nombre, estado };
  }
  const datos = { estado, modificado_por: usuario ? usuario.nombre : '', modificado_en: new Date().toISOString() };
  if (existe) await updateRow('proyectos_estado', 'proyecto', nombre, datos);
  else await insertarFila('proyectos_estado', { proyecto: nombre, ...datos });
  return { proyecto: nombre, ...datos };
}

module.exports = { resumenProyectos, proyectosVisibles, fijarEstado };
