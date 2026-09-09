const express = require('express');
const { getUsuarios } = require('../services/usuarios');

const router = express.Router();

// GET /api/usuarios — lista de usuarios de demo para el selector "actuar
// como" del nav (no hay login real todavía). Devuelve también los proyectos
// permitidos: el front los necesita para armar el selector de Proyecto en
// "Pedido de Pauta" sin tener que preguntarle al server en cada tecleo.
router.get('/usuarios', async (req, res) => {
  try {
    const usuarios = await getUsuarios();
    res.json(usuarios.map((u) => ({ id: u.id, nombre: u.nombre, rol: u.rol, proyectos: u.proyectos, email: u.email || '' })));
  } catch (err) {
    console.error('[usuarios]', err.message);
    res.status(500).json({ error: 'No se pudieron leer los usuarios', detalle: err.message });
  }
});

module.exports = router;
