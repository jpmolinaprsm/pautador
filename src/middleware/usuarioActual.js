// Resuelve el usuario "actuando" (header x-pautador-usuario, elegido en la
// pantalla de Login) y lo deja en req.usuario — así cada ruta puede aplicar
// su propia regla de rol/proyecto sin repetir la búsqueda. req.usuario queda
// null si no vino header o el id no existe (rutas sensibles lo tratan como
// "sin acceso").
//
// Junto con el usuario, el front manda el Proyecto y el Ecosistema
// (Oficial/Informativo) elegidos en las pantallas 2 y 3 del onboarding
// (x-pautador-proyecto / x-pautador-ecosistema) — quedan en
// req.proyectoActivo / req.ecosistemaActivo. Se VALIDAN acá contra lo que
// el usuario realmente puede ver (mismo criterio que requireRol: no alcanza
// con esconder el selector en el front), así ninguna ruta puede terminar
// operando sobre un proyecto/ecosistema ajeno aunque el header venga mal.

const { getUsuarioPorId, tieneAccesoAProyecto } = require('../services/usuarios');

const ECOSISTEMAS_VALIDOS = ['Oficial', 'Informativo'];

async function usuarioActual(req, res, next) {
  try {
    req.usuario = await getUsuarioPorId(req.header('x-pautador-usuario'));
  } catch (err) {
    req.usuario = null;
  }

  req.proyectoActivo = null;
  req.ecosistemaActivo = null;
  if (req.usuario) {
    const proyectoHeader = req.header('x-pautador-proyecto') || '';
    const ecosistemaHeader = req.header('x-pautador-ecosistema') || '';
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

module.exports = { usuarioActual, requireRol, ECOSISTEMAS_VALIDOS };
