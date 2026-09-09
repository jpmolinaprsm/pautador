const { readTable } = require('./dataSource');

// ETAPA BORRADOR: toda pauta se EJECUTA contra este activo, sin importar cuál
// se haya elegido en el formulario (el elegido queda guardado en
// "activo_solicitado", a fines de registro). Es el único activo cuya cuenta
// publicitaria le dio acceso a nuestro System User — las cuentas de los
// activos reales responden "(#200) owner has NOT granted ads_management".
// Cuando se habiliten los accesos, esto se saca y cada pieza va a su activo.
const ACTIVO_EJECUCION = 'test--tres-empanadas';

async function getActivos() {
  return readTable('config_activos');
}

async function getActivoPorKey(activoKey) {
  const activos = await getActivos();
  return activos.find((a) => a.activo_key === activoKey) || null;
}

// El activo con el que se habla con Meta de verdad (ver ACTIVO_EJECUCION).
async function getActivoEjecucion() {
  return getActivoPorKey(ACTIVO_EJECUCION);
}

module.exports = { getActivos, getActivoPorKey, getActivoEjecucion, ACTIVO_EJECUCION };
