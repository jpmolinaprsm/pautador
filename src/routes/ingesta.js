// Entradas de la ingesta automática (ver services/ingestaSheets.js):
//
//  POST /ingesta/sheet   — webhook que llama el Apps Script del Sheet cuando
//                          entran filas nuevas. Sin usuario (es una máquina):
//                          se autentica con el header x-ingesta-secret, por
//                          eso vive FUERA de /api (ahí corre usuarioActual).
//  POST /api/ingesta/importar — botón "Traer pautas nuevas" (administrador):
//                          lee las 3 hojas con la Service Account. Sirve para
//                          probar en local sin Apps Script.

const express = require('express');
const env = require('../config/env');
const { procesarFilas, revisarHojas, HOJAS } = require('../services/ingestaSheets');
const { requireRol } = require('../middleware/usuarioActual');

const webhook = express.Router();
const api = express.Router();

webhook.post('/ingesta/sheet', async (req, res) => {
  const secreto = req.get('x-ingesta-secret') || (req.body && req.body.secret) || '';
  if (!env.ingestaSecret || secreto !== env.ingestaSecret) {
    return res.status(401).json({ error: 'Secreto inválido.' });
  }
  const { spreadsheetId, hoja, filas } = req.body || {};
  if (env.ingestaSheetId && spreadsheetId && spreadsheetId !== env.ingestaSheetId) {
    return res.status(400).json({ error: 'La planilla no es la configurada (INGESTA_SHEET_ID).' });
  }
  if (!HOJAS[hoja]) {
    return res.status(400).json({ error: `Hoja "${hoja}" desconocida. Válidas: ${Object.keys(HOJAS).join(', ')}.` });
  }
  if (!Array.isArray(filas)) {
    return res.status(400).json({ error: 'Faltan las filas (array de objetos con los encabezados del Sheet).' });
  }
  try {
    const resultados = await procesarFilas(hoja, filas);
    const creadas = resultados.filter((r) => r.estado === 'creada').length;
    const errores = resultados.filter((r) => r.estado === 'error').length;
    res.json({ hoja, recibidas: filas.length, creadas, errores, resultados });
  } catch (err) {
    console.error('[ingesta/sheet]', err.message);
    res.status(500).json({ error: 'No se pudieron procesar las filas', detalle: err.message });
  }
});

api.post('/ingesta/importar', requireRol('administrador'), async (req, res) => {
  try {
    const salida = await revisarHojas();
    res.json(salida);
  } catch (err) {
    res.status(400).json({ error: 'No se pudo leer el Sheet', detalle: err.message });
  }
});

module.exports = { webhook, api };
