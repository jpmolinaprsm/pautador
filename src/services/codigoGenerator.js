// Genera el próximo código de contenido para un Proyecto + Eje, siguiendo
// la secuencia real de AppSheet (no arranca de cero) — así el código que
// arma PAUTADOR no choca con el histórico cuando esto se sincronice de
// verdad con AppSheet.
//
// Formato real (ver guia-flujo-pauta-meta.html): proyecto(6) + tipo(1) +
// eje(2) + secuencial(5) = 14 caracteres.

const path = require('path');
const XLSX = require('xlsx');
const { readTable } = require('./dataSource');

// Fallback para el preview en vivo del código (antes de que se termine de
// elegir Tipo) — "0" (Automatización) ya no existe en equiv_tipo, así que
// el default pasa a ser un código real: "D" (Informativo - Baja).
const TIPO_MVP = 'D';

let cacheAppSheet = null;
function leerAppSheetContenidos() {
  if (cacheAppSheet) return cacheAppSheet;
  try {
    const p = path.resolve(__dirname, '..', '..', '..', 'AppSheet', 'AppSheet Contenidos.xlsx');
    const wb = XLSX.readFile(p);
    cacheAppSheet = {
      proyectos: XLSX.utils.sheet_to_json(wb.Sheets['Proyectos'], { defval: '' }),
      codigos: XLSX.utils.sheet_to_json(wb.Sheets['CodigosContenido'], { defval: '' }),
    };
  } catch (err) {
    console.warn('[codigoGenerator] No pude leer "AppSheet Contenidos.xlsx" — sigo solo con la secuencia local.', err.message);
    cacheAppSheet = { proyectos: [], codigos: [] };
  }
  return cacheAppSheet;
}

// El prefijo de 6 caracteres es el que ya usa AppSheet para ese Proyecto.
// Si el proyecto no existe ahí (como nuestro Test Sandbox), se deriva uno
// que arranca con "TEST" para que quede clarísimo que no es real.
function resolverPrefijoProyecto(nombreProyecto) {
  const { proyectos } = leerAppSheetContenidos();
  const real = proyectos.find((p) => p.Proyecto === nombreProyecto);
  if (real && real.Codigo) return real.Codigo;
  const limpio = nombreProyecto.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return ('TEST' + limpio).slice(0, 6).padEnd(6, 'X');
}

async function generarSiguienteCodigo(nombreProyecto, codigoEje, tipoCodigo) {
  const prefijo = resolverPrefijoProyecto(nombreProyecto);
  const buscado = `${prefijo}${tipoCodigo || TIPO_MVP}${codigoEje}`;

  let maxSeq = 0;
  const { codigos } = leerAppSheetContenidos();
  codigos.forEach((r) => {
    if (r.Codigo && r.Codigo.startsWith(buscado)) {
      const seq = parseInt(r.Codigo.slice(9), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  });

  const locales = await readTable('cola_pautas');
  locales.forEach((r) => {
    if (r.codigo && r.codigo.startsWith(buscado)) {
      const seq = parseInt(r.codigo.slice(9), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  });

  return `${buscado}${String(maxSeq + 1).padStart(5, '0')}`;
}

module.exports = { generarSiguienteCodigo, resolverPrefijoProyecto };
