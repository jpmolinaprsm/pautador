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
const codigosSheet = require('./codigosSheet');

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
// Si el proyecto no existe ahí (uno cargado a mano que AppSheet no conoce), se deriva uno
// que arranca con "TEST" para que quede clarísimo que no es real.
function resolverPrefijoProyecto(nombreProyecto) {
  const { proyectos } = leerAppSheetContenidos();
  const real = proyectos.find((p) => p.Proyecto === nombreProyecto);
  if (real && real.Codigo) return real.Codigo;
  const limpio = nombreProyecto.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return ('TEST' + limpio).slice(0, 6).padEnd(6, 'X');
}

// Secuencia = máximo entre TRES fuentes: la hoja "CodigosContenido" viva
// de AppSheet (CODIGOS_SHEET_ID, la que manda mientras no esté migrada a
// Supabase — ver codigosSheet.js), el Excel local (copia vieja, por las
// dudas) y cola_pautas (lo que PAUTADOR ya generó). Esto es solo lectura:
// también lo llama el preview del código en el formulario, así que NO
// reserva número — el código se anota en el caché de la hoja recién cuando
// el pedido se inserta (ver crearPedido), y un lote de varios pedidos lo
// ve igual porque cada uno relee cola_pautas.
async function generarSiguienteCodigo(nombreProyecto, codigoEje, tipoCodigo) {
  const prefijo = resolverPrefijoProyecto(nombreProyecto);
  const buscado = `${prefijo}${tipoCodigo || TIPO_MVP}${codigoEje}`;

  let maxSeq = 0;
  const considerar = (codigo) => {
    if (codigo && String(codigo).startsWith(buscado)) {
      const seq = parseInt(String(codigo).slice(9), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  };

  const enHoja = await codigosSheet.codigosExistentes();
  if (enHoja) enHoja.forEach(considerar);

  const { codigos } = leerAppSheetContenidos();
  codigos.forEach((r) => considerar(r.Codigo));

  const locales = await readTable('cola_pautas');
  locales.forEach((r) => considerar(r.codigo));

  return `${buscado}${String(maxSeq + 1).padStart(5, '0')}`;
}

module.exports = { generarSiguienteCodigo, resolverPrefijoProyecto };
