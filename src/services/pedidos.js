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
// elegido (pedido del usuario — "tienen que aparecer todos"). El Activo
// elegido (`activoKey`) es el que se guarda en `cola_pautas.activo` y con
// el que se ejecuta de verdad en Meta (`ad_account_id`/`page_id` de ESE
// activo, ver getActivoPorKey) — ya no hay un activo de ejecución fijo
// (el sandbox "Tres Empanadas" quedó atrás, ver plan "Conectar activos
// reales").

const { readTable, updateRow } = require('./dataSource');
const { getActivoPorKey } = require('./configActivos');
const { insertarFilaColaPautas } = require('./colaPautasWriter');
const { generarSiguienteCodigo } = require('./codigoGenerator');
const { tieneAccesoAProyecto, tieneAccesoAActivo } = require('./usuarios');
const { parsearPlataformas, combinarPlataformas, modoDelFormato } = require('../config/plataformas');
const env = require('../config/env');
const { procesarPedidoExistente } = require('./publicarExistente');
const { procesarPedidoDark } = require('./crearAnuncioDark');
const { ESTADO_PEDIDO_PENDIENTE, ESTADO_DEVUELTA_PM, ESTADOS_YA_RESUELTOS, getPautaPorId, getMatrizParaPauta } = require('./colaPautas');
const { confirmarPauta } = require('./confirmar');
const { verificarMaterial } = require('./material');
const { resolverPresupuestoPorTipo } = require('./escalaPresupuestos');
const { getAudienciasPorActivo } = require('./audiencias');
const { OBJETIVOS_PERMITIDOS, esTipoPermitidoAutomatizado } = require('../config/mvp');
const { replicarATareas } = require('./tareasSheet');
const { registrarCodigo, recordarCodigo } = require('./codigosSheet');
const { etiquetarCreatividad } = require('./storage');
const { buscarUltimoMismoCruce } = require('./repartoSugerido');



