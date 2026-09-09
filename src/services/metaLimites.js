// Mínimo de presupuesto que exige Meta, leído de la cuenta publicitaria real.
//
// Por qué existe esto: Meta rechaza el conjunto de anuncios si su presupuesto
// total no supera `min_daily_budget × días de duración` (error code 100,
// subcode 1885272). Verificado contra la API real con `validate_only` sobre
// act_1081999260903314 (ARS, min_daily_budget = 150347 centavos):
//
//    1 día  → $1.503,47      7 días → $10.524,29      14 días → $21.048,58
//
// Eso explica por qué el "mínimo" parecía moverse solo entre pruebas: no era
// inflación, era que cada pauta tenía otra duración.
//
// Y lo más importante: el mínimo es POR CONJUNTO, no por pieza. Una pauta con
// matriz de 4 celdas necesita 4 conjuntos, cada uno arriba del mínimo — o sea
// 4× el mínimo en total. Sin esto, repartir un presupuesto chico entre varias
// celdas falla en Meta recién al confirmar, sin aviso previo.

const metaApi = require('./metaApi');
const env = require('../config/env');

// La cuenta no cambia su mínimo de un minuto a otro — se cachea en memoria
// para no pegarle a Meta en cada render de la pantalla. Se cachea la PROMESA
// (no el resultado) porque la lista resuelve todas sus filas en paralelo: si
// no, las 8 piezas preguntan a la vez antes de que la primera responda.
const cache = new Map();

async function pedirLimites(adAccountId) {
  try {
    const data = await metaApi.graphGet(`/${adAccountId}`, {
      fields: 'currency,min_daily_budget',
    });
    // min_daily_budget viene en centavos, como todos los montos de Meta.
    return {
      moneda: data.currency || '',
      minDiario: Number(data.min_daily_budget || 0) / 100,
    };
  } catch (err) {
    // Que no se pueda leer el mínimo no puede romper la pantalla — se
    // degrada a "sin aviso", igual que en modo mock. Pasa hoy con las
    // cuentas de los activos reales: todavía no le dieron acceso a nuestro
    // System User (error 200, "owner has NOT granted ads_management").
    console.warn('[metaLimites] no pude leer el mínimo de', adAccountId, '—', err.message);
    return null;
  }
}

async function getLimitesCuenta(adAccountId) {
  if (!adAccountId) return null;
  // En modo mock no hay a quién preguntarle — la UI simplemente no muestra
  // avisos de mínimo (mejor que inventar un número).
  if (env.metaMode !== 'real') return null;

  if (!cache.has(adAccountId)) cache.set(adAccountId, pedirLimites(adAccountId));
  return cache.get(adAccountId);
}

// Mínimo que va a exigir Meta para UN conjunto de anuncios que corre `dias`.
function minimoPorConjunto(limites, dias) {
  if (!limites || !limites.minDiario) return 0;
  return limites.minDiario * Math.max(1, Number(dias) || 1);
}

module.exports = { getLimitesCuenta, minimoPorConjunto };
