// Todo lo que sabe el sistema sobre el MATERIAL de una pieza: cómo se
// resuelve un link (Drive incluido) a bytes reales, cómo se verifica que
// sirva ANTES de pautar, y de dónde sale la miniatura del preview.
//
// Vive en un archivo propio porque hay dos momentos que tienen que estar de
// acuerdo, y antes no lo estaban:
//   1. el pedido (verificarMaterial) — chequea sin bajar el archivo entero;
//   2. la publicación (resolverBytes) — baja el archivo y lo sube a Meta.
// Si el chequeo del paso 1 fuera más permisivo que el 2, volveríamos al
// problema que motivó esto: el link mal pegado explota recién en manos del
// implementador, horas después y lejos de quien lo pegó.

const fs = require('fs');
const path = require('path');

// Cuánto esperamos a que el origen responda. Sin esto, un link colgado deja
// colgado el pedido entero.
const TIMEOUT_MS = 20000;

const MIME_POR_EXTENSION = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v',
};

// Drive comparte de dos formas ("/file/d/<id>/view" y "?id=<id>") y ninguna
// de las dos devuelve el archivo: hay que pasar por el endpoint de descarga.
function idDeDrive(url) {
  const texto = String(url || '');
  const m = texto.match(/\/file\/d\/([^/]+)/) || texto.match(/[?&]id=([^&]+)/);
  return m ? m[1] : '';
}

function convertirLinkDrive(url) {
  const id = idDeDrive(url);
  return id ? `https://drive.google.com/uc?export=download&id=${id}` : url;
}

// Dropbox muestra su página de preview por default (?dl=0); dl=1 fuerza la
// descarga directa del archivo real. A diferencia de Drive, no hay página
// intermedia de "no pudimos escanear por virus" para archivos grandes — este
// único paso alcanza sea cual sea el tamaño.
function esDropbox(url) { return /(^|\.)dropbox\.com/.test(url); }

function convertirLinkDropbox(url) {
  if (/[?&]dl=1(&|$)/.test(url)) return url;
  if (/[?&]dl=0(&|$)/.test(url)) return url.replace(/([?&])dl=0(&|$)/, '$1dl=1$2');
  return url + (url.includes('?') ? '&dl=1' : '?dl=1');
}

// A qué URL hay que pegarle para bajar el archivo de VERDAD, no la página de
// preview del servicio. Drive y Dropbox necesitan cada uno su propio truco;
// cualquier otro link (o un link ya "crudo") se usa tal cual.
function urlDeDescarga(url) {
  if (url.includes('drive.google.com')) return convertirLinkDrive(url);
  if (esDropbox(url)) return convertirLinkDropbox(url);
  return url;
}

// Miniatura para el preview. Drive la genera sola, sirve igual para imagen
// que para video (toma un cuadro) y no hay que bajar nada.
function previewDesdeMaterial(material) {
  const id = idDeDrive(material);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w400` : '';
}

async function descargar(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  const contentType = res.headers.get('content-type') || '';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { res, buffer, contentType };
}

// Igual que descargar(), pero corta el cuerpo apenas lee los headers: para
// verificar un video de 35 MB no hace falta bajar 35 MB. La excepción es el
// HTML, que se lee entero porque ahí adentro está el token de confirmación.
async function inspeccionar(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  const contentType = res.headers.get('content-type') || '';
  const bytes = Number(res.headers.get('content-length')) || 0;
  if (contentType.includes('text/html')) {
    return { res, contentType, bytes, html: await res.text() };
  }
  if (res.body && typeof res.body.cancel === 'function') {
    try { await res.body.cancel(); } catch (e) { /* el origen ya cerró: da igual */ }
  }
  return { res, contentType, bytes, html: '' };
}

// Archivos grandes (típico en video): Drive interpone una página de
// advertencia ("no pudimos escanear por virus") en vez del archivo. Hay que
// sacar el token de confirmación de esa página y reintentar con él.
function urlConfirmadaDeDrive(html, url) {
  const m = html.match(/confirm=([0-9A-Za-z_-]+)/) || html.match(/name="confirm"\s+value="([^"]+)"/);
  if (!m) return '';
  return `https://drive.google.com/uc?export=download&confirm=${m[1]}&id=${idDeDrive(url)}`;
}

function errorHtml(material) {
  return new Error(
    'El link no devolvió un archivo, devolvió una página web. Revisá que apunte a UN archivo '
    + `y que esté compartido como "cualquiera con el link": ${material}`
  );
}

const CONTENT_TYPES_GENERICOS = ['application/octet-stream', 'application/binary', 'binary/octet-stream'];

// Verificado contra Dropbox real: un link de carpeta compartida
// (.../scl/fo/.../archivo.jpg?dl=1) sirve el archivo con Content-Type
// "application/binary" en vez de "image/jpeg" — ahí la única pista que
// queda es la extensión en el propio link.
function contentTypeEfectivo(contentType, url) {
  const tipo = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (tipo && !CONTENT_TYPES_GENERICOS.includes(tipo)) return contentType;
  const sinQuery = String(url || '').split('?')[0].split('#')[0];
  let ext = '';
  try { ext = path.extname(decodeURIComponent(sinQuery)).toLowerCase(); } catch (e) { ext = path.extname(sinQuery).toLowerCase(); }
  return MIME_POR_EXTENSION[ext] || contentType;
}

