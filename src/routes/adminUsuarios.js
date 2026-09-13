// Panel Usuarios (pestaña de administradores): alta por mail y asignación
// de Proyectos y Activos por usuario. Las reglas de quién puede tocar qué
// (superadmin, deshabilitar, cambiar rol) viven en services/usuarios.js —
// acá solo se traduce HTTP.
const express = require('express');
const { requireRol } = require('../middleware/usuarioActual');
const { getUsuarios, serializarUsuario, crearUsuarioAdmin, actualizarUsuarioAdmin, ROLES } = require('../services/usuarios');
const { getActivos } = require('../services/configActivos');
const { resumenProyectos, fijarEstado } = require('../services/proyectos');

const router = express.Router();

function responderError(res, tag, err) {
  if (!err.status || err.status >= 500) console.error(`[${tag}]`, err.message);
  res.status(err.status || 500).json({ error: err.message });
}

// GET /api/admin/usuarios — todos los usuarios con sus accesos, más la
// lista de proyectos/activos para armar la grilla de checkboxes.
router.get('/admin/usuarios', requireRol('administrador'), async (req, res) => {
  try {
    const [usuarios, activos] = await Promise.all([getUsuarios(), getActivos()]);
    const proyectos = {};
    activos.forEach((a) => {
      if (!a.proyecto) return;
      if (!proyectos[a.proyecto]) proyectos[a.proyecto] = [];
      proyectos[a.proyecto].push({ activo_key: a.activo_key, activo: a.activo || a.activo_key, habilitado: a.activo_habilitado === true });
    });
    Object.values(proyectos).forEach((lista) => lista.sort((x, y) => x.activo.localeCompare(y.activo, 'es')));
    res.json({
      usuarios: usuarios.map(serializarUsuario).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es')),
      proyectos: Object.keys(proyectos).sort((a, b) => a.localeCompare(b, 'es')).map((p) => ({ proyecto: p, activos: proyectos[p] })),
      roles: ROLES,
      yo: { id: req.usuario.id, es_superadmin: req.usuario.es_superadmin === true },
    });
  } catch (err) {
    responderError(res, 'admin/usuarios', err);
  }
});

// POST /api/admin/usuarios — body: { email, nombre?, rol?, accesos?: [{proyecto, activo_key}] }
router.post('/admin/usuarios', requireRol('administrador'), async (req, res) => {
  try {
    const usuario = await crearUsuarioAdmin(req.usuario, req.body || {});
    res.status(201).json(serializarUsuario(usuario));
  } catch (err) {
    responderError(res, 'admin/usuarios POST', err);
  }
});

// PUT /api/admin/usuarios/:id — body: { nombre?, rol?, habilitado?, accesos? }
router.put('/admin/usuarios/:id', requireRol('administrador'), async (req, res) => {
  try {
    const usuario = await actualizarUsuarioAdmin(req.usuario, req.params.id, req.body || {});
    res.json(serializarUsuario(usuario));
  } catch (err) {
    responderError(res, 'admin/usuarios PUT', err);
  }
});

// GET /api/admin/proyectos — todos los proyectos con su actividad y si se
// ofrecen o no (y por qué). PUT /api/admin/proyectos/:proyecto — body
// { estado: 'activado' | 'desactivado' | 'automatico' } (ver services/proyectos.js).
router.get('/admin/proyectos', requireRol('administrador'), async (req, res) => {
  try {
    res.json(await resumenProyectos());
  } catch (err) {
    responderError(res, 'admin/proyectos', err);
  }
});

router.put('/admin/proyectos/:proyecto', requireRol('administrador'), async (req, res) => {
  try {
    res.json(await fijarEstado(req.params.proyecto, (req.body || {}).estado, req.usuario));
  } catch (err) {
    responderError(res, 'admin/proyectos PUT', err);
  }
});

module.exports = router;
