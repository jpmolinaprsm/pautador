const express = require('express');
const { getPendientes } = require('../services/colaPautas');
const { getActivoPorKey } = require('../services/configActivos');

const router = express.Router();

// GET /api/pendientes — Pantalla 1: cola filtrada (en modo mock, sin filtro de permisos todavía)
router.get('/pendientes', async (req, res) => {
  try {
    const pautas = await getPendientes();
    const conActivo = await Promise.all(
      pautas.map(async (p) => {
        const activo = await getActivoPorKey(p.activo);
        return {
          correlation_id: p.correlation_id,
          estado: p.estado,
          codigo: p.codigo,
          activo: p.activo,
          activo_nombre: activo && activo.activo ? activo.activo : p.activo,
          objetivo: p.objetivo,
          audiencia: p.audiencia,
          refuerzo_audiencia: p.refuerzo_audiencia,
          presupuesto: p.presupuesto,
          fecha: p.fecha,
          visibilidad: p.visibilidad,
        };
      })
    );
    res.json(conActivo);
  } catch (err) {
    console.error('[pendientes]', err.message);
    res.status(500).json({ error: 'No se pudo leer la cola de pendientes', detalle: err.message });
  }
});

module.exports = router;
