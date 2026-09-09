// Motor "mock": la misma simulación que ya había en confirmar.js, ahora
// separada para que confirmar.js pueda elegir entre este motor y el real
// (metaAdapterReal.js) según META_MODE — ver metaAdapter.js.

const { readTable, appendRow } = require('./dataSource');

function mockId(prefix) {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `MOCK-${prefix}-${t}-${r}`;
}

// Mismo problema que en metaAdapterReal.js: dos celdas del mismo eje+objetivo
// casi en simultáneo no deben terminar en dos campañas — se serializa por
// clave así la 2ª espera el resultado de la 1ª en vez de repetir el trabajo.
const campaniasEnCurso = new Map();

async function buscarOCrearCampania(pauta, objetivo) {
  const campanas = await readTable('campanas_meta');
  const existente = campanas.find(
    (c) => c.activo_key === pauta.activo && c.eje === pauta.eje && c.objetivo === objetivo
  );
  if (existente) return existente.campaign_id;

  const campaignId = mockId('CAMP');
  await appendRow('campanas_meta', [pauta.activo, pauta.eje, objetivo, campaignId, new Date().toISOString()]);
  return campaignId;
}

async function crearOBuscarCampania(pauta, objetivo, ctx) {
  const key = `${pauta.activo}::${pauta.eje}::${objetivo}`;
  if (campaniasEnCurso.has(key)) return campaniasEnCurso.get(key);

  const promesa = buscarOCrearCampania(pauta, objetivo);
  campaniasEnCurso.set(key, promesa);
  try {
    return await promesa;
  } finally {
    campaniasEnCurso.delete(key);
  }
}

// Un solo creative por pieza (ver metaAdapterReal.js) — el mock también lo
// resuelve una sola vez, para que el comportamiento sea el mismo probando
// en mock que contra Meta real.
async function crearCreative(pauta, ctx) {
  return mockId('CREA');
}

async function crearAdsetYAd(pauta, celda, monto, campaignId, ctx, creativeId) {
  return {
    adsetId: mockId('ADSET'),
    adId: mockId('AD'),
  };
}

module.exports = { crearOBuscarCampania, crearCreative, crearAdsetYAd };
