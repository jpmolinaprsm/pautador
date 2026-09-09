// El "da OK" del pautador (sección 1, fase 2 del flujo): valida la matriz,
// busca/crea la campaña por objetivo (campanas_meta), crea (o simula, según
// META_MODE) adset/creative/ad para las celdas automáticas, deja las celdas
// de audiencia "Otra" en estado manual, y registra todo en
// matriz_distribucion + cola_pautas.
//
// La creación real vs. simulada vive en metaAdapter.js (mock siempre genera
// IDs con prefijo MOCK-, real llama de verdad a Meta y siempre en PAUSED)
// — este archivo no sabe ni le importa cuál de los dos está activo.

const { readTable, appendRow, updateRow, updateRowWhere } = require('./dataSource');
const { getPautaPorId, getMatrizParaPauta, ESTADO_DESESTIMADA, ESTADO_DEVUELTA_PM, ESTADOS_YA_RESUELTOS } = require('./colaPautas');
const { getActivoEjecucion } = require('./configActivos');
const metaAdapter = require('./metaAdapter');
const { nomenclaturaCampania, nomenclaturaAdset } = require('./nomenclatura');



// Estados de una celda (= un conjunto de anuncios) dentro de matriz_distribucion.
// El carril automático nace publicado; el manual nace pendiente y lo cierra
// una persona. "manual" a secas es el estado viejo, de antes de separar los
// carriles: esas filas ya se dieron por hechas, se respetan como están.
const ESTADO_CELDA_PUBLICADA = 'publicada';
const ESTADO_CELDA_MANUAL_PENDIENTE = 'manual_pendiente';
const ESTADO_CELDA_MANUAL_HECHA = 'manual_hecha';
const ESTADOS_CELDA_CERRADA = [ESTADO_CELDA_PUBLICADA, ESTADO_CELDA_MANUAL_HECHA, 'manual'];

// Plataformas (FB/IG) resueltas: no viene de una tabla de equivalencia —
// "Plataforma" en AppSheet es el CANAL (Meta/YouTube/TikTok/...), no el
// placement dentro de Meta. Eso sale directo de config_activos, por activo
// (qué página/cuenta de IG tiene configurada).
function derivarPlataformasResueltas(activo) {
  if (!activo) return '[]';
  const plats = [];
  if (activo.page_id) plats.push('facebook');
  if (activo.ig_actor_id) plats.push('instagram');
  if (plats.length) return JSON.stringify(plats);
  return JSON.stringify(String(activo.plataformas_default || '').split(',').map((s) => s.trim()).filter(Boolean));
}


async function resolverEquivalencias(pauta) {
  const [equivObjetivo, equivFormato, equivTipo, activo] = await Promise.all([
    readTable('equiv_objetivo'),
    readTable('equiv_formato'),
    readTable('equiv_tipo'),
    // Etapa borrador: se publica SIEMPRE en el activo de ejecución (Tres
    // Empanadas), aunque la pieza haya sido cargada para otro. Antes se
    // usaba pauta.activo y las piezas de activos reales fallaban al
    // confirmar, porque no tenemos acceso a esas cuentas publicitarias.
    getActivoEjecucion(),
  ]);

  const formato = equivFormato.find((f) => f.appsheet_valor === pauta.formato);

  return { equivObjetivo, equivTipo, formato, activo, plataformasResueltas: derivarPlataformasResueltas(activo) };
}

