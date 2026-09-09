// Inserta una fila nueva en cola_pautas — usado por los dos flujos de
// "Crear Anuncios" (publicar contenido existente / crear anuncio Dark).
// El orden de columnas se toma de una fila ya existente (sheet_to_json
// preserva el orden del header real), así no hay que mantenerlo a mano.

const { readTable, appendRow } = require('./dataSource');

async function insertarFilaColaPautas(campos) {
  const todas = await readTable('cola_pautas');
  const header = todas.length ? Object.keys(todas[0]) : Object.keys(campos);
  await appendRow('cola_pautas', header.map((col) => (campos[col] !== undefined ? campos[col] : '')));
}

module.exports = { insertarFilaColaPautas };
