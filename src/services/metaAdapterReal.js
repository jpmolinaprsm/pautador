// Motor "real": llama de verdad a la Graph API de Meta. Todo se crea en
// PAUSED — nunca se activa nada acá (activar es una decisión manual en Ads
// Manager, confirmado en "Pauta Automática — Documentación.md").
//
// El targeting usa el público guardado real (celda.audiencia.saved_audience_id)
// cuando existe — ver metaAudiencias.js. Si no hay ID, o no se pudo leer (un
// ID de prueba, borrado, o sin permiso), cae al piso geo_locations:AR.
// La imagen y el video se suben de verdad (metaMedia.js) cuando la pauta
// tiene `material`.

const { readTable, appendRow } = require('./dataSource');
const metaApi = require('./metaApi');
const { subirMaterial, coincideProporcion } = require('./metaMedia');
const { nomenclaturaCampania, nomenclaturaAdset, nomenclaturaCreative } = require('./nomenclatura');
const { getTargetingDeSavedAudience } = require('./metaAudiencias');

// "Facebook,Instagram" / "feed,stories" → ["Facebook","Instagram"] / etc.
// Vacío si no hay nada elegido (pedidos viejos, o "Público" que todavía no
// tiene estos campos) — quien llama decide el default en ese caso.
function parseListaSimple(valor) {
  return String(valor || '').toLowerCase().split(',').map((v) => v.trim()).filter(Boolean);
}

// Placements que se van a usar de verdad: los elegidos a mano en el
// formulario (pauta.placements) si hay, si no Feed a secas (el Formato ya
// no tiene un Placement por defecto — ver placementDisponible). UNA sola
// función para esto — antes crearCreative() y crearAdsetYAd() cada una
// tenía su propio fallback y podían llegar a no coincidir entre sí.
function placementsEfectivos(pauta) {
  const elegidos = parseListaSimple(pauta.placements);
  if (elegidos.length) return elegidos;
  return ['feed'];
}

// A qué "position" real de Meta corresponde cada placement elegido en el
// formulario, por red — son nombres distintos en Facebook y en Instagram
// para lo que conceptualmente es el mismo lugar.
const POSICION_FB = { feed: 'feed', stories: 'story', reels: 'facebook_reels' };
const POSICION_IG = { feed: 'stream', stories: 'story', reels: 'reels' };

// Qué Placements tienen sentido para el Formato elegido — Feed siempre;
// Reels solo si es video (Reels no entrega imagen). Un carrusel no corre en
// Stories ni Reels, Meta no lo soporta ahí — queda en Feed nomás.
//
// La proporción (9:16 para Stories/Reels) ya NO depende del Formato — se
// valida contra el material real más abajo en crearCreative, según el
// Placement elegido. Stories NO exige que el material sea 9:16 de entrada:
// alcanza con que el que se va a usar en Stories lo sea — el principal, o
// uno específico cargado aparte (pauta.material_stories, ver crearCreative
// — Feed usa el principal, Stories usa el suyo, un solo anuncio con
// "Placement Asset Customization"). Reels si exige 9:16 sin excepción (no
// tiene ese material alternativo). Acá solo se decide si la opción aparece
// habilitada; la proporción real se valida recién al confirmar.
function placementDisponible(formatoInfo, placement) {
  if (placement === 'feed') return true;
  if (!formatoInfo || formatoInfo.modo === 'carrusel') return false;
  if (placement === 'stories') return true;
  if (placement === 'reels') return formatoInfo.modo === 'video';
  return false;
}

function fechaISO(fecha, horaFin) {
  // fecha viene como "2026-09-05" — Meta necesita ISO8601 con timezone.
  return `${fecha}T${horaFin ? '23:59:59' : '00:00:00'}-0300`;
}

