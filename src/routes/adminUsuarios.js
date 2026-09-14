// Panel Usuarios (pestaña de administradores): alta por mail y asignación
// de Proyectos y Activos por usuario. Las reglas de quién puede tocar qué
// (superadmin, deshabilitar, cambiar rol) viven en services/usuarios.js —
// acá solo se traduce HTTP.
const express = require('express');
const { requireRol } = require('../middleware/usuarioActual');
const { getUsuarios, serializarUsuario, crearUsuarioAdmin, actualizarUsuarioAdmin, ROLES } = require('../services/usuarios');
const { getActivos, getActivoPorKey } = require('../services/configActivos');
const { resumenProyectos, fijarEstado } = require('../services/proyectos');
const { estadoCuentas, armarMail, enviarResumen, smtpConfigurado, verificarSmtp } = require('../services/alertasPresupuesto');

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

// GET /api/admin/presupuestos — presupuesto restante por cuenta automatizada
// (lo mismo que va en el mail diario). POST /api/admin/presupuestos/enviar —
// manda el mail ahora (para probar la configuración SMTP).
// GET /api/admin/diagnostico-meta?activo_key=&post_id= — crea (y borra) un
// creative político sobre una publicación existente para ver qué responde
// Meta DESDE ESTE SERVIDOR. Sirve para distinguir un problema del token de
// uno del lugar desde donde se llama (Railway está en EE.UU.; la
// autorización de anuncios políticos de Meta mira el país).
router.get('/admin/diagnostico-meta', requireRol('administrador'), async (req, res) => {
  const metaApi = require('../services/metaApi');
  try {
    const activo = await getActivoPorKey(String(req.query.activo_key || ''));
    if (!activo || !activo.ad_account_id) return res.status(400).json({ error: 'activo_key sin cuenta publicitaria' });
    const yo = await metaApi.graphGet('/me', { fields: 'id,name' });
    const postId = String(req.query.post_id || '');
    if (!postId) return res.json({ yo, nota: 'pasá post_id (page_id_postid) para probar el creative' });
    let creative = null;
    let errorCreative = null;
    try {
      creative = await metaApi.graphPost(`/${activo.ad_account_id}/adcreatives`, {
        name: 'DIAGNOSTICO PAUTADOR (se borra)',
        object_story_id: postId,
        authorization_category: activo.authorization_category || 'POLITICAL',
      });
      await metaApi.graphDelete(`/${creative.id}`).catch(() => {});
    } catch (err) {
      errorCreative = { message: err.message, meta: err.metaError || null };
    }
    res.json({ yo, cuenta: activo.ad_account_id, creativeOk: !!creative, errorCreative });
  } catch (err) {
    responderError(res, 'admin/diagnostico-meta', err);
  }
});

// GET /api/admin/diagnostico-smtp — prueba la conexión SMTP desde este
// servidor (sin mandar mail).
router.get('/admin/diagnostico-smtp', requireRol('administrador'), async (req, res) => {
  res.json(await verificarSmtp());
});

router.get('/admin/presupuestos', requireRol('administrador'), async (req, res) => {
  try {
    const filas = await estadoCuentas();
    res.json({ filas, mail: armarMail(filas), smtpConfigurado: smtpConfigurado() });
  } catch (err) {
    responderError(res, 'admin/presupuestos', err);
  }
});

router.post('/admin/presupuestos/enviar', requireRol('administrador'), async (req, res) => {
  try {
    res.json(await enviarResumen());
  } catch (err) {
    responderError(res, 'admin/presupuestos/enviar', err);
  }
});

module.exports = router;
