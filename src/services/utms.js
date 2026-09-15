// UTMs de los links de destino (decisión del usuario, 2026-09-15): solo
// cuando hay link, y sin exponer la configuración de la campaña:
//   utm_source   = plataforma en minúsculas (meta, youtube, tiktok, x, display)
//   utm_medium   = paid
//   utm_campaign = id del anuncio en Meta ({{ad.id}}, macro que Meta
//                  reemplaza sola al hacer click; opaco hacia afuera y se
//                  decodifica en Ads Manager o en matriz_distribucion.ad_id).
//                  "Solo id por ahora" (usuario): en las otras plataformas no
//                  hay id cuando se escribe el link (el implementador crea el
//                  anuncio después), así que ahí van solo source y medium.
// Si el link ya trae alguna utm_*, se respeta y no se toca. El link se
// guarda crudo en cola_pautas; las UTMs se agregan a la salida: url_tags del
// creative en Meta (el link de la pieza queda limpio) y la columna "Link de
// destino" de la hoja Tareas (una fila por plataforma).

function utmSource(plataforma) {
  return String(plataforma || 'meta').trim().toLowerCase().replace(/\s+/g, '') || 'meta';
}

function tieneUtms(link) {
  return /[?&#]utm_[a-z]+=/i.test(String(link || ''));
}

// url_tags del creative en Meta. Se arma a mano: el macro {{ad.id}} tiene que
// ir literal (URLSearchParams lo escaparía).
function utmTagsMeta() {
  return 'utm_source=meta&utm_medium=paid&utm_campaign={{ad.id}}';
}

// El link con source y medium agregados (respeta las UTMs que ya tenga y el
// #fragmento). Para las plataformas que se cargan a mano.
function agregarUtms(link, plataforma) {
  const crudo = String(link || '').trim();
  if (!crudo || tieneUtms(crudo)) return crudo;
  let url;
  try { url = new URL(crudo); } catch (e) { return crudo; }
  url.searchParams.set('utm_source', utmSource(plataforma));
  url.searchParams.set('utm_medium', 'paid');
  return url.toString();
}

module.exports = { agregarUtms, utmTagsMeta, tieneUtms, utmSource };
