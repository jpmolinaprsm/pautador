const express = require('express');
const env = require('../config/env');
const { getUsuarios, serializarUsuario } = require('../services/usuarios');
const { enviarMail, transporteDisponible } = require('../services/alertasPresupuesto');

const router = express.Router();

// Usuarios de demo (los originales de prueba, sin mail): solo los ve el
// superadmin (usuario, 2026-09-14: "sacar los usuarios demo, solo
// visibles para mí"). El resto ve únicamente usuarios reales.
function esDemo(u) {
  return !String(u.email || '').trim();
}

// GET /api/usuarios — lista de usuarios para el selector "actuar como" del
// nav y el login. Devuelve también los proyectos permitidos (texto, armado
// desde usuario_accesos): el front los necesita para decidir la pantalla
// de Proyecto sin preguntarle al server en cada tecleo. Los deshabilitados
// no aparecen (no pueden entrar).
router.get('/usuarios', async (req, res) => {
  try {
    const usuarios = await getUsuarios();
    const verDemo = !!(req.usuario && req.usuario.es_superadmin);
    res.json(usuarios.filter((u) => u.habilitado && (verDemo || !esDemo(u))).map((u) => {
      const s = serializarUsuario(u);
      return { id: s.id, nombre: s.nombre, rol: s.rol, proyectos: s.proyectos, email: s.email, es_superadmin: s.es_superadmin };
    }));
  } catch (err) {
    console.error('[usuarios]', err.message);
    res.status(500).json({ error: 'No se pudieron leer los usuarios', detalle: err.message });
  }
});

// POST /api/uso/entrada — el front avisa cuando alguien entra al
// app con proyecto/modo/canal elegidos. No hace nada: el registro lo
// escribe el middleware de uso (services/eventosUso.js, "Entró al app").
router.post('/uso/entrada', (req, res) => {
  if (!req.usuario) return res.status(401).json({ error: 'Sin usuario.' });
  require('../services/eventosUso').latido(req.usuario, req.body || {});
  res.json({ ok: true });
});

// POST /api/uso/latido — presencia en vivo: el navegador lo manda cada
// minuto y al cambiar de pestaña, con {pantalla, proyecto, modo, canal}.
// No se registra en la base (ver services/eventosUso.js).
router.post('/uso/latido', (req, res) => {
  if (!req.usuario) return res.status(401).json({ error: 'Sin usuario.' });
  require('../services/eventosUso').latido(req.usuario, req.body || {});
  res.json({ ok: true });
});

// POST /api/usuarios/pedir-asignacion — el usuario logueado (del dominio,
// dado de alta solo pero sin proyectos) pide que un administrador le asigne
// proyectos: mail a todos los administradores habilitados con mail (si no
// hay ninguno, a ALERTAS_MAIL_TO). Un pedido por usuario cada 10 minutos.
const ultimoPedido = new Map(); // usuario_id -> timestamp
router.post('/usuarios/pedir-asignacion', async (req, res) => {
  const u = req.usuario;
  if (!u) return res.status(401).json({ error: 'Entrá con tu usuario para pedir la asignación.' });
  if (u.rol === 'administrador') return res.status(400).json({ error: 'Sos administrador: te asignás los proyectos desde Panel Usuarios.' });
  const hace = Date.now() - (ultimoPedido.get(u.id) || 0);
  if (hace < 10 * 60 * 1000) return res.json({ ok: true, repetido: true, mensaje: 'Ya avisamos a los administradores hace un rato. Te van a asignar los proyectos en breve.' });
  try {
    if (!transporteDisponible()) throw new Error('El envío de mails no está configurado en el servidor.');
    const admins = (await getUsuarios()).filter((a) => a.habilitado && a.rol === 'administrador' && String(a.email || '').includes('@')).map((a) => a.email);
    const destinatarios = admins.length ? admins : env.alertasMailTo;
    const quien = `${u.nombre || u.id} (${u.email || u.id})`;
    const asunto = `PAUTADOR — ${u.nombre || u.id} pidió asignación de proyectos`;
    const texto = [
      `${quien} entró a PAUTADOR y todavía no tiene proyectos asignados.`,
      '',
      'Para asignárselos: PAUTADOR → Panel Usuarios → elegir el usuario → marcar los proyectos (y activos) que puede ver.',
      '',
      'Este aviso lo manda PAUTADOR cuando alguien toca "Pedir asignación de Proyectos".',
    ].join('\n');
    await enviarMail(asunto, texto, destinatarios);
    ultimoPedido.set(u.id, Date.now());
    console.log(`[usuarios] ${quien} pidió asignación de proyectos → ${destinatarios.join(', ')}`);
    res.json({ ok: true, destinatarios: destinatarios.length, mensaje: 'Listo: avisamos a los administradores. Cuando te asignen los proyectos, volvé a entrar.' });
  } catch (err) {
    console.error('[usuarios/pedir-asignacion]', err.message);
    res.status(500).json({ error: 'No se pudo mandar el aviso', detalle: err.message });
  }
});

module.exports = router;
