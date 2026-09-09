// Procesa un pedido con visibilidad "DARK": el PM ya cargó formato/material/
// copy en "Pedido de Pauta" — el Implementador revisa, ajusta si hace falta
// (objetivo/audiencia/presupuesto/placements/fechas) y confirma. Igual que
// publicarExistente.js, esto TRANSICIONA la fila del pedido a "preview_lista"
// en vez de crear una nueva.

const { getPautaPorId, ESTADO_PEDIDO_PENDIENTE } = require('./colaPautas');
const { updateRow } = require('./dataSource');

async function procesarPedidoDark(datos) {
  const {
    correlationId,
    objetivo, audiencia, refuerzoAudiencia, presupuesto,
    formato, material, materialStories, copy, copyOpcional, linkDestino, redes, placements,
    fechaInicio, fechaFin,
  } = datos;

  if (!correlationId) {
    const err = new Error('Falta el pedido a procesar.');
    err.status = 400;
    throw err;
  }

  const pedido = await getPautaPorId(correlationId);
  if (!pedido) {
    const err = new Error(`No existe el pedido "${correlationId}".`);
    err.status = 404;
    throw err;
  }
  if (pedido.estado !== ESTADO_PEDIDO_PENDIENTE) {
    const err = new Error(`Este pedido ya está en estado "${pedido.estado}" — no se puede procesar de nuevo.`);
    err.status = 409;
    throw err;
  }
  if (!objetivo || !audiencia || !presupuesto || !formato || !material || (!copy && !copyOpcional)) {
    const err = new Error('Objetivo, audiencia, presupuesto, formato, material y copy son obligatorios (copy no, si el único placement es Stories).');
    err.status = 400;
    throw err;
  }

  const hoy = new Date().toISOString().slice(0, 10);

  await updateRow('cola_pautas', 'correlation_id', correlationId, {
    estado: 'preview_lista',
    objetivo,
    audiencia,
    refuerzo_audiencia: refuerzoAudiencia || '',
    formato,
    material,
    material_stories: materialStories || '',
    copy,
    link_destino: linkDestino || '',
    // Red (Facebook/Instagram/ambas) y Placement (Feed/Stories/Reels) —
    // multipick, sin elegir nada cae al default de siempre en
    // metaAdapterReal.js (no es obligatorio llenar ninguno de los dos).
    redes: Array.isArray(redes) ? redes.join(',') : (redes || ''),
    placements: Array.isArray(placements) ? placements.join(',') : (placements || ''),
    presupuesto: Number(presupuesto) || 0,
    fecha_inicio: fechaInicio || pedido.fecha_inicio || hoy,
    fecha_fin: fechaFin || pedido.fecha_fin || '',
  });

  return correlationId;
}

module.exports = { procesarPedidoDark };
