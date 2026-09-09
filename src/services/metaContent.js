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

module.exports = { getPublicacionesRecientes };
