const express = require('express');
const { getActivos } = require('../services/configActivos');

const router = express.Router();

// GET /api/config-activos
// Ruta de prueba: si esto devuelve tus filas, la conexión a Sheets funciona.
router.get('/config-activos', async (req, res) => {
  try {
    const activos = await getActivos();
    res.json(activos);
  } catch (err) {
    console.error('[config-activos]', err.message);
    res.status(500).json({
      error: 'No se pudo leer config_activos',
      detalle: err.message,
      ayuda:
        'Revisá: 1) GOOGLE_SHEET_ID en .env, 2) que la hoja tenga una pestaña llamada exactamente "config_activos", 3) que compartiste el Sheet con el email de la cuenta de servicio.',
    });
  }
});

module.exports = router;
