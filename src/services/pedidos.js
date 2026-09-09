// "Pedido de Pauta" — el equivalente al formulario de carga individual de
// AppSheet (ver AppSheet/Documentación Appsheet.md y AppSheet/Campos
// Appsheet.xlsx), completado por PM/Cuentas. Como el formulario ya junta
// TODO lo que hace falta (incluida la publicación real, si Visibilidad es
// Público) no hay una etapa intermedia de "Crear Anuncios procesa el
// pedido" — la pieza entra directo a "Validación de Anuncios"
// (estado "preview_lista"). "Crear Anuncios" (Implementadores) usa este
// mismo service function para pautar algo sin pedido previo — la única
// diferencia es el rol que puede llamarlo y quién queda como creador.
//
// Alcance de campos: de los ~30 campos reales de AppSheet, acá tomamos los
// de importancia Alta (los que además ya tienen columna en cola_pautas) —
// Departamento/Ministerio/Categoría Pieza/Comentarios/Línea quedan para
// cuando se haga el onboarding de datos reales (fuera de alcance hoy).
//
// Activo: el desplegable muestra TODOS los activos reales del proyecto
// elegido (pedido del usuario — "tienen que aparecer todos") y se guarda
// en "activo_solicitado" a fines de registro/UI. Pero la ejecución real
// (Meta) sigue yendo siempre a Tres Empanadas — es el único activo con
// credenciales reales conectadas hoy — hasta que el usuario confirme que
// ya tuvo la reunión con Toni y se habilite el resto.

const { readTable, updateRow } = require('./dataSource');
const { getActivoPorKey, ACTIVO_EJECUCION } = require('./configActivos');
const { insertarFilaColaPautas } = require('./colaPautasWriter');
const { generarSiguienteCodigo } = require('./codigoGenerator');
const { tieneAccesoAProyecto } = require('./usuarios');
const { procesarPedidoExistente } = require('./publicarExistente');
const { procesarPedidoDark } = require('./crearAnuncioDark');
const { ESTADO_PEDIDO_PENDIENTE, ESTADO_DEVUELTA_PM, ESTADOS_YA_RESUELTOS, getPautaPorId, getMatrizParaPauta } = require('./colaPautas');
const { confirmarPauta } = require('./confirmar');
const { verificarMaterial } = require('./material');
const { resolverPresupuestoPorTipo } = require('./escalaPresupuestos');



