// Link a la tarea de Asana de cada pedido, para el Historial (usuario,
// 2026-09-16). Make crea la tarea a partir de la hoja "Tareas" y, al
// terminar, escribe el link en la columna "Link de Asana" de esa misma fila
// (una fila = un Código × Plataforma). PAUTADOR solo LEE esa hoja, nunca
// escribe acá.
//
// Se mantiene en memoria y se refresca rápido en horario laboral (de 9 a 18
// hora Argentina, cuando se cargan pedidos y el link aparece a los pocos
// minutos) y más espaciado el resto del día.

const env = require('../config/env');
const sheets = require('./sheets');

const COLUMNAS = ['Codigo', 'Plataforma', 'Link de Asana'];
const MINUTOS_HORARIO_LABORAL = 2;
const MINUTOS_FUERA_DE_HORARIO = 30;

let porCodigo = new Map(); // CODIGO -> [{ plataforma, link }]
let actualizadoEn = null;

function configurada() {
  return !!(env.tareasSheetId && (env.credentialsJson || env.credentialsPath));
}

function horaArgentina() {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
}

async function refrescar() {
  const filas = await sheets.readColumns(env.tareasSheetId, env.tareasHoja, COLUMNAS);
  const mapa = new Map();
  filas.forEach((f) => {
    const codigo = String(f.Codigo || '').trim().toUpperCase();
    const link = String(f['Link de Asana'] || '').trim();
    if (!codigo || !/^https?:\/\//i.test(link)) return;
    const lista = mapa.get(codigo) || [];
    if (!lista.some((x) => x.link === link)) lista.push({ plataforma: String(f.Plataforma || '').trim(), link });
    mapa.set(codigo, lista);
  });
  porCodigo = mapa;
  actualizadoEn = new Date().toISOString();
  return mapa.size;
}

function linksDe(codigo) {
  return porCodigo.get(String(codigo || '').trim().toUpperCase()) || [];
}

function programarActualizacion() {
  if (!configurada()) return;
  const vuelta = async () => {
    try {
      await refrescar();
    } catch (err) {
      console.warn('[asana] no pude leer los links de la hoja Tareas:', err.message);
    }
    const h = horaArgentina();
    const minutos = h >= 9 && h < 18 ? MINUTOS_HORARIO_LABORAL : MINUTOS_FUERA_DE_HORARIO;
    setTimeout(vuelta, minutos * 60 * 1000);
  };
  setTimeout(vuelta, 15 * 1000);
}

module.exports = { linksDe, programarActualizacion, refrescar, estado: () => ({ codigos: porCodigo.size, actualizadoEn }) };
