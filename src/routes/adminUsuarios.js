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

// GET /api/admin/instancia — con qué estado sale lo que publica ESTE
// proceso (producción: ACTIVE; una PC local: siempre PAUSED). Solo superadmin.
router.get('/admin/instancia', requireRol('administrador'), (req, res) => {
  if (!req.usuario.es_superadmin) return res.status(403).json({ error: 'Solo el superadmin.' });
  const env = require('../config/env');
  res.json({ instancia: env.instancia, enRailway: env.enRailway, automatizado: env.automatizadoEstadoInicial, ingesta: env.ingestaEstadoInicial, metaMode: env.metaMode });
});

// GET /api/admin/uso?dias=30 — resumen del registro de uso (solo superadmin,
// ver services/eventosUso.js).
router.get('/admin/uso', requireRol('administrador'), async (req, res) => {
  if (!req.usuario.es_superadmin) return res.status(403).json({ error: 'Solo el superadmin ve el uso.' });
  try {
    const dias = Math.min(365, Math.max(1, Number(req.query.dias) || 30));
    res.json(await require('../services/eventosUso').resumenUso(dias));
  } catch (err) {
    responderError(res, 'admin/uso', err);
  }
});

// POST /api/admin/insumos/exportar — vuelca ahora las tablas a la planilla
// de insumos (lo mismo que corre solo una vez por día).
router.post('/admin/insumos/exportar', requireRol('administrador'), async (req, res) => {
  try {
    res.json(await require('../services/insumosSheet').exportarTablas());
  } catch (err) {
    responderError(res, 'admin/insumos', err);
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

// GET /api/admin/creatividades?vencidas=1 — biblioteca de creatividades
// (bucket privado + tabla `creatividades`, ver services/storage.js) con los
// datos del pedido asociado (cola_pautas por correlation_id) y los ids de
// campaña/conjunto en Meta (matriz_distribucion). Solo superadmin (usuario,
// 2026-09-14: "una pestaña solo visible para mí"). La vista previa es un
// link firmado de 1 hora.
router.get('/admin/creatividades', requireRol('administrador'), async (req, res) => {
  if (!req.usuario.es_superadmin) return res.status(403).json({ error: 'Solo el superadmin ve la biblioteca de creatividades.' });
  const storage = require('../services/storage');
  const { readTable } = require('../services/dataSource');
  try {
    const conVencidas = String(req.query.vencidas || '') === '1';
    const [creas, pautas, matriz, activos] = await Promise.all([
      readTable('creatividades'), readTable('cola_pautas'), readTable('matriz_distribucion'), getActivos(),
    ]);
    const nombreActivo = (key) => { const a = activos.find((x) => x.activo_key === key); return a ? (a.activo || key) : key; };
    const filas = creas
      .filter((c) => conVencidas || !c.borrado_en)
      .sort((a, b) => String(b.creado_en || '').localeCompare(String(a.creado_en || '')));
    const salida = [];
    for (const c of filas) {
      // Pedidos que usan esta creatividad: por etiqueta (correlation_id) o por
      // material "creatividad:<id>" (carrusel: varios separados por "|").
      const usos = pautas.filter((p) => p.correlation_id && (p.correlation_id === c.correlation_id || String(p.material || '').split('|').map((s) => s.trim()).includes(`creatividad:${c.id}`)));
      const pedidos = usos.map((p) => {
        const celdas = matriz.filter((m) => m.correlation_id === p.correlation_id);
        return {
          correlation_id: p.correlation_id, codigo: p.codigo, proyecto: p.proyecto, activo: nombreActivo(p.activo), activo_key: p.activo,
          campana: p.campana, eje: p.eje, tipo: String(p.codigo || '').charAt(6), objetivo: p.objetivo, audiencia: p.audiencia,
          estado: p.estado, fecha: p.fecha, fecha_inicio: p.fecha_inicio, fecha_fin: p.fecha_fin, presupuesto: p.presupuesto, modo: p.modo, origen: p.origen || '',
          creador: p.creador || p.creado_por || '', plataforma: p.plataforma || 'Meta',
          meta: { campanas: [...new Set(celdas.map((m) => m.campaign_id).filter(Boolean))], conjuntos: celdas.filter((m) => m.adset_id).length, publicadas: celdas.filter((m) => m.estado_celda === 'publicada').length },
        };
      });
      let previewUrl = null;
      if (!c.borrado_en) { try { previewUrl = await storage.urlFirmada(c.storage_path, 3600); } catch (e) { previewUrl = null; } }
      salida.push({
        id: c.id, nombre: c.nombre_original, content_type: c.content_type, bytes: Number(c.bytes) || 0, width: c.width, height: c.height,
        origen: c.origen, link_original: c.link_original, subido_por: c.subido_por, creado_en: c.creado_en, expira_en: c.expira_en, borrado_en: c.borrado_en,
        etiquetas: { proyecto: c.proyecto, activo: c.activo_key ? nombreActivo(c.activo_key) : '', codigo: c.codigo, campana: c.campana, eje: c.eje },
        previewUrl, pedidos,
      });
    }
    res.json({ storageActivo: storage.habilitado(), total: salida.length, creatividades: salida });
  } catch (err) {
    responderError(res, 'admin/creatividades', err);
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
