// Catálogo de proyectos: hoja "Proyectos" de la planilla INSUMOS_SHEET_ID
// (columnas Proyecto, Código, Estado, Cliente). Es del usuario: PAUTADOR la
// lee (caché 60 s) y nunca la escribe. Decisión 2026-09-15: la hoja es la
// dueña del nombre, el prefijo del código y el cliente; Supabase guarda lo
// operativo (activos por proyecto, prendido/apagado manual).
// Sin planilla configurada (o si no se puede leer) devuelve null y todo
// sigue como antes (proyectos = los de config_activos).
const env = require('../config/env');
const sheets = require('./sheets');

const CACHE_MS = 60 * 1000;
let cache = { mapa: null, leidoEn: 0 };
let avisado = false;

function configurado() {
  return !!(env.insumosSheetId && (env.credentialsJson || env.credentialsPath));
}

function limpio(v) { return String(v == null ? '' : v).trim(); }

// Map nombre -> { proyecto, codigo, cliente, activo }. Si un nombre está
// repetido (pasa: "La Invencible", "Modernización"), gana la primera fila
// Activa; si ninguna, la primera.
async function getCatalogo() {
  if (!configurado()) return null;
  if (cache.mapa && Date.now() - cache.leidoEn < CACHE_MS) return cache.mapa;
  try {
    const filas = await sheets.readRange(env.insumosSheetId, env.proyectosHoja);
    const mapa = new Map();
    filas.forEach((f) => {
      const proyecto = limpio(f.Proyecto);
      if (!proyecto) return;
      const fila = { proyecto, codigo: limpio(f['Código'] || f.Codigo).toUpperCase(), cliente: limpio(f.Cliente), activo: /^activo$/i.test(limpio(f.Estado)) };
      const previa = mapa.get(proyecto);
      if (!previa || (!previa.activo && fila.activo)) mapa.set(proyecto, fila);
    });
    cache = { mapa, leidoEn: Date.now() };
    avisado = false;
    return mapa;
  } catch (err) {
    if (!avisado) { avisado = true; console.warn('[proyectos] no pude leer la hoja Proyectos de INSUMOS_SHEET_ID — sigo con config_activos:', err.message); }
    return cache.mapa || null;
  }
}

async function getProyectoCatalogo(nombre) {
  const mapa = await getCatalogo();
  return mapa ? mapa.get(limpio(nombre)) || null : null;
}

module.exports = { configurado, getCatalogo, getProyectoCatalogo };