// publicar=true → "Crear Anuncios": crea y manda a Meta en el mismo request.
// publicar=false (default) → "Pedido de Pauta": queda esperando validación.
// soloValidar=true → no escribe nada: corre TODAS las validaciones de acá
// abajo (campos obligatorios, material real, reparto) y corta antes del
// primer write. Lo usa la carga por CSV para mostrar el preview con
// errores por fila sin crear nada todavía.
async function crearPedido(datos, usuario, { publicar = false, soloValidar = false } = {}) {
  const {
    proyecto, activoKey, ejeCodigo, tipoCodigo, campana, linea, visibilidad, formato,
    objetivo, audienciaCodigo, otraAudiencia, refuerzoAudiencia, otrasRefuerzo,
    material, copy, presupuesto: presupuestoManual, fechaInicio, fechaFin, linkDestino, post, comentarios,
    // Cruces Objetivo×Audiencia que el PM desactivó antes de pedir (ver
    // Módulo 2 en el front) — quedan afuera para siempre, ni Validación los
    // ve (getMatrizParaPauta en colaPautas.js los filtra al armar la matriz).
    combosExcluidos,
    // Comparten el mismo bulkId todas las piezas de una misma tanda (Módulo
    // 5, "Cantidad de piezas" > 1) — ver enviarBulkV2 en el front. Sirve
    // para que Validación pueda contar "cuántas van juntas en este grupo".
    bulkId,
    // Solo tiene sentido cuando el Placement incluye Stories JUNTO con
    // Feed/Reels y las dos imágenes no son la misma (ver metaAdapterReal.js:
    // crearCreative arma un asset_feed_spec con las dos en vez del
    // object_story_spec simple de siempre). Opcional: sin esto, Stories usa
    // el mismo material que el resto, como ya funcionaba.
    materialStories,
  } = datos;

  // Presupuesto: "Pedido de Pauta" (PM/Cuentas — o Admin usando ese mismo
  // camino, publicar=false) nunca lo elige a mano — ya no existe el
  // desplegable de Intensidad. Sale de Tipo (que define la Intensidad:
  // A/F=Alta, B/E=Media, C/D=Baja) × tamaño de la Audiencia principal, vía
  // escala_presupuestos — el PM no ve el monto, lo ve recién el
  // Implementador en Validación. "Crear Anuncios" (Implementador,
  // publicar=true) sigue eligiendo el monto directo, como siempre.
  let presupuesto = presupuestoManual;
  if (!publicar && tipoCodigo && audienciaCodigo) {
    presupuesto = await resolverPresupuestoPorTipo(tipoCodigo, ACTIVO_EJECUCION, audienciaCodigo);
  }

  if (!proyecto || !tieneAccesoAProyecto(usuario, proyecto)) {
    const err = new Error(`No tenés acceso al proyecto "${proyecto || ''}".`);
    err.status = 403;
    throw err;
  }

  // Público SIEMPRE necesita una publicación real elegida del picker — nadie
  // más va a "arreglarlo" después, la pieza entra directo a Validación con
  // lo que se cargó acá.
  if (visibilidad === 'PUBLICO' && !(post && post.id)) {
    const err = new Error('Para "Público" hace falta elegir una publicación real (no alcanza con pegar un link).');
    err.status = 400;
    throw err;
  }

  const materialFinal = material || (post && post.permalink) || '';
  // Público: el Copy es el texto de la publicación elegida, no algo que se
  // tipee a mano — nunca se le pide al PM/Implementador, sale del post.
  const copyFinal = visibilidad === 'PUBLICO' ? (post && post.caption) || copy || '' : copy;
  const tieneObjetivo = Array.isArray(objetivo) ? objetivo.length > 0 : !!objetivo;

  // Formato ya resuelto acá (no solo más abajo, para el chequeo de material)
  // porque también hace falta para saber si el Copy es obligatorio: Stories
  // es pantalla completa, Meta no muestra el texto principal ahí, así que si
  // el ÚNICO placement es Stories no tiene sentido exigirlo.
  const formatoInfo = visibilidad === 'DARK' && formato
    ? (await readTable('equiv_formato')).find((f) => f.appsheet_valor === formato)
    : null;
  const placementsElegidos = Array.isArray(datos.placements)
    ? datos.placements
    : String(datos.placements || '').split(',').map((s) => s.trim()).filter(Boolean);
  const placementsFinal = placementsElegidos.length ? placementsElegidos : ['feed'];
  const copyOpcional = placementsFinal.length === 1 && placementsFinal[0] === 'stories';
  // Link de destino: el campo queda siempre visible en el formulario, pero
  // solo es obligatorio de verdad si el Objetivo incluye Tráfico — antes no
  // se validaba ni siquiera en ese caso (se podía confirmar una pauta de
  // Tráfico sin link y no pasaba nada).
  const objetivosElegidos = Array.isArray(objetivo) ? objetivo : String(objetivo || '').split(',').map((s) => s.trim()).filter(Boolean);
  const esTrafico = objetivosElegidos.includes('Tráfico');

  const faltantes = [];
  if (!activoKey) faltantes.push('Activo');
  if (!tipoCodigo) faltantes.push('Tipo');
  if (!ejeCodigo) faltantes.push('Eje');
  if (!campana) faltantes.push('Campaña');
  if (!visibilidad) faltantes.push('Visibilidad');
  if (!tieneObjetivo) faltantes.push('Objetivo');
  if (!audienciaCodigo) faltantes.push('Audiencia');
  if (!materialFinal) faltantes.push('Material');
  if (visibilidad === 'DARK' && !copyFinal && !copyOpcional) faltantes.push('Copy');
  if (!presupuesto) faltantes.push('Presupuesto');
  if (visibilidad === 'DARK' && !formato) faltantes.push('Formato');
  if (esTrafico && !linkDestino) faltantes.push('Link de destino (obligatorio con Objetivo Tráfico)');
  if (faltantes.length) {
    const err = new Error(`Faltan campos obligatorios: ${faltantes.join(', ')}.`);
    err.status = 400;
    throw err;
  }

  // El material se verifica ACÁ, no al publicar: un link de Drive mal pegado
  // (privado, carpeta, PDF, borrado) antes se descubría recién cuando el
  // implementador confirmaba, lejos de quien lo cargó. Solo aplica a Oculto:
  // en Público el material es una publicación real elegida del picker, que no
  // se sube a Meta (ya está publicada).
  // El front hace este mismo chequeo para mostrar el preview; esta es la que
  // manda — igual que con los roles, no alcanza con esconder el botón.
  //
  // Carrusel: el material no es UNO, son varios separados por "|" (ver
  // metaAdapterReal.js) — se verifica cada uno por separado, no la cadena
  // entera de una (eso siempre iba a fallar: "no es un link").
  if (visibilidad === 'DARK') {
    const esCarrusel = !!(formatoInfo && formatoInfo.modo === 'carrusel');
    const materialesAVerificar = esCarrusel
      ? materialFinal.split('|').map((m) => m.trim()).filter(Boolean)
      : [materialFinal];
    for (let i = 0; i < materialesAVerificar.length; i += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await verificarMaterial(materialesAVerificar[i]);
      } catch (e) {
        const prefijo = esCarrusel ? `imagen ${i + 1} del carrusel: ` : '';
        const err = new Error(`No se puede usar ese material (${prefijo}${e.message})`);
        err.status = 400;
        throw err;
      }
    }
    // Material específico de Stories (opcional, solo tiene sentido con Feed
    // o Reels elegidos también) — mismo chequeo temprano que el material
    // principal, no recién al confirmar.
    if (materialStories) {
      try {
        await verificarMaterial(materialStories);
      } catch (e) {
        const err = new Error(`No se puede usar ese material de Stories (${e.message})`);
        err.status = 400;
        throw err;
      }
    }
  }

  // El reparto se valida ANTES de crear la fila: si no suma 100 no se puede
  // publicar, y una pieza a medio hacer esperando en Validación es peor que
  // un error claro acá.
  if (datos.reparto && typeof datos.reparto === 'object') {
    const suma = Object.values(datos.reparto).reduce((a, v) => a + (Number(v) || 0), 0);
    if (Math.abs(suma - 100) > 0.5) {
      const err = new Error('El reparto del presupuesto suma ' + (Math.round(suma * 100) / 100) + '%, tiene que sumar 100%.');
      err.status = 400;
      throw err;
    }
  }

  const activoSolicitado = await getActivoPorKey(activoKey);
  if (!activoSolicitado || activoSolicitado.proyecto !== proyecto) {
    const err = new Error(`El activo elegido no pertenece al proyecto "${proyecto}".`);
    err.status = 400;
    throw err;
  }

  const activo = await getActivoPorKey(ACTIVO_EJECUCION);
  const [ejes, tipos] = await Promise.all([readTable('equiv_eje'), readTable('equiv_tipo')]);
  const eje = ejes.find((e) => e.codigo === ejeCodigo);
  if (!eje) {
    const err = new Error(`Eje "${ejeCodigo}" no existe en equiv_eje.`);
    err.status = 400;
    throw err;
  }
  if (!tipos.find((t) => t.codigo === tipoCodigo)) {
    const err = new Error(`Tipo "${tipoCodigo}" no existe en equiv_tipo.`);
    err.status = 400;
    throw err;
  }

  if (soloValidar) return { ok: true };

  const codigo = await generarSiguienteCodigo(proyecto, ejeCodigo, tipoCodigo);
  const formatoFinal = visibilidad === 'DARK' ? formato : 'Post existente';
  // Misma fórmula que AppSheet para "Contenido" (ver Campos Appsheet.xlsx):
  // Campana + (Linea entre comillas, si hay) + " (Formato)".
  const lineaLimpia = (linea || '').trim();
  const contenido = `${campana}${lineaLimpia ? ` "${lineaLimpia}"` : ''} (${formatoFinal})`;
  const hoy = new Date().toISOString().slice(0, 10);
  const correlationId = `PEDIDO-${Date.now()}`;
  const objetivoTexto = Array.isArray(objetivo) ? objetivo.join(',') : objetivo;
  const refuerzoTexto = Array.isArray(refuerzoAudiencia) ? refuerzoAudiencia.join(',') : (refuerzoAudiencia || '');

  // 1) Crea la fila — arranca en "pendiente" nada más por una fracción de
  // segundo, el paso 2 de acá abajo la termina y la deja en "preview_lista"
  // dentro del mismo request. Nunca queda expuesta como pendiente de verdad
  // (no hay más cola de pedidos sin procesar).
  await insertarFilaColaPautas({
    correlation_id: correlationId,
    estado: ESTADO_PEDIDO_PENDIENTE,
    fecha: hoy,
    proyecto,
    codigo,
    activo: ACTIVO_EJECUCION,
    objetivo: objetivoTexto,
    audiencia: audienciaCodigo,
    otras_audiencias: audienciaCodigo === 'Otra' ? (otraAudiencia || '') : '',
    formato: formatoFinal,
    plataforma: 'Meta',
    material: materialFinal,
    copy: copyFinal,
    campana,
    contenido,
    eje: eje.eje,
    provincia: activo && activo.provincia ? activo.provincia : '',
    visibilidad,
    refuerzo_audiencia: refuerzoTexto,
    otras_refuerzo: (Array.isArray(refuerzoAudiencia) ? refuerzoAudiencia : []).includes('Otra') ? (otrasRefuerzo || '') : '',
    link_destino: linkDestino || '',
    presupuesto: Number(presupuesto) || 0,
    post_id: post && post.id ? post.id : '',
    fecha_inicio: fechaInicio || hoy,
    fecha_fin: fechaFin || '',
    creador: usuario.nombre,
    row_id: codigo,
    activo_solicitado: activoKey,
    imagen_preview: (post && post.imagen) || '',
    comentarios: comentarios || '',
    combos_excluidos: Array.isArray(combosExcluidos) ? combosExcluidos.join(',') : '',
    bulk_id: bulkId || '',
  });

  // 2) ...y de una la "termina" (mismo paso que antes hacía Crear Anuncios):
  // completa lo que le falta a Meta (billing_event, etc.) — para Público ya
  // tenemos el post real, para Oculto ya tenemos material/copy/formato.
  const comun = {
    correlationId,
    objetivo: objetivoTexto,
    audiencia: audienciaCodigo,
    refuerzoAudiencia: refuerzoTexto,
    presupuesto,
    fechaInicio: fechaInicio || hoy,
    fechaFin,
  };
  if (visibilidad === 'PUBLICO') {
    await procesarPedidoExistente({ ...comun, post });
  } else {
    await procesarPedidoDark({ ...comun, formato: formatoFinal, material: materialFinal, materialStories, copy: copyFinal, copyOpcional, linkDestino, redes: datos.redes, placements: datos.placements });
  }

  // 3) Los dos caminos se separan acá:
  //    - "Pedido de Pauta" (PM/Cuentas): queda en Validación de Anuncios,
  //      esperando que un Implementador reparta y confirme.
  //    - "Crear Anuncios" (Implementador): va derecho a Meta. Es el camino
  //      alternativo, sin validación — el que la carga ya es quien valida.
  if (!publicar) return { correlationId, codigo, publicado: false };

  const pauta = await getPautaPorId(correlationId);
  const matriz = await getMatrizParaPauta(pauta);

  // Si TODA la pieza es manual (audiencia "Otra", sin saved_audience_id) no
  // hay nada que Meta pueda crear: se deja en la cola para que la marquen
  // como hecha a mano, en vez de "confirmarla" sin haber publicado nada.
  if (!matriz.celdas.some((c) => !c.manual)) {
    return {
      correlationId,
      codigo,
      publicado: false,
      motivo: 'La audiencia es "Otra" (sin público guardado en Meta): esta pieza se crea a mano. Quedó en Validación de Anuncios para que la marques como hecha.',
    };
  }

  // El reparto lo define quien carga, en el preview de "Crear Anuncios"
  // (acá no hay Validación donde repartir después). Si no vino, queda el
  // parejo por defecto que ya calculó la matriz. Las celdas salen siempre
  // de la matriz: del reparto solo se toma el porcentaje, así no se puede
  // inventar una combinación que la pieza no tiene.
  const reparto = datos.reparto && typeof datos.reparto === 'object' ? datos.reparto : null;
  const celdas = matriz.celdas.map((c) => ({
    objetivo: c.objetivo,
    audiencia_codigo: c.audiencia.codigo,
    porcentaje: reparto && reparto[`${c.objetivo}||${c.audiencia.codigo}`] !== undefined
      ? Number(reparto[`${c.objetivo}||${c.audiencia.codigo}`]) || 0
      : c.porcentaje,
  }));

  const suma = celdas.reduce((a, c) => a + c.porcentaje, 0);
  if (reparto && Math.abs(suma - 100) > 0.5) {
    const err = new Error(`El reparto del presupuesto suma ${Math.round(suma * 100) / 100}%, tiene que sumar 100%.`);
    err.status = 400;
    throw err;
  }
  const resultado = await confirmarPauta(correlationId, celdas, usuario.nombre);
  return { correlationId, codigo, publicado: true, resultado };
}

