const express = require('express');
const { getPautaPorId, getMatrizParaPauta } = require('../services/colaPautas');
const { readTable, updateRow } = require('../services/dataSource');
const { confirmarPauta, marcarHechaAMano, marcarCeldaHecha, desestimarPauta, devolverPauta } = require('../services/confirmar');
const { editarPauta } = require('../services/pedidos');
const { requireRol } = require('../middleware/usuarioActual');

const router = express.Router();

const ESTADOS_YA_RESUELTOS = ['confirmada', 'publicada'];

// Si la pieza ya se confirmó, reconstruye la matriz desde matriz_distribucion
// (con los IDs simulados que se generaron) en vez de recalcular un reparto
// nuevo — así el detalle muestra el resultado real de la confirmación.
async function matrizYaConfirmada(pauta) {
  const filas = (await readTable('matriz_distribucion')).filter(
    (f) => f.correlation_id === pauta.correlation_id
  );
  const celdas = filas.map((f) => ({
    objetivo: f.objetivo,
    audiencia: { codigo: f.audiencia_key, nombre: f.audiencia_nombre, tipo: f.tipo_audiencia, manual: f.estado_celda === 'manual' },
    porcentaje: Number(f.porcentaje),
    monto: Number(f.monto_resuelto),
    manual: f.estado_celda === 'manual',
    campaign_id: f.campaign_id,
    adset_id: f.adset_id,
    creative_id: f.creative_id,
    ad_id: f.ad_id,
    estado_celda: f.estado_celda,
    nomenclatura: f.nomenclatura,
  }));
  const objetivos = [...new Set(celdas.map((c) => c.objetivo))];
  const audiencias = [...new Map(celdas.map((c) => [c.audiencia.codigo, c.audiencia])).values()];
  return {
    esMatriz: objetivos.length > 1 || audiencias.length > 1,
    presupuestoTotal: Number(pauta.presupuesto_resuelto) || 0,
    objetivos,
    audiencias,
    celdas,
    confirmada: true,
  };
}

// GET /api/pauta/:id — Pantalla 2: detalle + matriz objetivo × audiencia
router.get('/pauta/:id', requireRol('implementador', 'pm_cuentas', 'administrador'), async (req, res) => {
  try {
    const pauta = await getPautaPorId(req.params.id);
    if (!pauta) {
      return res.status(404).json({ error: `No existe la pauta "${req.params.id}"` });
    }
    const matriz = ESTADOS_YA_RESUELTOS.includes(pauta.estado)
      ? await matrizYaConfirmada(pauta)
      : await getMatrizParaPauta(pauta);
    res.json({ pauta, matriz });
  } catch (err) {
    console.error('[pauta]', err.message);
    res.status(500).json({ error: 'No se pudo resolver la pauta', detalle: err.message });
  }
});

// POST /api/pauta/:id/confirmar — el "da OK". Con META_MODE=real CREA DE
// VERDAD campaña/conjunto/creative/anuncio en Meta (siempre en PAUSED); con
// META_MODE=mock genera IDs falsos con prefijo MOCK-. En los dos casos
// escribe matriz_distribucion y pasa la pieza a "confirmada".
// Body: { celdas: [{ objetivo, audiencia_codigo, porcentaje }] }
// Es idempotente: si una corrida anterior falló a mitad, las celdas ya
// publicadas se reusan en vez de duplicarse (ver services/confirmar.js).
router.post('/pauta/:id/confirmar', requireRol('implementador', 'administrador'), async (req, res) => {
  try {
    const celdas = Array.isArray(req.body.celdas) ? req.body.celdas : [];
    const resultado = await confirmarPauta(req.params.id, celdas, req.usuario.nombre);
    res.json(resultado);
  } catch (err) {
    console.error('[confirmar]', err.message);
    res.status(err.status || 500).json({ error: 'No se pudo confirmar la pieza', detalle: err.message });
  }
});

// POST /api/pauta/:id/presupuesto — el Implementador/Administrador puede
// ajustar el presupuesto que vino en el pedido antes de confirmar (el PM,
// en "Pedido de Pauta", solo elige Intensidad — el número final lo termina
// de definir quien valida). Body: { presupuesto }.
router.post('/pauta/:id/presupuesto', requireRol('implementador', 'administrador'), async (req, res) => {
  try {
    const pauta = await getPautaPorId(req.params.id);
    if (!pauta) return res.status(404).json({ error: `No existe la pauta "${req.params.id}"` });
    if (ESTADOS_YA_RESUELTOS.includes(pauta.estado) || pauta.estado === 'manual_hecha' || pauta.estado === 'desestimada') {
      return res.status(409).json({ error: `Esta pieza ya está en estado "${pauta.estado}" — no se puede editar el presupuesto.` });
    }
    const presupuesto = Number(req.body.presupuesto);
    if (!presupuesto || presupuesto <= 0) {
      return res.status(400).json({ error: 'Presupuesto inválido.' });
    }
    await updateRow('cola_pautas', 'correlation_id', req.params.id, { presupuesto });
    res.json({ presupuesto });
  } catch (err) {
    console.error('[presupuesto]', err.message);
    res.status(500).json({ error: 'No se pudo actualizar el presupuesto', detalle: err.message });
  }
});

