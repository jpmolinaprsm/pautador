// Capa única de acceso a Google Sheets. Todo lo demás (config_activos,
// equivalencias, cola_pautas, registro) lee/escribe a través de estas
// dos funciones genéricas — así el nombre de las hojas y la forma de leerlas
// vive en un solo lugar, igual que el principio del Plan A ("la lógica de
// negocio existe en un solo lugar").

const path = require('path');
const { google } = require('googleapis');
const env = require('../config/env');

let sheetsClientPromise = null;

function getClient() {
  if (!sheetsClientPromise) {
    sheetsClientPromise = (async () => {
      const auth = new google.auth.GoogleAuth({
        keyFile: path.resolve(env.credentialsPath),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      const authClient = await auth.getClient();
      return google.sheets({ version: 'v4', auth: authClient });
    })();
  }
  return sheetsClientPromise;
}

/**
 * Lee una hoja completa y la devuelve como array de objetos.
 * La primera fila se toma como encabezado (nombres de columna).
 * @param {string} sheetName - nombre de la pestaña, ej. "config_activos"
 */
async function readTable(sheetName) {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: env.sheetId,
    range: sheetName,
  });

  const rows = res.data.values || [];
  if (rows.length === 0) return [];

  const [headers, ...body] = rows;
  return body
    .filter((row) => row.some((cell) => cell !== undefined && cell !== ''))
    .map((row) => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] !== undefined ? row[i] : '';
      });
      return obj;
    });
}

/**
 * Agrega una fila al final de una hoja.
 * @param {string} sheetName
 * @param {Array} rowValues - valores en el mismo orden que las columnas del sheet
 */
async function appendRow(sheetName, rowValues) {
  const sheets = await getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: env.sheetId,
    range: sheetName,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowValues] },
  });
}

/**
 * Actualiza campos de una fila existente. Sin probar todavía — modo google
 * no está en uso (ver README). Requiere ubicar el número de fila real antes
 * de poder hacer un values.update con un range puntual.
 */
async function updateRow() {
  throw new Error(
    'updateRow no está implementado para DATA_SOURCE=google todavía — solo modo mock lo soporta por ahora.'
  );
}

async function updateRowWhere() {
  throw new Error(
    'updateRowWhere no está implementado para DATA_SOURCE=google todavía — solo modo mock lo soporta por ahora.'
  );
}

module.exports = { readTable, appendRow, updateRow, updateRowWhere };
