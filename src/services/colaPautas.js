const { readTable } = require('./dataSource');
const { getAudienciasParaResolver } = require('./audiencias');

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

// AppSheet separa multipicks con "," o "~" según el campo — aceptamos los dos.
function parseLista(valor) {
  if (!valor) return [];
  return String(valor)
    .split(/[,~]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

// Una pieza desestimada está tan cerrada como una publicada: sale de la
// cola. La diferencia es que no se creó nada en Meta, y queda el motivo.
const ESTADO_DESESTIMADA = 'desestimada';
// "Corregir y devolver": el Implementador no arregla nada él mismo, le pasa
// la pelota a quien pidió la pauta (PM/Cuentas) con el motivo. NO es un
// estado resuelto — sigue viva, solo que ahora le toca corregirla al PM;
// al guardar la corrección (editarPauta) vuelve sola a 'preview_lista'.
const ESTADO_DEVUELTA_PM = 'devuelta_pm';
const ESTADOS_YA_RESUELTOS = ['confirmada', 'publicada', 'manual_hecha', ESTADO_DESESTIMADA];
// Estado transitorio interno de pedidos.js — una fila pasa por acá una
// fracción de segundo entre crearse y terminarse de armar (ver
// services/pedidos.js), nunca queda expuesta así en ninguna lista.
const ESTADO_PEDIDO_PENDIENTE = 'pendiente';

// "Plataforma" en AppSheet es el canal (Meta / YouTube / TikTok / X / ...),
// puede venir multi-select ("Meta, Youtube"). Meta es lo que PAUTADOR
// publica solo; desde el punto 4 del plan también se piden Youtube/Tik
// Tok/X/Display por Pedido Normal (quedan manual_pendiente y se marcan
// hechas desde Historial), así que también entran acá. Lo que no es
// ninguna de esas (filas viejas de AppSheet con otros canales) queda afuera.
const { PLATAFORMAS } = require('../config/plataformas');
const PLATAFORMAS_CONOCIDAS = PLATAFORMAS.map((p) => p.nombre.toLowerCase());
function esParaMeta(fila) {
  return parseLista(fila.plataforma).some((p) => PLATAFORMAS_CONOCIDAS.includes(p.toLowerCase()));
}

async function getPendientes() {
  const filas = await readTable('cola_pautas');
  return filas.filter(
    (f) => f.correlation_id && esParaMeta(f) && f.estado !== ESTADO_PEDIDO_PENDIENTE && !ESTADOS_YA_RESUELTOS.includes(f.estado)
  );
}

// A diferencia de getPendientes(), no filtra por estado — así el detalle
// sigue siendo visible después de confirmar (para ver qué se generó).
async function getPautaPorId(correlationId) {
  const filas = await readTable('cola_pautas');
  return filas.find((f) => f.correlation_id === correlationId) || null;
}

// Nombre de audiencia "limpio" para mostrar (selects, nomenclatura,
// audiencia_resuelta): saca CUALQUIER paréntesis aclaratorio que traigan
// algunos nombres reales de Meta o de nuestros propios fallback, esté al
// final o en el medio (ej. "Trabajadores... (nacionales, provinciales,
// municipales, etc.) de la Provincia del Chubut" -> "Trabajadores... de la
// Provincia del Chubut"). Solo saca paréntesis — no toca nombres largos sin
// paréntesis (esos son el nombre real de la audiencia, no ruido nuestro).
function limpiarNombreAudiencia(nombre) {
  if (!nombre) return nombre;
  const limpio = nombre.replace(/\s*\([^)]*\)/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return limpio || nombre;
}

// Resuelve una audiencia (principal o refuerzo) contra equiv_audiencia del activo.
// "Otra" u OTRAlgo que no matchea → manual: true (regla de "qué no se automatiza").
function resolverAudiencia(codigo, textoLibre, audienciasActivo, tipo) {
  if (!codigo || codigo.toLowerCase() === 'otra') {
    return {
      tipo,
      codigo: 'Otra',
      nombre: textoLibre || 'Audiencia personalizada',
      manual: true,
      saved_audience_id: null,
      tamano: '',
    };
  }
  const match = audienciasActivo.find((a) => a.codigo_audiencia === codigo);
  return {
    tipo,
    codigo,
    nombre: match ? limpiarNombreAudiencia(match.nombre_display) : codigo,
    manual: !match,
    saved_audience_id: match ? match.saved_audience_id : null,
    // Junto con el Tipo (Intensidad), define el presupuesto sugerido — ver
    // resolverPresupuestoPorTipo en escalaPresupuestos.js. Se expone acá
    // para que Validación pueda explicar "por qué" ese monto.
    tamano: match ? match.tamaño || '' : '',
  };
}

// Reparto parejo con dos decimales que suma EXACTO el total pedido: con 3
// celdas, 100/3 redondeado da 33,33 × 3 = 99,99 y se perdían pesos del
// presupuesto (y el total nunca cerraba). El resto del redondeo se le suma
// a la última celda del grupo, igual que hace "Repartir parejo" en la
// pantalla.
function repartirParejo(combos, pctTotal) {
  const n = combos.length;
  if (!n) return [];
  const pctBase = Math.floor((pctTotal / n) * 100) / 100;
  const celdas = combos.map(({ objetivo, audiencia }) => ({ objetivo, audiencia, porcentaje: pctBase, manual: audiencia.manual }));
  celdas[n - 1].porcentaje = +(pctTotal - pctBase * (n - 1)).toFixed(2);
  return celdas;
}

// Arma la matriz objetivo × audiencia de una pauta, con un reparto inicial
// parejo (el pautador lo ajusta después en la UI). Si hay un solo objetivo y
// una sola audiencia, no arma matriz — devuelve un solo bloque al 100%.
async function getMatrizParaPauta(pauta) {
  const objetivos = parseLista(pauta.objetivo);
  // Reales del activo + catálogo del proyecto (Pedido Manual): así una pieza
  // con código del catálogo muestra el nombre limpio y su tamaño.
  const audienciasActivo = await getAudienciasParaResolver(pauta.activo);

  const audienciasCrudas = [
    resolverAudiencia(pauta.audiencia, pauta.otras_audiencias, audienciasActivo, 'principal'),
    ...parseLista(pauta.refuerzo_audiencia).map((cod) =>
      resolverAudiencia(cod, pauta.otras_refuerzo, audienciasActivo, 'refuerzo')
    ),
  ];
  // Si la misma audiencia viene como principal Y como refuerzo (o repetida
  // entre refuerzos), sería una celda duplicada — o sea dos conjuntos
  // idénticos en Meta compitiendo entre sí. Gana la primera aparición.
  const audiencias = audienciasCrudas.filter(
    (a, i) => audienciasCrudas.findIndex((b) => b.codigo === a.codigo) === i
  );

  // "Pedido de Anuncios Normal" (modo manual — ver crearPedido en
  // pedidos.js y el comentario en middleware/usuarioActual.js): ninguna
  // celda se publica sola por la API de Meta, sin importar si la audiencia
  // elegida es una guardada de verdad o no — se cargan a mano en Meta y se
  // marcan "hecho" desde Validación, mismo mecanismo que ya existía para
  // audiencia "Otra", ahora también se activa por modo.
  if (pauta.modo === 'normal') {
    audiencias.forEach((a) => { a.manual = true; });
  }

  const presupuestoTotal = Number(pauta.presupuesto) || 0;

  // Cruces que el PM/Cuentas desactivó al pedir (ver moduloValido/Módulo 2
  // en el front) — ese Objetivo×Audiencia no existió nunca para esta pauta,
  // ni en el reparto ni en Validación. Se guarda como "Objetivo|codigo",
  // mismo formato de clave que usa el front.
  const excluidos = new Set(parseLista(pauta.combos_excluidos).map((s) => s));

  const combosCrudos = [];
  objetivos.forEach((objetivo) => {
    audiencias.forEach((audiencia) => {
      if (excluidos.has(`${objetivo}|${audiencia.codigo}`)) return;
      combosCrudos.push({ objetivo, audiencia });
    });
  });

  const esMatriz = combosCrudos.length > 1;

  if (!esMatriz) {
    const combo = combosCrudos[0] || { objetivo: objetivos[0] || pauta.objetivo, audiencia: audiencias[0] };
    return {
      esMatriz: false,
      presupuestoTotal,
      celdas: [
        {
          objetivo: combo.objetivo,
          audiencia: combo.audiencia,
          porcentaje: 100,
          monto: presupuestoTotal,
          manual: combo.audiencia.manual,
        },
      ],
    };
  }

  // Reparto elegido a mano con los sliders (ver renderFilaReparto en
  // app.js) — JSON {"Objetivo|codigo_audiencia": pct}, mismo formato de
  // clave que combos_excluidos. Se usa SOLO si cubre exactamente las
  // celdas que quedaron (ni de más ni de menos) y suma 100 — cualquier
  // otro caso (falta, viejo por un cambio de Objetivo/Audiencia después de
  // armarlo, no suma 100) cae al reparto automático de siempre, nunca
  // rompe el pedido por esto.
  let repartoCustom = null;
  try {
    const crudo = pauta.reparto ? JSON.parse(pauta.reparto) : null;
    if (crudo && typeof crudo === 'object') {
      const claves = combosCrudos.map((c) => `${c.objetivo}|${c.audiencia.codigo}`);
      const cubreTodas = claves.length === Object.keys(crudo).length
        && claves.every((k) => Number.isFinite(crudo[k]));
      const suma = claves.reduce((a, k) => a + (Number(crudo[k]) || 0), 0);
      if (cubreTodas && Math.abs(suma - 100) < 0.5) repartoCustom = crudo;
    }
  } catch (e) {
    repartoCustom = null; // JSON inválido — mismo criterio que "no hay reparto"
  }

  const principalCombos = combosCrudos.filter((c) => c.audiencia.tipo === 'principal');
  const refuerzoCombos = combosCrudos.filter((c) => c.audiencia.tipo !== 'principal');
  // Con 2 o más audiencias, la Principal arranca con el 70% del presupuesto
  // (repartido parejo entre sus objetivos habilitados) y el 30% restante se
  // reparte parejo entre los refuerzos — para que no arranque en pie de
  // igualdad con ellos. Con una sola audiencia (o si algún grupo quedó
  // vacío por combos_excluidos), se reparte parejo entre todas las celdas,
  // como antes. El reparto a mano (arriba) pisa todo esto cuando es válido.
  const celdas = repartoCustom
    ? combosCrudos.map((c) => ({
      objetivo: c.objetivo,
      audiencia: c.audiencia,
      porcentaje: Number(repartoCustom[`${c.objetivo}|${c.audiencia.codigo}`]),
      manual: c.audiencia.manual,
    }))
    : (principalCombos.length && refuerzoCombos.length
      ? repartirParejo(principalCombos, 70).concat(repartirParejo(refuerzoCombos, 30))
      : repartirParejo(combosCrudos, 100));
  celdas.forEach((c) => {
    c.monto = +((presupuestoTotal * c.porcentaje) / 100).toFixed(2);
  });

  return { esMatriz: true, presupuestoTotal, objetivos, audiencias, celdas };
}

module.exports = {
  ESTADO_DESESTIMADA,
  ESTADO_DEVUELTA_PM,
  ESTADOS_YA_RESUELTOS,
  getPendientes,
  getPautaPorId,
  getMatrizParaPauta,
  diasDeDuracion,
  resolverAudiencia,
  limpiarNombreAudiencia,
  parseLista,
  esParaMeta,
  ESTADO_PEDIDO_PENDIENTE,
};
