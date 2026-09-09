// Arma el shape de "item" que necesita la pantalla única del pautador
// (ver Mock Up de Claude Design/brief-original.md y Pautador.dc.html):
// a diferencia de /api/pendientes + /api/pauta/:id (resumen + detalle
// bajo demanda), acá se manda TODO de una — audiencias, celdas y (si ya
// se confirmó o se marcó manual) el resultado — para que el front expanda
// cualquier fila sin otro fetch.

const { readTable } = require('./dataSource');
const { getMatrizParaPauta, esParaMeta, ESTADO_PEDIDO_PENDIENTE } = require('./colaPautas');
const { getActivoPorKey, getActivoEjecucion } = require('./configActivos');
const { proyectosPermitidos } = require('./usuarios');
const { getLimitesCuenta, minimoPorConjunto } = require('./metaLimites');
const { ESTADO_CELDA_MANUAL_PENDIENTE, ESTADOS_CELDA_CERRADA } = require('./confirmar');
const { ESTADO_DESESTIMADA, ESTADO_DEVUELTA_PM } = require('./colaPautas');
// Para "Publicación existente" el preview sale del post real (guardado al
// crear el pedido). Para Oculto/Dark el Material es un link de Drive y la
// miniatura la arma material.js — la misma que usa el preview del pedido.
const { previewDesdeMaterial } = require('./material');

// Días que va a correr el conjunto — MISMA regla que usa metaAdapterReal al
// crear el adset (si no hay fecha_fin: inicio + duracion_dias del activo, o 7).
// Tiene que coincidir, porque de esto depende el mínimo que exige Meta.
//
// El "+1" no es un redondeo: el adset arranca a las 00:00:00 del día de
// inicio y termina a las 23:59:59 del día de fin, así que del 8 al 15 corre
// 8 días, no 7. Verificado contra Meta: para esas fechas pidió $12.027,75,
// que es exactamente min_daily_budget ($1.503,47) × 8.
function diasDeDuracion(pauta, activo) {
  // Si la fecha de inicio ya pasó, Meta no la "recupera": el conjunto corre
  // desde hoy hasta el fin. Contar desde la fecha original sobrestimaba la
  // duración (y con eso el mínimo, bloqueando pautas que sí entraban).
  const hoy = new Date().toISOString().slice(0, 10);
  const inicioPedido = pauta.fecha_inicio || pauta.fecha;
  const inicio = inicioPedido && inicioPedido > hoy ? inicioPedido : hoy;

  if (pauta.fecha_fin && inicio) {
    const ms = new Date(`${pauta.fecha_fin}T00:00:00-0300`) - new Date(`${inicio}T00:00:00-0300`);
    const dias = Math.round(ms / 86400000);
    if (dias >= 0) return dias + 1;
  }
  return (Number(activo && activo.duracion_dias) || 7) + 1;
}

