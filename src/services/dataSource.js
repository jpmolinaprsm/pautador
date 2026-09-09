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
// posicional — toma el orden real de columnas de una fila ya existente
// (sheet_to_json preserva el orden del header), así el caller no tiene que
// mantenerlo a mano ni romperse si el sheet le agrega columnas nuevas.
async function insertarFila(sheetName, campos) {
  const todas = await readTable(sheetName);
  const header = todas.length ? Object.keys(todas[0]) : Object.keys(campos);
  await appendRow(sheetName, header.map((col) => (campos[col] !== undefined ? campos[col] : '')));
}

module.exports = { readTable, appendRow, updateRow, updateRowWhere, insertarFila };
