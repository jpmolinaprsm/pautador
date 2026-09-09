const express = require('express');
const { getActivos, getActivoPorKey, ACTIVO_EJECUCION } = require('../services/configActivos');
const { getPublicacionesRecientes } = require('../services/metaContent');
const { generarSiguienteCodigo } = require('../services/codigoGenerator');
const { readTable, insertarFila } = require('../services/dataSource');
const { getLimitesCuenta } = require('../services/metaLimites');

const { proyectosPermitidos } = require('../services/usuarios');
const { requireRol } = require('../middleware/usuarioActual');
const env = require('../config/env');

const router = express.Router();

// Para generar activo_key de un Proyecto/Activo nuevo — no tiene que
// coincidir con las abreviaturas de las filas viejas (esas son manuales),
// solo ser estable y única.
function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// GET /api/activos — selector de activos (opcionalmente filtrado por ?proyecto=)
router.get('/activos', async (req, res) => {
  try {
    const activos = await getActivos();
    const filtrados = req.query.proyecto ? activos.filter((a) => a.proyecto === req.query.proyecto) : activos;
    res.json(filtrados.map((a) => ({
      activo_key: a.activo_key,
      proyecto: a.proyecto,
      activo: a.activo || a.activo_key,
    })));
  } catch (err) {
    console.error('[activos]', err.message);
    res.status(500).json({ error: 'No se pudieron leer los activos', detalle: err.message });
  }
});

// POST /api/activos — pestaña "Agregar Proyectos / Activos / Audiencias".
// Un Proyecto no es una tabla propia (config_activos.proyecto es solo una
// columna) — se crea "solo" con su primer Activo, igual que ya pasa con
// filas reales como Valle 24/Noticia Franca (activo en blanco, activo_key =
// el proyecto solo). El resto de los campos que sí quedan en blanco
// (bm_id, credenciales, IDs de Asana/Slack) no los lee ningún código hoy —
// son de referencia para cuando se conecten esas integraciones.
router.post('/activos', requireRol('administrador'), async (req, res) => {
  try {
    const { proyecto, activo, adAccountId, pageId, igActorId, provincia, duracionDias, categoria } = req.body;
    if (!proyecto || !proyecto.trim()) {
      return res.status(400).json({ error: 'Elegí el Proyecto.' });
    }
    const activos = await getActivos();
    // El activo se cuelga de un proyecto que ya existe. Dar de alta un
    // proyecto nuevo es otra cosa (permisos, códigos, cuentas de Meta) y
    // hoy no se hace desde acá.
    const proyectosExistentes = [...new Set(activos.map((a) => a.proyecto).filter(Boolean))];
    if (!proyectosExistentes.includes(proyecto.trim())) {
      return res.status(400).json({
        error: `El proyecto "${proyecto.trim()}" no existe. Los activos se crean sobre un proyecto ya cargado.`,
      });
    }
    const proyectoSlug = slugify(proyecto);
    const activoSlug = activo && activo.trim() ? slugify(activo) : '';
    if (!proyectoSlug) {
      return res.status(400).json({ error: 'El nombre del Proyecto no generó una clave válida — probá con letras/números.' });
    }
    const activoKey = activoSlug ? `${proyectoSlug}--${activoSlug}` : proyectoSlug;
    if (activos.some((a) => a.activo_key === activoKey)) {
      return res.status(409).json({ error: `Ya existe un activo con la clave "${activoKey}" — probá con otro nombre de Proyecto/Activo.` });
    }
    await insertarFila('config_activos', {
      proyecto: proyecto.trim(),
      activo: (activo || '').trim(),
      activo_key: activoKey,
      activo_habilitado: true,
      ad_account_id: (adAccountId || '').trim(),
      page_id: (pageId || '').trim(),
      ig_actor_id: (igActorId || '').trim(),
      placements_fb: 'feed',
      placements_ig: igActorId ? 'stream' : '',
      duracion_dias: Number(duracionDias) || 7,
      authorization_category: categoria || 'POLITICAL',
      provincia: (provincia || '').trim(),
    });
    res.json({ activo_key: activoKey, proyecto: proyecto.trim(), activo: (activo || '').trim() });
  } catch (err) {
    console.error('[crear-activo]', err.message);
    res.status(500).json({ error: 'No se pudo crear el activo', detalle: err.message });
  }
});

