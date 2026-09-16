// Ingesta de las pautas automáticas de Valle 24 / El Norte Ahora / Noticia
// Franca — hojas salida_manual_{catamarca,chaco,chubut} del Sheet
// INGESTA_SHEET_ID. Nadie las pide desde la pantalla: cada fila nueva es una
// pauta igual a las demás (publicación existente de Facebook, objetivo
// Interacción, audiencia geo de toda la provincia, 24 hs) que PAUTADOR crea
// en Meta con el estado INGESTA_ESTADO_INICIAL (PAUSED hasta que el usuario
// diga) y registra como cualquier pedido (Historial + hoja Tareas).
//
// Entra por dos caminos que terminan en el MISMO procesarFilas():
//   - webhook POST /ingesta/sheet (Apps Script del Sheet, ver routes/ingesta.js)
//   - polling revisarHojas() cada INGESTA_MINUTOS (necesita Service Account)
// Dedupe por (hoja, Codigo) en la tabla ingesta_sheets: una fila crea UNA
// pauta aunque llegue por los dos caminos a la vez.
//
// Forma de la fila (confirmada con datos reales 2026-09-11):
//   parent_codigo | pieza_n | wp_post | fb_post | Proyecto | Codigo | Tipo |
//   Eje | Comunicacion | Contenido | Link Noticia | Link FB | Plataforma |
//   Objetivo | Duracion | Activo | Material | Copy | Audiencia | Fecha

const env = require('../config/env');
const { readTable, insertarFila, updateRowWhere } = require('./dataSource');
const { crearPedido } = require('./pedidos');
const sheets = require('./sheets');

// Hoja -> activo/proyecto de PAUTADOR (config_activos). Fijo a propósito:
// cada hoja es UN medio.
const HOJAS = {
  salida_manual_chaco: { activoKey: 'el-norte-ahora', proyecto: 'Gobierno del Chaco' },
  // Nombre EXACTO como en AppSheet (de ahí sale el prefijo CTMPRV del código).
  salida_manual_catamarca: { activoKey: 'valle-24', proyecto: 'Catamarca Provincia Oficial' },
  // Noticia Franca es activo del proyecto Gobierno del Chubut (corregido
  // 2026-09-11: "Nacho Torres" es OTRO proyecto del mismo cliente).
  salida_manual_chubut: { activoKey: 'noticia-franca', proyecto: 'Gobierno del Chubut' },
};

// El Sheet dice "Interacciones"; equiv_objetivo dice "Interacción".
const OBJETIVOS = {
  interacciones: 'Interacción', interaccion: 'Interacción', 'interacción': 'Interacción',
  alcance: 'Alcance', trafico: 'Tráfico', 'tráfico': 'Tráfico', impresiones: 'Impresiones', views: 'Views',
};

const USUARIO_INGESTA = { nombre: 'Ingesta automática', rol: 'administrador', proyectos: 'todos' };

const limpio = (v) => String(v === undefined || v === null ? '' : v).trim();

// "4/09/2026" (d/m/aaaa, como lo escribe el Sheet), "2026-09-04" o un serial
// de Google Sheets -> "aaaa-mm-dd". Sin fecha -> hoy.
function fechaISO(valor) {
  const hoy = new Date().toISOString().slice(0, 10);
  if (valor === undefined || valor === null || valor === '') return hoy;
  if (typeof valor === 'number') {
    const d = new Date(Math.round((valor - 25569) * 86400 * 1000));
    return Number.isNaN(d.getTime()) ? hoy : d.toISOString().slice(0, 10);
  }
  const s = limpio(valor);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return hoy;
}

function sumarDias(iso, dias) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// "24hrs" -> 1 día, "48 hs" -> 2, "3 días" -> 3, cualquier otra cosa -> 1.
function duracionDias(valor) {
  const s = limpio(valor).toLowerCase();
  const horas = /(\d+)\s*h/.exec(s);
  if (horas) return Math.max(1, Math.ceil(Number(horas[1]) / 24));
  const dias = /(\d+)\s*d/.exec(s);
  if (dias) return Math.max(1, Number(dias[1]));
  return 1;
}

// "https://www.facebook.com/1085068954693874_122115376857320132" -> id
function idDesdeLinkFb(link) {
  const m = /(\d{5,}_\d{5,})/.exec(limpio(link));
  return m ? m[1] : '';
}

