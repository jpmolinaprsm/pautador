const { readTable } = require('./dataSource');
const { getAudienciasPorActivo } = require('./audiencias');

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
// puede venir multi-select ("Meta, Youtube"). Pautador solo procesa Meta —
// el resto de los canales son otro flujo (ver sección 8 del .md).
function esParaMeta(fila) {
  return parseLista(fila.plataforma).some((p) => p.toLowerCase() === 'meta');
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
    };
  }
  const match = audienciasActivo.find((a) => a.codigo_audiencia === codigo);
  return {
    tipo,
    codigo,
    nombre: match ? match.nombre_display : codigo,
    manual: !match,
    saved_audience_id: match ? match.saved_audience_id : null,
  };
}

// Arma la matriz objetivo × audiencia de una pauta, con un reparto inicial
// parejo (el pautador lo ajusta después en la UI). Si hay un solo objetivo y
// una sola audiencia, no arma matriz — devuelve un solo bloque al 100%.
async function getMatrizParaPauta(pauta) {
  const objetivos = parseLista(pauta.objetivo);
  const audienciasActivo = await getAudienciasPorActivo(pauta.activo);

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

  const presupuestoTotal = Number(pauta.presupuesto) || 0;
  const esMatriz = objetivos.length > 1 || audiencias.length > 1;

  if (!esMatriz) {
    const audiencia = audiencias[0];
    return {
      esMatriz: false,
      presupuestoTotal,
      celdas: [
        {
          objetivo: objetivos[0] || pauta.objetivo,
          audiencia,
          porcentaje: 100,
          monto: presupuestoTotal,
          manual: audiencia.manual,
        },
      ],
    };
  }

  const totalCeldas = objetivos.length * audiencias.length;
  // Reparto parejo que suma EXACTO 100: con 3 celdas, 100/3 redondeado da
  // 33,33 × 3 = 99,99 y se perdían pesos del presupuesto (y el total nunca
  // cerraba). El resto del redondeo se le suma a la última celda, igual que
  // hace "Repartir parejo" en la pantalla.
  const pctBase = totalCeldas ? Math.floor((100 / totalCeldas) * 100) / 100 : 0;

  const celdas = [];
  objetivos.forEach((objetivo) => {
    audiencias.forEach((audiencia) => {
      celdas.push({ objetivo, audiencia, porcentaje: pctBase, manual: audiencia.manual });
    });
  });
  if (celdas.length) {
    const ultima = celdas[celdas.length - 1];
    ultima.porcentaje = +(100 - pctBase * (celdas.length - 1)).toFixed(2);
  }
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
  resolverAudiencia,
  parseLista,
  esParaMeta,
  ESTADO_PEDIDO_PENDIENTE,
};
