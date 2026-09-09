// Cliente HTTP mínimo para la Graph API de Meta. Usa fetch nativo de Node
// (disponible desde Node 18+, acá corremos Node 24). Nada de esto se llama
// a menos que META_MODE=real — ver metaAdapter.js.

const env = require('../config/env');

const GRAPH_BASE = 'https://graph.facebook.com';

class MetaApiError extends Error {
  constructor(metaError, endpoint) {
    const detalle = metaError.error_user_msg || metaError.error_user_title || metaError.message;
    super(`Meta API error en ${endpoint}: ${detalle} (code ${metaError.code}${metaError.error_subcode ? `, subcode ${metaError.error_subcode}` : ''})`);
    this.metaError = metaError;
    this.endpoint = endpoint;
  }
}

function buildUrl(path) {
  return `${GRAPH_BASE}/${env.metaGraphApiVersion}${path.startsWith('/') ? path : '/' + path}`;
}

async function parseResponse(res, endpoint) {
  const data = await res.json();
  if (data.error) {
    throw new MetaApiError(data.error, endpoint);
  }
  return data;
}

async function graphGet(path, params = {}) {
  const url = new URL(buildUrl(path));
  url.searchParams.set('access_token', env.metaAccessToken);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
  });
  const res = await fetch(url.toString());
  return parseResponse(res, path);
}

// POST con body como form-urlencoded (lo que espera la Graph API) —
// los valores objeto/array se serializan a JSON, como pide Meta.
async function graphPost(path, fields = {}) {
  const url = buildUrl(path);
  const form = new URLSearchParams();
  form.set('access_token', env.metaAccessToken);
  Object.entries(fields).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    form.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  return parseResponse(res, path);
}

async function graphDelete(path) {
  const url = new URL(buildUrl(path));
  url.searchParams.set('access_token', env.metaAccessToken);
  const res = await fetch(url.toString(), { method: 'DELETE' });
  return parseResponse(res, path);
}

module.exports = { graphGet, graphPost, graphDelete, MetaApiError };
