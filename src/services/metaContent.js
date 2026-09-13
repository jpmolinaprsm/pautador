// Trae las últimas publicaciones (Facebook + Instagram) de un activo, para
// la pestaña "Publicar contenido existente" (idea tomada del piloto de
// Toni: mostrar los últimos posteos de FB/IG del activo elegido y armar
// la pauta a partir de uno, sin tener que subir material de nuevo).
//
// Nada de esto crea/modifica nada en Meta — son GET, de solo lectura.

const metaApi = require('./metaApi');

// config_activos todavía tiene placeholders tipo "⚠️ BUSCAR EN BM" para los
// activos reales sin completar — un ID de Meta real es siempre numérico.
function esIdValido(valor) {
  return !!valor && /^\d+$/.test(String(valor).trim());
}

// Los endpoints de Página en la "nueva experiencia" de Meta exigen un
// token de Página (no alcanza con el del System User) — se saca al vuelo.
async function getPageAccessToken(pageId) {
  const data = await metaApi.graphGet(`/${pageId}`, { fields: 'access_token' });
  return data.access_token;
}

async function getPostsFacebook(pageId) {
  if (!esIdValido(pageId)) return [];
  try {
    const pageToken = await getPageAccessToken(pageId);
    const url = new URL(`https://graph.facebook.com/${require('../config/env').metaGraphApiVersion}/${pageId}/posts`);
    url.searchParams.set('fields', 'id,message,created_time,full_picture,permalink_url');
    url.searchParams.set('limit', '12');
    url.searchParams.set('access_token', pageToken);
    const res = await fetch(url.toString());
    const data = await res.json();
    if (data.error) return []; // sin posts propios / sin permiso — no bloquea la pantalla
    return (data.data || []).map((p) => ({
      id: p.id,
      plataforma: 'Facebook',
      caption: p.message || '',
      imagen: p.full_picture || '',
      permalink: p.permalink_url || '',
      fecha: p.created_time,
    }));
  } catch (err) {
    console.warn('[metaContent] No pude leer posts de Facebook para page_id', pageId, '-', err.message);
    return [];
  }
}

async function getPostsInstagram(igActorId) {
  if (!esIdValido(igActorId)) return [];
  const data = await metaApi.graphGet(`/${igActorId}/media`, {
    // media_product_type distingue un Reel (REELS) de un post de feed
    // normal (FEED/CAROUSEL_ALBUM/STORY) — media_type solo dice si es foto
    // o video, no dónde vive. Hace falta para saber, al elegir una
    // publicación existente, si ES un Reel (ver nota en app.js sobre
    // "Reels en Feed" — pendiente de probar en vivo, no hay ninguna cuenta
    // de Instagram conectada todavía en el activo de pruebas).
    fields: 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp',
    limit: 12,
  }).catch(() => null);
  if (!data) return [];
  return (data.data || []).map((m) => ({
    id: m.id,
    plataforma: 'Instagram',
    caption: m.caption || '',
    imagen: m.media_type === 'VIDEO' ? (m.thumbnail_url || '') : (m.media_url || ''),
    permalink: m.permalink || '',
    fecha: m.timestamp,
    media_type: m.media_type,
    media_product_type: m.media_product_type || '',
    esReel: m.media_product_type === 'REELS',
  }));
}

async function getPublicacionesRecientes(activo) {
  const [fb, ig] = await Promise.all([
    getPostsFacebook(activo.page_id),
    getPostsInstagram(activo.ig_actor_id),
  ]);
  return [...fb, ...ig].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

// Saca de un link de Facebook pegado a mano (el que da "Copiar enlace" en
// un posteo) el identificador que hace falta para volver a pedírselo a
// Graph. OJO: esto NO es directamente comparable contra los "id" que trae
// getPostsFacebook (ver resolverPostDesdeLink) — "story_fbid" viene en
// formato "pfbid..." (un token opaco que Meta usa en los links para no
// exponer el id numérico real) y el id que devuelve /{page_id}/posts es
// otro numérico distinto. Solo Graph sabe traducir uno al otro.
function extraerIdFacebookDesdeLink(link) {
  try {
    const u = new URL(String(link || '').trim());
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (host !== 'facebook.com') return null;
    const storyFbid = u.searchParams.get('story_fbid');
    if (storyFbid) return storyFbid;
    const v = u.searchParams.get('v');
    if (v) return v;
    const m = u.pathname.match(/\/(?:posts|videos|photos)\/(?:[^/]+\/)?([a-zA-Z0-9]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// Resuelve el link pegado en "Pegar link" (Público) contra el posteo real
// en Meta — a diferencia de getPostsFacebook (últimos 12), sirve para
// CUALQUIER posteo de la página sin importar qué tan viejo sea. La consulta
// que funciona es GET /{page_id}_{id-del-link} con el token de la Página —
// pedirle a Graph el id del link solo (sin el page_id adelante) tira error
// "(#12) singular statuses API is deprecated" en vez de resolver el post.
async function resolverPostDesdeLink(activo, link) {
  const idPost = extraerIdFacebookDesdeLink(link);
  if (!idPost) {
    const err = new Error('No pudimos identificar el posteo en ese link. Pegá el link que te da el botón "Copiar enlace" del posteo en Facebook.');
    err.status = 400;
    throw err;
  }
  if (!esIdValido(activo.page_id)) {
    const err = new Error('Este activo todavía no tiene una página de Facebook conectada.');
    err.status = 400;
    throw err;
  }
  const pageToken = await getPageAccessToken(activo.page_id);
  const url = new URL(`https://graph.facebook.com/${require('../config/env').metaGraphApiVersion}/${activo.page_id}_${idPost}`);
  url.searchParams.set('fields', 'id,message,created_time,full_picture,permalink_url');
  url.searchParams.set('access_token', pageToken);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.error) {
    const err = new Error(`Meta no encontró ese posteo en esta página (${data.error.message}).`);
    err.status = 400;
    throw err;
  }
  return {
    id: data.id,
    plataforma: 'Facebook',
    caption: data.message || '',
    imagen: data.full_picture || '',
    permalink: data.permalink_url || link,
    fecha: data.created_time,
  };
}

module.exports = { getPublicacionesRecientes, resolverPostDesdeLink };
