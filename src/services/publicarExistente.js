// Procesa un pedido con visibilidad "PUBLICO": el Implementador elige el
// post real de Facebook/Instagram que corresponde a lo pedido y confirma —
// esto TRANSICIONA la fila del pedido (ya creada por "Pedido de Pauta",
// estado "pendiente") a "preview_lista", no crea una fila nueva. Proyecto/
// activo/eje/campaña/código ya vienen resueltos del pedido; acá se termina
// de fijar post_id/material/copy (con el post real, más preciso que el link
// que haya puesto el PM) y se permite ajustar objetivo/audiencia/presupuesto/
// fechas si hace falta.

const { getPautaPorId, ESTADO_PEDIDO_PENDIENTE } = require('./colaPautas');
const { updateRow } = require('./dataSource');

async function procesarPedidoExistente(datos) {
  const {
    correlationId, post,
    objetivo, audiencia, refuerzoAudiencia, presupuesto,
    fechaInicio, fechaFin,
  } = datos;

  if (!correlationId || !post || !post.id) {
    const err = new Error('Faltan el pedido o la publicación elegida.');
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
  if (!objetivo || !audiencia || !presupuesto) {
    const err = new Error('Objetivo, audiencia y presupuesto son obligatorios.');
    err.status = 400;
    throw err;
  }

  const hoy = new Date().toISOString().slice(0, 10);

  await updateRow('cola_pautas', 'correlation_id', correlationId, {
    estado: 'preview_lista',
    objetivo,
    audiencia,
    refuerzo_audiencia: refuerzoAudiencia || '',
    material: post.permalink || pedido.material,
    copy: post.caption || pedido.copy,
    post_id: post.id,
    presupuesto: Number(presupuesto) || 0,
    fecha_inicio: fechaInicio || pedido.fecha_inicio || hoy,
    fecha_fin: fechaFin || pedido.fecha_fin || '',
    // Una publicación existente SOLO puede correr como anuncio en la red de
    // la que vino — un post de Facebook no puede publicarse como anuncio de
    // Instagram y viceversa (son objetos de contenido distintos para Meta).
    // Se resuelve acá, no en el cliente: mismo criterio que el resto de la
    // pieza (no confiamos en el navegador para esto).
    redes: post.plataforma === 'Instagram' ? 'instagram' : 'facebook',
  });

  return correlationId;
}

module.exports = { procesarPedidoExistente };
