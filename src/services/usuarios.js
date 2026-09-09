// Entran acá los usuarios de demo originales Y los que se loguean con
// Google (ver resolverUsuarioValidado, usado desde routes/auth.js). El
// front manda el id (= el mail, para los nuevos) en el header
// x-pautador-usuario en cada request; acá se resuelve rol + proyectos
// permitidos para filtrar tabs y datos server-side (ver
// middleware/usuarioActual.js) — la sesión de Google confirma QUIÉN es,
// pero el permiso de qué puede ver/hacer sigue siendo 100% este archivo.

const { readTable, insertarFila } = require('./dataSource');
const env = require('../config/env');

async function getUsuarios() {
  return readTable('usuarios');
}

async function getUsuarioPorId(id) {
  if (!id) return null;
  const usuarios = await getUsuarios();
  return usuarios.find((u) => u.id === id) || null;
}

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function getUsuarioPorEmail(email) {
  const e = normalizarEmail(email);
  if (!e) return null;
  const usuarios = await getUsuarios();
  return usuarios.find((u) => normalizarEmail(u.email) === e) || null;
}

// "juan.pablo.molina" -> "Juan Pablo Molina" — solo para tener algo mejor
// que el mail crudo mientras no hay perfil real (Google OAuth sí va a traer
// el nombre de verdad).
function nombreDesdeEmail(email) {
  const local = email.split('@')[0];
  return local.split(/[.\-_]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join(' ') || email;
}

// Usado por el login con Google (routes/auth.js, después de verificar el
// id_token) y por el formulario de mail de respaldo (mismo endpoint, ver
// loginPorEmail) — matchea/crea por email, mismo mecanismo de siempre para
// el resto de la app (header x-pautador-usuario, ver middleware/usuarioActual).
//
// Un mail del dominio que todavía no está en la tabla entra igual (pedido
// del usuario: "que todos los users entren a este mock, yo después armo
// los accesos") pero sin ningún Proyecto asignado — ve la pantalla de
// onboarding vacía hasta que un administrador se lo dé desde la tabla.
async function resolverUsuarioValidado(emailCrudo, nombreSugerido) {
  const email = normalizarEmail(emailCrudo);
  const dominio = email.split('@')[1];
  if (!email || !dominio) {
    const err = new Error('Escribí un mail válido.');
    err.status = 400;
    throw err;
  }
  if (dominio !== env.authDominio) {
    const err = new Error(`Solo se puede entrar con un mail "@${env.authDominio}".`);
    err.status = 403;
    throw err;
  }
  const existente = await getUsuarioPorEmail(email);
  if (existente) return existente;
  const nuevo = { id: email, email, nombre: nombreSugerido || nombreDesdeEmail(email), rol: 'pm_cuentas', proyectos: '' };
  await insertarFila('usuarios', nuevo);
  return nuevo;
}

// Formulario de mail — respaldo para cuando GOOGLE_CLIENT_ID no está
// configurado (ver env.js y GET /api/auth/config). Misma validación que el
// login con Google, solo que sin verificar nada contra Google.
async function loginPorEmail(emailCrudo) {
  return resolverUsuarioValidado(emailCrudo);
}

function proyectosPermitidos(usuario) {
  if (!usuario) return [];
  const crudo = String(usuario.proyectos || '').trim();
  if (crudo.toLowerCase() === 'todos') return 'todos';
  return crudo.split(',').map((p) => p.trim()).filter(Boolean);
}

function tieneAccesoAProyecto(usuario, proyecto) {
  const permitidos = proyectosPermitidos(usuario);
  if (permitidos === 'todos') return true;
  return permitidos.includes(proyecto);
}

module.exports = {
  getUsuarios, getUsuarioPorId, getUsuarioPorEmail, resolverUsuarioValidado, loginPorEmail,
  proyectosPermitidos, tieneAccesoAProyecto,
};
