// Historial de Anuncios = la hoja CodigosContenido de AppSheet (todo lo que
// se cargó, por AppSheet o por PAUTADOR, desde HISTORIAL_DESDE) cruzada con
// lo que PAUTADOR sabe de cada código. Pedido del usuario (2026-09-12):
//  - solo el proyecto y el canal elegidos, y lo que el usuario puede ver
//    según sus accesos a Proyecto y Activo (Panel Usuarios); admin ve todo;
//  - estados: "Pautado" (salió a Meta desde PAUTADOR, o alguien lo marcó
//    acá) / "Ver en Asana" (todo lo demás — la visibilidad real de lo
//    manual está en Asana). Desestimadas se muestran como tal.
// Más adelante lo anterior al 1/9 sale de BigQuery.

const env = require('../config/env');
const { readTable, insertarFila, updateRow } = require('./dataSource');
const { filasDesde } = require('./codigosSheet');
const { getActivos } = require('./configActivos');
const { tieneAccesoAProyecto, activosPermitidos } = require('./usuarios');
const { linksDe } = require('./asanaLinks');

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

let avisoMarcas = false;
async function leerMarcas() {
  try {
    return await readTable('historial_marcas');
  } catch (err) {
    if (!avisoMarcas) {
      avisoMarcas = true;
      console.warn('[historial] no pude leer historial_marcas (¿falta correr migration_010?):', err.message);
    }
    return [];
  }
}

function esAdmin(usuario) {
  return !!usuario && usuario.rol === 'administrador';
}

async function getHistorial({ usuario, proyecto, ecosistema }) {
  const filas = await filasDesde(env.historialDesde);
  if (!filas) return { desde: env.historialDesde, filas: [], sinHoja: true };

  const [tipos, pautas, matriz, marcas, activos] = await Promise.all([
    readTable('equiv_tipo'), readTable('cola_pautas'), readTable('matriz_distribucion'), leerMarcas(), getActivos(),
  ]);
  const ecoDe = new Map(tipos.map((t) => [String(t.codigo), t.ecosistema]));
  const pautaPorCodigo = new Map(pautas.filter((p) => p.codigo).map((p) => [p.codigo, p]));
  const publicadas = new Set(matriz.filter((c) => c.adset_id || c.ad_id).map((c) => c.correlation_id));
  const marcaPorCodigo = new Map(marcas.map((m) => [m.codigo, m]));
  const keyPorNombre = new Map(activos.map((a) => [String(a.proyecto || '').trim() + '|' + norm(a.activo), a.activo_key]));

  const salida = [];
  const vistos = new Set();
  filas.forEach((f) => {
    const codigo = String(f.Codigo || '').trim();
    if (!codigo || vistos.has(codigo)) return;
    if (proyecto && proyecto !== 'TODOS' && String(f.Proyecto || '').trim() !== proyecto) return;
    const eco = ecoDe.get(codigo.charAt(6)) || '';
    if (ecosistema && ecosistema !== 'TODOS' && eco !== ecosistema) return;
    const pauta = pautaPorCodigo.get(codigo);
    // Cada usuario ve según sus accesos a Proyecto y Activo (Panel Usuarios)
    // — misma regla que el resto de la app. El activo de la hoja viene por
    // nombre: se cruza con config_activos; si no está cargado ahí, solo lo
    // ve quien tiene el proyecto completo.
    if (!esAdmin(usuario)) {
      const proyectoFila = String(f.Proyecto || '').trim();
      if (!tieneAccesoAProyecto(usuario, proyectoFila)) return;
      const permitidos = activosPermitidos(usuario, proyectoFila);
      if (permitidos !== 'todos') {
        const key = keyPorNombre.get(proyectoFila + '|' + norm(f.Activo));
        if (!key || !permitidos.includes(key)) return;
      }
    }
    vistos.add(codigo);
    const marca = marcaPorCodigo.get(codigo);
    const asana = linksDe(codigo);
    // "Ver en Asana" solo si hay link de verdad (usuario, 2026-09-16: era
    // confuso que dijera eso sin llevar a ningún lado).
    let estado = asana.length ? 'Ver en Asana' : 'Sin link a Asana';
    if (pauta && pauta.estado === 'desestimada') estado = 'Desestimada';
    else if (pauta && (pauta.estado === 'manual_hecha' || publicadas.has(pauta.correlation_id))) estado = 'Pautado';
    else if (marca && marca.estado === 'pautado') estado = 'Pautado';

    salida.push({
      codigo,
      fecha: f.fechaIso,
      proyecto: f.Proyecto,
      activo: f.Activo,
      eje: f.Eje,
      campana: f.Campana,
      contenido: f.Contenido,
      plataforma: f.Plataforma,
      objetivo: f.Objetivo,
      audiencia: f.Audiencia,
      formato: f.Formato,
      visibilidad: f.Visibilidad,
      creador: f.Creador,
      tipo: f.Tipo,
      ecosistema: eco,
      estado,
      origen: pauta ? 'pautador' : 'appsheet',
      correlation_id: pauta ? pauta.correlation_id : '',
      marcado_por: marca ? marca.marcado_por : '',
      marcado_en: marca ? marca.marcado_en : '',
      // Link(s) a la tarea de Asana que dejó Make en la hoja Tareas (uno por
      // plataforma) — vacío hasta que Make termina de crearla.
      asana,
    });
  });
  salida.sort((a, b) => (b.fecha > a.fecha ? 1 : b.fecha < a.fecha ? -1 : b.codigo.localeCompare(a.codigo)));
  return { desde: env.historialDesde, filas: salida };
}

// "Marcar pautado" desde la app — solo tiene sentido para lo que PAUTADOR
// no publicó (una fila de AppSheet, o una pieza manual).
async function marcarPautado(codigo, usuario) {
  const cod = String(codigo || '').trim();
  if (!cod) {
    const err = new Error('Falta el código.');
    err.status = 400;
    throw err;
  }
  const marcas = await readTable('historial_marcas');
  const datos = { estado: 'pautado', marcado_por: usuario ? usuario.nombre : '', marcado_en: new Date().toISOString() };
  if (marcas.find((m) => m.codigo === cod)) await updateRow('historial_marcas', 'codigo', cod, datos);
  else await insertarFila('historial_marcas', { codigo: cod, ...datos });
  return { codigo: cod, ...datos };
}

module.exports = { getHistorial, marcarPautado };
