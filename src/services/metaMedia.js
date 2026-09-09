// Resuelve y sube el material de una pauta a Meta. Soporta dos vías
// (probadas contra la API real): un archivo local (relativo a la raíz del
// proyecto) o una URL — incluido un link de Google Drive "para cualquiera
// con el link", que se convierte a descarga directa.
//
// Imagen y video se suben por endpoints distintos y arman creatives
// distintos, así que subirMaterial() devuelve qué tipo resolvió:
//
//   { tipo: 'imagen', imageHash }                 → object_story_spec.link_data
//   { tipo: 'video',  videoId, thumbnailUrl }     → object_story_spec.video_data
//
// La diferencia grande: /adimages responde con el hash al instante, pero
// /advideos devuelve un id y deja el video PROCESÁNDOSE del lado de Meta —
// hay que esperar a que pase a "ready" antes de poder usarlo en un anuncio,
// y recién ahí Meta tiene miniaturas para ofrecer.

const env = require('../config/env');
const metaApi = require('./metaApi');
const { imageSize } = require('image-size');
// La resolución del material (Drive, content-type, archivos grandes) vive
// en services/material.js, compartida con la verificación que corre al
// PEDIR la pauta: las dos tienen que aceptar y rechazar exactamente lo
// mismo, o el chequeo del pedido deja pasar links que después fallan acá.
const { resolverBytes } = require('./material');

// Cuánta tolerancia se acepta contra una proporción exacta — no hace falta
// el pixel perfecto (Meta recorta un poco a los costados sin drama), pero
// sí que sea CLARAMENTE esa proporción: una vertical 3:4 contra un 9:16
// pedido, por ejemplo, no tendría que pasar (diferencia ~0.19, bien arriba
// del 12%). Subido de 4% a 12% (2026-09-08) — el 4% rechazaba archivos que
// Meta reencuadra sin problema.
const TOLERANCIA_PROPORCION = 0.12;

// "4:5" / "16:9" → 0.8 / 1.778. Usado para chequear que un material
// coincida con la proporción que pide el Placement elegido (Stories/Reels
// piden 9:16, Feed no pide nada) y, en Carrusel, que cada pieza coincida
// con la primera — ver metaAdapterReal.js.
function coincideProporcion(width, height, aspecto) {
  if (!width || !height || !aspecto) return null; // no se pudo evaluar
  const [aw, ah] = String(aspecto).split(':').map(Number);
  if (!aw || !ah) return null;
  const ratioObjetivo = aw / ah;
  const ratioReal = width / height;
  return Math.abs(ratioReal - ratioObjetivo) <= TOLERANCIA_PROPORCION;
}

// Mismo cálculo para imagen y video — se usa para decidir si el material
// sirve para Reels (vertical) y/o Stories (≈9:16), ver metaAdapterReal.js.
function clasificarAspecto(width, height) {
  if (!width || !height) return { vertical: null, esNueveDieciseis: null };
  return {
    vertical: height > width,
    esNueveDieciseis: coincideProporcion(width, height, '9:16'),
  };
}

// Cuánto esperamos a que Meta termine de procesar un video. Es sincrónico
// con el "Confirmar" de la pantalla, así que no puede ser eterno: si se pasa
// de acá, se avisa y la pieza se hace a mano.
const ESPERA_MAX_MS = 3 * 60 * 1000;
const INTERVALO_MS = 3000;

