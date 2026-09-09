const { readTable } = require('./dataSource');

async function getAudienciasPorActivo(activoKey) {
  const todas = await readTable('equiv_audiencia');
  return todas.filter((a) => a.activo_key === activoKey);
}

module.exports = { getAudienciasPorActivo };
