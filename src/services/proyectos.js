// Qué proyectos se ofrecen para elegir (pantalla de Proyecto) y por qué.
//
// Fuentes (decisión del usuario, 2026-09-15):
//  - CATÁLOGO: hoja "Proyectos" de la planilla INSUMOS_SHEET_ID (nombre,
//    código, cliente, Estado Activo/Inactivo) — la edita el usuario, ver
//    proyectosCatalogo.js. Inactivo en la hoja = no se ofrece nunca. Sin
//    planilla, el universo son los proyectos de config_activos.
//  - ACTIVIDAD: códigos en CodigosContenido en los últimos
//    PROYECTOS_INACTIVIDAD_DIAS (45) días.
//  - MANUAL (proyectos_estado, migraciones 011/013): "Prender" lo deja
//    visible PROYECTOS_PRENDIDO_DIAS (5) días y después vuelve a la regla;
//    "Apagar" lo esconde aunque tenga actividad, hasta que alguien lo
//    prenda o lo pase a automático.
//  - Además hace falta al menos un activo cargado en config_activos: sin
//    activo no se puede pedir nada (crearPedido exige activo del proyecto).

const env = require('../config/env');
const { readTable, insertarFila, updateRow } = require('./dataSource');
const { getActivos } = require('./configActivos');
const { ultimasFechasPorProyecto, volumenPorProyectoDesde } = require('./codigosSheet');
const catalogo = require('./proyectosCatalogo');

let avisoEstado = false;
async function leerEstados() {
  try {
    return await readTable('proyectos_estado');
  } catch (err) {
    if (!avisoEstado) {
      avisoEstado = true;
      console.warn('[proyectos] no pude leer proyectos_estado (¿falta correr supabase/migration_011?):', err.message);
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

const cmp = (a, b) => String(a || '').localeCompare(String(b || ''), 'es');

// [{proyecto, cliente, codigo, enCatalogo, activoEnCatalogo, tieneActivos,
//   ultimaFecha, volumen, estadoManual, activadoHasta, activoPorUso,
//   visible, motivo}] para TODOS los proyectos (catálogo ∪ config_activos).
async function resumenProyectos() {
  const [activos, estados, ultimas, mapa] = await Promise.all([getActivos(), leerEstados(), ultimasFechasPorProyecto(), catalogo.getCatalogo()]);
  const desde = desdeIso();
  const volumen = desde ? (await volumenPorProyectoDesde(desde)) || {} : {};
  const estadoDe = new Map(estados.map((e) => [e.proyecto, e]));
  const clienteActivos = {};
  const conActivos = new Set();
  activos.forEach((a) => {
    if (!a.proyecto) return;
    conActivos.add(a.proyecto);
    if (a.cliente && !clienteActivos[a.proyecto]) clienteActivos[a.proyecto] = a.cliente;
  });
  // Universo: los Activos del catálogo más los que tienen activos cargados.
  // Un Inactivo de la hoja sin activos no interesa (usuario: "solo nos
  // importan los Activos"); si tiene activos se lista igual, oculto, para
  // que se vea por qué no aparece.
  const nombres = new Set([...conActivos, ...(mapa ? [...mapa.values()].filter((c) => c.activo).map((c) => c.proyecto) : [])]);
  const ahora = new Date().toISOString();

  return [...nombres].sort(cmp).map((p) => {
    const cat = mapa ? mapa.get(p) || null : null;
    const e = estadoDe.get(p);
    const ultimaFecha = ultimas ? (ultimas[p] || '') : '';
    // Sin regla (o sin hoja de códigos) todos cuentan como activos por uso.
    const activoPorUso = !desde || !ultimas ? true : (!!ultimaFecha && ultimaFecha >= desde);
    const activadoHasta = e && e.activado_hasta ? String(e.activado_hasta) : '';
    // "activado" vence: pasado activado_hasta vuelve a automático.
    let estadoManual = e ? e.estado : 'automatico';
    if (estadoManual === 'activado' && activadoHasta && activadoHasta < ahora) estadoManual = 'automatico';
    const tieneActivos = conActivos.has(p);
    const activoEnCatalogo = cat ? cat.activo : true; // sin catálogo, nada se excluye por acá
    let visible; let motivo;
    if (cat && !cat.activo) { visible = false; motivo = 'Inactivo en la hoja Proyectos'; }
    else if (!tieneActivos) { visible = false; motivo = 'Sin activos cargados (Agregar Activos / Audiencias)'; }
    else if (estadoManual === 'desactivado') { visible = false; motivo = 'Deshabilitado por ' + (e.modificado_por || 'un administrador'); }
    else if (estadoManual === 'activado') { visible = true; motivo = 'Habilitado por ' + (e.modificado_por || 'un administrador') + (activadoHasta ? ' hasta el ' + activadoHasta.slice(0, 10) : ''); }
    else if (activoPorUso) { visible = true; motivo = ultimaFecha ? 'Con pedidos (último: ' + ultimaFecha + ')' : 'Sin regla de actividad'; }
    else { visible = false; motivo = ultimaFecha ? 'Sin pedidos desde ' + ultimaFecha : 'Sin pedidos en la hoja'; }
    return {
      proyecto: p,
      cliente: (cat && cat.cliente) || clienteActivos[p] || '',
      codigo: (cat && cat.codigo) || '',
      enCatalogo: !!cat,
      activoEnCatalogo,
      tieneActivos,
      ultimaFecha,
      volumen: volumen[p] || 0,
      estadoManual,
      activadoHasta,
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

// {proyecto: cliente} — catálogo primero, config_activos después.
async function clientesPorProyecto() {
  const resumen = await resumenProyectos();
  const out = {};
  resumen.forEach((r) => { out[r.proyecto] = r.cliente; });
  return out;
}

async function fijarEstado(proyecto, estado, usuario) {
  const nombre = String(proyecto || '').trim();
  if (!nombre) { const err = new Error('Falta el proyecto.'); err.status = 400; throw err; }
  if (!['activado', 'desactivado', 'automatico'].includes(estado)) { const err = new Error('Estado inválido.'); err.status = 400; throw err; }
  const estados = await readTable('proyectos_estado');
  const existe = estados.find((e) => e.proyecto === nombre);
  const activadoHasta = estado === 'activado' ? new Date(Date.now() + env.proyectosPrendidoDias * 86400000).toISOString() : null;
  const datos = { estado, modificado_por: usuario ? usuario.nombre : '', modificado_en: new Date().toISOString(), activado_hasta: activadoHasta };
  const escribir = async (d) => {
    if (existe) await updateRow('proyectos_estado', 'proyecto', nombre, d);
    else await insertarFila('proyectos_estado', { proyecto: nombre, ...d });
  };
  try {
    await escribir(datos);
  } catch (err) {
    // Migración 013 sin correr: se guarda sin la fecha (queda como "activado"
    // sin vencimiento) y se avisa.
    if (!/activado_hasta/.test(err.message)) throw err;
    console.warn('[proyectos] falta correr supabase/migration_013_proyectos_activado_hasta.sql — guardo sin activado_hasta:', err.message);
    delete datos.activado_hasta;
    await escribir(datos);
  }
  return { proyecto: nombre, ...datos };
}

module.exports = { resumenProyectos, proyectosVisibles, clientesPorProyecto, fijarEstado };
