// Predefinido de presupuesto/reparto para esta primera etapa (usuario,
// 2026-09-14): un pedido nuevo arranca con lo mismo que se asignó la última
// vez en el MISMO cruce Activo × Tipo × Objetivos × Audiencias — el total
// (presupuesto_resuelto) y el % de cada celda (matriz_distribucion). Si no
// hay historial, el front reparte parejo y el servidor usa la escala.
// Más adelante se puede reemplazar por el histórico de BigQuery.
const { readTable } = require('./dataSource');

const lista = (v) => String(v || '').split(/[,~]/).map((s) => s.trim()).filter(Boolean);
const mismoConjunto = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

async function buscarUltimoMismoCruce({ activoKey, tipoCodigo, objetivos, audiencias }) {
  if (!activoKey || !tipoCodigo || !objetivos.length || !audiencias.length) return null;
  const pautas = (await readTable('cola_pautas')).filter((p) => (
    p.activo === activoKey
    && p.estado === 'confirmada'
    && p.origen !== 'ingesta'
    && String(p.codigo || '').charAt(6) === String(tipoCodigo)
    && mismoConjunto(lista(p.objetivo), objetivos)
    && mismoConjunto([p.audiencia, ...lista(p.refuerzo_audiencia)].filter(Boolean), audiencias)
  )).sort((a, b) => String(b.confirmado_en || '').localeCompare(String(a.confirmado_en || '')));
  if (!pautas.length) return null;
  const p = pautas[0];
  const celdas = (await readTable('matriz_distribucion')).filter((m) => m.correlation_id === p.correlation_id);
  const reparto = {};
  celdas.forEach((c) => { reparto[`${c.objetivo}|${c.audiencia_key}`] = Number(c.porcentaje) || 0; });
  return {
    correlation_id: p.correlation_id,
    codigo: p.codigo,
    fecha: String(p.confirmado_en || '').slice(0, 10),
    presupuesto: Number(p.presupuesto_resuelto) || Number(p.presupuesto) || null,
    reparto,
  };
}

module.exports = { buscarUltimoMismoCruce };