async function confirmarPauta(correlationId, celdasEditadas, confirmadoPor) {
  const pauta = await getPautaPorId(correlationId);
  if (!pauta) {
    const err = new Error(`No existe la pauta "${correlationId}"`);
    err.status = 404;
    throw err;
  }
  if (ESTADOS_YA_RESUELTOS.includes(pauta.estado)) {
    const err = new Error(`Esta pieza ya está en estado "${pauta.estado}" — no se puede confirmar de nuevo.`);
    err.status = 409;
    throw err;
  }

  const matrizOriginal = await getMatrizParaPauta(pauta);

  // No confiamos en el cliente para resolver audiencia/manual — solo para el
  // % editado y, en Público, qué publicación real usa cada celda si se
  // destildó "misma publicación para todas" (ver postId más abajo).
  const celdasFinales = matrizOriginal.celdas.map((celda) => {
    const editada = (celdasEditadas || []).find(
      (c) => c.objetivo === celda.objetivo && c.audiencia_codigo === celda.audiencia.codigo
    );
    const porcentaje = editada ? Number(editada.porcentaje) || 0 : celda.porcentaje;
    const postId = editada && editada.postId ? String(editada.postId).trim() : null;
    return { ...celda, porcentaje, postId };
  });

  const totalPct = celdasFinales.reduce((acc, c) => acc + c.porcentaje, 0);
  if (Math.abs(totalPct - 100) > 0.5) {
    const err = new Error(`La distribución suma ${totalPct}% — tiene que sumar 100% para confirmar.`);
    err.status = 400;
    throw err;
  }

  const { equivObjetivo, equivTipo, formato, activo, plataformasResueltas } = await resolverEquivalencias(pauta);
  // formato va en el contexto porque define el placement (Feed vs Reels).
  const ctxMeta = { activo, equivObjetivo, equivTipo, formato };
  const confirmadoEn = new Date().toISOString();

  // Si una celda falla a mitad de la tanda (pasa: presupuesto bajo el mínimo
  // de Meta, material que no baja, etc.), las anteriores YA se crearon en
  // Meta pero la pieza queda pendiente. Sin esto, el reintento las volvía a
  // crear: anuncios duplicados gastando plata en paralelo. Lo ya publicado
  // queda registrado en matriz_distribucion, así que eso manda.
  const yaRegistradas = (await readTable('matriz_distribucion')).filter(
    (f) => f.correlation_id === correlationId
      && [...ESTADOS_CELDA_CERRADA, ESTADO_CELDA_MANUAL_PENDIENTE].includes(f.estado_celda)
  );

  // Todos los conjuntos automáticos de esta pieza comparten el MISMO
  // creative por defecto — y por lo tanto, para Oculto/Dark, la MISMA
  // publicación en Meta. Antes cada celda armaba el suyo propio: Meta
  // generaba una publicación oculta NUEVA por cada conjunto aunque el
  // contenido fuera idéntico, y los likes/comentarios/compartidos quedaban
  // repartidos en vez de acumularse en una sola. Se resuelve UNA vez acá,
  // antes del loop, para las celdas que NO pidieron una publicación propia
  // (celda.postId) — "misma publicación para todas" sigue siendo el
  // default y el camino más común, esto no le cambia nada.
  //
  // Si ya hay una celda registrada de una corrida anterior con creative_id
  // (retomando después de una falla parcial), se reusa ESA — si no, cada
  // reintento generaría una publicación oculta nueva y volvería a partir el
  // link entre corridas. Acotado a celdas SIN override propio: una celda
  // con publicación distinta no puede "prestar" su creative como si fuera
  // el compartido de las demás.
  const celdasSinOverride = celdasFinales.filter((c) => !c.postId || c.postId === pauta.post_id);
  let creativeIdCompartido = (yaRegistradas.find(
    (f) => f.creative_id && celdasSinOverride.some((c) => c.objetivo === f.objetivo && c.audiencia.codigo === f.audiencia_key)
  ) || {}).creative_id || null;
  const faltaAlgoPorPublicar = celdasSinOverride.some((celda) => {
    if (!(celda.porcentaje > 0) || celda.audiencia.manual) return false;
    return !yaRegistradas.find((f) => f.objetivo === celda.objetivo && f.audiencia_key === celda.audiencia.codigo);
  });
  if (!creativeIdCompartido && faltaAlgoPorPublicar) {
    creativeIdCompartido = await metaAdapter.crearCreative(pauta, ctxMeta);
  }

  // Cache de creatives por publicación override — si dos celdas destildaron
  // "misma publicación" pero eligieron LA MISMA publicación entre sí, no
  // hace falta un creative por cada una, comparten el que ya se resolvió.
  const creativesPorPost = new Map();
  async function resolverCreativeDeCelda(celda) {
    if (!celda.postId || celda.postId === pauta.post_id) return creativeIdCompartido;
    if (creativesPorPost.has(celda.postId)) return creativesPorPost.get(celda.postId);
    const previaMismaCelda = yaRegistradas.find(
      (f) => f.objetivo === celda.objetivo && f.audiencia_key === celda.audiencia.codigo && f.creative_id
    );
    const resuelto = previaMismaCelda ? previaMismaCelda.creative_id : await metaAdapter.crearCreative(pauta, ctxMeta, celda.postId);
    creativesPorPost.set(celda.postId, resuelto);
    return resuelto;
  }

  const resultado = [];
  for (const celda of celdasFinales) {
    const monto = Math.round((matrizOriginal.presupuestoTotal * celda.porcentaje) / 100);
    const nombreAdset = nomenclaturaAdset(pauta, celda, activo);

    // Celda en 0% = "esta combinación no va". Pasa siempre que se usa
    // "Todo acá" (pone el resto en 0). Sin esto se intentaba crear un
    // conjunto con presupuesto $0 y Meta rechazaba la pauta entera.
    if (!(celda.porcentaje > 0)) continue;

    const previa = yaRegistradas.find(
      (f) => f.objetivo === celda.objetivo && f.audiencia_key === celda.audiencia.codigo
    );
    if (previa) {
      resultado.push({
        objetivo: celda.objetivo,
        audiencia: celda.audiencia,
        porcentaje: Number(previa.porcentaje) || celda.porcentaje,
        monto: Number(previa.monto_resuelto) || monto,
        estado_celda: previa.estado_celda,
        campaign_id: previa.campaign_id || undefined,
        adset_id: previa.adset_id || undefined,
        creative_id: previa.creative_id || undefined,
        ad_id: previa.ad_id || undefined,
        nomenclatura: previa.nomenclatura || nombreAdset,
        reusada: true,
      });
      continue;
    }

    // Carril manual: confirmar NO la da por hecha. Queda "manual_pendiente"
    // hasta que alguien la cree a mano en Meta y la marque desde la pantalla.
    // Son dos carriles distintos: el automático lo resuelve la app, el manual
    // lo resuelve una persona y después informa.
    if (celda.audiencia.manual) {
      resultado.push({
        objetivo: celda.objetivo,
        audiencia: celda.audiencia,
        porcentaje: celda.porcentaje,
        monto,
        estado_celda: ESTADO_CELDA_MANUAL_PENDIENTE,
        nomenclatura: nombreAdset,
      });
      await appendRow('matriz_distribucion', [
        correlationId, celda.objetivo, celda.audiencia.codigo, celda.audiencia.nombre, celda.audiencia.tipo,
        celda.porcentaje, monto, '', '', '', '', ESTADO_CELDA_MANUAL_PENDIENTE, confirmadoEn, nombreAdset,
      ]);
      continue;
    }

    const campaignId = await metaAdapter.crearOBuscarCampania(pauta, celda.objetivo, ctxMeta);
    const creativeIdCelda = await resolverCreativeDeCelda(celda);
    const { adsetId, adId } = await metaAdapter.crearAdsetYAd(pauta, celda, monto, campaignId, ctxMeta, creativeIdCelda);

    resultado.push({
      objetivo: celda.objetivo,
      audiencia: celda.audiencia,
      porcentaje: celda.porcentaje,
      monto,
      estado_celda: 'publicada',
      campaign_id: campaignId,
      adset_id: adsetId,
      creative_id: creativeIdCelda,
      ad_id: adId,
      nomenclatura: nombreAdset,
    });
    await appendRow('matriz_distribucion', [
      correlationId, celda.objetivo, celda.audiencia.codigo, celda.audiencia.nombre, celda.audiencia.tipo,
      celda.porcentaje, monto, campaignId, adsetId, creativeIdCelda, adId, 'publicada', confirmadoEn, nombreAdset,
    ]);
  }

  const objetivosDistintos = [...new Set(celdasFinales.map((c) => c.objetivo))];
  const optimizationGoal = objetivosDistintos
    .map((obj) => {
      const eq = equivObjetivo.find((e) => e.appsheet_valor === obj);
      return `${obj}=${eq ? eq.meta_optimization_goal : '?'}`;
    })
    .join('; ');

  const audienciaResuelta = [...new Map(celdasFinales.map((c) => [c.audiencia.codigo, c.audiencia])).values()]
    .map((a) => `${a.codigo}:${a.nombre}`)
    .join(', ');

  const nomenclaturaPreview = objetivosDistintos
    .map((obj) => nomenclaturaCampania(pauta, obj, equivTipo))
    .join(' | ');

  await updateRow('cola_pautas', 'correlation_id', correlationId, {
    estado: 'confirmada',
    confirmado_por: confirmadoPor || 'pautador-mock@prosumia.la',
    confirmado_en: confirmadoEn,
    presupuesto_resuelto: matrizOriginal.presupuestoTotal,
    audiencia_resuelta: audienciaResuelta,
    plataformas_resueltas: plataformasResueltas,
    optimization_goal: optimizationGoal,
    modo: formato ? formato.modo : '',
    nomenclatura_preview: nomenclaturaPreview,
    errores_preview: '',
  });

  return {
    estado: 'confirmada',
    confirmado_en: confirmadoEn,
    presupuesto_total: matrizOriginal.presupuestoTotal,
    nomenclatura_preview: nomenclaturaPreview,
    celdas: resultado,
  };
}

