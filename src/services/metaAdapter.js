// Único punto donde se decide si "confirmar" simula (mock) o llama de
// verdad a Meta (real) — igual patrón que dataSource.js con Sheets/Excel.
const env = require('../config/env');
const mock = require('./metaAdapterMock');
const real = require('./metaAdapterReal');

const impl = env.metaMode === 'real' ? real : mock;

module.exports = {
  crearOBuscarCampania: (...args) => impl.crearOBuscarCampania(...args),
  crearCreative: (...args) => impl.crearCreative(...args),
  crearAdsetYAd: (...args) => impl.crearAdsetYAd(...args),
};
