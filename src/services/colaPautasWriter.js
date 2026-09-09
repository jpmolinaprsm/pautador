// Inserta una fila nueva en cola_pautas — usado por los dos flujos de
// "Crear Anuncios" (publicar contenido existente / crear anuncio Dark).
// Delega en dataSource.insertarFila (inserta por nombre de columna en
// Supabase, sin adivinar orden — ver ese archivo para el porqué: con la
// tabla vacía, adivinar el orden metía valores en columnas equivocadas).

const { insertarFila } = require('./dataSource');

async function insertarFilaColaPautas(campos) {
  await insertarFila('cola_pautas', campos);
}

module.exports = { insertarFilaColaPautas };