// GET /api/proyectos — Proyectos de config_activos, filtrados a los que el
// usuario actual tiene permitidos (si no hay usuario o tiene "todos", los
// muestra todos — son datos de referencia, no una acción sensible).
router.get('/proyectos', async (req, res) => {
  try {
    const activos = await getActivos();
    let proyectos = [...new Set(activos.map((a) => a.proyecto).filter(Boolean))].sort();
    if (req.usuario) {
      const permitidos = proyectosPermitidos(req.usuario);
      if (permitidos !== 'todos') proyectos = proyectos.filter((p) => permitidos.includes(p));
    }
    res.json(proyectos);
  } catch (err) {
    console.error('[proyectos]', err.message);
    res.status(500).json({ error: 'No se pudieron leer los proyectos', detalle: err.message });
  }
});

// GET /api/limites — el mínimo de presupuesto que exige Meta, leído en vivo de
// la cuenta publicitaria donde se ejecuta. Lo usa el formulario para avisar
// (y bloquear) antes de crear algo que Meta va a rechazar. Devuelve
// minDiario en 0 si no se pudo leer: en ese caso la UI no avisa nada.
router.get('/limites', async (req, res) => {
  try {
    const activo = await getActivoPorKey(ACTIVO_EJECUCION);
    const limites = await getLimitesCuenta(activo && activo.ad_account_id);
    res.json(limites || { minDiario: 0, moneda: '' });
  } catch (err) {
    console.error('[limites]', err.message);
    res.json({ minDiario: 0, moneda: '' });
  }
});

// GET /api/ejes — tabla real de Ejes (equiv_eje)
router.get('/ejes', async (req, res) => {
  try {
    const ejes = await readTable('equiv_eje');
    res.json(ejes.map((e) => ({ codigo: e.codigo, eje: e.eje })));
  } catch (err) {
    console.error('[ejes]', err.message);
    res.status(500).json({ error: 'No se pudo leer equiv_eje', detalle: err.message });
  }
});

// GET /api/tipos — equiv_tipo (A/B/C Oficial, D/E/F Informativo Baja/Media/
// Alta, Y Pautas Army, 0 Automatización). Hoy en la práctica solo se usa "0"
// (fase 1, MVP) — el resto queda visible/elegible para que el código y la
// nomenclatura ya salgan con el tipo real cuando se habiliten las próximas
// fases, sin tener que tocar esto de nuevo. Acotado al Ecosistema activo de
// la sesión (pantalla 3 del onboarding, Oficial/Informativo) salvo 'TODOS'
// (admin, "Ver ambos") — ver middleware/usuarioActual.js.
router.get('/tipos', async (req, res) => {
  try {
    const tipos = await readTable('equiv_tipo');
    const filtrados = req.ecosistemaActivo && req.ecosistemaActivo !== 'TODOS'
      ? tipos.filter((t) => t.ecosistema === req.ecosistemaActivo)
      : tipos;
    res.json(filtrados.map((t) => ({ codigo: t.codigo, nombre: t.tipo_campana, ecosistema: t.ecosistema })));
  } catch (err) {
    console.error('[tipos]', err.message);
    res.status(500).json({ error: 'No se pudo leer equiv_tipo', detalle: err.message });
  }
});

// GET /api/campanas?proyecto=... — nombres de campaña ya usados en ese
// proyecto, como sugerencias (datalist) del campo "Campana" de Pedido de
// Pauta — AppSheet permite elegir una existente o escribir una nueva.
router.get('/campanas', requireRol('pm_cuentas', 'implementador', 'administrador'), async (req, res) => {
  try {
    const filas = await readTable('cola_pautas');
    const nombres = [...new Set(
      filas.filter((f) => f.correlation_id && f.proyecto === req.query.proyecto).map((f) => f.campana).filter(Boolean)
    )].sort();
    res.json(nombres);
  } catch (err) {
    console.error('[campanas]', err.message);
    res.status(500).json({ error: 'No se pudieron leer las campañas', detalle: err.message });
  }
});

// GET /api/siguiente-codigo?proyecto=...&eje_codigo=... — código de contenido
// nuevo, siguiendo la secuencia real de AppSheet para ese proyecto+eje.
router.get('/siguiente-codigo', async (req, res) => {
  try {
    const { proyecto, eje_codigo, tipo_codigo } = req.query;
    if (!proyecto || !eje_codigo) {
      return res.status(400).json({ error: 'Faltan "proyecto" y/o "eje_codigo".' });
    }
    const codigo = await generarSiguienteCodigo(proyecto, eje_codigo, tipo_codigo);
    res.json({ codigo });
  } catch (err) {
    console.error('[siguiente-codigo]', err.message);
    res.status(500).json({ error: 'No se pudo generar el código', detalle: err.message });
  }
});

