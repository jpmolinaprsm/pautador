const express = require('express');
const { getItemsCompletos, getPendientesPorProyecto, getPendientesDetalle } = require('../services/items');
const { getHistorial, marcarPautado } = require('../services/historial');
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

// GET /api/pendientes-detalle — una entrada por pieza pendiente con
// proyecto/modo/ecosistema/plataformas; el front cuenta para los globos de
// Proyecto, Modo, Ecosistema y Plataforma. No depende de req.proyectoActivo.
router.get('/pendientes-detalle', requireRol('implementador', 'pm_cuentas', 'administrador'), async (req, res) => {
  try {
    res.json(await getPendientesDetalle(req.usuario));
  } catch (err) {
    console.error('[pendientes-detalle]', err.message);
    res.status(500).json({ error: 'No se pudieron contar los pendientes', detalle: err.message });
  }
});

// GET /api/historial — Historial desde la hoja CodigosContenido (ver
// services/historial.js): proyecto y canal elegidos, solo lo del usuario
// (admin ve todo), desde HISTORIAL_DESDE.
router.get('/historial', requireRol('implementador', 'pm_cuentas', 'administrador'), async (req, res) => {
  try {
    res.json(await getHistorial({ usuario: req.usuario, proyecto: req.proyectoActivo, ecosistema: req.ecosistemaActivo }));
  } catch (err) {
    console.error('[historial]', err.message);
    res.status(500).json({ error: 'No se pudo leer el historial', detalle: err.message });
  }
});

// POST /api/historial/:codigo/pautado — "Marcar pautado" una fila que no
// publicó PAUTADOR (queda en historial_marcas, migración 010).
router.post('/historial/:codigo/pautado', requireRol('implementador', 'administrador'), async (req, res) => {
  try {
    res.json(await marcarPautado(req.params.codigo, req.usuario));
  } catch (err) {
    console.error('[historial/pautado]', err.message);
    res.status(err.status || 500).json({ error: 'No se pudo marcar', detalle: err.message });
  }
});

module.exports = router;