// Piezas 100% manuales (audiencia "Otra", sin ninguna celda automática) no
// se pueden "confirmar" — PAUTADOR no publica nada. El pautador las crea a
// mano en Meta y después marca la pieza como hecha para que salga de pendientes.
async function marcarHechaAMano(correlationId, confirmadoPor) {
  const pauta = await getPautaPorId(correlationId);
  if (!pauta) {
    const err = new Error(`No existe la pauta "${correlationId}"`);
    err.status = 404;
    throw err;
  }
  if (ESTADOS_YA_RESUELTOS.includes(pauta.estado)) {
    const err = new Error(`Esta pieza ya está en estado "${pauta.estado}".`);
    err.status = 409;
    throw err;
  }

  const matriz = await getMatrizParaPauta(pauta);
  const esManualCompleta = matriz.celdas.every((c) => c.manual);
  if (!esManualCompleta) {
    const err = new Error('Esta pieza tiene celdas automáticas — no es 100% manual, tiene que confirmarse.');
    err.status = 400;
    throw err;
  }

  await updateRow('cola_pautas', 'correlation_id', correlationId, {
    estado: 'manual_hecha',
    confirmado_por: confirmadoPor || 'pautador-mock@prosumia.la',
    confirmado_en: new Date().toISOString(),
  });

  return { estado: 'manual_hecha' };
}