// GET /api/formatos — equiv_formato, para el selector de formato (Dark).
// Solo el modo (imagen/video/carrusel) — la proporción esperada depende
// del Placement elegido, no del Formato (ver DIMENSIONES_POR_PLACEMENT en
// app.js y placementDisponible en metaAdapterReal.js).
router.get('/formatos', async (req, res) => {
  try {
    const formatos = await readTable('equiv_formato');
    res.json(formatos.map((f) => ({
      appsheet_valor: f.appsheet_valor,
      modo: f.modo,
    })));
  } catch (err) {
    console.error('[formatos]', err.message);
    res.status(500).json({ error: 'No se pudo leer equiv_formato', detalle: err.message });
  }
});

// GET /api/objetivos — equiv_objetivo, para el desplegable de Objetivo
router.get('/objetivos', async (req, res) => {
  try {
    const objetivos = await readTable('equiv_objetivo');
    res.json(objetivos.map((o) => o.appsheet_valor));
  } catch (err) {
    console.error('[objetivos]', err.message);
    res.status(500).json({ error: 'No se pudo leer equiv_objetivo', detalle: err.message });
  }
});

// GET /api/audiencias?activo_key=... — equiv_audiencia filtrada por activo,
// para los selectores de Audiencia/Refuerzo
router.get('/audiencias', async (req, res) => {
  try {
    const todas = await readTable('equiv_audiencia');
    const del_activo = todas.filter((a) => a.activo_key === req.query.activo_key);
    res.json(del_activo.map((a) => ({ codigo: a.codigo_audiencia, nombre: a.nombre_display })));
  } catch (err) {
    console.error('[audiencias]', err.message);
    res.status(500).json({ error: 'No se pudo leer equiv_audiencia', detalle: err.message });
  }
});

// POST /api/audiencias — agrega una audiencia a un Activo existente. El
// "tamaño" queda de referencia, pero el saved_audience_id NO es opcional:
// el motor real lo usa para targetear de verdad (ver metaAdapterReal.js,
// getTargetingDeSavedAudience) — sin él, la pieza cae al piso geo:AR, que
// no es la audiencia que se pidió.
router.post('/audiencias', requireRol('administrador'), async (req, res) => {
  try {
    const { activoKey, codigo, nombre, tamano, savedAudienceId } = req.body;
    if (!activoKey) return res.status(400).json({ error: 'Falta elegir el Activo.' });
    if (!codigo || !codigo.trim()) return res.status(400).json({ error: 'Falta el código de la audiencia.' });
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Falta el nombre a mostrar.' });
    if (!savedAudienceId || !savedAudienceId.trim()) return res.status(400).json({ error: 'Falta el Saved Audience ID (el público guardado real en Meta).' });

    const activo = await getActivoPorKey(activoKey);
    if (!activo) return res.status(400).json({ error: `No existe el activo "${activoKey}".` });

    const codigoNorm = codigo.trim();
    const todas = await readTable('equiv_audiencia');
    if (todas.some((a) => a.activo_key === activoKey && a.codigo_audiencia === codigoNorm)) {
      return res.status(409).json({ error: `Ya existe una audiencia con código "${codigoNorm}" para este activo.` });
    }

    await insertarFila('equiv_audiencia', {
      activo_key: activoKey,
      codigo_audiencia: codigoNorm,
      nombre_display: nombre.trim(),
      'tamaño': tamano || '',
      saved_audience_id: (savedAudienceId || '').trim(),
    });
    res.json({ codigo: codigoNorm, nombre: nombre.trim(), activo_key: activoKey });
  } catch (err) {
    console.error('[crear-audiencia]', err.message);
    res.status(500).json({ error: 'No se pudo crear la audiencia', detalle: err.message });
  }
});

// GET /api/publicaciones?activo_key=... — últimos posteos de FB/IG de ese
// activo. Lo usan "Crear Anuncios" (Implementadores, al procesar un pedido
// Público) y "Pedido de Pauta" (PM/Cuentas, para elegir la publicación en
// vez de pegar el link a mano).
router.get('/publicaciones', requireRol('pm_cuentas', 'implementador', 'administrador'), async (req, res) => {
  if (!env.metaAccessToken) {
    return res.status(400).json({ error: 'No hay META_ACCESS_TOKEN configurado — hace falta para leer publicaciones de Meta.' });
  }
  try {
    const activo = await getActivoPorKey(req.query.activo_key);
    if (!activo) return res.status(404).json({ error: `No existe el activo "${req.query.activo_key}"` });
    const publicaciones = await getPublicacionesRecientes(activo);
    res.json(publicaciones);
  } catch (err) {
    console.error('[publicaciones]', err.message);
    res.status(500).json({ error: 'No se pudieron leer las publicaciones', detalle: err.message });
  }
});

module.exports = router;
