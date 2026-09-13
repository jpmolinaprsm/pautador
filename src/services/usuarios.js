// Entran acá los usuarios de demo originales Y los que se loguean con
// Google (ver resolverUsuarioValidado, usado desde routes/auth.js). El
// front manda el id (= el mail, para los nuevos) en el header
// x-pautador-usuario en cada request; acá se resuelve rol + accesos
// permitidos para filtrar tabs y datos server-side (ver
// middleware/usuarioActual.js) — la sesión de Google confirma QUIÉN es,
// pero el permiso de qué puede ver/hacer sigue siendo 100% este archivo.
//
// Permisos (Panel Usuarios, 2026-09-11):
//  - administrador: ve TODOS los proyectos y activos. No tiene filas de
//    acceso. Solo un superadmin (usuarios.es_superadmin) puede dar o
//    sacar ese rol.
//  - implementador / pm_cuentas: ven SOLO lo que tienen en usuario_accesos —
//    una fila por (proyecto, activo_key); activo_key vacío = todos los
//    activos de ese proyecto, incluidos los que se carguen después.
//  - habilitado=false: el usuario existe pero no entra (ni por login ni
//    por header) — para sacar a alguien sin borrar su historial.
// La columna vieja usuarios.proyectos ("A,B,C" o "todos") se sigue leyendo
// como respaldo por si la migración 007 no corrió todavía; la migración la
// vacía y el panel no la escribe más.

const { readTable, insertarFila, updateRow, deleteRowsWhere } = require('./dataSource');
const env = require('../config/env');