// Edita los campos de una pauta que YA EXISTE (a diferencia de crearPedido,
// no inserta nada nuevo) — la usan tanto el Implementador ("Corregir y
// pautar": se arregla algo y se sigue con el confirm normal, sin volver
// atrás) como el PM/Cuentas (corrigiendo una pieza que el Implementador le
// devolvió con "Corregir y devolver"). Mismas reglas de campos obligatorios
// que crearPedido, salvo Eje y Tipo — esos dos quedan FIJOS: van
// codificados adentro de `codigo` (generarSiguienteCodigo arma
// {prefijo}{tipo}{eje}{secuencia}), así que cambiarlos dejaría el código de
// la pieza sin relación con lo que dice, en vez de corregir algo, la
// convertiría en otra pauta con la identidad de la vieja. Tampoco se toca
// Presupuesto (lo resuelve la escala Tipo×Audiencia al crear, o el ajuste
// manual en Validación) ni Visibilidad (Público/Oculto son dos caminos de
// carga distintos, no algo que se cambie a mitad de camino).
async function editarPauta(correlationId, datos) {
  const pauta = await getPautaPorId(correlationId);
  if (!pauta) {
    const err = new Error(`No existe la pauta "${correlationId}".`);
    err.status = 404;
    throw err;
  }
  if (ESTADOS_YA_RESUELTOS.includes(pauta.estado)) {
    const err = new Error(`Esta pieza ya está en estado "${pauta.estado}" — no se puede editar.`);
    err.status = 409;
    throw err;
  }

  const {
    campana, linea, formato,
    objetivo, audienciaCodigo, otraAudiencia, refuerzoAudiencia, otrasRefuerzo,
    material, copy, fechaInicio, fechaFin, linkDestino, materialStories,
  } = datos;

  const visibilidad = pauta.visibilidad;
  const materialFinal = visibilidad === 'DARK' ? (material || '') : pauta.material;
  const tieneObjetivo = Array.isArray(objetivo) ? objetivo.length > 0 : !!objetivo;
  const formatoInfo = visibilidad === 'DARK' && formato
    ? (await readTable('equiv_formato')).find((f) => f.appsheet_valor === formato)
    : null;
  const placementsElegidos = Array.isArray(datos.placements)
    ? datos.placements
    : String(datos.placements || '').split(',').map((s) => s.trim()).filter(Boolean);
  const placementsFinal = placementsElegidos.length ? placementsElegidos : ['feed'];
  const copyOpcional = placementsFinal.length === 1 && placementsFinal[0] === 'stories';
  const objetivosElegidos = Array.isArray(objetivo) ? objetivo : String(objetivo || '').split(',').map((s) => s.trim()).filter(Boolean);
  const esTrafico = objetivosElegidos.includes('Tráfico');

  const faltantes = [];
  if (!campana) faltantes.push('Campaña');
  if (!tieneObjetivo) faltantes.push('Objetivo');
  if (!audienciaCodigo) faltantes.push('Audiencia');
  if (visibilidad === 'DARK' && !materialFinal) faltantes.push('Material');
  if (visibilidad === 'DARK' && !copy && !copyOpcional) faltantes.push('Copy');
  if (visibilidad === 'DARK' && !formato) faltantes.push('Formato');
  if (esTrafico && !linkDestino) faltantes.push('Link de destino (obligatorio con Objetivo Tráfico)');
  if (faltantes.length) {
    const err = new Error(`Faltan campos obligatorios: ${faltantes.join(', ')}.`);
    err.status = 400;
    throw err;
  }

  if (visibilidad === 'DARK') {
    const esCarrusel = !!(formatoInfo && formatoInfo.modo === 'carrusel');
    const materialesAVerificar = esCarrusel
      ? materialFinal.split('|').map((m) => m.trim()).filter(Boolean)
      : [materialFinal];
    for (let i = 0; i < materialesAVerificar.length; i += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await verificarMaterial(materialesAVerificar[i]);
      } catch (e) {
        const prefijo = esCarrusel ? `imagen ${i + 1} del carrusel: ` : '';
        const err = new Error(`No se puede usar ese material (${prefijo}${e.message})`);
        err.status = 400;
        throw err;
      }
    }
    if (materialStories) {
      try {
        await verificarMaterial(materialStories);
      } catch (e) {
        const err = new Error(`No se puede usar ese material de Stories (${e.message})`);
        err.status = 400;
        throw err;
      }
    }
  }

  const formatoFinal = visibilidad === 'DARK' ? formato : pauta.formato;
  const lineaLimpia = (linea || '').trim();
  const contenido = `${campana}${lineaLimpia ? ` "${lineaLimpia}"` : ''} (${formatoFinal})`;
  const objetivoTexto = Array.isArray(objetivo) ? objetivo.join(',') : objetivo;
  const refuerzoTexto = Array.isArray(refuerzoAudiencia) ? refuerzoAudiencia.join(',') : (refuerzoAudiencia || '');

  const cambios = {
    objetivo: objetivoTexto,
    audiencia: audienciaCodigo,
    otras_audiencias: audienciaCodigo === 'Otra' ? (otraAudiencia || '') : '',
    formato: formatoFinal,
    material: materialFinal,
    material_stories: materialStories || '',
    copy: visibilidad === 'DARK' ? copy : pauta.copy,
    campana,
    contenido,
    refuerzo_audiencia: refuerzoTexto,
    otras_refuerzo: (Array.isArray(refuerzoAudiencia) ? refuerzoAudiencia : []).includes('Otra') ? (otrasRefuerzo || '') : '',
    link_destino: linkDestino || '',
    fecha_inicio: fechaInicio || pauta.fecha_inicio,
    fecha_fin: fechaFin || '',
    redes: Array.isArray(datos.redes) ? datos.redes.join(',') : (datos.redes || pauta.redes || ''),
    placements: placementsFinal.join(','),
  };
  // Si estaba devuelta al PM para corregir, al guardar la corrección vuelve
  // sola a Validación (preview_lista) — el Implementador la vuelve a ver
  // para confirmar. Si la está editando el propio Implementador ("Corregir
  // y pautar"), el estado no cambia: sigue en lo suyo.
  if (pauta.estado === ESTADO_DEVUELTA_PM) cambios.estado = 'preview_lista';

  await updateRow('cola_pautas', 'correlation_id', correlationId, cambios);
  return { correlationId, estado: cambios.estado || pauta.estado };
}

module.exports = { crearPedido, editarPauta };
