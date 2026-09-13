const express = require('express');
const { getUsuarios, serializarUsuario } = require('../services/usuarios');

const router = express.Router();

// GET /api/usuarios — lista de usuarios para el selector "actuar como" del
// nav (login de prueba). Devuelve también los proyectos permitidos (texto,
// armado desde usuario_accesos): el front los necesita para decidir la
// pantalla de Proyecto sin preguntarle al server en cada tecleo. Los
// deshabilitados no aparecen (no pueden entrar).
router.get('/usuarios', async (req, res) => {
  try {
    const usuarios = await getUsuarios();
    res.json(usuarios.filter((u) => u.habilitado).map((u) => {
      const s = serializarUsuario(u);
      return { id: s.id, nombre: s.nombre, rol: s.rol, proyectos: s.proyectos, email: s.email, es_superadmin: s.es_superadmin };
    }));
  } catch (err) {
    console.error('[usuarios]', err.message);
    res.status(500).json({ error: 'No se pudieron leer los usuarios', detalle: err.message });
  }
});

module.exports = router;
