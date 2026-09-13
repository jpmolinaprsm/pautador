// Resuelve el usuario "actuando" (header x-pautador-usuario, elegido en la
// pantalla de Login) y lo deja en req.usuario — así cada ruta puede aplicar
// su propia regla de rol/proyecto sin repetir la búsqueda. req.usuario queda
// null si no vino header o el id no existe (rutas sensibles lo tratan como
// "sin acceso").
//
// Junto con el usuario, el front manda el Proyecto, el Ecosistema
// (Oficial/Informativo) y el Modo (automatizado/normal) elegidos en el
// onboarding (x-pautador-proyecto / x-pautador-ecosistema /
// x-pautador-modo) — quedan en req.proyectoActivo / req.ecosistemaActivo /
// req.modoActivo. Se VALIDAN acá contra lo que el usuario realmente puede
// ver (mismo criterio que requireRol: no alcanza con esconder el selector
// en el front), así ninguna ruta puede terminar operando sobre un
// proyecto/ecosistema/modo ajeno aunque el header venga mal.
//
// Modo separa CÓMO se ejecuta un pedido, distinto de Ecosistema (a QUIÉN
// pertenece el contenido): "automatizado" es el recorte a MVP (Media/Baja,
// Alcance/Interacción, sin Validación — ver src/config/mvp.js), "normal"
// es todo lo demás (Alta, otras plataformas/objetivos) — nunca lo publica
// PAUTADOR solo, siempre se carga a mano y se marca hecho (ver
// getMatrizParaPauta en colaPautas.js). Sin header válido, se trata como
// "normal" (el default más conservador: nunca toca la API de Meta solo).

const { getUsuarioPorId, tieneAccesoAProyecto } = require('../services/usuarios');

const ECOSISTEMAS_VALIDOS = ['Oficial', 'Informativo'];
const MODOS_VALIDOS = ['automatizado', 'normal'];

async function usuarioActual(req, res, next) {
  try {
    req.usuario = await getUsuarioPorId(req.header('x-pautador-usuario'));
    // Deshabilitado desde Panel Usuarios = como si no existiera (aunque el
    // browser tenga el id guardado de antes).
    if (req.usuario && req.usuario.habilitado === false) req.usuario = null;
  } catch (err) {
    req.usuario = null;
  }

  req.proyectoActivo = null;
  req.ecosistemaActivo = null;
  req.modoActivo = null;
  if (req.usuario) {
    const proyectoHeader = req.header('x-pautador-proyecto') || '';
    const ecosistemaHeader = req.header('x-pautador-ecosistema') || '';
    const modoHeader = req.header('x-pautador-modo') || '';
    const esAdmin = req.usuario.rol === 'administrador';
    if (proyectoHeader === 'TODOS' && esAdmin) {
      req.proyectoActivo = 'TODOS';
    } else if (proyectoHeader && tieneAccesoAProyecto(req.usuario, proyectoHeader)) {
      req.proyectoActivo = proyectoHeader;
    }
    if (ecosistemaHeader === 'TODOS' && esAdmin) {
      req.ecosistemaActivo = 'TODOS';
    } else if (ECOSISTEMAS_VALIDOS.includes(ecosistemaHeader)) {
      req.ecosistemaActivo = ecosistemaHeader;
    }
    if (MODOS_VALIDOS.includes(modoHeader)) {
      req.modoActivo = modoHeader;
    }
  }
  next();
}

// Para usar en una ruta puntual: requireRol('implementador', 'administrador')
function requireRol(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ error: 'Elegí un usuario (arriba a la derecha) para hacer esto.' });
    }
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: `Tu rol ("${req.usuario.rol}") no tiene acceso a esta acción.` });
    }
    next();
  };
}

module.exports = { usuarioActual, requireRol, ECOSISTEMAS_VALIDOS, MODOS_VALIDOS };
