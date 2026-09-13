// Creatividades en Supabase Storage (punto 5 del plan): bucket PRIVADO
// "creatividades" (nadie lo lee por URL directa) + tabla `creatividades`
// con dónde está cada archivo, sus etiquetas (proyecto/activo/codigo/
// campaña/eje) y cuándo vence (CREATIVIDADES_DIAS, 90). Reemplaza la carpeta
// ../uploads del disco, que se servía sin auth y no expiraba nunca.
//
// Referencia en cola_pautas.material: "creatividad:<id>". material.js
// resuelve esa forma bajando el archivo del bucket a buffer (Meta lo recibe
// igual que antes), y la pantalla muestra el preview con una URL firmada
// (1 h). Todo con el service role del server — el browser nunca habla con
// el bucket.

const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const env = require('../config/env');
const { readTable, insertarFila, updateRow } = require('./dataSource');

let cliente = null;
function getClient() {
  if (!cliente) {
    if (!env.supabaseUrl || !env.supabaseServiceRoleKey) throw new Error('Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY para el storage.');
    cliente = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false } });
  }
  return cliente.storage.from(env.creatividadesBucket);
}

function habilitado() {
  return env.creatividadesStorage === true;
}

function nuevoId() {
  return `cre_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function esReferencia(material) {
  return /^creatividad:cre_[a-z0-9_]+$/i.test(String(material || '').trim());
}
function idDeReferencia(material) {
  return String(material || '').trim().replace(/^creatividad:/i, '');
}

// Ruta dentro del bucket: sin datos del pedido todavía (se sube ANTES de
// pedir), va por fecha; las etiquetas de proyecto/activo/código se completan
// después en la tabla (etiquetar), no en la ruta.
function rutaEn(id, ext) {
  const d = new Date();
  const mes = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${mes}/${id}${ext}`;
}

// Sube un buffer al bucket y registra la fila. Devuelve la creatividad
// (id, storage_path, previewUrl firmada) — el caller la referencia como
// "creatividad:<id>".
async function subirCreatividad({ buffer, nombreOriginal, contentType, width, height, origen, linkOriginal, subidoPor }) {
  const id = nuevoId();
  const ext = (path.extname(nombreOriginal || '') || `.${(contentType || 'application/octet-stream').split('/')[1] || 'bin'}`).toLowerCase();
  const storagePath = rutaEn(id, ext);

  const { error } = await getClient().upload(storagePath, buffer, { contentType, upsert: false });
  if (error) throw new Error(`Storage: no pude subir "${nombreOriginal}": ${error.message}`);

  const creadoEn = new Date();
  const expiraEn = new Date(creadoEn.getTime() + env.creatividadesDias * 86400000);
  await insertarFila('creatividades', {
    id,
    storage_path: storagePath,
    nombre_original: nombreOriginal || '',
    content_type: contentType || '',
    bytes: buffer.length,
    width: width || null,
    height: height || null,
    origen: origen || 'subida',
    link_original: linkOriginal || '',
    subido_por: subidoPor || '',
    creado_en: creadoEn.toISOString(),
    expira_en: expiraEn.toISOString(),
  });

  return { id, storage_path: storagePath, previewUrl: await urlFirmada(storagePath), expira_en: expiraEn.toISOString() };
}

async function urlFirmada(storagePath, segundos = 3600) {
  const { data, error } = await getClient().createSignedUrl(storagePath, segundos);
  if (error) throw new Error(`Storage: no pude firmar "${storagePath}": ${error.message}`);
  return data.signedUrl;
}

async function getCreatividad(id) {
  return (await readTable('creatividades')).find((c) => c.id === id) || null;
}

// Baja el archivo del bucket a buffer — lo que metaMedia manda a Meta.
async function descargarCreatividad(id) {
  const fila = await getCreatividad(id);
  if (!fila) throw new Error(`No existe la creatividad "${id}".`);
  if (fila.borrado_en) throw new Error(`La creatividad "${id}" venció y ya se borró (${fila.expira_en}). Hay que volver a subirla.`);
  const { data, error } = await getClient().download(fila.storage_path);
  if (error) throw new Error(`Storage: no pude bajar "${fila.storage_path}": ${error.message}`);
  const buffer = Buffer.from(await data.arrayBuffer());
  return { buffer, filename: fila.nombre_original || path.basename(fila.storage_path), contentType: fila.content_type || '' };
}

// Etiquetas del pedido (se conocen recién al crearlo) — no falla si el id
// no es una creatividad (material por link, post existente, etc.).
async function etiquetarCreatividad(material, etiquetas) {
  if (!esReferencia(material)) return;
  await updateRow('creatividades', 'id', idDeReferencia(material), {
    proyecto: etiquetas.proyecto || '',
    activo_key: etiquetas.activo_key || '',
    codigo: etiquetas.codigo || '',
    campana: etiquetas.campana || '',
    eje: etiquetas.eje || '',
    correlation_id: etiquetas.correlation_id || '',
  });
}

// Job diario: borra del bucket lo vencido y lo marca. Meta ya tiene su
// propia copia de lo que se publicó, así que borrar acá no toca ninguna pauta.
async function borrarVencidas() {
  const ahora = new Date().toISOString();
  const vencidas = (await readTable('creatividades')).filter((c) => !c.borrado_en && c.expira_en && c.expira_en < ahora);
  let ok = 0;
  for (const c of vencidas) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await getClient().remove([c.storage_path]);
    if (error) { console.warn('[storage] no pude borrar', c.storage_path, error.message); continue; }
    // eslint-disable-next-line no-await-in-loop
    await updateRow('creatividades', 'id', c.id, { borrado_en: ahora });
    ok += 1;
  }
  return { vencidas: vencidas.length, borradas: ok };
}

module.exports = {
  habilitado, esReferencia, idDeReferencia,
  subirCreatividad, urlFirmada, getCreatividad, descargarCreatividad, etiquetarCreatividad, borrarVencidas,
};