// Una fila del Sheet -> el mismo payload que manda la pantalla a crearPedido.
function filaAPedido(hoja, fila, ejes) {
  const cfg = HOJAS[hoja];
  if (!cfg) throw new Error(`Hoja "${hoja}" no está mapeada a ningún activo (ver HOJAS en ingestaSheets.js).`);

  const codigo = limpio(fila.Codigo);
  if (!codigo) throw new Error('La fila no tiene Codigo.');

  const ejeNombre = limpio(fila.Eje);
  const eje = ejes.find((e) => limpio(e.eje).toLowerCase() === ejeNombre.toLowerCase());
  if (!eje) throw new Error(`Eje "${ejeNombre}" no existe en equiv_eje.`);

  // La hoja puede traer el objetivo "adornado" ("10K - Interacciones (solo
  // facebook)", Chubut): se busca la palabra conocida adentro del texto.
  const objetivoTexto = limpio(fila.Objetivo).toLowerCase();
  const claveObjetivo = OBJETIVOS[objetivoTexto] ? objetivoTexto : Object.keys(OBJETIVOS).find((k) => objetivoTexto.includes(k));
  const objetivo = claveObjetivo ? OBJETIVOS[claveObjetivo] : null;
  if (!objetivo) throw new Error(`Objetivo "${limpio(fila.Objetivo)}" no reconocido.`);

  const linkFb = limpio(fila['Link FB'] || fila.fb_post);
  const postId = /^\d+_\d+$/.test(limpio(fila.Material)) ? limpio(fila.Material) : idDesdeLinkFb(linkFb);
  if (!postId) throw new Error(`No pude sacar el id de la publicación de "${linkFb || '(sin Link FB)'}".`);

  const audiencia = limpio(fila.Audiencia);
  if (!audiencia) throw new Error('La fila no tiene Audiencia.');

  // La pauta arranca cuando se procesa (hoy), no en la fecha de la fila: la
  // Fecha del Sheet es la de la noticia, y Meta rechaza un adset que empieza
  // en el pasado. La duración (24 hs) corre desde hoy.
  const fechaInicio = new Date().toISOString().slice(0, 10);
  const copy = limpio(fila.Copy) || limpio(fila.Contenido);

  return {
    proyecto: cfg.proyecto,
    activoKey: cfg.activoKey,
    ejeCodigo: eje.codigo,
    tipoCodigo: '0',
    campana: limpio(fila.Comunicacion) || limpio(fila.Contenido) || codigo,
    visibilidad: 'PUBLICO',
    objetivo: [objetivo],
    audienciaCodigo: audiencia,
    // Publicación existente: mismo shape que deja "Elegir publicación" /
    // "Pegar link" en la pantalla (ver resolverPostDesdeLinkV2).
    post: { id: postId, permalink: linkFb, caption: copy, plataforma: 'Facebook' },
    material: linkFb,
    copy,
    linkDestino: limpio(fila['Link Noticia'] || fila.wp_post),
    fechaInicio,
    fechaFin: sumarDias(fechaInicio, duracionDias(fila.Duracion)),
    redes: ['facebook'],
    codigoExterno: codigo,
    // origen 'ingesta' va por opciones de crearPedido, no acá (ver pedidos.js).
    comentarios: `Ingesta automática — ${hoja}`,
  };
}

