// Cola de envío a Meta (usuario, 2026-09-17): confirmar un pedido ya no
// espera a que Meta termine. crearPedido guarda la fila con envio='en_cola'
// y la encola acá; un proceso de fondo de este mismo servidor la "termina"
// (procesarPedido* + confirmarPauta, lo mismo que antes corría en el request)
// y va dejando envio = creando → listo | error (+ envio_error). La pantalla
// muestra el cuadro "En proceso N/M" leyendo GET /api/pedidos/envios.
//
// De a uno por activo (Meta limita por cuenta), en paralelo entre activos.
// Si el servidor se reinicia con cosas en cola, al arrancar se retoman
// desde la fila (terminarPedidoDesdeFila en pedidos.js).

const env = require('../config/env');
const { readTable, updateRow } = require('./dataSource');

const colas = new Map(); // activoKey -> promesa del último trabajo

async function marcarEnvio(correlationId, envio, error) {
  try {
    await updateRow('cola_pautas', 'correlation_id', correlationId, {
      envio,
      envio_error: error ? String(error).slice(0, 2000) : '',
      envio_actualizado: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[cola-envio] no pude marcar', correlationId, envio, e.message);
  }
}

// trabajo(): async, hace el envío; su error queda en envio_error.
function encolar(correlationId, activoKey, trabajo) {
  const clave = activoKey || '_';
  const anterior = colas.get(clave) || Promise.resolve();
  const propio = anterior.then(async () => {
    await marcarEnvio(correlationId, 'creando');
    try {
      await trabajo();
      await marcarEnvio(correlationId, 'listo');
    } catch (err) {
      console.error('[cola-envio]', correlationId, err.message);
      await marcarEnvio(correlationId, 'error', err.message);
    }
  });
  colas.set(clave, propio);
  return propio;
}

// Al arrancar: lo que quedó en cola o a mitad de camino en la corrida
// anterior se retoma desde la fila.
async function recuperarPendientes(terminarDesdeFila) {
  let filas;
  try {
    filas = await readTable('cola_pautas');
  } catch (e) {
    console.warn('[cola-envio] no pude leer la cola al arrancar:', e.message);
    return 0;
  }
  // Solo lo de ESTE proceso (envio_instancia, migración 017): producción
  // publica ACTIVO y una PC local PAUSADO sobre la misma base — ninguno puede
  // retomar lo del otro. Lo que no tiene dueño anotado es de antes de la 017
  // y lo creó producción: solo lo retoma Railway.
  const mio = (f) => (f.envio_instancia ? f.envio_instancia === env.instancia : env.enRailway);
  const pendientes = filas.filter((f) => (f.envio === 'en_cola' || f.envio === 'creando') && mio(f));
  pendientes.forEach((f) => encolar(f.correlation_id, f.activo, () => terminarDesdeFila(f.correlation_id)));
  if (pendientes.length) console.log(`[cola-envio] retomo ${pendientes.length} pedido(s) que quedaron en cola`);
  return pendientes.length;
}

module.exports = { encolar, recuperarPendientes, marcarEnvio };