const ROLES = ['pm_cuentas', 'implementador', 'administrador'];

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Los accesos vienen pegados a cada usuario (u.accesos = [{proyecto,
// activo_key}]) — así proyectosPermitidos/activosPermitidos siguen siendo
// sincrónicas y los callers de siempre (items.js, publicaciones.js,
// middleware) no cambian. Si la tabla no existe (migración 007 sin correr)
// se avisa una vez y se sigue con la columna vieja.
let avisoAccesos = false;
async function leerAccesos() {
  try {
    return await readTable('usuario_accesos');
  } catch (err) {
    if (!avisoAccesos) {
      avisoAccesos = true;
      console.warn('[usuarios] no pude leer usuario_accesos (¿falta correr supabase/migration_007_usuario_accesos.sql?):', err.message);
    }
    return [];
  }
}

function pegarAccesos(usuarios, accesos) {
  return usuarios.map((u) => ({
    ...u,
    es_superadmin: u.es_superadmin === true,
    habilitado: u.habilitado !== false,
    accesos: accesos
      .filter((a) => a.usuario_id === u.id)
      .map((a) => ({ proyecto: a.proyecto, activo_key: a.activo_key || '' })),
  }));
}

// Si la migración 007 no corrió, las columnas es_superadmin/habilitado no
// existen y la lectura entera falla — se reintenta con las columnas viejas
// para no dejar a nadie sin poder entrar (aviso una vez en consola).
const COLUMNAS_USUARIOS_VIEJAS = ['id', 'nombre', 'rol', 'proyectos', 'email'];
let avisoUsuarios = false;
async function leerUsuarios() {
  try {
    return await readTable('usuarios');
  } catch (err) {
    if (!/es_superadmin|habilitado/.test(err.message)) throw err;
    if (!avisoUsuarios) {
      avisoUsuarios = true;
      console.warn('[usuarios] falta correr supabase/migration_007_usuario_accesos.sql — leyendo usuarios sin superadmin/habilitado:', err.message);
    }
    return readTable('usuarios', COLUMNAS_USUARIOS_VIEJAS);
  }
}

async function getUsuarios() {
  const [usuarios, accesos] = await Promise.all([leerUsuarios(), leerAccesos()]);
  return pegarAccesos(usuarios, accesos);
}

async function getUsuarioPorId(id) {
  if (!id) return null;
  const usuarios = await getUsuarios();
  return usuarios.find((u) => u.id === id) || null;
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

function validarEmailDominio(emailCrudo) {
  const email = normalizarEmail(emailCrudo);
  const dominio = email.split('@')[1];
  if (!email || !dominio || !email.split('@')[0]) {
    const err = new Error('Escribí un mail válido.');
    err.status = 400;
    throw err;
  }
  if (dominio !== env.authDominio) {
    const err = new Error(`Solo se puede entrar con un mail "@${env.authDominio}".`);
    err.status = 403;
    throw err;
  }
  return email;
}

// Usado por el login con Google (routes/auth.js, después de verificar el
// id_token) y por el formulario de mail de respaldo (mismo endpoint, ver
// loginPorEmail) — matchea/crea por email, mismo mecanismo de siempre para
// el resto de la app (header x-pautador-usuario, ver middleware/usuarioActual).
//
// Con AUTH_ALTA_LIBRE=1 (hoy) un mail del dominio que todavía no está en la
// tabla entra igual, sin ningún acceso — ve la pantalla de Proyecto vacía
// hasta que un administrador se lo asigne en Panel Usuarios. Con 0 solo
// entra quien ya fue dado de alta.
async function resolverUsuarioValidado(emailCrudo, nombreSugerido) {
  const email = validarEmailDominio(emailCrudo);
  const existente = await getUsuarioPorEmail(email);
  if (existente) {
    if (!existente.habilitado) {
      const err = new Error('Tu usuario está deshabilitado — pedile a un administrador que lo vuelva a habilitar.');
      err.status = 403;
      throw err;
    }
    return existente;
  }
  if (!env.authAltaLibre) {
    const err = new Error('Tu mail todavía no está dado de alta — pedile a un administrador que te agregue en Panel Usuarios.');
    err.status = 403;
    throw err;
  }
  const nuevo = { id: email, email, nombre: nombreSugerido || nombreDesdeEmail(email), rol: 'pm_cuentas', proyectos: '' };
  await insertarFila('usuarios', nuevo);
  return { ...nuevo, es_superadmin: false, habilitado: true, accesos: [] };
}

// Formulario de mail — respaldo para cuando GOOGLE_CLIENT_ID no está
// configurado (ver env.js y GET /api/auth/config). Misma validación que el
// login con Google, solo que sin verificar nada contra Google.
async function loginPorEmail(emailCrudo) {
  return resolverUsuarioValidado(emailCrudo);
}

function esAdmin(usuario) {
  return !!usuario && usuario.rol === 'administrador';
}

// Columna vieja `proyectos` — respaldo hasta que corra la migración 007.
function proyectosLegacy(usuario) {
  const crudo = String(usuario.proyectos || '').trim();
  if (crudo.toLowerCase() === 'todos') return 'todos';
  return crudo.split(',').map((p) => p.trim()).filter(Boolean);
}

// 'todos' (solo administradores) o la lista de nombres de Proyecto.
function proyectosPermitidos(usuario) {
  if (!usuario) return [];
  if (esAdmin(usuario)) return 'todos';
  const legacy = proyectosLegacy(usuario);
  if (legacy === 'todos') return 'todos';
  const set = new Set(legacy);
  (usuario.accesos || []).forEach((a) => set.add(a.proyecto));
  return [...set];
}

function tieneAccesoAProyecto(usuario, proyecto) {
  const permitidos = proyectosPermitidos(usuario);
  if (permitidos === 'todos') return true;
  return permitidos.includes(proyecto);
}

// 'todos' (admin, o acceso a todo el proyecto) o la lista de activo_key
// permitidos dentro de ese proyecto (vacía = ninguno).
function activosPermitidos(usuario, proyecto) {
  if (!usuario) return [];
  if (esAdmin(usuario)) return 'todos';
  const legacy = proyectosLegacy(usuario);
  if (legacy === 'todos' || legacy.includes(proyecto)) return 'todos';
  const delProyecto = (usuario.accesos || []).filter((a) => a.proyecto === proyecto);
  if (delProyecto.some((a) => !a.activo_key)) return 'todos';
  return delProyecto.map((a) => a.activo_key);
}

function tieneAccesoAActivo(usuario, proyecto, activoKey) {
  const permitidos = activosPermitidos(usuario, proyecto);
  if (permitidos === 'todos') return true;
  return permitidos.includes(activoKey);
}

// Lo que ve el front (nav, login, Panel Usuarios). `proyectos` se sigue
// mandando como texto ("todos" o "A,B") porque app.js lo usa así para
// decidir la pantalla de Proyecto — se arma desde los accesos, no de la
// columna vieja.
function serializarUsuario(u) {
  const permitidos = proyectosPermitidos(u);
  return {
    id: u.id,
    nombre: u.nombre,
    rol: u.rol,
    email: u.email || '',
    proyectos: permitidos === 'todos' ? 'todos' : permitidos.join(','),
    es_superadmin: u.es_superadmin === true,
    habilitado: u.habilitado !== false,
    accesos: u.accesos || [],
  };
}

// ---------- Panel Usuarios (solo administradores, ver routes/adminUsuarios.js) ----------

function errorHttp(msg, status) {
  const err = new Error(msg);
  err.status = status;
  return err;
}

function normalizarAccesos(accesos) {
  const vistos = new Set();
  const out = [];
  (Array.isArray(accesos) ? accesos : []).forEach((a) => {
    const proyecto = String((a && a.proyecto) || '').trim();
    const activoKey = String((a && a.activo_key) || '').trim();
    if (!proyecto) return;
    const clave = proyecto + '|' + activoKey;
    if (vistos.has(clave)) return;
    vistos.add(clave);
    out.push({ proyecto, activo_key: activoKey });
  });
  // Si un proyecto está "completo" (activo_key vacío), las filas por activo
  // de ese mismo proyecto sobran.
  const completos = new Set(out.filter((a) => !a.activo_key).map((a) => a.proyecto));
  return out.filter((a) => !a.activo_key || !completos.has(a.proyecto));
}

async function reemplazarAccesos(usuarioId, accesos, porQuien) {
  await deleteRowsWhere('usuario_accesos', { usuario_id: usuarioId });
  for (const a of accesos) {
    // eslint-disable-next-line no-await-in-loop
    await insertarFila('usuario_accesos', { usuario_id: usuarioId, proyecto: a.proyecto, activo_key: a.activo_key || '', creado_por: porQuien });
  }
}

// Qué puede hacer `quien` (el admin logueado) sobre `objetivo` (el usuario
// que se edita) — las reglas del usuario: solo un superadmin designa o
// revoca administradores; a un superadmin no lo toca nadie más que él
// mismo; nadie se deshabilita a sí mismo.
function verificarPuedeEditar(quien, objetivo, cambios) {
  if (!esAdmin(quien)) throw errorHttp('Solo un administrador puede administrar usuarios.', 403);
  const soySuper = quien.es_superadmin === true;
  if (objetivo && objetivo.es_superadmin && quien.id !== objetivo.id) {
    throw errorHttp('A un superadmin solo lo puede editar él mismo.', 403);
  }
  const cambiaRol = cambios.rol !== undefined && (!objetivo || cambios.rol !== objetivo.rol);
  if (cambiaRol && (cambios.rol === 'administrador' || (objetivo && objetivo.rol === 'administrador')) && !soySuper) {
    throw errorHttp('Solo un superadmin puede designar o revocar administradores.', 403);
  }
  if (objetivo && objetivo.es_superadmin && (cambios.habilitado === false || (cambiaRol && cambios.rol !== 'administrador'))) {
    throw errorHttp('El superadmin no se puede deshabilitar ni dejar de ser administrador.', 400);
  }
  if (objetivo && quien.id === objetivo.id && cambios.habilitado === false) {
    throw errorHttp('No te podés deshabilitar a vos mismo.', 400);
  }
}

async function crearUsuarioAdmin(quien, datos) {
  const email = validarEmailDominio(datos.email);
  const rol = ROLES.includes(datos.rol) ? datos.rol : 'pm_cuentas';
  verificarPuedeEditar(quien, null, { rol });
  if (await getUsuarioPorEmail(email)) throw errorHttp(`"${email}" ya está dado de alta.`, 409);
  const accesos = rol === 'administrador' ? [] : normalizarAccesos(datos.accesos);
  const nuevo = {
    id: email, email, nombre: String(datos.nombre || '').trim() || nombreDesdeEmail(email),
    rol, proyectos: rol === 'administrador' ? 'todos' : '', es_superadmin: false, habilitado: true,
  };
  await insertarFila('usuarios', nuevo);
  if (accesos.length) await reemplazarAccesos(email, accesos, quien.id);
  return getUsuarioPorId(email);
}

async function actualizarUsuarioAdmin(quien, id, cambios) {
  const objetivo = await getUsuarioPorId(id);
  if (!objetivo) throw errorHttp('Ese usuario no existe.', 404);
  const rol = cambios.rol !== undefined ? cambios.rol : objetivo.rol;
  if (!ROLES.includes(rol)) throw errorHttp(`Rol inválido: "${rol}".`, 400);
  const habilitado = cambios.habilitado !== undefined ? cambios.habilitado === true : objetivo.habilitado;
  verificarPuedeEditar(quien, objetivo, { rol, habilitado });

  const updates = { rol, habilitado };
  if (cambios.nombre !== undefined && String(cambios.nombre).trim()) updates.nombre = String(cambios.nombre).trim();
  // Un admin no tiene accesos por fila (ve todo); si deja de serlo, arranca
  // con los que vengan en el mismo pedido (o ninguno).
  updates.proyectos = rol === 'administrador' ? 'todos' : '';
  await updateRow('usuarios', 'id', id, updates);

  if (rol === 'administrador') {
    await reemplazarAccesos(id, [], quien.id);
  } else if (cambios.accesos !== undefined || objetivo.rol === 'administrador') {
    await reemplazarAccesos(id, normalizarAccesos(cambios.accesos), quien.id);
  }
  return getUsuarioPorId(id);
}

module.exports = {
  ROLES,
  getUsuarios, getUsuarioPorId, getUsuarioPorEmail, resolverUsuarioValidado, loginPorEmail,
  proyectosPermitidos, tieneAccesoAProyecto, activosPermitidos, tieneAccesoAActivo,
  serializarUsuario, crearUsuarioAdmin, actualizarUsuarioAdmin, esAdmin,
};