// Cierra UNA celda del carril manual: la persona ya la creó a mano en Meta y
// viene a informarlo. No toca las demás celdas — cada carril se resuelve por
// su cuenta.
async function marcarCeldaHecha(correlationId, objetivo, audienciaCodigo, usuario) {
  const pauta = await getPautaPorId(correlationId);
  if (!pauta) {
    const err = new Error(`No existe la pauta "${correlationId}"`);
    err.status = 404;
    throw err;
  }

  const filas = (await readTable('matriz_distribucion')).filter((f) => f.correlation_id === correlationId);
  const yaRegistrada = filas.find((f) => f.objetivo === objetivo && f.audiencia_key === audienciaCodigo);

  if (yaRegistrada && ESTADOS_CELDA_CERRADA.includes(yaRegistrada.estado_celda)) {
    const err = new Error(`Esa celda ya está en estado "${yaRegistrada.estado_celda}".`);
    err.status = 409;
    throw err;
  }

  // La celda tiene que ser del carril manual: el automático se cierra
  // publicando en Meta, no marcándolo a mano.
  const matriz = await getMatrizParaPauta(pauta);
  const celdaMatriz = matriz.celdas.find(
    (c) => c.objetivo === objetivo && c.audiencia.codigo === audienciaCodigo
  );
  if (!celdaMatriz) {
    const err = new Error('Esa combinación de objetivo y audiencia no existe en esta pieza.');
    err.status = 404;
    throw err;
  }
  if (!celdaMatriz.manual) {
    const err = new Error('Esa celda es automática: se publica con "Confirmar", no se marca a mano.');
    err.status = 400;
    throw err;
  }

  if (yaRegistrada) {
    await updateRowWhere(
      'matriz_distribucion',
      { correlation_id: correlationId, objetivo, audiencia_key: audienciaCodigo },
      { estado_celda: ESTADO_CELDA_MANUAL_HECHA }
    );
  } else {
    // Todavía no se confirmó el carril automático, así que la fila no existe:
    // se crea cerrada. Los dos carriles avanzan por separado.
    const monto = Math.round((matriz.presupuestoTotal * celdaMatriz.porcentaje) / 100);
    const { formato, activo } = await resolverEquivalencias(pauta);
    await appendRow('matriz_distribucion', [
      correlationId, objetivo, audienciaCodigo, celdaMatriz.audiencia.nombre, celdaMatriz.audiencia.tipo,
      celdaMatriz.porcentaje, monto, '', '', '', '', ESTADO_CELDA_MANUAL_HECHA, new Date().toISOString(),
      nomenclaturaAdset(pauta, celdaMatriz, activo),
    ]);
  }

  return { estado_celda: ESTADO_CELDA_MANUAL_HECHA };
}

