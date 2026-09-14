const { readTable } = require('./dataSource');
const { getActivoPorKey } = require('./configActivos');
const codigosSheet = require('./codigosSheet');

// equiv_audiencia: públicos guardados reales por activo (los que se pueden
// publicar solos). Es la única fuente válida en Pedido Automatizado.
async function getAudienciasPorActivo(activoKey) {
  const todas = await readTable('equiv_audiencia');
  return todas.filter((a) => a.activo_key === activoKey);
}

// audiencias_catalogo (migration_012): audiencias por Proyecto × Canal que
// vienen del Excel "IDs de Auds x Activos" con nombre limpio del Excel
// "Audiencias". Solo para Pedido Manual: la pieza sale "a mano". Sin la
// tabla (migración no corrida) se comporta como si estuviera vacía.
let avisoCatalogo = false;
async function leerCatalogo() {
  try {
    return await readTable('audiencias_catalogo');
  } catch (err) {
    if (!avisoCatalogo) {
      avisoCatalogo = true;
      console.warn('[audiencias] no pude leer audiencias_catalogo (¿falta migration_012?):', err.message);
    }
    return [];
  }
}

async function getCatalogoPorProyecto(proyecto, canal) {
  const filas = await leerCatalogo();
  return filas.filter((f) => f.proyecto === proyecto && (!canal || f.canal === canal));
}

async function buscarEnCatalogo(codigo) {
  const filas = await leerCatalogo();
  return filas.find((f) => f.codigo === codigo) || null;
}

function catalogoComoEquiv(fila, activoKey) {
  return {
    activo_key: activoKey,
    codigo_audiencia: fila.codigo,
    nombre_display: fila.nombre,
    'tamaño': fila.tamano || '',
    saved_audience_id: null,
    catalogo: true,
  };
}

// Para resolver una pieza ya cargada (nombre, tamaño): las reales del activo
// más el catálogo de su proyecto (los dos canales — el código no depende del
// canal). Los códigos del catálogo no tienen público guardado: en Pedido
// Manual la celda es manual de todos modos (getMatrizParaPauta).
async function getAudienciasParaResolver(activoKey) {
  const equiv = await getAudienciasPorActivo(activoKey);
  const activo = await getActivoPorKey(activoKey);
  if (!activo) return equiv;
  const catalogo = await getCatalogoPorProyecto(activo.proyecto);
  const vistos = new Set(equiv.map((a) => a.codigo_audiencia));
  const extra = [];
  catalogo.forEach((f) => {
    if (vistos.has(f.codigo)) return;
    vistos.add(f.codigo);
    extra.push(catalogoComoEquiv(f, activoKey));
  });
  return equiv.concat(extra);
}

// Cuántas veces se usó cada código de audiencia en ese Proyecto × Canal
// según la hoja CodigosContenido (para listar primero las que ya se usan).
const ECO_POR_LETRA = { A: 'Oficial', B: 'Oficial', C: 'Oficial', D: 'Informativo', E: 'Informativo', F: 'Informativo', Y: 'Informativo', 0: 'Informativo' };
async function usoPorProyectoCanal(proyecto, canal, desdeIso) {
  const uso = {};
  let filas = [];
  try {
    filas = (await codigosSheet.filasDesde(desdeIso || '2026-01-01')) || [];
  } catch (err) {
    return uso;
  }
  filas.forEach((f) => {
    if (String(f.Proyecto || '').trim() !== proyecto) return;
    const canalFila = ECO_POR_LETRA[String(f.Codigo || '').charAt(6)];
    if (canal && canalFila !== canal) return;
    const codigo = String(f.Audiencia || '').split(':')[0].trim().toUpperCase();
    if (!/^[A-Z0-9]{5,13}$/.test(codigo)) return;
    uso[codigo] = (uso[codigo] || 0) + 1;
  });
  return uso;
}

module.exports = { getAudienciasPorActivo, getCatalogoPorProyecto, buscarEnCatalogo, getAudienciasParaResolver, usoPorProyectoCanal };
