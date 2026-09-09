const express = require('express');
const { getItemsCompletos, getPendientesPorProyecto } = require('../services/items');
const { requireRol } = require('../middleware/usuarioActual');

const router = express.Router();

// GET /api/items — pantalla única de "Validación de Anuncios": todas las
// piezas (pendientes + historial) con su matriz/resultado ya resuelto, para
// expandir cualquier fila sin otro fetch. Acceden implementador (edición),
// pm_cuentas (solo lectura) y administrador (superusuario) — ver Mock Up de
// Claude Design/brief-original.md. Acotado al Proyecto activo de la sesión
// (pantalla 2 del onboarding) salvo que sea 'TODOS' (admin) — ver
// middleware/usuarioActual.js.
router.get('/items', requireRol('implementador', 'pm_cuentas', 'administrador'), async (req, res) => {
  try {
    const items = await getItemsCompletos(req.usuario, req.proyectoActivo);
    res.json(items);
  } catch (err) {
    console.error('[items]', err.message);
    res.status(500).json({ error: 'No se pudieron leer las piezas', detalle: err.message });
  }
});

// GET /api/proyectos-pendientes — cuántas piezas esperan validación en cada
// Proyecto al que el usuario tiene acceso. Alimenta el globo que ve el
// Implementador en la pantalla 2 del onboarding (elegir Proyecto), ANTES de
// elegir uno — por eso no depende de req.proyectoActivo.
router.get('/proyectos-pendientes', requireRol('implementador', 'pm_cuentas', 'administrador'), async (req, res) => {
  try {
    const conteos = await getPendientesPorProyecto(req.usuario);
    res.json(conteos);
  } catch (err) {
    console.error('[proyectos-pendientes]', err.message);
    res.status(500).json({ error: 'No se pudieron contar los pendientes', detalle: err.message });
  }
});

module.exports = router;