// publicar=true → "Crear Anuncios": crea y manda a Meta en el mismo request.
// publicar=false (default) → "Pedido de Pauta": queda esperando validación.
// soloValidar=true → no escribe nada: corre TODAS las validaciones de acá
// abajo (campos obligatorios, material real, reparto) y corta antes del
// primer write. Lo usa la carga por CSV para mostrar el preview con
// errores por fila sin crear nada todavía.
//
// modo ('automatizado' | cualquier otra cosa, incluido undefined, se trata
// como 'normal' — default conservador: nunca toca la API de Meta sola sin
// que se haya elegido "automatizado" explícitamente) — distinto de
// publicar/soloValidar: separa CÓMO se ejecuta el pedido elegido en la
// primera pantalla, no quién lo pide. 'automatizado' es el recorte a MVP
// (Media/Baja, Alcance/Interacción, Activo habilitado, sin audiencia
// "Otra" — ver src/config/mvp.js). 'normal' es todo lo demás (Alta, otras
// plataformas/objetivos, audiencia real o "Otra") — nunca lo publica
// PAUTADOR solo: getMatrizParaPauta (colaPautas.js) fuerza TODAS las
// celdas a manual, así confirmarPauta las deja "manual_pendiente" en vez
// de crear nada en Meta, y la única acción que queda es marcarlas hechas
// desde Historial (mismo mecanismo que ya existía para audiencia "Otra").
async function crearPedido(datos, usuario, { publicar = false, soloValidar = false, modo } = {}) {
  const modoResuelto = modo === 'automatizado' ? 'automatizado' : 'normal';
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
  // El chequeo de acceso va ANTES de resolver nada (presupuesto incluido):
  // a alguien sin acceso al proyecto no se le cuenta ni qué Tipo existe.
  if (!proyecto || !tieneAccesoAProyecto(usuario, proyecto)) {
    const err = new Error(`No tenés acceso al proyecto "${proyecto || ''}".`);
    err.status = 403;
    throw err;
  }
  // Accesos por activo (Panel Usuarios) — igual que con el proyecto, no
  // alcanza con que el select no lo muestre. (Que el activo exista y sea
  // de este proyecto se valida más abajo, junto con Eje/Tipo.)
  if (activoKey && !tieneAccesoAActivo(usuario, proyecto, activoKey)) {
    const err = new Error(`No tenés acceso al activo "${activoKey}" de "${proyecto}".`);
    err.status = 403;
    throw err;
  }

  let presupuesto = presupuestoManual;
  if (!publicar && tipoCodigo && audienciaCodigo) {
    presupuesto = await resolverPresupuestoPorTipo(tipoCodigo, activoKey, audienciaCodigo);
  }
  // Ingesta (salida_manual_*): cada medio tiene su monto fijo por pauta en
  // config_activos.presupuesto_default (leído del BM 2026-09-14: El Norte
  // Ahora 15.000, Valle 24 7.500, Noticia Franca 10.000) — pisa el monto
  // genérico del Tipo "0".
  if (datos.origen === 'ingesta' && activoKey) {
    const activoIngesta = await getActivoPorKey(activoKey);
    if (activoIngesta && Number(activoIngesta.presupuesto_default) > 0) presupuesto = Number(activoIngesta.presupuesto_default);
  }

  // Plataforma (punto 4): solo el modo "normal" puede pedir otra que Meta
  // (Youtube/Tik Tok/X/Display, ver src/config/plataformas.js) — esas
  // piezas nunca se publican solas, quedan manual_pendiente. Automatizado
  // es Meta siempre, ignore lo que mande el front.
  // Puede ser una o varias ("Meta, Youtube" — se guarda así y Tareas
  // escribe una fila por cada una). Con varias, el Formato es el genérico
  // (Imagen/Video/Carrusel) que todas soportan — ver combinarPlataformas.
  const nombresPlataforma = modoResuelto === 'normal' && datos.plataforma ? parsearPlataformas(datos.plataforma) : ['Meta'];
  const plataformaInfo = combinarPlataformas(nombresPlataforma);
  if (!plataformaInfo) {
    const err = new Error(`Plataforma "${nombresPlataforma.join(', ')}" no existe.`);
    err.status = 400;
    throw err;
  }
  const plataforma = plataformaInfo.nombre;
  const esMeta = plataformaInfo.esMeta;
  const objetivosElegidos = Array.isArray(objetivo) ? objetivo : String(objetivo || '').split(',').map((s) => s.trim()).filter(Boolean);
  // Predefinido de esta etapa (usuario, 2026-09-14): mismo total que la
  // última vez en este cruce Activo × Tipo × Objetivos × Audiencias. Sin
  // historial queda la escala. La ingesta tiene su monto por medio.
  if (!publicar && datos.origen !== 'ingesta' && tipoCodigo && activoKey && audienciaCodigo) {
    const audienciasCruce = [audienciaCodigo, ...(Array.isArray(refuerzoAudiencia) ? refuerzoAudiencia : String(refuerzoAudiencia || '').split(',').map((s) => s.trim()).filter(Boolean))];
    const ultimo = await buscarUltimoMismoCruce({ activoKey, tipoCodigo, objetivos: objetivosElegidos, audiencias: audienciasCruce }).catch(() => null);
    if (ultimo && Number(ultimo.presupuesto) > 0) presupuesto = Number(ultimo.presupuesto);
  }
  if (!esMeta) {
    if (visibilidad !== 'DARK') {
      const err = new Error(`En ${plataforma} no hay "Público" (publicación existente): la pieza se carga como anuncio nuevo (Oculto).`);
      err.status = 400;
      throw err;
    }
    const nombresFormato = (plataformaInfo.formatos || []).map((f) => f.nombre);
    if (formato && !nombresFormato.includes(formato)) {
      const err = new Error(`El Formato "${formato}" no existe en ${plataforma} — opciones: ${nombresFormato.join(', ') || 'ninguna en común'}.`);
      err.status = 400;
      throw err;
    }
  }
  if (plataformaInfo.objetivos) {
    const objetivosNoValidos = objetivosElegidos.filter((o) => !plataformaInfo.objetivos.includes(o));
    if (objetivosNoValidos.length) {
      const err = new Error(`Objetivo(s) no disponibles en ${plataforma}: ${objetivosNoValidos.join(', ')} — opciones: ${plataformaInfo.objetivos.join(', ')}.`);
      err.status = 400;
      throw err;
    }
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
  const formatoInfo = esMeta && visibilidad === 'DARK' && formato
    ? (await readTable('equiv_formato')).find((f) => f.appsheet_valor === formato)
    : null;
  const placementsElegidos = esMeta && Array.isArray(datos.placements)
    ? datos.placements
    : (esMeta ? String(datos.placements || '').split(',').map((s) => s.trim()).filter(Boolean) : []);
  const placementsFinal = placementsElegidos.length ? placementsElegidos : ['feed'];
  const copyOpcional = esMeta && placementsFinal.length === 1 && placementsFinal[0] === 'stories';
  // Link de destino: el campo queda siempre visible en el formulario, pero
  // solo es obligatorio de verdad si el Objetivo incluye Tráfico — antes no
  // se validaba ni siquiera en ese caso (se podía confirmar una pauta de
  // Tráfico sin link y no pasaba nada). Display lo exige siempre.
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
  if (plataformaInfo.requiereLink && !linkDestino) faltantes.push(`Link de destino (obligatorio en ${plataforma})`);
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
    const esCarrusel = esMeta ? !!(formatoInfo && formatoInfo.modo === 'carrusel') : modoDelFormato(plataformaInfo, formato) === 'carrusel';
    const materialesAVerificar = esCarrusel
      ? materialFinal.split('|').map((m) => m.trim()).filter(Boolean)
      : [materialFinal];
    for (let i = 0; i < materialesAVerificar.length; i += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const info = await verificarMaterial(materialesAVerificar[i]);
        // Youtube / Tik Tok solo llevan video (ver config/plataformas.js).
        if (plataformaInfo.soloVideo && info.tipo !== 'video') {
          throw new Error(`${plataforma} solo acepta video, y esto es ${info.tipo}`);
        }
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

  const [ejes, tipos] = await Promise.all([readTable('equiv_eje'), readTable('equiv_tipo')]);
  const eje = ejes.find((e) => e.codigo === ejeCodigo);
  if (!eje) {
    const err = new Error(`Eje "${ejeCodigo}" no existe en equiv_eje.`);
    err.status = 400;
    throw err;
  }
  const tipoInfo = tipos.find((t) => t.codigo === tipoCodigo);
  if (!tipoInfo) {
    const err = new Error(`Tipo "${tipoCodigo}" no existe en equiv_tipo.`);
    err.status = 400;
    throw err;
  }
  // Clientes solo Informativo (CLIENTES_SOLO_INFORMATIVO, ej. Córdoba): un
  // Tipo Oficial no pasa aunque el front lo mande.
  if (tipoInfo.ecosistema === 'Oficial' && env.clientesSoloInformativo.includes(String(activoSolicitado.cliente || ''))) {
    const err = new Error(`${activoSolicitado.cliente}: por ahora solo canal Informativo (Oficial va a tener su propio módulo).`);
    err.status = 400;
    throw err;
  }

  // --- Recorte a MVP, SOLO para modo "automatizado": Intensidad, Objetivo,
  // Activo habilitado, sin audiencia manual (ver src/config/mvp.js). Esto
  // es ADEMÁS de lo que ya filtran los GET (/tipos, /objetivos, /activos)
  // — el CSV bulk-upload y clientes viejos podrían mandar un valor que el
  // select ya no ofrece. "normal" no tiene ninguna de estas restricciones
  // (por eso "incluye lo que está en el automatizado": cualquier Tipo,
  // Objetivo, Activo o audiencia vale) — lo que lo distingue es que
  // getMatrizParaPauta fuerza sus celdas a manual más abajo, nunca
  // restricciones de qué se puede pedir.
  if (modoResuelto === 'automatizado') {
    if (!esTipoPermitidoAutomatizado(tipoInfo)) {
      const err = new Error(`El Tipo "${tipoCodigo}" no está habilitado en Pedido Anuncios Automatizados — solo se puede pautar con Intensidad Media, Baja, o Pautas Army.`);
      err.status = 400;
      throw err;
    }

    const objetivosInvalidos = objetivosElegidos.filter((o) => !OBJETIVOS_PERMITIDOS.includes(o));
    if (objetivosInvalidos.length) {
      const err = new Error(`Objetivo(s) no habilitados en Pedido Anuncios Automatizados: ${objetivosInvalidos.join(', ')}. Solo se puede elegir "Alcance" o "Interacción".`);
      err.status = 400;
      throw err;
    }

    if (activoSolicitado.activo_habilitado !== true) {
      const err = new Error(`El activo "${activoSolicitado.activo || activoKey}" no está habilitado para Pedido Anuncios Automatizados.`);
      err.status = 400;
      throw err;
    }

    // Sin audiencia "Otra" (manual) en modo automatizado — ni principal ni
    // refuerzo, ni por un código CSV vacío o sin match (eso también cae
    // acá: ver resolverAudiencia en colaPautas.js, es la única fuente de
    // manual:true fuera del forzado por modo "normal").
    const audienciasActivo = await getAudienciasPorActivo(activoKey);
    const esAudienciaValida = (cod) => !!cod && cod.toLowerCase() !== 'otra' && audienciasActivo.some((a) => a.codigo_audiencia === cod);
    if (!esAudienciaValida(audienciaCodigo)) {
      const err = new Error('La audiencia principal tiene que ser una audiencia real guardada en Meta — "Otra" (audiencia manual) no está disponible en Pedido Anuncios Automatizados.');
      err.status = 400;
      throw err;
    }
    const refuerzoCodigos = Array.isArray(refuerzoAudiencia) ? refuerzoAudiencia : String(refuerzoAudiencia || '').split(',').map((s) => s.trim()).filter(Boolean);
    const refuerzoInvalido = refuerzoCodigos.find((cod) => !esAudienciaValida(cod));
    if (refuerzoInvalido) {
      const err = new Error(`La audiencia de refuerzo "${refuerzoInvalido}" no es una audiencia real guardada en Meta — "Otra" (audiencia manual) no está disponible en Pedido Anuncios Automatizados.`);
      err.status = 400;
      throw err;
    }
  }

  if (soloValidar) return { ok: true };

  // Ingesta desde las hojas salida_manual_* (ver ingestaSheets.js): el
  // código YA viene armado por el circuito de AppSheet (ej. GDCHAC0AG00262)
  // y tiene que quedar igual para que Tareas/Asana y el histórico coincidan
  // — no se genera uno nuevo. Los pedidos normales siguen con la secuencia.
  const codigo = datos.codigoExterno
    ? String(datos.codigoExterno).trim()
    : await generarSiguienteCodigo(proyecto, ejeCodigo, tipoCodigo);
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
  const filaNueva = {
    correlation_id: correlationId,
    estado: ESTADO_PEDIDO_PENDIENTE,
    fecha: hoy,
    proyecto,
    codigo,
    activo: activoKey,
    objetivo: objetivoTexto,
    audiencia: audienciaCodigo,
    otras_audiencias: audienciaCodigo === 'Otra' ? (otraAudiencia || '') : '',
    formato: formatoFinal,
    plataforma,
    // Categoría de Pieza y Gobernador (campos de AppSheet, van a la hoja
    // Tareas) — columnas de migration_009, se mandan solo si vienen.
    ...(datos.categoriaPieza ? { categoria_pieza: String(datos.categoriaPieza).trim() } : {}),
    ...(datos.gobernador === true || datos.gobernador === 'Sí' ? { gobernador: 'Sí' } : (datos.gobernador === false || datos.gobernador === 'No' ? { gobernador: 'No' } : {})),
    material: materialFinal,
    copy: copyFinal,
    campana,
    contenido,
    eje: eje.eje,
    provincia: activoSolicitado && activoSolicitado.provincia ? activoSolicitado.provincia : '',
    visibilidad,
    refuerzo_audiencia: refuerzoTexto,
    otras_refuerzo: (Array.isArray(refuerzoAudiencia) ? refuerzoAudiencia : []).includes('Otra') ? (otrasRefuerzo || '') : '',
    link_destino: linkDestino || '',
    presupuesto: Number(presupuesto) || 0,
    post_id: post && post.id ? post.id : '',
    fecha_inicio: fechaInicio || hoy,
    fecha_fin: fechaFin || '',
    // Mail (como AppSheet en la columna Creador de CodigosContenido) — así el
    // Historial "solo lo mío" cruza por el mismo dato. Los demo sin mail
    // siguen con el nombre.
    creador: usuario.email || usuario.nombre,
    row_id: codigo,
    activo_solicitado: activoKey,
    imagen_preview: (post && post.imagen) || '',
    comentarios: comentarios || '',
    combos_excluidos: Array.isArray(combosExcluidos) ? combosExcluidos.join(',') : '',
    // Reparto a mano con los sliders (ver Módulo 2/renderFilaReparto en
    // app.js) — se guarda tal cual (JSON) y getMatrizParaPauta decide si lo
    // usa (cubre las celdas exactas y suma 100) o cae al automático.
    reparto: datos.reparto && typeof datos.reparto === 'object' ? JSON.stringify(datos.reparto) : '',
    bulk_id: bulkId || '',
    modo: modoResuelto,
    // 'ingesta' (hojas salida_manual_*) es el único origen que puede crear
    // ACTIVO (ver confirmar.js/estadoInicial). Se manda solo cuando viene:
    // la columna es de migration_005 y un pedido normal no debe depender
    // de que esa migración ya esté corrida.
    ...(datos.origen ? { origen: datos.origen } : {}),
  };
  try {
    await insertarFilaColaPautas(filaNueva);
  } catch (e) {
    // Migración 009 (categoria_pieza/gobernador) sin correr: se guarda el
    // pedido igual, sin esos dos campos, y se avisa — un pedido no se
    // pierde por una columna que todavía no existe (lección de la 004).
    if (!/categoria_pieza|gobernador/.test(e.message)) throw e;
    console.warn('[pedidos] falta correr supabase/migration_009_plataformas.sql — guardo sin categoría de pieza/gobernador:', e.message);
    delete filaNueva.categoria_pieza;
    delete filaNueva.gobernador;
    await insertarFilaColaPautas(filaNueva);
  }

  // Réplica a la hoja "Tareas" (Make → Asana), reemplazo del script de
  // AppSheet — en segundo plano y sin frenar el pedido: si falla, queda
  // tareas_error y el job periódico lo reintenta (ver tareasSheet.js).
  replicarATareas(correlationId).catch((e) => console.warn('[tareas]', correlationId, e.message));
  // Fila nueva en la hoja "CodigosContenido" de AppSheet (BigQuery) — misma
  // lógica: en segundo plano, con reintento; nunca frena el pedido. El
  // código ya insertado entra al caché de la hoja de una (por si el
  // siguiente pedido llega antes de que la fila se escriba).
  recordarCodigo(codigo);
  registrarCodigo(correlationId).catch((e) => console.warn('[codigos]', correlationId, e.message));

  // Etiquetas de la creatividad (si el material es "creatividad:<id>"):
  // recién acá se conocen proyecto/activo/código/campaña/eje. Ver storage.js.
  // Carrusel: varios materiales separados por "|" (ver metaAdapterReal.js).
  const materialesAEtiquetar = [materialFinal, materialStories].filter(Boolean)
    .flatMap((m) => String(m).split('|').map((s) => s.trim()).filter(Boolean));
  materialesAEtiquetar.forEach((m) => {
    etiquetarCreatividad(m, { proyecto, activo_key: activoKey, codigo, campana, eje: eje.eje, correlation_id: correlationId })
      .catch((e) => console.warn('[creatividades] etiquetar', m, e.message));
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
    await procesarPedidoDark({ ...comun, formato: formatoFinal, material: materialFinal, materialStories, copy: copyFinal, copyOpcional, linkDestino, redes: esMeta ? datos.redes : [], placements: esMeta ? datos.placements : [] });
  }

  // 3) A partir de acá el camino es el mismo para los dos roles: se arma la
  //    matriz y se publica en Meta (siempre PAUSED) en el mismo request —
  //    ya no hay instancia intermedia de Validación para "Pedido de
  //    Pauta" (MVP: ver plan "MVP: sacar Validación").
  const pauta = await getPautaPorId(correlationId);
  const matriz = await getMatrizParaPauta(pauta);

  // Si TODA la pieza es manual (audiencia "Otra", sin saved_audience_id) no
  // hay nada que Meta pueda crear: se deja en la cola para que la marquen
  // como hecha a mano, en vez de "confirmarla" sin haber publicado nada.
  // En modo "normal" esto es SIEMPRE cierto (getMatrizParaPauta fuerza
  // manual:true en todas las celdas) — y ahí NO queremos este atajo: hace
  // falta que confirmarPauta corra igual para que la pieza quede
  // "confirmada"/"pendiente_manual" con sus celdas en matriz_distribucion,
  // que es lo que la deja lista para marcar hecha desde Historial.
  if (modoResuelto !== 'normal' && !matriz.celdas.some((c) => !c.manual)) {
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
    porcentaje: reparto && reparto[`${c.objetivo}|${c.audiencia.codigo}`] !== undefined
      ? Number(reparto[`${c.objetivo}|${c.audiencia.codigo}`]) || 0
      : c.porcentaje,
  }));

  const suma = celdas.reduce((a, c) => a + c.porcentaje, 0);
  if (reparto && Math.abs(suma - 100) > 0.5) {
    const err = new Error(`El reparto del presupuesto suma ${Math.round(suma * 100) / 100}%, tiene que sumar 100%.`);
    err.status = 400;
    throw err;
  }
  let resultado;
  try {
    resultado = await confirmarPauta(correlationId, celdas, usuario.nombre);
  } catch (err) {
    // Si Meta (o cualquier paso de la publicación) falla, el error tiene que
    // quedar en la fila — antes la pieza quedaba "preview_lista" sin rastro
    // y el mensaje solo lo veía quien estaba pidiendo en ese momento.
    await updateRow('cola_pautas', 'correlation_id', correlationId, {
      error_publicacion: String(err.message || err).slice(0, 2000),
      errores_preview: String(err.message || err).slice(0, 2000),
    }).catch((e) => console.warn('[pedidos] no pude guardar error_publicacion de', correlationId, e.message));
    throw err;
  }
  // publicado = de verdad salió algo a Meta. En modo normal (todas las celdas
  // manuales) NO: la pieza queda para cargar a mano — el front mostraba
  // "publicada en Meta (en pausa)" igual (bug visto en la revisión de
  // usabilidad 2026-09-12).
  const publicado = matriz.celdas.some((c) => !c.manual);
  return { correlationId, codigo, publicado, manual: !publicado, plataforma, resultado };
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