async function getItemCompleto(pauta, matrizDistribucionCache, equivTipo) {
  const matriz = await getMatrizParaPauta(pauta);

  const objetivos = [...new Set(matriz.celdas.map((c) => c.objetivo))];
  const audienciasMap = new Map();
  matriz.celdas.forEach((c) => audienciasMap.set(c.audiencia.codigo, c.audiencia));
  const audiencias = [...audienciasMap.values()];

  let estado = 'pendiente';
  // Caso 100% manual sin matriz (1 objetivo × audiencia "Otra"): celdas
  // vacío es la señal que usa el front para "Manual" en vez de "Simple"
  // (ver Mock Up de Claude Design — isManualOnly = !celdas.length).
  const esManualSimple = !matriz.esMatriz && matriz.celdas[0] && matriz.celdas[0].manual;
  // Lo ya registrado por celda, exista o no una confirmación de la pieza: el
  // carril manual se puede cerrar ANTES de confirmar el automático (son
  // independientes), así que el estado de cada celda hay que mirarlo siempre.
  const filasCelda = matrizDistribucionCache.filter((f) => f.correlation_id === pauta.correlation_id);
  const estadoDeCelda = (objetivo, audCodigo) => {
    const f = filasCelda.find((x) => x.objetivo === objetivo && x.audiencia_key === audCodigo);
    return f ? f.estado_celda : '';
  };

  let celdas = esManualSimple
    ? []
    : matriz.celdas.map((c) => ({
        objetivo: c.objetivo,
        audCodigo: c.audiencia.codigo,
        pct: c.porcentaje,
        manual: c.manual,
        estadoCelda: estadoDeCelda(c.objetivo, c.audiencia.codigo),
      }));
  let resultado = null;

  if (pauta.estado === 'confirmada' || pauta.estado === 'publicada') {
    const filas = filasCelda;
    // Los dos carriles se cierran por separado: la pieza recién está terminada
    // cuando el automático se publicó Y las celdas manuales fueron marcadas
    // como hechas. Mientras quede alguna pendiente, sigue en la cola.
    const quedaManualPendiente = filas.some((f) => f.estado_celda === ESTADO_CELDA_MANUAL_PENDIENTE);
    estado = quedaManualPendiente ? 'pendiente_manual' : 'confirmada';
    celdas = filas.map((f) => ({
      objetivo: f.objetivo,
      audCodigo: f.audiencia_key,
      pct: Number(f.porcentaje) || 0,
      manual: !ESTADOS_CELDA_CERRADA.includes(f.estado_celda) || f.estado_celda === 'manual',
      estadoCelda: f.estado_celda,
    }));
    resultado = {
      confirmado_en: pauta.confirmado_en,
      presupuesto_total: Number(pauta.presupuesto_resuelto) || matriz.presupuestoTotal,
      celdas: filas.map((f) => ({
        objetivo: f.objetivo,
        audCodigo: f.audiencia_key,
        audNombre: f.audiencia_nombre,
        pct: Number(f.porcentaje) || 0,
        monto: Number(f.monto_resuelto) || 0,
        manual: f.estado_celda !== 'publicada',
        estado_celda: f.estado_celda,
        campaign_id: f.campaign_id,
        adset_id: f.adset_id,
        creative_id: f.creative_id,
        ad_id: f.ad_id,
        nomenclatura: f.nomenclatura,
      })),
    };
  } else if (pauta.estado === 'manual_hecha') {
    estado = 'manual_hecha';
    celdas = [];
  } else if (pauta.estado === ESTADO_DESESTIMADA) {
    estado = ESTADO_DESESTIMADA;
    celdas = [];
  } else if (pauta.estado === ESTADO_DEVUELTA_PM) {
    estado = ESTADO_DEVUELTA_PM;
    celdas = [];
  }

  // Tipo va como 7º carácter del código (ver nomenclatura.js), resuelto
  // contra equiv_tipo — lo usa el front para ordenar la cola de Validación
  // por Intensidad (Alta primero). "Pautas Army" no tiene intensidad (usa
  // monto_fijo): queda como '' a propósito, el ordenamiento la trata como
  // la prioridad más baja.
  const tipoChar = pauta.codigo ? pauta.codigo[6] : '';
  const tipo = (equivTipo || []).find((t) => String(t.codigo) === tipoChar);
  const tipoIntensidad = (tipo && tipo.intensidad) || '';

  const activo = await getActivoPorKey(pauta.activo);
  // Mínimo que Meta le va a exigir a CADA conjunto de esta pauta (una celda
  // de la matriz = un conjunto). La pantalla lo usa para avisar antes de
  // confirmar, en vez de que Meta lo rechace 20 segundos después.
  // Se lee de la cuenta donde REALMENTE se va a publicar (etapa borrador:
  // siempre el activo de ejecución), no de la del activo solicitado.
  const activoEjecucion = await getActivoEjecucion();
  const dias = diasDeDuracion(pauta, activo);
  const limites = await getLimitesCuenta(activoEjecucion && activoEjecucion.ad_account_id);

  return {
    correlation_id: pauta.correlation_id,
    codigo: pauta.codigo,
    activo: pauta.activo,
    activo_nombre: activo && activo.activo ? activo.activo : pauta.activo,
    proyecto: pauta.proyecto,
    campana: pauta.campana,
    contenido: pauta.contenido,
    eje: pauta.eje,
    formato: pauta.formato,
    visibilidad: pauta.visibilidad,
    imagen_preview: pauta.imagen_preview || previewDesdeMaterial(pauta.material),
    // Para "Público" (post existente), material ES el permalink del post
    // (ver pedidos.js: materialFinal = material || post.permalink) — el
    // front lo usa para armar un link "Ver publicación" (no hace falta
    // guardarlo aparte).
    material: pauta.material || '',
    fecha: pauta.fecha,
    tipo_intensidad: tipoIntensidad,
    copy: pauta.copy,
    comentarios: pauta.comentarios || '',
    bulk_id: pauta.bulk_id || '',
    redes: pauta.redes || '',
    link_destino: pauta.link_destino,
    presupuesto: Number(pauta.presupuesto) || 0,
    dias_duracion: dias,
    fecha_inicio: pauta.fecha_inicio || '',
    fecha_fin: pauta.fecha_fin || '',
    min_por_conjunto: minimoPorConjunto(limites, dias),
    moneda: limites ? limites.moneda : '',
    objetivos,
    audiencias,
    celdas,
    estado,
    motivo_desestimacion: pauta.motivo_desestimacion || '',
    desestimado_por: pauta.desestimado_por || '',
    desestimado_en: pauta.desestimado_en || '',
    resultado,
  };
}