// POST /api/pauta/:id/celda-hecha — cierra UNA celda del carril manual
// (audiencia "Otra") después de haberla creado a mano en Meta. Las celdas
// automáticas de la misma pieza no se tocan: son carriles independientes.
// Body: { objetivo, audiencia_codigo }
router.post('/pauta/:id/celda-hecha', requireRol('implementador', 'administrador'), async (req, res) => {
  try {
    const { objetivo, audiencia_codigo: audienciaCodigo } = req.body;
    if (!objetivo || !audienciaCodigo) {
      return res.status(400).json({ error: 'Faltan "objetivo" y/o "audiencia_codigo".' });
    }
    const resultado = await marcarCeldaHecha(req.params.id, objetivo, audienciaCodigo, req.usuario.nombre);
    res.json(resultado);
  } catch (err) {
    console.error('[celda-hecha]', err.message);
    res.status(err.status || 500).json({ error: 'No se pudo marcar la celda', detalle: err.message });
  }
});

// POST /api/pauta/:id/marcar-manual — piezas 100% manuales (audiencia
// "Otra") no se confirman: el pautador las crea a mano en Meta y después
// las saca de pendientes con esto.
router.post('/pauta/:id/marcar-manual', requireRol('implementador', 'administrador'), async (req, res) => {
  try {
    const resultado = await marcarHechaAMano(req.params.id, req.usuario.nombre);
    res.json(resultado);
  } catch (err) {
    console.error('[marcar-manual]', err.message);
    res.status(err.status || 500).json({ error: 'No se pudo marcar la pieza', detalle: err.message });
  }
});

// POST /api/pauta/:id/desestimar — rechazar el pedido: no se pauta y sale
// de la cola. El motivo es obligatorio y queda guardado en la fila: es lo
// único que le queda a quien pidió la pauta para entender qué corregir.
// PM/Cuentas puede desestimar sus propios pedidos, no solo Implementador.
// Body: { motivo }
router.post('/pauta/:id/desestimar', requireRol('pm_cuentas', 'implementador', 'administrador'), async (req, res) => {
  try {
    const resultado = await desestimarPauta(req.params.id, req.body.motivo, req.usuario.nombre);
    res.json(resultado);
  } catch (err) {
    console.error('[desestimar]', err.message);
    res.status(err.status || 500).json({ error: 'No se pudo desestimar la pieza', detalle: err.message });
  }
});

// POST /api/pauta/:id/devolver — "Corregir y devolver": el Implementador
// NO corrige nada — le pasa la pieza de vuelta a quien la pidió (PM/
// Cuentas) con el motivo, para que la corrija ahí (ver /editar) y vuelva
// sola a Validación. Body: { motivo }
router.post('/pauta/:id/devolver', requireRol('implementador', 'administrador'), async (req, res) => {
  try {
    const resultado = await devolverPauta(req.params.id, req.body.motivo, req.usuario.nombre);
    res.json(resultado);
  } catch (err) {
    console.error('[devolver]', err.message);
    res.status(err.status || 500).json({ error: 'No se pudo devolver la pieza', detalle: err.message });
  }
});

// POST /api/pauta/:id/editar — corregir los campos de una pauta que ya
// existe, sin crear una pieza nueva. La usan tanto el Implementador
// ("Corregir y pautar": arregla algo y sigue con el confirm de siempre)
// como el PM/Cuentas (corrigiendo algo que le devolvieron con /devolver —
// al guardar, esa pieza vuelve sola a Validación). Mismos campos y mismas
// reglas de obligatoriedad que crear un pedido nuevo.
router.post('/pauta/:id/editar', requireRol('pm_cuentas', 'implementador', 'administrador'), async (req, res) => {
  try {
    const resultado = await editarPauta(req.params.id, req.body);
    res.json(resultado);
  } catch (err) {
    console.error('[editar-pauta]', err.message);
    res.status(err.status || 500).json({ error: 'No se pudo editar la pieza', detalle: err.message });
  }
});

module.exports = router;