// Qué es el material sale del Content-Type real, no del Formato que eligió
// el usuario. MISMO criterio que usa metaMedia al subir: sin Content-Type se
// asume imagen (Meta la acepta igual) — si acá fuéramos más estrictos que
// allá, estaríamos frenando pautas que en realidad funcionan.
function clasificar(contentType) {
  if (contentType.startsWith('video/')) return 'video';
  if (!contentType || contentType.startsWith('image/')) return 'imagen';
  return '';
}

// Resuelve el material a bytes listos para subir a Meta.
async function resolverBytes(material) {
  const pareceUrl = /^https?:\/\//i.test(material);
  if (!pareceUrl) {
    // Ruta local, relativa a la raíz del proyecto (donde vive esta carpeta
    // pautador/ al lado de Tablas/, Foto.jpg, etc.)
    const localPath = path.resolve(__dirname, '..', '..', '..', material);
    if (!fs.existsSync(localPath)) {
      throw new Error(`No encontré el archivo local "${material}" (busqué en ${localPath})`);
    }
    const ext = path.extname(localPath).toLowerCase();
    return {
      buffer: fs.readFileSync(localPath),
      filename: path.basename(localPath),
      contentType: MIME_POR_EXTENSION[ext] || '',
    };
  }

  const url = urlDeDescarga(material);
  let { res, buffer, contentType } = await descargar(url);

  if (contentType.includes('text/html') && material.includes('drive.google.com')) {
    const urlConfirmado = urlConfirmadaDeDrive(buffer.toString('utf8'), url);
    if (urlConfirmado) ({ res, buffer, contentType } = await descargar(urlConfirmado));
  }

  if (!res.ok) {
    throw new Error(`No se pudo descargar el material (HTTP ${res.status}): ${material}`);
  }
  if (contentType.includes('text/html')) throw errorHtml(material);
  contentType = contentTypeEfectivo(contentType, material);

  // El nombre de archivo de la URL (ej. Drive comparte "view" sin extensión)
  // no sirve — Meta necesita una extensión real para el multipart. La
  // derivamos del Content-Type, que es la única fuente confiable acá.
  const ext = (contentType.split('/')[1] || 'jpg').split(';')[0];
  return { buffer, filename: `material.${ext}`, contentType };
}

// Chequea que el material se pueda usar, SIN subir nada a Meta y sin bajar
// el archivo entero. Es lo que corre al pedir la pauta: si algo está mal se
// entera quien pegó el link, no el implementador tres horas después.
// Devuelve { tipo, contentType, bytes, previewUrl }; si no sirve, tira un
// error que dice el motivo concreto y qué hacer.
async function verificarMaterial(material) {
  const texto = String(material || '').trim();
  if (!texto) throw new Error('Falta el link del material.');

  if (/drive\.google\.com\/drive\/folders/i.test(texto)) {
    throw new Error('Ese link es una CARPETA de Drive, no un archivo. Abrí el archivo que va a la pauta y copiá el link de ahí.');
  }

  const pareceUrl = /^https?:\/\//i.test(texto);
  if (!pareceUrl) {
    const localPath = path.resolve(__dirname, '..', '..', '..', texto);
    if (!fs.existsSync(localPath)) {
      throw new Error(`"${texto}" no es un link (no empieza con http) ni un archivo que exista en el servidor.`);
    }
    const contentType = MIME_POR_EXTENSION[path.extname(localPath).toLowerCase()] || '';
    const tipo = clasificar(contentType);
    if (!tipo) throw new Error(`El archivo no es una imagen ni un video (es "${contentType}").`);
    return { tipo, contentType, bytes: fs.statSync(localPath).size, previewUrl: '' };
  }

  const esDrive = texto.includes('drive.google.com');
  if (esDrive && !idDeDrive(texto)) {
    throw new Error('Ese link de Drive no apunta a un archivo. Usá "Compartir → Copiar vínculo" parado sobre el archivo.');
  }

  let datos;
  try {
    datos = await inspeccionar(urlDeDescarga(texto));
  } catch (err) {
    const detalle = err.name === 'TimeoutError' ? 'no respondió a tiempo' : err.message;
    throw new Error(`No se pudo abrir el material (${detalle}). Revisá el link.`);
  }

  // Con token de confirmación el archivo existe y se puede bajar: Drive solo
  // está avisando que es grande. El publicador hace este mismo salto.
  if (datos.html && esDrive) {
    const urlConfirmado = urlConfirmadaDeDrive(datos.html, convertirLinkDrive(texto));
    if (urlConfirmado) datos = await inspeccionar(urlConfirmado);
  }

  if (!datos.res.ok) {
    const pista = datos.res.status === 404
      ? 'El archivo no existe o se borró.'
      : 'Revisá que esté compartido como "cualquiera con el link".';
    throw new Error(`No se pudo abrir el material (HTTP ${datos.res.status}). ${pista}`);
  }
  if (datos.contentType.includes('text/html')) throw errorHtml(texto);
  const contentTypeReal = contentTypeEfectivo(datos.contentType, texto);

  const tipo = clasificar(contentTypeReal);
  if (!tipo) {
    throw new Error(`El material no es una imagen ni un video (el archivo es "${contentTypeReal}"). Meta no lo puede pautar.`);
  }

  return {
    tipo,
    contentType: contentTypeReal,
    bytes: datos.bytes,
    previewUrl: previewDesdeMaterial(texto),
  };
}

module.exports = { resolverBytes, verificarMaterial, previewDesdeMaterial, convertirLinkDrive, clasificar };