// POST multipart a la Graph API (no sirve graphPost, que manda urlencoded).
async function subirArchivo(endpoint, buffer, filename, campos = {}) {
  const form = new FormData();
  form.append('access_token', env.metaAccessToken);
  form.append('source', new Blob([buffer]), filename);
  Object.entries(campos).forEach(([k, v]) => form.append(k, v));

  const res = await fetch(`https://graph.facebook.com/${env.metaGraphApiVersion}/${endpoint}`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  if (data.error) {
    const detalle = data.error.error_user_msg || data.error.error_user_title || data.error.message;
    const err = new Error(`Meta API error subiendo material: ${detalle}`);
    err.metaError = data.error;
    throw err;
  }
  return data;
}

async function subirImagen(buffer, filename, adAccountId) {
  const data = await subirArchivo(`${adAccountId}/adimages`, buffer, filename);
  const key = Object.keys(data.images)[0];
  // Las medidas salen del archivo mismo (no hace falta preguntarle a Meta) —
  // sirven para decidir si el material sirve para Reels/Stories, ver
  // metaAdapterReal.js. Si el parser no reconoce el formato, se sigue sin
  // ese dato: no es motivo para frenar la subida.
  let width = null;
  let height = null;
  try {
    const dim = imageSize(buffer);
    width = dim.width;
    height = dim.height;
  } catch (err) { /* sin medidas — Feed sigue funcionando igual */ }
  return { imageHash: data.images[key].hash, width, height };
}

// Meta procesa el video en background: hasta que no está "ready" no se puede
// usar en un creative ni tiene miniaturas.
async function esperarProcesado(videoId) {
  const limite = Date.now() + ESPERA_MAX_MS;
  while (Date.now() < limite) {
    const data = await metaApi.graphGet(`/${videoId}`, { fields: 'status' });
    const estado = (data.status && data.status.video_status) || '';
    if (estado === 'ready') return;
    if (estado === 'error') {
      const detalle = (data.status && data.status.processing_progress) || '';
      throw new Error(`Meta no pudo procesar el video (estado "error"${detalle ? `, progreso ${detalle}` : ''}). Probá con otro archivo o creá la pieza a mano.`);
    }
    await new Promise((r) => setTimeout(r, INTERVALO_MS));
  }
  throw new Error(`El video sigue procesándose en Meta después de ${Math.round(ESPERA_MAX_MS / 60000)} minutos. No se pudo crear el anuncio ahora — reintentá en un rato (el video ya está subido) o creá la pieza a mano.`);
}

// Un creative de video NO se puede crear sin miniatura. Meta genera varias
// solas al terminar de procesar y marca una como preferida.
async function miniaturaDe(videoId) {
  const data = await metaApi.graphGet(`/${videoId}/thumbnails`, { fields: 'uri,is_preferred' });
  const thumbs = data.data || [];
  if (!thumbs.length) {
    throw new Error('Meta procesó el video pero no generó ninguna miniatura — no se puede armar el anuncio. Creá la pieza a mano.');
  }
  return (thumbs.find((t) => t.is_preferred) || thumbs[0]).uri;
}

// Meta expone las medidas del video una vez procesado. Sirve para saber si
// es vertical de verdad (Reels) o ≈9:16 (Stories), sin depender de que el
// Formato esté bien elegido.
async function medidasDeVideo(videoId) {
  const data = await metaApi.graphGet(`/${videoId}`, { fields: 'format' });
  const f = (data.format || [])[0];
  if (!f || !f.width || !f.height) return { width: null, height: null };
  return { width: f.width, height: f.height };
}

async function subirVideo(buffer, filename, adAccountId) {
  const data = await subirArchivo(`${adAccountId}/advideos`, buffer, filename);
  await esperarProcesado(data.id);
  const { width, height } = await medidasDeVideo(data.id);
  const aspecto = clasificarAspecto(width, height);
  return {
    tipo: 'video',
    videoId: data.id,
    thumbnailUrl: await miniaturaDe(data.id),
    width,
    height,
    vertical: aspecto.vertical,
    esNueveDieciseis: aspecto.esNueveDieciseis,
  };
}

// Sube el material y devuelve con qué armar el creative. El tipo se decide
// por el Content-Type real del archivo, no por el Formato que eligió el
// usuario en el formulario (que puede estar mal cargado).
async function subirMaterial(material, adAccountId) {
  const { buffer, filename, contentType } = await resolverBytes(material);

  if (contentType.startsWith('video/')) {
    return subirVideo(buffer, filename, adAccountId);
  }
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error(`El material no es una imagen ni un video (Meta recibió "${contentType}"). Revisá el link del material.`);
  }
  const img = await subirImagen(buffer, filename, adAccountId);
  const aspecto = clasificarAspecto(img.width, img.height);
  return {
    tipo: 'imagen',
    imageHash: img.imageHash,
    width: img.width,
    height: img.height,
    vertical: aspecto.vertical,
    esNueveDieciseis: aspecto.esNueveDieciseis,
  };
}

module.exports = { subirMaterial, coincideProporcion };
