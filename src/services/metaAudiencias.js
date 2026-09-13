// Resuelve el targeting real de un público guardado (Saved Audience)
// creado a mano en Meta.
//
// La API no deja CREAR públicos guardados con esta app (`POST
// /act_X/saved_audiences` responde `(#3) Application does not have the
// capability` — es una habilitación de la app/cuenta, no del token). Por eso
// se crean a mano en Ads Manager y se carga el ID en `equiv_audiencia`. Pero
// LEER uno que ya existe sí funciona con los mismos permisos de
// `ads_management`, y ahí está el targeting completo (edad, geo, intereses,
// audiencias personalizadas) — se copia tal cual al armar el adset, en vez
// de usar el piso `geo_locations: AR`.
//
// Verificado contra la cuenta real: Meta devuelve, entre otros campos,
// `age_range` — un espejo de solo lectura de `age_min`/`age_max` que exige
// `targeting_automation.advantage_audience: 1` para poder reenviarse. Como
// esta app apaga Advantage+ Audience siempre (regla explícita del piloto de
// Toni: nunca dejar que Meta expanda la segmentación sola), mandar
// `age_range` de vuelta rompe la creación del adset con "The field
// targeting_automation must be enabled to use the field age_range" — se
// descarta antes de reusar el targeting.

const env = require('../config/env');
const metaApi = require('./metaApi');

const CAMPOS_SOLO_LECTURA = ['age_range'];

// La cuenta no cambia de un minuto a otro el targeting de un público
// guardado — se cachea la PROMESA (no el resultado) por la misma razón que
// metaLimites.js: una matriz con la misma audiencia en varias celdas la
// pide en paralelo, y sin esto cada celda dispara su propio GET.
const cache = new Map();

async function pedirTargeting(savedAudienceId) {
  const data = await metaApi.graphGet(`/${savedAudienceId}`, { fields: 'targeting' });
  const targeting = { ...(data.targeting || {}) };
  CAMPOS_SOLO_LECTURA.forEach((campo) => { delete targeting[campo]; });
  return targeting;
}

// null si no hay nada que resolver (modo mock, sin ID, o falló la lectura —
// un ID de prueba/inventado, borrado, o sin permiso). Nunca tira: quien
// llama decide el fallback (el piso geo:AR) y deja rastro en el log.
// "region:<key>" — audiencia geográfica de toda una provincia sin público
// guardado en Meta (la app no puede crearlos por API, ver arriba). Es el
// mismo targeting que usa el público real "Provincia del Chubut" de Gaceta
// Patagónica (18-65, todos los géneros, región + home/recent). Keys de
// Meta: Chaco 99, Santa Fe 117, Chubut 100, Catamarca 98.
function targetingDeRegion(regionKey) {
  return {
    age_min: 18,
    age_max: 65,
    genders: [0],
    geo_locations: {
      regions: [{ key: String(regionKey), country: 'AR' }],
      location_types: ['home', 'recent'],
    },
  };
}

async function getTargetingDeSavedAudience(savedAudienceId) {
  if (!savedAudienceId || env.metaMode !== 'real') return null;
  const region = /^region:(\d+)$/.exec(String(savedAudienceId).trim());
  if (region) return targetingDeRegion(region[1]);
  if (!cache.has(savedAudienceId)) cache.set(savedAudienceId, pedirTargeting(savedAudienceId));
  try {
    return await cache.get(savedAudienceId);
  } catch (err) {
    cache.delete(savedAudienceId); // no cachear el fallo — puede ser transitorio
    throw err;
  }
}

module.exports = { getTargetingDeSavedAudience };
