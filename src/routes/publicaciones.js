const express = require('express');
const { getActivos, getActivoPorKey } = require('../services/configActivos');
const { getPublicacionesRecientes, resolverPostDesdeLink } = require('../services/metaContent');
const { limpiarNombreAudiencia } = require('../services/colaPautas');
const { getCatalogoPorProyecto, usoPorProyectoCanal } = require('../services/audiencias');
const { buscarUltimoMismoCruce } = require('../services/repartoSugerido');

const MAX_AUDIENCIAS_POR_PROYECTO = 10;
const { OBJETIVOS_PERMITIDOS, esTipoPermitidoAutomatizado } = require('../config/mvp');
const { PLATAFORMAS, MODO_POR_FORMATO, categoriasPara } = require('../config/plataformas');
const { volumenPorProyectoDesde } = require('../services/codigosSheet');
const { proyectosVisibles } = require('../services/proyectos');
const { generarSiguienteCodigo } = require('../services/codigoGenerator');
const { readTable, insertarFila } = require('../services/dataSource');
const { getLimitesCuenta } = require('../services/metaLimites');
const { resolverPresupuestoPorTipo } = require('../services/escalaPresupuestos');

const { proyectosPermitidos, tieneAccesoAActivo } = require('../services/usuarios');
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

// GET /api/activos — selector de activos (opcionalmente filtrado por
// ?proyecto=). ?soloHabilitados=1 (recorte a MVP, ver src/config/mvp.js)
// filtra además por activo_habilitado=true — es opt-in a propósito: lo usa
// el picker de "Pedido de Pauta"/"Crear Anuncios", pero la pantalla de
// administración (alta de Activos/Audiencias) sigue viendo TODOS, para
// poder precargarle audiencias a un activo antes de habilitarlo.
router.get('/activos', async (req, res) => {
  try {
    const activos = await getActivos();
    let filtrados = req.query.proyecto ? activos.filter((a) => a.proyecto === req.query.proyecto) : activos;
    if (req.query.soloHabilitados === '1') {
      filtrados = filtrados.filter((a) => a.activo_habilitado === true);
    }
    // Accesos por activo (Panel Usuarios): un PM/Implementador solo ve los
    // activos que tiene asignados — un admin ve todos. Sin usuario (ej.
    // curl de prueba) no se filtra: son datos de referencia.
    if (req.usuario) {
      filtrados = filtrados.filter((a) => tieneAccesoAActivo(req.usuario, a.proyecto, a.activo_key));
    }
    // Pedido Normal: el selector de Activo se acota al Ecosistema elegido
    // usando el histórico de AppSheet (punto 7: ecosistema_historico
    // Oficial/Informativo/Mixto — un Mixto aparece en los dos; sin dato,
    // aparece siempre). Solo en modo normal: automatizado no elige
    // Ecosistema y el header podría venir viejo de otra sesión.
    // Desde 2026-09-11 ("prendé Oficial") el modo automatizado también
    // pregunta Ecosistema, así que el filtro aplica en los dos modos.
    // ?todos=1 (pestaña de administración "Agregar Activos / Audiencias"):
    // sin recorte por canal — ahí se cargan audiencias a cualquier activo.
    if (req.query.todos !== '1' && (req.ecosistemaActivo === 'Oficial' || req.ecosistemaActivo === 'Informativo')) {
      filtrados = filtrados.filter((a) => !a.ecosistema_historico || a.ecosistema_historico === 'Mixto' || a.ecosistema_historico === req.ecosistemaActivo);
    }
    // Ordenado por Proyecto y después por Activo — así quedan agrupados
    // aunque el select ya no muestre el prefijo "Proyecto — " (se sacó a
    // pedido del usuario), en vez del orden de inserción de la base.
    const ordenados = [...filtrados].sort((a, b) => {
      const p = (a.proyecto || '').localeCompare(b.proyecto || '', 'es');
      if (p !== 0) return p;
      return (a.activo || a.activo_key || '').localeCompare(b.activo || b.activo_key || '', 'es');
    });
    res.json(ordenados.map((a) => ({
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
    // Visibles según actividad (sin códigos en el último mes y medio → no
    // aparece) y la decisión manual de un admin (Activar / Desactivar en
    // Panel Usuarios → Proyectos) — ver services/proyectos.js.
    const visibles = await proyectosVisibles();
    proyectos = proyectos.filter((p) => visibles.has(p));
    // Clientes apagados por ahora (CLIENTES_OCULTOS, ej. Córdoba hasta que
    // tenga su módulo) — se esconden todos sus proyectos.
    if (env.clientesOcultos.length) {
      const clienteDe = {};
      activos.forEach((a) => { if (a.proyecto && a.cliente && !clienteDe[a.proyecto]) clienteDe[a.proyecto] = a.cliente; });
      proyectos = proyectos.filter((p) => !env.clientesOcultos.includes(clienteDe[p] || ''));
    }
    // ?detalle=1: con el Cliente de cada proyecto (config_activos.cliente,
    // migración 008) — la pantalla de Proyecto los agrupa por cliente.
    // Con volumen15 = códigos de los últimos 15 días en CodigosContenido,
    // ordenados de mayor a menor (después por nombre).
    if (req.query.detalle === '1') {
      const clientePor = {};
      activos.forEach((a) => { if (a.proyecto && a.cliente && !clientePor[a.proyecto]) clientePor[a.proyecto] = a.cliente; });
      const desde = new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 10);
      const volumen = (await volumenPorProyectoDesde(desde)) || {};
      return res.json(proyectos
        .map((p) => ({
          proyecto: p,
          cliente: clientePor[p] || '',
          volumen15: volumen[p] || 0,
          // Solo canal Informativo (CLIENTES_SOLO_INFORMATIVO, ej. Córdoba): la
          // pantalla de Canal apaga "Oficial" con la leyenda.
          soloInformativo: env.clientesSoloInformativo.includes(clientePor[p] || ''),
          // Tiene al menos un activo con automatización (credenciales de
          // Meta): sin esto no se puede elegir "Pedido Automatizado".
          automatizable: activos.some((a) => a.proyecto === p && a.activo_habilitado === true),
          activosAutomatizables: activos.filter((a) => a.proyecto === p && a.activo_habilitado === true).map((a) => a.activo || a.activo_key).sort((x, y) => x.localeCompare(y, 'es')),
        }))
        .sort((a, b) => b.volumen15 - a.volumen15 || a.proyecto.localeCompare(b.proyecto, 'es')));
    }
    res.json(proyectos);
  } catch (err) {
    console.error('[proyectos]', err.message);
    res.status(500).json({ error: 'No se pudieron leer los proyectos', detalle: err.message });
  }
});

// GET /api/limites?activo_key=... — el mínimo de presupuesto que exige
// Meta, leído en vivo de la cuenta publicitaria de ESE activo. Lo usa el
// formulario para avisar (y bloquear) antes de crear algo que Meta va a
// rechazar. Sin activo_key (ej. la primera carga de la pantalla, antes de
// elegir Activo) devuelve el default en 0 — no hay cuenta todavía de la
// que leer. Devuelve minDiario en 0 si no se pudo leer: en ese caso la UI
// no avisa nada.
router.get('/limites', async (req, res) => {
  try {
    const activo = req.query.activo_key ? await getActivoPorKey(req.query.activo_key) : null;
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
    const porEcosistema = req.ecosistemaActivo && req.ecosistemaActivo !== 'TODOS'
      ? tipos.filter((t) => t.ecosistema === req.ecosistemaActivo)
      : tipos;
    // Recorte a MVP, SOLO en modo "automatizado": Intensidad Media/Baja, más
    // "Pautas Army" (monto fijo, entra aparte — ver esTipoPermitidoAutomatizado
    // en src/config/mvp.js). En modo "normal" (o sin modo elegido) se ven
    // todos los Tipos del ecosistema — "normal" incluye lo del
    // automatizado, no tiene restricción propia.
    const filtrados = (req.modoActivo === 'automatizado'
      ? porEcosistema.filter(esTipoPermitidoAutomatizado)
      : porEcosistema)
      // "0 – Automatización" no se elige a mano: es el Tipo de las pautas que
      // llegan solas desde las hojas salida_manual_* (Noticia Franca, El
      // Norte Ahora, Valle 24). La ingesta lo usa directo, sin pasar por acá.
      // "Y – Pautas Army" tampoco (usuario, 2026-09-14): queda en la tabla
      // solo para el histórico.
      .filter((t) => String(t.codigo) !== '0' && String(t.codigo) !== 'Y');
    // Los Tipos Oficiales se llaman por la letra (A/B/C) en la tabla — para
    // el desplegable se muestran "B - Media" (letra - intensidad, pedido del
    // usuario 2026-09-12); lo que se escribe en Tareas no cambia.
    const nombreDe = (t) => (String(t.tipo_campana || '').length === 1 && t.intensidad ? `${t.tipo_campana} - ${t.intensidad}` : t.tipo_campana);
    res.json(filtrados.map((t) => ({ codigo: t.codigo, nombre: nombreDe(t), ecosistema: t.ecosistema })));
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

// GET /api/plataformas — Pedido Normal: qué plataformas se pueden pedir y,
// para cada una, formatos/objetivos/campos (ver src/config/plataformas.js).
// Meta manda formatos/objetivos en null: el front usa /formatos y
// /objetivos como siempre. En modo automatizado solo existe Meta.
router.get('/plataformas', (req, res) => {
  // En automatizado se devuelven todas igual, marcadas: la cuadrícula las
  // muestra apagadas ("solo en Pedido Normal") en vez de esconderlas.
  res.json(PLATAFORMAS.map((p) => ({
    nombre: p.nombre,
    soloNormal: p.nombre !== 'Meta',
    habilitada: req.modoActivo !== 'automatizado' || p.nombre === 'Meta',
    formatos: p.formatos,
    objetivos: p.objetivos,
    placements: !!p.placements,
    soloVideo: !!p.soloVideo,
    requiereLink: !!p.requiereLink,
    medidas: p.medidas || [],
    ayudaMaterial: p.ayudaMaterial || '',
    // modo (imagen/video/carrusel) de cada formato — el front lo usa para
    // ofrecer solo los formatos que comparten las plataformas elegidas.
    modos: MODO_POR_FORMATO[p.nombre] || {},
    categorias: Object.fromEntries(Object.keys(p.categoriaPor || {}).map((f) => [f, categoriasPara(p.nombre, f)])),
  })));
});

// GET /api/objetivos — equiv_objetivo, para el desplegable de Objetivo
router.get('/objetivos', async (req, res) => {
  try {
    const objetivos = await readTable('equiv_objetivo');
    // Recorte a MVP, SOLO en modo "automatizado" — ver src/config/mvp.js.
    const filtrados = req.modoActivo === 'automatizado'
      ? objetivos.filter((o) => OBJETIVOS_PERMITIDOS.includes(o.appsheet_valor))
      : objetivos;
    res.json(filtrados.map((o) => o.appsheet_valor));
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
    const lista = del_activo.map((a) => ({
      codigo: a.codigo_audiencia,
      nombre: limpiarNombreAudiencia(a.nombre_display),
      tamano: a['tamaño'] || '',
      manual: false,
      usos: 0,
    }));
    // Pedido Manual: además del activo, el catálogo del Proyecto × Canal
    // (Excel "IDs de Auds x Activos", nombres del Excel "Audiencias") — esas
    // piezas salen a mano. Primero las que ya se usaron en ese proyecto y
    // canal (hoja CodigosContenido), después el resto por nombre.
    if (req.modoActivo !== 'automatizado' && req.query.activo_key) {
      const activo = await getActivoPorKey(req.query.activo_key);
      const canal = req.ecosistemaActivo === 'Oficial' || req.ecosistemaActivo === 'Informativo' ? req.ecosistemaActivo : null;
      if (activo) {
        const vistos = new Set(lista.map((a) => a.codigo));
        (await getCatalogoPorProyecto(activo.proyecto, canal)).forEach((f) => {
          if (vistos.has(f.codigo)) return;
          vistos.add(f.codigo);
          lista.push({ codigo: f.codigo, nombre: f.nombre, tamano: f.tamano || '', manual: true, usos: 0 });
        });
        // Pedido Manual (usuario, 2026-09-14): solo las más usadas en los
        // últimos dos meses en ese Proyecto × Canal, hasta 10 — si hay menos
        // con uso, son menos (el resto se pide con "Otra").
        const desde = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
        const uso = await usoPorProyectoCanal(activo.proyecto, canal, desde);
        lista.forEach((a) => { a.usos = uso[String(a.codigo).toUpperCase()] || 0; });
        const usadas = lista.filter((a) => a.usos > 0);
        lista.length = 0;
        lista.push(...usadas);
        lista.sort((x, y) => (y.usos - x.usos) || x.nombre.localeCompare(y.nombre, 'es'));
        lista.splice(MAX_AUDIENCIAS_POR_PROYECTO);
      }
    }
    lista.sort((x, y) => (y.usos - x.usos) || x.nombre.localeCompare(y.nombre, 'es'));
    res.json(lista);
  } catch (err) {
    console.error('[audiencias]', err.message);
    res.status(500).json({ error: 'No se pudo leer equiv_audiencia', detalle: err.message });
  }
});

// GET /api/reparto-sugerido?activoKey=&tipoCodigo=&objetivos=a,b&audiencias=x,y
// — reparto y total del último pedido confirmado con ese mismo cruce (ver
// services/repartoSugerido.js). {} si no hay historial.
router.get('/reparto-sugerido', async (req, res) => {
  try {
    const lista = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
    const r = await buscarUltimoMismoCruce({
      activoKey: String(req.query.activoKey || ''),
      tipoCodigo: String(req.query.tipoCodigo || ''),
      objetivos: lista(req.query.objetivos),
      audiencias: lista(req.query.audiencias),
    });
    res.json(r || {});
  } catch (err) {
    res.json({});
  }
});

// GET /api/presupuesto-preview?activoKey=&tipoCodigo=&audienciaCodigo= —
// "Pedido de Pauta" nunca elige el presupuesto a mano (lo resuelve el
// servidor recién al confirmar, ver resolverPresupuestoPorTipo), pero el
// panel de reparto por sliders necesita mostrar montos en pesos mientras
// se mueven — este endpoint solo LEE el mismo cálculo, no escribe nada.
router.get('/presupuesto-preview', async (req, res) => {
  try {
    const { activoKey, tipoCodigo, audienciaCodigo } = req.query;
    if (!activoKey || !tipoCodigo || !audienciaCodigo) {
      return res.json({ presupuesto: null });
    }
    const presupuesto = await resolverPresupuestoPorTipo(tipoCodigo, activoKey, audienciaCodigo);
    res.json({ presupuesto });
  } catch (err) {
    // Mismos motivos que ya explica resolverPresupuestoPorTipo (sin tamaño
    // cargado, Tipo sin Intensidad, etc.) — no es un error de servidor, es
    // "todavía no se puede calcular", el front lo trata como "sin preview".
    res.json({ presupuesto: null, motivo: err.message });
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

// POST /api/publicaciones/resolver — resuelve el link que se pega a mano en
// "Pegar link" (Público) contra el posteo real en Meta, sin depender de que
// esté entre los últimos 12 que trae GET /publicaciones (ver
// resolverPostDesdeLink: el link "Copiar enlace" trae un id que solo Graph
// sabe traducir al post real).
router.post('/publicaciones/resolver', requireRol('pm_cuentas', 'implementador', 'administrador'), async (req, res) => {
  if (!env.metaAccessToken) {
    return res.status(400).json({ error: 'No hay META_ACCESS_TOKEN configurado — hace falta para leer publicaciones de Meta.' });
  }
  try {
    const activo = await getActivoPorKey(req.body.activo_key);
    if (!activo) return res.status(404).json({ error: `No existe el activo "${req.body.activo_key}"` });
    const post = await resolverPostDesdeLink(activo, req.body.link);
    res.json(post);
  } catch (err) {
    console.error('[publicaciones-resolver]', err.message);
    res.status(err.status || 500).json({ error: 'No se pudo resolver ese link', detalle: err.message });
  }
});

module.exports = router;