// Procesa filas ya leídas (del webhook o del polling). Devuelve un resultado
// por fila: creada / ignorada (ya estaba) / error (con motivo).
async function procesarFilas(hoja, filas) {
  const vistas = (await readTable('ingesta_sheets')).filter((v) => v.hoja === hoja);
  const ejes = await readTable('equiv_eje');
  const resultados = [];

  for (const fila of filas || []) {
    const filaId = limpio(fila.Codigo);
    if (!filaId) { resultados.push({ fila_id: '', estado: 'ignorada', error: 'sin Codigo' }); continue; }

    const previa = vistas.find((v) => v.fila_id === filaId);
    if (previa && (previa.estado === 'creada' || previa.estado === 'baseline')) {
      resultados.push({ fila_id: filaId, estado: 'ignorada', error: previa.estado === 'creada' ? 'ya procesada' : 'anterior a la ingesta (baseline)', correlation_id: previa.correlation_id });
      continue;
    }

    const registrar = async (campos) => {
      const datos = { hoja, fila_id: filaId, procesado_en: new Date().toISOString(), ...campos };
      if (previa) await updateRowWhere('ingesta_sheets', { hoja, fila_id: filaId }, datos);
      else await insertarFila('ingesta_sheets', datos);
    };

    // Freno para la primera pasada (o si el Sheet trae historial): una fila
    // con Fecha más vieja que INGESTA_MAX_DIAS no se pauta — evita que el
    // primer polling salga a crear de golpe todas las noticias viejas.
    const antiguedadDias = Math.round((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(fechaISO(fila.Fecha))) / 86400000);
    if (env.ingestaMaxDias > 0 && antiguedadDias > env.ingestaMaxDias) {
      if (!previa) {
        // eslint-disable-next-line no-await-in-loop
        await registrar({ correlation_id: '', estado: 'ignorada', error: `fila de hace ${antiguedadDias} días (> INGESTA_MAX_DIAS=${env.ingestaMaxDias})` }).catch(() => {});
      }
      resultados.push({ fila_id: filaId, estado: 'ignorada', error: `fila de hace ${antiguedadDias} días` });
      continue;
    }

    // Fila a medio cargar (en el Sheet se escribe celda por celda y el
    // webhook avisa en cada cambio): si falta alguna columna que define la
    // pauta, se espera a la próxima pasada sin anotar nada — si no, una fila
    // con Duración vacía saldría con 1 día por default (usuario, 2026-09-16).
    const faltan = ['Codigo', 'Eje', 'Objetivo', 'Audiencia', 'Duracion'].filter((c) => !limpio(fila[c]));
    if (!limpio(fila['Link FB'] || fila.fb_post)) faltan.push('Link FB');
    if (faltan.length) {
      resultados.push({ fila_id: filaId, estado: 'incompleta', error: `todavía sin ${faltan.join(', ')} — se reintenta en la próxima pasada` });
      continue;
    }

    try {
      const datos = filaAPedido(hoja, fila, ejes);
      // eslint-disable-next-line no-await-in-loop
      const r = await crearPedido(datos, USUARIO_INGESTA, { modo: 'automatizado', origen: 'ingesta' });
      // eslint-disable-next-line no-await-in-loop
      await registrar({ correlation_id: r.correlationId, estado: 'creada', error: '' });
      resultados.push({ fila_id: filaId, estado: 'creada', correlation_id: r.correlationId, codigo: r.codigo, publicado: r.publicado });
    } catch (err) {
      // Un error queda anotado pero NO bloquea: si se corrige el dato en el
      // Sheet, la próxima pasada lo vuelve a intentar.
      // eslint-disable-next-line no-await-in-loop
      await registrar({ correlation_id: '', estado: 'error', error: String(err.message).slice(0, 500) }).catch(() => {});
      resultados.push({ fila_id: filaId, estado: 'error', error: err.message });
    }
  }
  return resultados;
}

// Polling: lee las 3 hojas con la Service Account y procesa lo nuevo.
async function revisarHojas() {
  if (!env.ingestaSheetId) throw new Error('Falta INGESTA_SHEET_ID en .env.');
  const salida = {};
  for (const hoja of Object.keys(HOJAS)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const filas = await sheets.readRange(env.ingestaSheetId, hoja);
      // eslint-disable-next-line no-await-in-loop
      salida[hoja] = await procesarFilas(hoja, filas);
    } catch (err) {
      salida[hoja] = { error: err.message };
    }
  }
  return salida;
}

// Línea de base: registra TODAS las filas que hoy tienen las 3 hojas como
// "ya vistas" (estado 'baseline'), sin crear ninguna pauta. Se corre UNA vez
// antes de prender el polling, así la primera pasada no sale a pautar el
// historial — solo lo que entre de ahí en adelante.
async function registrarBaseline() {
  if (!env.ingestaSheetId) throw new Error('Falta INGESTA_SHEET_ID en .env.');
  const vistas = await readTable('ingesta_sheets');
  const salida = {};
  for (const hoja of Object.keys(HOJAS)) {
    // eslint-disable-next-line no-await-in-loop
    const filas = await sheets.readRange(env.ingestaSheetId, hoja);
    let nuevas = 0;
    for (const fila of filas) {
      const filaId = limpio(fila.Codigo);
      if (!filaId || vistas.some((v) => v.hoja === hoja && v.fila_id === filaId)) continue;
      // eslint-disable-next-line no-await-in-loop
      await insertarFila('ingesta_sheets', { hoja, fila_id: filaId, correlation_id: '', estado: 'baseline', error: 'existía antes de prender la ingesta', procesado_en: new Date().toISOString() });
      nuevas += 1;
    }
    salida[hoja] = { filas: filas.length, registradas: nuevas };
  }
  return salida;
}

module.exports = { HOJAS, procesarFilas, revisarHojas, registrarBaseline, filaAPedido, fechaISO, duracionDias, idDesdeLinkFb };