// Desestimar: la pieza NO se va a pautar y sale de la cola. A diferencia de
// "hecha a mano", acá no se creó nada en Meta — es un rechazo, y por eso el
// motivo es obligatorio: sin él, el que pidió la pauta ve la pieza
// desaparecer sin saber por qué, y no queda con qué corregir el pedido.
// Una pieza ya publicada no se puede desestimar: lo que está en Meta hay que
// pausarlo o borrarlo allá, no esconderlo de esta lista.
const MOTIVO_MINIMO = 5;

async function desestimarPauta(correlationId, motivo, usuario) {
  const pauta = await getPautaPorId(correlationId);
  if (!pauta) {
    const err = new Error('No existe la pauta "' + correlationId + '"');
    err.status = 404;
    throw err;
  }
  if (pauta.estado === ESTADO_DESESTIMADA) {
    const err = new Error('Esta pieza ya estaba desestimada.');
    err.status = 409;
    throw err;
  }
  if (ESTADOS_YA_RESUELTOS.includes(pauta.estado)) {
    const err = new Error('Esta pieza ya está en estado "' + pauta.estado + '" — lo que ya se creó en Meta hay que darlo de baja ahí.');
    err.status = 409;
    throw err;
  }

  const texto = String(motivo || '').trim();
  if (texto.length < MOTIVO_MINIMO) {
    const err = new Error('Escribí el motivo: es lo que va a leer quien pidió la pauta para corregirla.');
    err.status = 400;
    throw err;
  }

  await updateRow('cola_pautas', 'correlation_id', correlationId, {
    estado: ESTADO_DESESTIMADA,
    desestimado_por: usuario || 'pautador-mock@prosumia.la',
    desestimado_en: new Date().toISOString(),
    motivo_desestimacion: texto,
  });

  return { estado: ESTADO_DESESTIMADA, motivo: texto };
}

// "Corregir y devolver": a diferencia de desestimar, esto NO es un rechazo
// final — el Implementador no toca nada, solo le devuelve la pieza a quien
// la pidió (PM/Cuentas) con el motivo de qué corregir. Mismos guards que
// desestimar (no se puede devolver algo ya resuelto o ya desestimado); al
// corregirla y guardar (ver editarPauta en pedidos.js) vuelve sola a
// 'preview_lista', lista para que el Implementador la revise de nuevo.
async function devolverPauta(correlationId, motivo, usuario) {
  const pauta = await getPautaPorId(correlationId);
  if (!pauta) {
    const err = new Error('No existe la pauta "' + correlationId + '"');
    err.status = 404;
    throw err;
  }
  if (pauta.estado === ESTADO_DESESTIMADA || pauta.estado === ESTADO_DEVUELTA_PM) {
    const err = new Error('Esta pieza ya estaba ' + (pauta.estado === ESTADO_DESESTIMADA ? 'desestimada' : 'devuelta') + '.');
    err.status = 409;
    throw err;
  }
  if (ESTADOS_YA_RESUELTOS.includes(pauta.estado)) {
    const err = new Error('Esta pieza ya está en estado "' + pauta.estado + '" — lo que ya se creó en Meta hay que darlo de baja ahí.');
    err.status = 409;
    throw err;
  }

  const texto = String(motivo || '').trim();
  if (texto.length < MOTIVO_MINIMO) {
    const err = new Error('Escribí el motivo: es lo que va a leer quien pidió la pauta para corregirla.');
    err.status = 400;
    throw err;
  }

  await updateRow('cola_pautas', 'correlation_id', correlationId, {
    estado: ESTADO_DEVUELTA_PM,
    desestimado_por: usuario || 'pautador-mock@prosumia.la',
    desestimado_en: new Date().toISOString(),
    motivo_desestimacion: texto,
  });

  return { estado: ESTADO_DEVUELTA_PM, motivo: texto };
}

module.exports = {
  confirmarPauta,
  marcarHechaAMano,
  desestimarPauta,
  devolverPauta,
  marcarCeldaHecha,
  ESTADOS_YA_RESUELTOS,
  ESTADO_CELDA_MANUAL_PENDIENTE,
  ESTADOS_CELDA_CERRADA,
  ESTADO_DESESTIMADA,
};