function sumarDias(fechaISO8601, dias) {
  const d = new Date(`${fechaISO8601}T00:00:00-0300`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Dos celdas de la misma matriz (mismo eje+objetivo) piden esta campaña casi
// al mismo tiempo — sin esto, la 2ª entra a buscar antes de que la 1ª haya
// terminado de escribir en campanas_meta y Meta termina con dos campañas
// idénticas en vez de una con dos adsets adentro. Se cachea la promesa (no
// el resultado) por cuenta+nombre así la 2ª espera a la 1ª en vez de repetir
// el trabajo.
const campaniasEnCurso = new Map();

// Nuestro registro local (o una búsqueda por nombre) puede apuntar a una
// campaña que el usuario archivó/eliminó a mano en Ads Manager después —
// Meta no deja agregarle conjuntos de anuncios nuevos a una campaña
// archivada (code 100, subcode 1487866). Antes de reutilizar un ID hay que
// confirmar que sigue viva; si no, se trata como "no existe" y se crea de
// nuevo más abajo.
async function campaniaUsable(campaignId) {
  try {
    const c = await metaApi.graphGet(`/${campaignId}`, { fields: 'effective_status' });
    return !['ARCHIVED', 'DELETED'].includes(c.effective_status);
  } catch (err) {
    return false;
  }
}

async function buscarOCrearCampania(pauta, objetivo, ctx, nombre) {
  // 1) Nuestro propio registro (rápido, no pega contra Meta si ya lo sabemos).
  const campanas = await readTable('campanas_meta');
  const existenteLocal = campanas.find(
    (c) => c.activo_key === pauta.activo && c.eje === pauta.eje && c.objetivo === objetivo
  );
  if (existenteLocal && (await campaniaUsable(existenteLocal.campaign_id))) {
    return existenteLocal.campaign_id;
  }

  // 2) Meta manda: puede haber una campaña con este nombre exacto creada a
  // mano, en una corrida anterior cuyo registro local no llegó a guardarse,
  // o por otra celda que ganó la carrera — antes de crear, preguntamos.
  const busqueda = await metaApi.graphGet(`/${ctx.activo.ad_account_id}/campaigns`, {
    fields: 'id,name,effective_status',
    filtering: [{ field: 'name', operator: 'EQUAL', value: nombre }],
  });
  const existenteMeta = (busqueda.data || []).find((c) => !['ARCHIVED', 'DELETED'].includes(c.effective_status));
  if (existenteMeta) {
    await appendRow('campanas_meta', [pauta.activo, pauta.eje, objetivo, existenteMeta.id, new Date().toISOString()]);
    return existenteMeta.id;
  }

  const equivObj = ctx.equivObjetivo.find((e) => e.appsheet_valor === objetivo);
  if (!equivObj || !equivObj.meta_campaign_objective) {
    throw new Error(`Objetivo "${objetivo}" no tiene meta_campaign_objective en equiv_objetivo — no se puede crear la campaña.`);
  }

  const data = await metaApi.graphPost(`/${ctx.activo.ad_account_id}/campaigns`, {
    name: nombre,
    objective: equivObj.meta_campaign_objective,
    status: 'PAUSED',
    special_ad_categories: ctx.activo.authorization_category === 'POLITICAL' ? ['ISSUES_ELECTIONS_POLITICS'] : [],
    // El presupuesto vive en cada Adset (una porción por celda de la matriz),
    // no en la campaña — por eso el compartido entre adsets (CBO) va apagado.
    is_adset_budget_sharing_enabled: false,
  });

  await appendRow('campanas_meta', [pauta.activo, pauta.eje, objetivo, data.id, new Date().toISOString()]);
  return data.id;
}

async function crearOBuscarCampania(pauta, objetivo, ctx) {
  const nombre = nomenclaturaCampania(pauta, objetivo, ctx.equivTipo);
  const key = `${ctx.activo.ad_account_id}::${nombre}`;

  if (campaniasEnCurso.has(key)) return campaniasEnCurso.get(key);

  const promesa = buscarOCrearCampania(pauta, objetivo, ctx, nombre);
  campaniasEnCurso.set(key, promesa);
  try {
    return await promesa;
  } finally {
    campaniasEnCurso.delete(key);
  }
}

// Un solo creative por PIEZA (no por conjunto) — se llama UNA vez antes del
// loop de celdas en confirmar.js y se reusa en cada Ad. Antes cada celda se
// armaba el suyo propio y, para Oculto/Dark, eso significa que Meta generaba
// una publicación oculta NUEVA por cada conjunto (aunque el contenido fuera
// idéntico): los likes/comentarios/compartidos quedaban repartidos en varias
// publicaciones en vez de acumularse en una sola. Nada acá depende de la
// celda (ni objetivo ni audiencia), así que resolverlo una vez es correcto,
// no una simplificación.
// postIdOverride: solo para Público, cuando una celda usa una publicación
// distinta a la del resto de la pieza (ver "misma publicación para todas
// las celdas" en confirmar.js) — si no viene, usa la de la pauta como
// siempre. El resto de la pieza (copy/nomenclatura) sigue siendo el mismo
// para todas las celdas; lo único que cambia por celda es a qué post real
// apunta el creative.
async function crearCreative(pauta, ctx, postIdOverride) {
  const nombre = nomenclaturaCreative(pauta);
  // Mismo cálculo que usa crearAdsetYAd para el targeting — tienen que dar
  // lo mismo acá y allá, o la validación permitiría algo que el targeting
  // no termina armando (o al revés).
  const placementsElegidos = placementsEfectivos(pauta);
  const esReels = placementsElegidos.includes('reels');
  const usaStories = placementsElegidos.includes('stories');

  let creativePayload;
  const postId = postIdOverride || pauta.post_id;
  if (pauta.formato === 'Post existente' && postId) {
    // Publicación existente: el anuncio referencia el post tal cual está
    // (mismo texto, misma imagen) — nada que subir. object_story_id va
    // COMO CAMPO DE NIVEL SUPERIOR, no anidado en object_story_spec (Meta
    // rechaza esa combinación con "el campo link es obligatorio").
    // El id de un post de Facebook YA viene como "{page_id}_{post_id}"
    // (así lo devuelve /{page_id}/posts) — no hay que anteponer el page_id
    // de nuevo. Un post de Instagram es un ID numérico solo, campo distinto.
    creativePayload = postId.includes('_')
      ? { object_story_id: postId }
      : { source_instagram_media_id: postId };
  } else if (ctx.formato && ctx.formato.modo === 'carrusel') {
    // Carrusel: varias imágenes en una sola pieza. pauta.material trae los
    // links/archivos separados por "|" (ver el editor de carrusel en
    // app.js). Cada imagen se sube y valida IGUAL que una imagen suelta
    // (mismo tipo/proporción que pide el Formato), y todas juntas arman los
    // child_attachments — Meta pide entre 2 y 10.
    const linkCarrusel = pauta.link_destino || `https://www.facebook.com/${ctx.activo.page_id}`;
    const items = String(pauta.material || '').split('|').map((m) => m.trim()).filter(Boolean);
    if (items.length < 2) {
      throw new Error(`El Formato "${ctx.formato.appsheet_valor}" es un carrusel — hacen falta al menos 2 imágenes (hay ${items.length}).`);
    }
    if (items.length > 10) {
      throw new Error(`El Formato "${ctx.formato.appsheet_valor}" es un carrusel — Meta acepta hasta 10 imágenes (hay ${items.length}).`);
    }

    const childAttachments = [];
    // Referencia de proporción: la primera imagen subida — Meta muestra
    // todas las piezas del carrusel al mismo tamaño, así que si no
    // comparten proporción entre sí, alguna queda recortada o con barras.
    let refItem = null;
    for (let i = 0; i < items.length; i += 1) {
      // Secuencial a propósito: si la imagen 3 de 8 falla, no vale la pena
      // haber subido en paralelo las 8 — mejor cortar apenas se sabe.
      // eslint-disable-next-line no-await-in-loop
      const materialItem = await subirMaterial(items[i], ctx.activo.ad_account_id);
      if (materialItem.tipo !== 'imagen') {
        throw new Error(`El Formato "${ctx.formato.appsheet_valor}" es un carrusel de imágenes — la imagen ${i + 1} es un video.`);
      }
      if (!refItem) {
        refItem = materialItem;
      } else {
        const coincide = coincideProporcion(materialItem.width, materialItem.height, `${refItem.width}:${refItem.height}`);
        if (coincide === false) {
          throw new Error(
            `La pieza ${i + 1} del carrusel no tiene la misma proporción que las demás `
            + `(mide ${materialItem.width}×${materialItem.height}px, la primera mide ${refItem.width}×${refItem.height}px).`
          );
        }
      }
      childAttachments.push({ link: linkCarrusel, image_hash: materialItem.imageHash });
    }

    // Placement: un carrusel solo corre en Feed — placementDisponible() ya
    // lo garantiza (Stories/Reels no aplican a carrusel), esto es el chequeo
    // del lado del servidor de esa misma regla.
    placementsElegidos.forEach((p) => {
      if (!placementDisponible(ctx.formato, p)) {
        throw new Error(`El placement "${p}" no está disponible para el Formato "${ctx.formato.appsheet_valor}".`);
      }
    });

    const objectStorySpecCarrusel = {
      page_id: ctx.activo.page_id,
      link_data: { message: pauta.copy || '', link: linkCarrusel, child_attachments: childAttachments },
    };
    if (ctx.activo.ig_actor_id) objectStorySpecCarrusel.instagram_actor_id = ctx.activo.ig_actor_id;
    creativePayload = { object_story_spec: objectStorySpecCarrusel };
  } else {
    // Material nuevo (Oculto/Dark): se sube el archivo y se arma el creative
    // según lo que resultó ser — imagen (link_data) o video (video_data).
    const link = pauta.link_destino || `https://www.facebook.com/${ctx.activo.page_id}`;
    const material = pauta.material
      ? await subirMaterial(pauta.material, ctx.activo.ad_account_id)
      : null;

    // El material tiene que ser del tipo que pide el Formato — si dice
    // "Video" y se subió una imagen (o viceversa), mejor frenar acá con un
    // mensaje claro que dejar que Meta lo rechace, o peor, que lo acepte
    // recortado/estirado a lo que no es. La proporción ya NO se valida acá
    // contra el Formato — se valida más abajo, por Placement (Reels/Stories
    // piden 9:16; Feed no pide nada en particular).
    if (material && ctx.formato && ctx.formato.modo && ctx.formato.modo !== 'carrusel') {
      if (material.tipo !== ctx.formato.modo) {
        throw new Error(
          `El Formato "${ctx.formato.appsheet_valor}" pide ${ctx.formato.modo === 'video' ? 'un video' : 'una imagen'}, `
          + `pero el material subido es ${material.tipo === 'video' ? 'un video' : 'una imagen'}.`
        );
      }
    }

    // Cada Placement elegido tiene que tener sentido para este Formato —
    // la pantalla ya deshabilita los que no aplican, esto es el mismo
    // chequeo pero del lado del servidor (no confiamos solo en el cliente).
    placementsElegidos.forEach((p) => {
      if (!placementDisponible(ctx.formato, p)) {
        throw new Error(`El placement "${p}" no está disponible para el Formato "${(ctx.formato && ctx.formato.appsheet_valor) || pauta.formato}".`);
      }
    });

    // Reels solo entrega piezas verticales, y solo entrega VIDEO — si el
    // material no da la talla, Meta lo recorta mal o directamente no lo
    // entrega. Mejor cortar acá con un mensaje claro que publicar algo roto.
    if (esReels && material && material.tipo === 'imagen') {
      throw new Error('Elegiste el placement "Reels" pero el material es una imagen. Reels necesita un video vertical.');
    }
    if (esReels && material && material.tipo === 'video' && material.vertical === false) {
      throw new Error(`Elegiste el placement "Reels" pero el video es horizontal (mide ${material.width}×${material.height}px). Reels solo entrega piezas verticales: subí un video vertical o sacá "Reels" del placement.`);
    }
    // Placements distintos con imágenes distintas (ej. Feed 1:1 y Stories
    // 9:16): en vez de forzar una sola imagen a los dos, se arma un
    // asset_feed_spec — sigue siendo UN solo anuncio, pero Meta sirve la
    // imagen que corresponde según dónde aparece ("Placement Asset
    // Customization"). Solo aplica con imágenes (Stories sola, sin Feed/
    // Reels al lado, ya funciona con el material de siempre — no hace
    // falta esto) y si se cargó un material específico para Stories. Se
    // calcula ACÁ (antes del chequeo de proporción de Stories de abajo)
    // porque cuando aplica, el material PRINCIPAL ya no tiene que ser 9:16
    // — el que tiene que serlo es el de Stories, y ese se valida aparte.
    const usaOtroPlacementAdemas = placementsElegidos.some((p) => p !== 'stories');
    const quiereDosImagenes = usaStories && usaOtroPlacementAdemas && pauta.material_stories
      && material && material.tipo === 'imagen';

    // Stories sí acepta imagen o video, pero solo si la proporción es ≈9:16
    // — si no se pudo determinar (medidas no reconocidas), no se bloquea:
    // mejor dejar pasar que inventar un rechazo sin base.
    if (usaStories && !quiereDosImagenes && material && material.esNueveDieciseis === false) {
      throw new Error(`Elegiste el placement "Stories" pero el material no tiene proporción 9:16 (vertical) — mide ${material.width}×${material.height}px. Subí un material 9:16, cargá un material específico para Stories, o sacá "Stories" del placement.`);
    }

    if (quiereDosImagenes) {
      const materialStories = await subirMaterial(pauta.material_stories, ctx.activo.ad_account_id);
      if (materialStories.tipo !== 'imagen') {
        throw new Error('El material de Stories tiene que ser una imagen (el material principal también lo es).');
      }
      const coincideStories = coincideProporcion(materialStories.width, materialStories.height, '9:16');
      if (coincideStories === false) {
        throw new Error(`El material de Stories no tiene proporción 9:16 (vertical) — mide ${materialStories.width}×${materialStories.height}px.`);
      }

      const plataformasSpec = ['facebook', ctx.activo.ig_actor_id && 'instagram'].filter(Boolean);
      const assetFeedSpec = {
        images: [
          { hash: material.imageHash, adlabels: [{ name: 'imagen_principal' }] },
          { hash: materialStories.imageHash, adlabels: [{ name: 'imagen_stories' }] },
        ],
        bodies: [{ text: pauta.copy || '', adlabels: [{ name: 'texto' }] }],
        link_urls: [{ website_url: link, adlabels: [{ name: 'link' }] }],
        ad_formats: ['SINGLE_IMAGE'],
        asset_customization_rules: [
          {
            customization_spec: {
              publisher_platforms: plataformasSpec,
              facebook_positions: ['story'],
              ...(ctx.activo.ig_actor_id ? { instagram_positions: ['story'] } : {}),
            },
            image_label: { name: 'imagen_stories' },
            body_label: { name: 'texto' },
            link_url_label: { name: 'link' },
          },
          {
            // Sin filtro de posición = default: todo lo que NO matcheó la
            // regla de arriba (Feed, Reels) usa la imagen principal.
            customization_spec: { publisher_platforms: plataformasSpec },
            image_label: { name: 'imagen_principal' },
            body_label: { name: 'texto' },
            link_url_label: { name: 'link' },
          },
        ],
      };
      const objectStorySpecDual = { page_id: ctx.activo.page_id };
      if (ctx.activo.ig_actor_id) objectStorySpecDual.instagram_actor_id = ctx.activo.ig_actor_id;
      creativePayload = { object_story_spec: objectStorySpecDual, asset_feed_spec: assetFeedSpec };
    } else {
      let contenidoSpec;
      if (material && material.tipo === 'video') {
        // Un creative de video necesita sí o sí la miniatura (image_url) y,
        // para que Meta lo acepte en Feed, un call_to_action.
        contenidoSpec = {
          video_data: {
            video_id: material.videoId,
            image_url: material.thumbnailUrl,
            message: pauta.copy || '',
            call_to_action: { type: 'LEARN_MORE', value: { link } },
          },
        };
      } else {
        const linkData = { message: pauta.copy || '', link };
        if (material) linkData.image_hash = material.imageHash;
        contenidoSpec = { link_data: linkData };
      }

      const objectStorySpec = { page_id: ctx.activo.page_id, ...contenidoSpec };
      if (ctx.activo.ig_actor_id) objectStorySpec.instagram_actor_id = ctx.activo.ig_actor_id;
      creativePayload = { object_story_spec: objectStorySpec };
    }
  }

  const creative = await metaApi.graphPost(`/${ctx.activo.ad_account_id}/adcreatives`, {
    name: `${nombre} - creative`,
    ...creativePayload,
  });
  return creative.id;
}

// Adset + Ad de UN conjunto (una celda de la matriz), referenciando el
// creative COMPARTIDO de la pieza (creativeId, resuelto una vez por
// crearCreative — ver confirmar.js). Ya no crea su propio creative.
async function crearAdsetYAd(pauta, celda, monto, campaignId, ctx, creativeId) {
  const equivObj = ctx.equivObjetivo.find((e) => e.appsheet_valor === celda.objetivo);
  if (!equivObj || !equivObj.meta_optimization_goal) {
    throw new Error(`Objetivo "${celda.objetivo}" no tiene optimization_goal/billing_event en equiv_objetivo.`);
  }

  const nombre = nomenclaturaAdset(pauta, celda, ctx.activo);
  const inicio = pauta.fecha_inicio || new Date().toISOString().slice(0, 10);
  // Meta EXIGE end_time para adsets con presupuesto tipo "total"
  // (lifetime_budget, que es el único que usamos) — si no vino fecha_fin,
  // se arma sola: inicio + duracion_dias del activo (o 7 días si no hay
  // config), tal como ya decía el diseño original ("Default = Fecha Inicio
  // + duración del config del activo").
  const fin = pauta.fecha_fin || sumarDias(inicio, Number(ctx.activo.duracion_dias) || 7);

  // Red: Facebook, Instagram, o ambas — multipick en el formulario
  // (pauta.redes). Sin elección explícita (pedidos viejos, o el camino de
  // "Público" que todavía no la tiene) cae al default de siempre: Facebook
  // siempre, Instagram solo si el activo tiene cuenta conectada.
  const redesElegidas = parseListaSimple(pauta.redes);
  const tienePlacementFb = redesElegidas.length ? redesElegidas.includes('facebook') : true;
  const tienePlacementIg = redesElegidas.length ? redesElegidas.includes('instagram') : !!ctx.activo.ig_actor_id;

  // Placement: Feed, Stories, Reels — multipick (pauta.placements). Sin
  // elección explícita cae en Feed (ver placementsEfectivos()). Nada de
  // Audience Network ni Advantage+ placements automático — eso sigue sin
  // ser una opción.
  const posiciones = placementsEfectivos(pauta);
  const facebookPositions = posiciones.map((p) => POSICION_FB[p]).filter(Boolean);
  const instagramPositions = posiciones.map((p) => POSICION_IG[p]).filter(Boolean);

  // Meta exige que Facebook Stories nunca vaya solo: hace falta acompañarlo
  // con Feed de Facebook o con Stories de Instagram (si no, rechaza el
  // adset — code 100, subcode 1815891). Pasa sobre todo con activos sin
  // Instagram conectado todavía: ahí instagramPositions queda vacío y el
  // único placement elegido/heredado del Formato es Stories.
  if (
    facebookPositions.includes('story')
    && !facebookPositions.includes('feed')
    && !(tienePlacementIg && instagramPositions.includes('story'))
  ) {
    facebookPositions.push('feed');
  }

  // Si la audiencia tiene un público guardado real (creado a mano en Meta —
  // la API no deja crearlos, ver metaAudiencias.js), se usa SU targeting
  // completo (edad, geo, intereses). El piso geo:AR queda solo para cuando
  // no hay público guardado, o no se pudo leer (ID de prueba/inventado,
  // borrado, o sin permiso) — nunca rompe la publicación por esto.
  let targetingBase = { geo_locations: { countries: ['AR'] } };
  if (celda.audiencia.saved_audience_id) {
    try {
      const targetingGuardado = await getTargetingDeSavedAudience(celda.audiencia.saved_audience_id);
      if (targetingGuardado) targetingBase = targetingGuardado;
    } catch (err) {
      console.warn(`[metaAdapterReal] No se pudo leer el público guardado "${celda.audiencia.saved_audience_id}" (${celda.audiencia.nombre}) — se usa el piso geo:AR. Detalle: ${err.message}`);
    }
  }

  const targeting = {
    ...targetingBase,
    publisher_platforms: [tienePlacementFb && 'facebook', tienePlacementIg && 'instagram'].filter(Boolean),
    facebook_positions: facebookPositions.length ? facebookPositions : ['feed'],
    // Meta lo prende por default — el piloto de Toni es explícito: nunca
    // dejar que Meta expanda la segmentación por su cuenta. Pisa lo que haya
    // traído el público guardado (algunos vienen con esto prendido).
    targeting_automation: { advantage_audience: 0 },
  };
  if (tienePlacementIg) targeting.instagram_positions = instagramPositions.length ? instagramPositions : ['stream'];

  const adsetPayload = {
    name: nombre,
    campaign_id: campaignId,
    billing_event: equivObj.meta_billing_event,
    optimization_goal: equivObj.meta_optimization_goal,
    bid_strategy: equivObj.meta_bid_strategy,
    lifetime_budget: Math.round(monto * 100),
    start_time: fechaISO(inicio, false),
    targeting,
    status: 'PAUSED',
    // Meta exige saber qué se promociona (la Página) para objetivos tipo
    // engagement/awareness — sin esto, el Ad final se rechaza.
    promoted_object: { page_id: ctx.activo.page_id },
  };
  // destination_type: 'ON_POST' solo lo acepta POST_ENGAGEMENT (para
  // desambiguar contra qué se optimiza: el posteo, no Messenger/WhatsApp).
  // Mandarlo con otros optimization_goal (ej. REACH) tira "el tipo de
  // destino seleccionado no es compatible con este objetivo" — error real,
  // visto en Validación al confirmar una pauta con Objetivo "Alcance".
  if (equivObj.meta_optimization_goal === 'POST_ENGAGEMENT') {
    adsetPayload.destination_type = 'ON_POST';
  }
  // Frecuencia: solo los Objetivos que la traen cargada en equiv_objetivo la
  // usan (hoy Alcance 2/7 días e Impresiones 10/7 días) — el resto no manda
  // frequency_control_specs y Meta optimiza libre, como siempre.
  const frecuenciaMax = Number(equivObj.meta_frequency_max) || 0;
  const frecuenciaDias = Number(equivObj.meta_frequency_dias) || 0;
  if (frecuenciaMax > 0 && frecuenciaDias > 0) {
    adsetPayload.frequency_control_specs = [{
      event: 'IMPRESSIONS',
      interval_days: frecuenciaDias,
      max_frequency: frecuenciaMax,
    }];
  }
  if (fin) adsetPayload.end_time = fechaISO(fin, true);

  let adsetId;
  try {
    // "Anuncios multianunciante" tiene que ir siempre desactivado (regla del
    // piloto de Toni) — lo intentamos acá.
    const adset = await metaApi.graphPost(`/${ctx.activo.ad_account_id}/adsets`, {
      ...adsetPayload,
      contextual_bundling_spec: { status: 'OPT_OUT' },
    });
    adsetId = adset.id;
  } catch (err) {
    const esGatekeeperMultiAdvertiser = err.metaError && err.metaError.code === 3 && /contextual_bundle/.test(err.metaError.message || '');
    if (!esGatekeeperMultiAdvertiser) throw err;
    // La cuenta no tiene habilitado ese control por API (gatekeeper de Meta,
    // no depende de nosotros) — seguimos sin poder desactivarlo y avisamos,
    // en vez de bloquear toda la pieza por esto.
    console.warn(`[metaAdapterReal] "${nombre}": la cuenta no puede controlar "multi-advertiser ads" por API — revisar a mano en Ads Manager.`);
    const adset = await metaApi.graphPost(`/${ctx.activo.ad_account_id}/adsets`, adsetPayload);
    adsetId = adset.id;
  }

  let adId;
  try {
    const adPayload = {
      name: nombre,
      adset_id: adsetId,
      creative: { creative_id: creativeId },
      status: 'PAUSED',
    };
    if (ctx.activo.authorization_category) adPayload.authorization_category = ctx.activo.authorization_category;
    const ad = await metaApi.graphPost(`/${ctx.activo.ad_account_id}/ads`, adPayload);
    adId = ad.id;
  } catch (err) {
    await metaApi.graphDelete(`/${adsetId}`).catch(() => {}); // borra adset — el creative queda huérfano sin costo
    throw err;
  }

  return { adsetId, adId };
}

module.exports = { crearOBuscarCampania, crearCreative, crearAdsetYAd };
