// Misma interfaz que sheets.js (readTable / appendRow), pero leyendo directo
// de los Excel que ya están en Tablas/ — sin Google Cloud, sin credenciales.
// Ideal para probar la UI de PAUTADOR (cola de pendientes + matriz) ya mismo.
//
// Cuando quieras conectar la Sheet real, alcanza con poner DATA_SOURCE=google
// en el .env — no hay que tocar ni las rutas ni el frontend, todos hablan
// contra services/dataSource.js, no contra este archivo directamente.

const path = require('path');
const XLSX = require('xlsx');
const env = require('../config/env');

// Qué Excel y qué filas de "ayuda" (encabezado explicado, ejemplos) hay que
// saltear en cada tabla. Los índices son sobre las filas DE DATOS, es decir
// ya sin contar la fila 1 (los nombres de columna).
const TABLAS = {
  config_activos: { archivo: 'operaciones-pauta-meta.xlsx', saltear: [] },
  equiv_objetivo: { archivo: 'operaciones-pauta-meta.xlsx', saltear: [] },
  equiv_formato: { archivo: 'operaciones-pauta-meta.xlsx', saltear: [] },
  equiv_tipo: { archivo: 'operaciones-pauta-meta.xlsx', saltear: [] },
  equiv_eje: { archivo: 'operaciones-pauta-meta.xlsx', saltear: [] },
  cola_pautas: { archivo: 'operaciones-pauta-meta.xlsx', saltear: [0] }, // fila "← AppSheet escribe"
  registro: { archivo: 'operaciones-pauta-meta.xlsx', saltear: [] },
  matriz_distribucion: { archivo: 'operaciones-pauta-meta.xlsx', saltear: [] },
  campanas_meta: { archivo: 'operaciones-pauta-meta.xlsx', saltear: [] },
  usuarios: { archivo: 'operaciones-pauta-meta.xlsx', saltear: [] },
  'equiv_audiencia': { archivo: 'tabla-audiencias-vacía.xlsx', saltear: [0] },
  'escala_presupuestos': { archivo: 'tabla-presupuestos-vacía.xlsx', saltear: [0] },
};

function abrirHoja(sheetName) {
  const info = TABLAS[sheetName];
  if (!info) {
    throw new Error(
      `No sé en qué Excel vive "${sheetName}" en modo mock — agregalo a TABLAS en sheetsMock.js`
    );
  }
  const filePath = path.resolve(__dirname, '..', '..', env.mockDataDir, info.archivo);
  let wb;
  try {
    wb = XLSX.readFile(filePath);
  } catch (err) {
    throw new Error(`No pude abrir ${filePath}: ${err.message}`);
  }
  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`"${info.archivo}" no tiene una pestaña llamada exactamente "${sheetName}"`);
  }
  return { wb, filePath };
}

function readTable(sheetName) {
  const info = TABLAS[sheetName];
  if (!info) {
    throw new Error(
      `No sé en qué Excel vive "${sheetName}" en modo mock — agregalo a TABLAS en sheetsMock.js`
    );
  }

  const filePath = path.resolve(__dirname, '..', '..', env.mockDataDir, info.archivo);
  let wb;
  try {
    wb = XLSX.readFile(filePath);
  } catch (err) {
    throw new Error(`No pude abrir ${filePath}: ${err.message}`);
  }

  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`"${info.archivo}" no tiene una pestaña llamada exactamente "${sheetName}"`);
  }

  const filas = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  return filas
    .filter((_, idx) => !info.saltear.includes(idx))
    .filter((fila) => Object.values(fila).some((v) => String(v).trim() !== ''));
}

// Agrega una fila al final de la hoja. rowValues va en el mismo orden que
// el encabezado de la hoja (misma interfaz que sheets.js/Google).
function appendRow(sheetName, rowValues) {
  const { wb, filePath } = abrirHoja(sheetName);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
  rows.push(rowValues);
  wb.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(rows);
  XLSX.writeFile(wb, filePath);
}

// Busca la fila donde columna `matchColumn` == `matchValue` y pisa los
// campos de `updates` ({ columna: valor }). Usado para transicionar el
// estado de cola_pautas cuando el pautador confirma una pieza.
function updateRow(sheetName, matchColumn, matchValue, updates) {
  const { wb, filePath } = abrirHoja(sheetName);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
  const header = rows[0];
  const matchIdx = header.indexOf(matchColumn);
  if (matchIdx === -1) {
    throw new Error(`"${sheetName}" no tiene una columna "${matchColumn}"`);
  }
  const rowIdx = rows.findIndex((r, i) => i > 0 && r[matchIdx] === matchValue);
  if (rowIdx === -1) {
    throw new Error(`No encontré en "${sheetName}" una fila con ${matchColumn}="${matchValue}"`);
  }
  Object.entries(updates).forEach(([col, val]) => {
    const idx = header.indexOf(col);
    if (idx === -1) {
      throw new Error(`"${sheetName}" no tiene una columna "${col}"`);
    }
    rows[rowIdx][idx] = val;
  });
  wb.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(rows);
  XLSX.writeFile(wb, filePath);
}

// Igual que updateRow pero matcheando por VARIAS columnas — una celda de
// matriz_distribucion no se identifica con una sola (hace falta
// correlation_id + objetivo + audiencia_key).
function updateRowWhere(sheetName, criterios, updates) {
  const { wb, filePath } = abrirHoja(sheetName);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
  const header = rows[0];

  const pares = Object.entries(criterios).map(([col, val]) => {
    const idx = header.indexOf(col);
    if (idx === -1) throw new Error(`"${sheetName}" no tiene una columna "${col}"`);
    return [idx, val];
  });

  const rowIdx = rows.findIndex((r, i) => i > 0 && pares.every(([idx, val]) => String(r[idx]) === String(val)));
  if (rowIdx === -1) {
    const detalle = Object.entries(criterios).map(([c, v]) => `${c}="${v}"`).join(', ');
    throw new Error(`No encontré en "${sheetName}" una fila con ${detalle}`);
  }

  Object.entries(updates).forEach(([col, val]) => {
    const idx = header.indexOf(col);
    if (idx === -1) throw new Error(`"${sheetName}" no tiene una columna "${col}"`);
    rows[rowIdx][idx] = val;
  });
  wb.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(rows);
  XLSX.writeFile(wb, filePath);
}

module.exports = { readTable, appendRow, updateRow, updateRowWhere };
