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
      const auth = new google.auth.GoogleAuth(
        env.credentialsJson
          ? { credentials: env.credentialsJson, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }
          : { keyFile: path.resolve(env.credentialsPath), scopes: ['https://www.googleapis.com/auth/spreadsheets'] },
      );
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

// --- Acceso a OTRAS planillas (no la de configuración de env.sheetId) ---
// Las usan la ingesta de salida_manual_* y la réplica a "Tareas" (punto 3
// del plan): mismo cliente y misma Service Account, distinto spreadsheetId.

// Freno de escritura por planilla. Del 2026-09-11 al 2026-09-14 estuvo acá
// la planilla de PRODUCCIÓN "Appsheet - Tareas de Asana"
// (180z6MdtteHN0yuT_EI1AMKZ6fjdwU_EDArxbrkNRTMw), después de que un
// reintento mal acotado le escribió 61 filas de prueba. El usuario la
// habilitó el 2026-09-14 para la prueba de Tareas → Make → Asana. Si hay
// que volver a frenarla, se agrega el ID a esta lista y listo.
const PLANILLAS_PROHIBIDAS = new Set([]);
function verificarEscrituraPermitida(spreadsheetId) {
  if (PLANILLAS_PROHIBIDAS.has(String(spreadsheetId || '').trim())) {
    throw new Error(`Escritura bloqueada: la planilla ${spreadsheetId} es de producción (Tareas de Asana) y está prohibida por el usuario.`);
  }
}

/**
 * Lee una pestaña entera de cualquier planilla y la devuelve como array de
 * objetos (primera fila = encabezados), igual que readTable.
 */
async function readRange(spreadsheetId, sheetName) {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: sheetName });
  const rows = res.data.values || [];
  if (rows.length === 0) return [];
  const [headers, ...body] = rows;
  return body
    .filter((row) => row.some((cell) => cell !== undefined && cell !== ''))
    .map((row) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
      return obj;
    });
}

/**
 * Agrega varias filas al final de una pestaña de cualquier planilla —
 * valores posicionales, en el orden de columnas de esa hoja.
 */
async function appendRowsTo(spreadsheetId, sheetName, filas) {
  verificarEscrituraPermitida(spreadsheetId);
  if (!filas.length) return;
  const sheets = await getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: sheetName,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: filas },
  });
}

/**
 * Actualiza campos de una fila existente. Sin probar todavía — modo google
 * no está en uso (ver README). Requiere ubicar el número de fila real antes
 * de poder hacer un values.update con un range puntual.
 */
/**
 * Reemplaza una pestaña entera de cualquier planilla con `valores` (matriz,
 * primera fila = encabezados). La crea si no existe. Deja la primera fila en
 * negrita y congelada. La usa el volcado diario de tablas (insumosSheet.js).
 */
async function replaceSheetTo(spreadsheetId, sheetName, valores) {
  verificarEscrituraPermitida(spreadsheetId);
  const sheets = await getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  let props = meta.data.sheets.map((s) => s.properties).find((p) => p.title === sheetName);
  if (!props) {
    const r = await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] } });
    props = r.data.replies[0].addSheet.properties;
  }
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: sheetName });
  await sheets.spreadsheets.values.update({ spreadsheetId, range: `${sheetName}!A1`, valueInputOption: 'RAW', requestBody: { values: valores } });
  const columnas = Math.max(1, ...valores.map((f) => f.length));
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    { repeatCell: { range: { sheetId: props.sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 } } }, fields: 'userEnteredFormat(textFormat.bold,backgroundColor)' } },
    { updateSheetProperties: { properties: { sheetId: props.sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    { autoResizeDimensions: { dimensions: { sheetId: props.sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: Math.min(columnas, 30) } } },
  ] } });
  return { sheetId: props.sheetId, filas: valores.length - 1 };
}

/**
 * Garantiza que la fila 1 de una pestaña tenga estos encabezados al final
 * (agrega los que falten, en orden, ampliando la grilla si hace falta). No
 * mueve ni pisa columnas existentes. Devuelve la fila de encabezados final.
 */
async function asegurarEncabezados(spreadsheetId, sheetName, encabezados) {
  verificarEscrituraPermitida(spreadsheetId);
  const sheets = await getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const props = meta.data.sheets.map((s) => s.properties).find((p) => p.title === sheetName);
  if (!props) throw new Error(`No existe la pestaña "${sheetName}".`);
  const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!1:1` });
  const actuales = (r.data.values && r.data.values[0]) || [];
  const faltan = encabezados.filter((h) => !actuales.includes(h));
  if (!faltan.length) return actuales;
  const total = actuales.length + faltan.length;
  const columnas = props.gridProperties.columnCount || 0;
  if (total > columnas) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ appendDimension: { sheetId: props.sheetId, dimension: 'COLUMNS', length: total - columnas } }] } });
  }
  const desde = actuales.length + 1;
  const letra = (n) => { let s = ''; let x = n; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s; };
  await sheets.spreadsheets.values.update({ spreadsheetId, range: `${sheetName}!${letra(desde)}1:${letra(total)}1`, valueInputOption: 'RAW', requestBody: { values: [faltan] } });
  return [...actuales, ...faltan];
}

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

module.exports = { readTable, appendRow, updateRow, updateRowWhere, readRange, appendRowsTo, replaceSheetTo, asegurarEncabezados, verificarEscrituraPermitida };