// usuario: quien está mirando la pestaña "Validación de Anuncios" — si tiene
// proyectos restringidos (no "todos"), solo debe ver piezas de esos proyectos.
// proyectoActivo: el Proyecto elegido en la pantalla 2 del onboarding (ver
// middleware/usuarioActual.js) — acota más todavía, a UN solo proyecto de
// los permitidos. 'TODOS' (solo admin) o null/undefined = no acota más allá
// de lo que el usuario ya tiene permitido (comportamiento de antes de esta
// pantalla, para no romper llamadas que todavía no mandan el header).
async function getItemsCompletos(usuario, proyectoActivo) {
  const [filas, matrizDistribucion, equivTipo] = await Promise.all([
    readTable('cola_pautas'),
    readTable('matriz_distribucion'),
    readTable('equiv_tipo'),
  ]);
  const permitidos = usuario ? proyectosPermitidos(usuario) : 'todos';
  const filtroProyecto = proyectoActivo && proyectoActivo !== 'TODOS' ? proyectoActivo : null;
  const pautas = filas.filter(
    (f) =>
      f.correlation_id &&
      esParaMeta(f) &&
      f.estado !== ESTADO_PEDIDO_PENDIENTE &&
      (permitidos === 'todos' || permitidos.includes(f.proyecto)) &&
      (!filtroProyecto || f.proyecto === filtroProyecto)
  );
  return Promise.all(pautas.map((p) => getItemCompleto(p, matrizDistribucion, equivTipo)));
}

// Cuántas piezas esperan validación en cada Proyecto al que el usuario tiene
// acceso — alimenta el globo que ve el Implementador en la pantalla 2 del
// onboarding (elegir Proyecto), antes de entrar a ninguna pestaña. Mismo
// criterio de "pendiente" que usa el badge del nav dentro de la app (incluye
// pendiente_manual: el automático ya se publicó pero queda una celda manual
// sin cerrar — para el implementador sigue siendo trabajo pendiente).
async function getPendientesPorProyecto(usuario) {
  const items = await getItemsCompletos(usuario, null);
  const conteos = {};
  items.forEach((it) => {
    if (it.estado === 'pendiente' || it.estado === 'pendiente_manual') {
      conteos[it.proyecto] = (conteos[it.proyecto] || 0) + 1;
    }
  });
  return conteos;
}

module.exports = { getItemsCompletos, getPendientesPorProyecto };
