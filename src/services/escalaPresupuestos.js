// El presupuesto de un "Pedido de Pauta" (PM/Cuentas) ya no se elige a mano
// (Intensidad Baja/Media/Alta como tramo fijo, sin relación con nada): sale
// de dos cosas que el PM YA eligió — el Tipo de campaña (que define la
// Intensidad real: A/F=Alta, B/E=Media, C/D=Baja, ver equiv_tipo.intensidad)
// y el tamaño de la Audiencia principal (chica/mediana/grande, ver
// equiv_audiencia.tamaño) — cruzadas en escala_presupuestos. El PM nunca ve
// el monto resultante: lo ve recién el Implementador en Validación.

const { readTable } = require('./dataSource');

// Audiencia "Otra" (texto libre, sin fila real en equiv_audiencia) no tiene
// tamaño: es el único caso donde no hay de dónde sacarlo. En vez de bloquear
// el pedido entero, se asume "mediana" como piso razonable — el
// Implementador la ve y la puede ajustar en Validación como cualquier otra.
const TAMANO_DEFAULT_AUDIENCIA_OTRA = 'mediana';

async function resolverPresupuestoPorTipo(tipoCodigo, activoKeyEjecucion, audienciaCodigo) {
  const [tipos, audiencias, escala] = await Promise.all([
    readTable('equiv_tipo'),
    readTable('equiv_audiencia'),
    readTable('escala_presupuestos'),
  ]);

  const tipo = tipos.find((t) => t.codigo === tipoCodigo);
  if (!tipo) {
    const err = new Error(`El Tipo "${tipoCodigo}" no existe en equiv_tipo — no se puede resolver el presupuesto.`);
    err.status = 400;
    throw err;
  }

  // Algunos Tipos tienen un monto fijo, sin importar la Audiencia (ej.
  // "Pautas Army" = $75.000 siempre) — se resuelven acá y listo, sin tocar
  // escala_presupuestos ni pedir tamaño de audiencia.
  if (tipo.monto_fijo) return Number(tipo.monto_fijo);

  if (!tipo.intensidad) {
    const err = new Error(`El Tipo "${tipoCodigo}" no tiene Intensidad ni monto fijo definidos en equiv_tipo — no se puede resolver el presupuesto.`);
    err.status = 400;
    throw err;
  }

  let tamano = TAMANO_DEFAULT_AUDIENCIA_OTRA;
  if (audienciaCodigo && audienciaCodigo.toLowerCase() !== 'otra') {
    const audiencia = audiencias.find((a) => a.activo_key === activoKeyEjecucion && a.codigo_audiencia === audienciaCodigo);
    if (!audiencia || !audiencia['tamaño']) {
      const err = new Error(`La audiencia "${audienciaCodigo}" no tiene un tamaño (chica/mediana/grande) cargado en equiv_audiencia — no se puede resolver el presupuesto.`);
      err.status = 400;
      throw err;
    }
    tamano = audiencia['tamaño'];
  }

  const fila = escala.find((e) => e['tamaño'] === tamano && e.intensidad === tipo.intensidad);
  if (!fila || !fila.monto) {
    const err = new Error(`No hay presupuesto cargado en escala_presupuestos para Tamaño "${tamano}" × Intensidad "${tipo.intensidad}".`);
    err.status = 400;
    throw err;
  }
  return Number(fila.monto);
}

module.exports = { resolverPresupuestoPorTipo };
