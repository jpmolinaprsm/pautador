// Único punto donde se decide de dónde vienen los datos: Excel local (mock),
// Google Sheets real, o Supabase (Postgres real). Todo el resto de la app
// (services, routes) importa ESTE archivo, nunca sheets.js/sheetsMock.js/
// db.js directamente — así cambiar de fuente es una sola línea en .env, no
// un cambio de código.

const env = require('../config/env');
const google = require('./sheets');
const mock = require('./sheetsMock');
const supabase = require('./db');

const IMPLS = { google, supabase, mock };
const impl = IMPLS[env.dataSource] || mock;

async function readTable(sheetName) {
  return impl.readTable(sheetName);
}

async function appendRow(sheetName, rowValues) {
  return impl.appendRow(sheetName, rowValues);
}

async function updateRow(sheetName, matchColumn, matchValue, updates) {
  return impl.updateRow(sheetName, matchColumn, matchValue, updates);
}

// Para filas que no se identifican con una sola columna (ej. una celda de
// matriz_distribucion = correlation_id + objetivo + audiencia_key).
async function updateRowWhere(sheetName, criterios, updates) {
  return impl.updateRowWhere(sheetName, criterios, updates);
}

// Agrega una fila a partir de un objeto {columna: valor} en vez de un array
// posicional. Supabase inserta por nombre directo (impl.insertObjeto) — no
// hace falta adivinar nada. Excel/Sheets sí necesitan un array posicional
// (una fila de spreadsheet no tiene "nombres de columna" propios): ahí se
// toma el orden real de una fila ya existente (sheet_to_json preserva el
// orden del header). Con la tabla vacía en Excel/Sheets se cae al orden de
// declaración de `campos` como último recurso — puede quedar mal si no
// coincide con el header real, pero ya no aplica a Supabase (ver bug real
// que esto tuvo: con cola_pautas vacía, un valor terminó en la columna
// timestamptz equivocada).
async function insertarFila(sheetName, campos) {
  if (impl.insertObjeto) return impl.insertObjeto(sheetName, campos);
  const todas = await readTable(sheetName);
  const header = todas.length ? Object.keys(todas[0]) : Object.keys(campos);
  await appendRow(sheetName, header.map((col) => (campos[col] !== undefined ? campos[col] : '')));
}

module.exports = { readTable, appendRow, updateRow, updateRowWhere, insertarFila };
