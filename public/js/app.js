// Pantalla única de PAUTADOR — lista + matriz inline + batch + historial.
// Lógica portada de "Mock Up de Claude Design/Pautador.dc.html" (clase
// Component) contra los endpoints reales: GET /api/items,
// POST /api/pauta/:id/confirmar, POST /api/pauta/:id/marcar-manual.
// Mismo patrón que el resto del proyecto: sin framework, re-render por
// innerHTML + delegación de eventos.

function fmtMoney(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-AR');
}

// "Pendiente" de la tabla de Validación: hace cuánto se pidió (columna
// nueva, pedido del usuario) — a partir de la fecha del pedido, no de
// fecha_inicio (esa es cuándo arranca a correr, no cuándo se pidió). Si es
// de hoy, en minutos/horas (el correlation_id trae el timestamp exacto,
// "PEDIDO-<Date.now()>" — ver crearPedido en pedidos.js); si no, en días.
function haceCuanto(fechaStr, id) {
  const ts = id && /^PEDIDO-(\d+)$/.test(id) ? Number(id.slice(7)) : null;
  if (ts) {
    const creado = new Date(ts);
    const ahora = new Date();
    if (creado.toDateString() === ahora.toDateString()) {
      const diffMin = Math.max(0, Math.round((ahora - creado) / 60000));
      if (diffMin < 1) return 'Recién';
      if (diffMin < 60) return `Hace ${diffMin} min`;
      return `Hace ${Math.floor(diffMin / 60)} h`;
    }
  }
  if (!fechaStr) return '—';
  const dias = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(fechaStr + 'T00:00:00').getTime()) / 86400000);
  if (dias <= 0) return 'Hoy';
  if (dias === 1) return 'Ayer';
  return `Hace ${dias} días`;
}

// Orden fijo pedido por el usuario para el desplegable de Objetivo — no es
// el orden de equiv_objetivo en la base. Lo que no esté en esta lista (ej.
// un objetivo nuevo que se cargue después) queda al final, sin romper nada.
const ORDEN_OBJETIVOS = ['Alcance Normal', 'Interacción', 'Alcance con presencia', 'Impresiones', 'Views', 'Tráfico', 'Conversión'];
function ordenarObjetivos(lista) {
  return [...lista].sort((a, b) => {
    const ia = ORDEN_OBJETIVOS.indexOf(a);
    const ib = ORDEN_OBJETIVOS.indexOf(b);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

const state = {
  items: [],
  selected: {},
  expandedId: null,
  // Pedido en curso contra Meta (id → "confirmar"/"marcar") — deshabilita el
  // botón al toque para no permitir el doble clic mientras se espera la
  // respuesta real. confirmadosFlash resalta la fila en verde un momento
  // antes de que se recargue la lista y pase a Historial.
  accionEnCurso: {},
  // Pieza con el cuadro de "desestimar" abierto (una por vez) y el error
  // de motivo vacío, si lo hubo.
  desestimandoId: null,
  desestimarError: null,
  // Pieza con el panel de "corregir" abierto (una por vez), los campos que
  // se están editando, y el error/estado de guardado, si los hubo.
  editandoId: null,
  editarCampos: null,
  lightboxUrl: null,
  loginError: null,
  loginEnviando: false,
  googleHabilitado: false,
  editarError: null,
  editarGuardando: false,
  // Público con matriz (varios objetivo×audiencia): por defecto todas las
  // celdas publican la MISMA publicación real (la de la pieza) — destildar
  // acá permite elegir una distinta por celda (mismaPublicacion[id]=false),
  // guardada en celdaPostIds["id|objetivo|audCodigo"].
  mismaPublicacion: {},
  celdaPostIds: {},
  confirmadosFlash: {},
  batchConfirmando: false,
  // Barra de desestimar en lote: abierta/cerrada, en curso, y el error de
  // motivo vacío si lo hubo — mismo patrón que el desestimar por fila.
  batchDesestimarAbierto: false,
  batchDesestimarEnviando: false,
  batchDesestimarError: null,
  historyOpen: false,
  toast: null,
  cargando: true,
  error: null,
  tabActiva: 'pedido',

  // ---- usuario "actuando como" (no hay login real todavía — ver
  // src/middleware/usuarioActual.js) — define qué pestañas y qué datos ve.
  usuarios: [],
  usuarioActualId: localStorage.getItem('pautador_usuario_id') || null,

  // ---- onboarding: Proyecto y Ecosistema (Oficial/Informativo) elegidos
  // en las pantallas 2 y 3 — 'TODOS' = Admin viendo todo, sin restricción.
  // Se mandan al servidor en cada request (ver apiFetch) y ahí se vuelven a
  // validar contra lo que el usuario realmente puede ver.
  proyectoActivo: localStorage.getItem('pautador_proyecto_activo') || null,
  ecosistemaActivo: localStorage.getItem('pautador_ecosistema_activo') || null,
  proyectosDisponibles: [],
  pendientesPorProyecto: {},
  // El desplegable Proyecto de "Pedido de Pauta" queda fijo al elegido acá
  // arriba, salvo que el Admin haya elegido "Ver todos los proyectos".
  proyectosDisponiblesBloqueado: true,

  // ---- datos de referencia compartidos por "Pedido de Pauta"/"Crear
  // Anuncios" (cargados una vez por cargarDatosPedido) ----
  pdProyectos: [],
  pdProyecto: null, // usado por el modo CSV (proyecto/activo del archivo)
  pdEjes: [],
  pdActivos: [],
  pdActivoKey: null, // usado por el modo CSV
  pdTipos: [],
  pdFormatos: [],
  pdObjetivos: [],
  pdAudiencias: [],
  // Mínimo de presupuesto que exige Meta en la cuenta donde se ejecuta
  // (minDiario × días × conjuntos). 0 = no se pudo leer, no se avisa nada.
  limites: { minDiario: 0, moneda: '' },

  // ---- "Pedido de Pauta" / "Crear Anuncios" — se completan en 5 módulos,
  // uno a la vez (ver renderTabPedido2). Misma pantalla para las dos
  // pestañas: state.pd2ModoDirecto (seteado en cambiarTab) decide si el
  // envío va a la cola de pedidos o directo a Meta, con presupuesto/reparto.
  pd2ModuloActivo: 1, // hasta qué módulo está desbloqueado (1-5)
  pd2ModoDirecto: false,
  // null hasta elegir una de las 2 tarjetas iniciales — 'csv' muestra el
  // editor de filas (pd-csv-wrap); 'anuncios' es el único modo con módulos:
  // 1 a 10 piezas, la cantidad se elige en el Módulo 4 ("individual" es
  // simplemente 1 pieza, no hay un modo aparte).
  pd2ModoCarga: null,
  pd2Proyecto: null, pd2ActivoKey: null, pd2TipoCodigo: 'D', pd2EjeCodigo: null,
  pd2CampanasSugeridas: [],
  pd2Objetivo: [], pd2AudienciaCodigo: '', pd2Refuerzo: [],
  // Cruces Objetivo|Audiencia que el PM desactivó antes de pedir — ver
  // renderCrucesV2. Vive fuera de pd2BulkItems porque Objetivo/Audiencia
  // son compartidos por todas las piezas del pedido, no por pieza.
  pd2CombosExcluidos: {},
  pd2Visibilidad: 'DARK', pd2Redes: ['facebook', 'instagram'], pd2Placements: [],
  pd2Posts: [], pd2CargandoPosts: false,
  // Piezas del pedido — SIEMPRE al menos 1 (ver ajustarCantidadPiezasV2),
  // mismo espíritu que pdBulkItems de v1 pero acá cubre también el caso de
  // una sola pieza, con ids propios pd2bulk*. Cada pieza trae su propio
  // Material/Copy/Línea/Audiencia y, si corresponde: Carrusel, Material de
  // Stories, Presupuesto y reparto por combo (ver claves reparto*/carrusel/
  // materialStories* en ajustarCantidadPiezasV2).
  pd2BulkItems: [],
  pd2BulkPreviews: null,
  pd2BulkResultados: null,
  pd2BulkError: null,
  pd2BulkEnviando: false,
  pd2BulkVerificando: false,

  // Carga por CSV — una fila por pieza, cada una con su propio estado de
  // validación (ver validarFilasCsv/confirmarCargaCsv). No pasa por los
  // módulos: usa Proyecto/Activo compartidos (pdProyecto/pdActivoKey).
  pdCsvFilas: [],
  pdCsvErrorGeneral: null,
  pdCsvCreando: false,

  // ---- pestaña "Agregar Activos / Audiencias" ----
  admActivos: [],
  admActivosCargados: false,
  admActivoError: null,
  admActivoExito: null,
  admActivoEnviando: false,
  admAudienciasPorActivo: {},
  admAudActivoKey: null,
  admAudError: null,
  admAudExito: null,
  admAudEnviando: false,

};

function apiFetch(url, opts = {}) {
  const headers = Object.assign({}, opts.headers, {
    'x-pautador-usuario': state.usuarioActualId || '',
    'x-pautador-proyecto': state.proyectoActivo || '',
    'x-pautador-ecosistema': state.ecosistemaActivo || '',
  });
  return window.fetch(url, Object.assign({}, opts, { headers }));
}

function usuarioActual() {
  return state.usuarios.find((u) => u.id === state.usuarioActualId) || null;
}

function proyectosPermitidos() {
  const u = usuarioActual();
  if (!u) return [];
  const crudo = String(u.proyectos || '').trim();
  if (crudo.toLowerCase() === 'todos') return 'todos';
  return crudo.split(',').map((p) => p.trim()).filter(Boolean);
}

// Qué pestañas puede ver cada rol — administrador es superusuario (ve todo),
// el resto solo lo suyo (ver mensaje del usuario: "un rol no puede ver las
// pestañas a las que no tiene acceso").
const TABS_POR_ROL = {
  pm_cuentas: ['pedido2', 'pendientes'],
  implementador: ['pendientes', 'crear'],
  administrador: ['pedido2', 'pendientes', 'crear', 'admin'],
};

function tabsPermitidas() {
  const u = usuarioActual();
  return u ? (TABS_POR_ROL[u.rol] || []) : [];
}

// "Validación de Anuncios" es de edición para implementador/administrador,
// pero de solo lectura para pm_cuentas — esto es para las acciones de
// Implementador (repartir/confirmar/marcar manual/presupuesto), no para
// editar los campos de la pauta (ver puedeEditarCampos).
function puedeEditarValidacion() {
  const u = usuarioActual();
  return !!u && (u.rol === 'implementador' || u.rol === 'administrador');
}

// Editar los CAMPOS de una pauta (Campaña/Objetivo/Material/Copy/etc, ver
// editarPauta en pedidos.js) sí es parejo entre PM/Cuentas e Implementador
// — "mismos campos editables para ambos", a diferencia de las acciones de
// arriba que siguen siendo solo del Implementador.
function puedeEditarCampos() {
  const u = usuarioActual();
  return !!u && (u.rol === 'pm_cuentas' || u.rol === 'implementador' || u.rol === 'administrador');
}

// ---------- Carga de datos ----------

async function cargarItems() {
  state.cargando = true;
  render();
  try {
    const r = await apiFetch('/api/items');
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error || 'Error desconocido');
    state.items = data;
    state.error = null;
  } catch (err) {
    state.error = err.message;
  }
  state.cargando = false;
  render();
}

// ---------- Mutaciones locales (edición de % antes de confirmar) ----------

// Una celda "excluida" (ver toggleComboExcluido) no se manda a confirmar y
// no cuenta para el 100% del reparto — como si ese cruce Objetivo×Audiencia
// no existiera para esta pieza.
function totalPct(item) {
  return item.celdas.reduce((a, c) => a + (c.excluido ? 0 : c.pct), 0);
}

function findItem(id) {
  return state.items.find((it) => it.correlation_id === id);
}

function toggleSelect(id) {
  if (state.selected[id]) delete state.selected[id];
  else state.selected[id] = true;
  render();
}

function toggleExpand(id) {
  state.expandedId = state.expandedId === id ? null : id;
  render();
}


function setPct(id, objetivo, audCodigo, val) {
  const it = findItem(id);
  if (!it) return;
  const target = it.celdas.find((c) => c.objetivo === objetivo && c.audCodigo === audCodigo && !c.manual);
  if (!target || target.excluido || target.bloqueado) return;
  const manualSum = it.celdas.filter((c) => c.manual).reduce((a, c) => a + c.pct, 0);
  const bloqueadoSum = it.celdas.filter((c) => !c.manual && !c.excluido && c.bloqueado).reduce((a, c) => a + c.pct, 0);
  const budget = 100 - manualSum - bloqueadoSum;
  const others = it.celdas.filter((c) => !c.manual && !c.excluido && !c.bloqueado && !(c.objetivo === objetivo && c.audCodigo === audCodigo));
  const othersOldSum = others.reduce((a, c) => a + c.pct, 0);
  const newPct = Math.max(0, Math.min(budget, isNaN(val) ? 0 : val));
  const othersNewSum = budget - newPct;
  it.celdas = it.celdas.map((c) => {
    if (c.objetivo === objetivo && c.audCodigo === audCodigo) return { ...c, pct: newPct };
    if (c.manual || c.excluido || c.bloqueado) return c;
    const share = othersOldSum > 0 ? c.pct / othersOldSum : 1 / (others.length || 1);
    return { ...c, pct: Math.round(othersNewSum * share) };
  });
  // corrige el drift de redondeo para que la suma editable dé exacta
  const drift = budget - it.celdas.filter((c) => !c.manual && !c.excluido && !c.bloqueado).reduce((a, c) => a + c.pct, 0);
  if (drift !== 0) {
    const fixIdx = it.celdas.findIndex((c) => !c.manual && !c.excluido && !c.bloqueado && !(c.objetivo === objetivo && c.audCodigo === audCodigo));
    if (fixIdx !== -1) it.celdas[fixIdx] = { ...it.celdas[fixIdx], pct: it.celdas[fixIdx].pct + drift };
  }
  render();
}

function distributeEven(id) {
  const it = findItem(id);
  if (!it) return;
  const manualSum = it.celdas.filter((c) => c.manual).reduce((a, c) => a + c.pct, 0);
  const bloqueadoSum = it.celdas.filter((c) => !c.manual && !c.excluido && c.bloqueado).reduce((a, c) => a + c.pct, 0);
  const editable = it.celdas.filter((c) => !c.manual && !c.excluido && !c.bloqueado);
  const remaining = 100 - manualSum - bloqueadoSum;
  const base = Math.floor(remaining / (editable.length || 1));
  let given = 0, seen = 0;
  it.celdas = it.celdas.map((c) => {
    if (c.manual || c.excluido || c.bloqueado) return c;
    seen++;
    const val = seen === editable.length ? remaining - given : base;
    given += val;
    return { ...c, pct: val };
  });
  render();
}

function allToCell(id, objetivo, audCodigo) {
  const it = findItem(id);
  if (!it) return;
  const manualSum = it.celdas.filter((c) => c.manual).reduce((a, c) => a + c.pct, 0);
  const bloqueadoSum = it.celdas.filter((c) => !c.manual && !c.excluido && c.bloqueado && !(c.objetivo === objetivo && c.audCodigo === audCodigo)).reduce((a, c) => a + c.pct, 0);
  it.celdas = it.celdas.map((c) => {
    if (c.manual || c.excluido || (c.bloqueado && !(c.objetivo === objetivo && c.audCodigo === audCodigo))) return c;
    if (c.objetivo === objetivo && c.audCodigo === audCodigo) return { ...c, pct: 100 - manualSum - bloqueadoSum, bloqueado: false };
    return { ...c, pct: 0 };
  });
  render();
}

// Deja de contar este cruce Objetivo×Audiencia para la pieza (no se crea el
// conjunto de anuncios en Meta) — pedido del usuario: "que vuelva a estar
// que se puedan desactivar líneas de cruce". Al pasar a false, el usuario
// tiene que repartir de nuevo (o tocar "Repartir parejo") para llegar a 100%.
function toggleComboExcluido(id, objetivo, audCodigo) {
  const it = findItem(id);
  if (!it) return;
  it.celdas = it.celdas.map((c) => {
    if (c.manual || c.objetivo !== objetivo || c.audCodigo !== audCodigo) return c;
    const excluido = !c.excluido;
    // Excluir y bloquear son mutuamente excluyentes — no tendría sentido
    // "no se crea" y "bloqueado en X%" a la vez.
    return { ...c, excluido, bloqueado: excluido ? false : c.bloqueado, pct: excluido ? 0 : c.pct };
  });
  render();
}

// Fija el % de esta celda: "Repartir parejo"/mover otro slider ya no la
// tocan, solo redistribuyen entre las que quedan sin bloquear — pedido del
// usuario: "botón para bloquear un presupuesto y modificar los otros".
function toggleComboBloqueado(id, objetivo, audCodigo) {
  const it = findItem(id);
  if (!it) return;
  it.celdas = it.celdas.map((c) => {
    if (c.manual || c.objetivo !== objetivo || c.audCodigo !== audCodigo) return c;
    return { ...c, bloqueado: !c.bloqueado, excluido: false };
  });
  render();
}

// ---------- Acciones contra el servidor ----------

// Espera un toque antes de recargar la lista — así la fila alcanza a
// mostrarse en verde (confirmadosFlash) antes de desaparecer de pendientes
// y pasar a Historial.
function esperar(ms) { return new Promise((res) => setTimeout(res, ms)); }

async function confirmOne(id) {
  const it = findItem(id);
  if (!it) return;
  // Público con "misma publicación" destildada: cada celda manda su propio
  // ID de publicación (vacío = usa la principal de la pieza, mismo
  // resultado que si no se hubiera destildado nada — ver confirmar.js).
  const usaPostPorCelda = it.visibilidad === 'PUBLICO' && state.mismaPublicacion[id] === false;
  const celdas = it.celdas.filter((c) => !c.excluido).map((c) => ({
    objetivo: c.objetivo, audiencia_codigo: c.audCodigo, porcentaje: c.pct,
    ...(usaPostPorCelda ? { postId: state.celdaPostIds[`${id}|${c.objetivo}|${c.audCodigo}`] || undefined } : {}),
  }));
  state.accionEnCurso[id] = 'confirmar';
  render();
  try {
    const r = await apiFetch(`/api/pauta/${encodeURIComponent(id)}/confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ celdas }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error || 'No se pudo confirmar');
    state.toast = { titulo: 'Pauta confirmada', lines: [{ codigo: it.codigo, resumen: summarizeResultado(data) }] };
    state.confirmadosFlash[id] = true;
    delete state.accionEnCurso[id];
    render();
    await esperar(900);
    delete state.confirmadosFlash[id];
    await cargarItems();
  } catch (err) {
    state.error = err.message;
    delete state.accionEnCurso[id];
    delete state.confirmadosFlash[id];
    render();
  }
}

// Desestimar = "esto no se pauta". No crea nada en Meta: saca la pieza de
// la cola y guarda el motivo, que es lo único que le queda a quien la pidió
// para entender qué corregir. Por eso el motivo es obligatorio y lo valida
// también el servidor.
async function desestimar(id) {
  const campo = document.getElementById("motivo-" + id);
  const motivo = campo ? campo.value.trim() : "";
  if (motivo.length < 5) {
    state.desestimarError = { id: id, msg: "Escribí el motivo — es lo que va a leer quien pidió la pauta." };
    render();
    return;
  }
  const it = findItem(id);
  state.desestimarError = null;
  state.accionEnCurso[id] = "desestimar";
  render();
  try {
    const r = await apiFetch("/api/pauta/" + encodeURIComponent(id) + "/desestimar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motivo: motivo }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error || "No se pudo desestimar");
    state.toast = { titulo: "Pedido desestimado", lines: [{ codigo: it ? it.codigo : id, resumen: motivo }] };
    state.desestimandoId = null;
    delete state.accionEnCurso[id];
    await cargarItems();
  } catch (err) {
    state.error = err.message;
    delete state.accionEnCurso[id];
    render();
  }
}
// "Corregir y devolver": mismo motivo obligatorio que desestimar, pero NO
// es un rechazo — la pieza sigue viva, solo que ahora le toca corregirla a
// quien la pidió (PM/Cuentas). El Implementador no toca ningún campo acá.
async function devolverConMotivo(id) {
  const campo = document.getElementById("motivo-" + id);
  const motivo = campo ? campo.value.trim() : "";
  if (motivo.length < 5) {
    state.desestimarError = { id: id, msg: "Escribí el motivo — es lo que va a leer quien tiene que corregirla." };
    render();
    return;
  }
  const it = findItem(id);
  state.desestimarError = null;
  state.accionEnCurso[id] = "devolver";
  render();
  try {
    const r = await apiFetch("/api/pauta/" + encodeURIComponent(id) + "/devolver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motivo: motivo }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error || "No se pudo devolver la pieza");
    state.toast = { titulo: "Pedido devuelto para corrección", lines: [{ codigo: it ? it.codigo : id, resumen: motivo }] };
    state.desestimandoId = null;
    delete state.accionEnCurso[id];
    await cargarItems();
  } catch (err) {
    state.error = err.message;
    delete state.accionEnCurso[id];
    render();
  }
}

// Trae /api/formatos, /api/objetivos y las audiencias del activo de
// ejecución — lo mismo que carga "Pedido de Pauta" al entrar, pero acá
// puede hacer falta desde "Validación de Anuncios" directo (un
// Implementador no tiene la pestaña "Pedido de Pauta" — ver TABS_POR_ROL),
// así que el panel de edición no puede asumir que ya están cargados.
async function asegurarDatosReferencia() {
  const tareas = [];
  if (!state.pdFormatos.length) tareas.push(apiFetch('/api/formatos').then((r) => (r.ok ? r.json() : [])).then((d) => { state.pdFormatos = d; }));
  if (!state.pdObjetivos.length) tareas.push(apiFetch('/api/objetivos').then((r) => (r.ok ? r.json() : [])).then((d) => { state.pdObjetivos = ordenarObjetivos(d); }));
  if (!state.pdAudiencias.length) tareas.push(apiFetch('/api/audiencias?activo_key=test--tres-empanadas').then((r) => (r.ok ? r.json() : [])).then((d) => { state.pdAudiencias = d; }));
  if (tareas.length) await Promise.all(tareas);
}

function parseListaClient(valor) {
  return String(valor || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// Abre el panel de edición prefillenado con los datos reales de la pauta
// (no los del VM resumido — ese ya perdió cosas como el código de
// audiencia o los placements separados). "Corregir y pautar" también pasa
// por acá: es la misma edición, solo que sin haber pasado por /devolver.
async function abrirEditar(id) {
  state.desestimandoId = null;
  state.desestimarError = null;
  state.editandoId = id;
  state.editarError = null;
  state.editarCampos = null;
  render();
  await asegurarDatosReferencia();
  try {
    const r = await apiFetch('/api/pauta/' + encodeURIComponent(id));
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error || 'No se pudo cargar la pieza');
    const p = data.pauta;
    const itemLista = state.items.find((it) => it.correlation_id === id);
    state.editarCampos = {
      codigo: p.codigo || '',
      imagenPreview: (itemLista && itemLista.imagen_preview) || '',
      visibilidad: p.visibilidad,
      campana: p.campana || '', linea: '',
      objetivo: parseListaClient(p.objetivo), formato: p.formato || '',
      redes: parseListaClient(p.redes), placements: parseListaClient(p.placements),
      audienciaCodigo: p.audiencia || '', otraAudiencia: p.otras_audiencias || '',
      material: p.material || '', materialStories: p.material_stories || '',
      copy: p.copy || '', fechaInicio: p.fecha_inicio || '', fechaFin: p.fecha_fin || '',
      linkDestino: p.link_destino || '',
    };
  } catch (err) {
    state.editarError = err.message;
  }
  render();
}

// Antes de cualquier re-render disparado DESDE ADENTRO del panel de
// edición (ej. tildar "Otra" en Audiencia) hay que sincronizar lo que ya
// se tipeó a mano en los demás campos — si no, un render() de golpe los
// pisaría con el valor que tenían al abrir el panel (mismo bug que ya se
// resolvió para el Carrusel y la Audiencia por pieza del Bulk).
function sincronizarEditarDesdeDOM() {
  if (!state.editarCampos) return;
  const c = state.editarCampos;
  const val = (id) => { const el = document.getElementById(id); return el ? el.value : undefined; };
  ['campana', 'linea', 'material', 'materialStories', 'copy', 'fechaInicio', 'fechaFin', 'linkDestino', 'otraAudiencia', 'formato'].forEach((campo) => {
    const v = val('editarpauta-' + campo);
    if (v !== undefined) c[campo] = v;
  });
  c.objetivo = leerCheckboxes('editarpauta-objetivo-chk');
  c.redes = leerCheckboxes('editarpauta-redes-chk');
  c.placements = leerCheckboxes('editarpauta-placements-chk');
}

function cerrarEditar() {
  state.editandoId = null;
  state.editarCampos = null;
  state.editarError = null;
  render();
}

async function guardarEditar(id) {
  const val = (elId) => ((document.getElementById(elId) || {}).value || '').trim();
  const datos = {
    campana: val('editarpauta-campana'), linea: val('editarpauta-linea'),
    objetivo: leerCheckboxes('editarpauta-objetivo-chk'),
    formato: val('editarpauta-formato'),
    redes: leerCheckboxes('editarpauta-redes-chk'),
    placements: leerCheckboxes('editarpauta-placements-chk'),
    audienciaCodigo: val('editarpauta-audiencia'), otraAudiencia: val('editarpauta-otraAudiencia'),
    material: val('editarpauta-material'), materialStories: val('editarpauta-materialStories'),
    copy: val('editarpauta-copy'),
    fechaInicio: val('editarpauta-fechaInicio'), fechaFin: val('editarpauta-fechaFin'),
    linkDestino: val('editarpauta-linkDestino'),
  };
  state.editarGuardando = true;
  state.editarError = null;
  render();
  try {
    const r = await apiFetch('/api/pauta/' + encodeURIComponent(id) + '/editar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error || 'No se pudo guardar');
    state.editandoId = null;
    state.editarCampos = null;
    state.editarGuardando = false;
    await cargarItems();
  } catch (err) {
    state.editarError = err.message;
    state.editarGuardando = false;
    render();
  }
}

async function markManual(id) {
  const it = findItem(id);
  state.accionEnCurso[id] = 'marcar';
  render();
  try {
    const r = await apiFetch(`/api/pauta/${encodeURIComponent(id)}/marcar-manual`, { method: 'POST' });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error || 'No se pudo marcar');
    state.toast = { titulo: 'Marcada como hecha a mano', lines: [{ codigo: it ? it.codigo : id, resumen: 'Sale de pendientes — cargala en Meta a mano.' }] };
    state.confirmadosFlash[id] = true;
    delete state.accionEnCurso[id];
    render();
    await esperar(900);
    delete state.confirmadosFlash[id];
    await cargarItems();
  } catch (err) {
    state.error = err.message;
    delete state.accionEnCurso[id];
    delete state.confirmadosFlash[id];
    render();
  }
}

// Cierra una celda del carril manual. No toca el automático: son
// independientes, por eso la clave del "en curso" incluye la celda.
async function marcarCeldaHecha(id, objetivo, audCodigo) {
  const clave = `${id}|${objetivo}|${audCodigo}`;
  state.accionEnCurso[clave] = 'celda';
  render();
  try {
    const r = await apiFetch(`/api/pauta/${encodeURIComponent(id)}/celda-hecha`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objetivo, audiencia_codigo: audCodigo }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error || 'No se pudo marcar');
    state.toast = { titulo: 'Marcada como hecha a mano', lines: [{ codigo: objetivo, resumen: `${audCodigo} — cargada a mano en Meta.` }] };
    delete state.accionEnCurso[clave];
    await cargarItems();
  } catch (err) {
    state.error = err.message;
    delete state.accionEnCurso[clave];
    render();
  }
}

async function guardarPresupuesto(id, presupuesto) {
  const it = findItem(id);
  try {
    const r = await apiFetch(`/api/pauta/${encodeURIComponent(id)}/presupuesto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presupuesto }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error || 'No se pudo guardar el presupuesto');
    state.toast = { titulo: 'Presupuesto actualizado', lines: [{ codigo: it ? it.codigo : id, resumen: `Nuevo presupuesto: ${fmtMoney(data.presupuesto)}` }] };
    await cargarItems();
  } catch (err) {
    state.error = err.message;
    render();
  }
}

function isEligibleForBatch(item) {
  if (item.estado !== 'pendiente') return false;
  if (!item.celdas.length) return false;
  return Math.round(totalPct(item)) === 100;
}

function summarizeResultado(resultado) {
  const auto = resultado.celdas.filter((c) => !c.manual).length;
  const manual = resultado.celdas.filter((c) => c.manual).length;
  const parts = [];
  if (auto) parts.push(auto + ' automática' + (auto > 1 ? 's' : ''));
  if (manual) parts.push(manual + ' manual' + (manual > 1 ? 'es' : ''));
  return parts.join(', ');
}

async function confirmBatch() {
  const ids = Object.keys(state.selected).filter((id) => {
    const it = findItem(id);
    return it && isEligibleForBatch(it);
  });
  if (!ids.length) return;

  state.batchConfirmando = true;
  render();

  const lines = [];
  for (const id of ids) {
    const it = findItem(id);
    state.accionEnCurso[id] = 'confirmar';
    render();
    const celdas = it.celdas.map((c) => ({ objetivo: c.objetivo, audiencia_codigo: c.audCodigo, porcentaje: c.pct }));
    try {
      const r = await apiFetch(`/api/pauta/${encodeURIComponent(id)}/confirmar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ celdas }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detalle || data.error);
      lines.push({ codigo: it.codigo, resumen: summarizeResultado(data) });
      state.confirmadosFlash[id] = true;
    } catch (err) {
      lines.push({ codigo: it.codigo, resumen: 'Error: ' + err.message });
    }
    delete state.accionEnCurso[id];
    render();
  }
  state.selected = {};
  state.toast = { titulo: 'Confirmadas en lote', lines };
  render();
  await esperar(900);
  state.batchConfirmando = false;
  state.confirmadosFlash = {};
  await cargarItems();
}

// Un solo motivo se aplica a todas las seleccionadas — pensado para el
// caso típico (mismo problema repetido en varias piezas de una tanda),
// no para desestimar cosas distintas por razones distintas de una.
async function desestimarBatch() {
  const motivo = document.getElementById('batch-desestimar-motivo').value.trim();
  if (motivo.length < 5) {
    state.batchDesestimarError = 'Escribí el motivo — se aplica a todas las piezas seleccionadas.';
    render();
    return;
  }
  const ids = Object.keys(state.selected);
  if (!ids.length) return;

  state.batchDesestimarEnviando = true;
  state.batchDesestimarError = null;
  render();

  const lines = [];
  for (const id of ids) {
    const it = findItem(id);
    try {
      const r = await apiFetch(`/api/pauta/${encodeURIComponent(id)}/desestimar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detalle || data.error || 'No se pudo desestimar');
      lines.push({ codigo: it ? it.codigo : id, resumen: 'Desestimada — ' + motivo });
    } catch (err) {
      lines.push({ codigo: it ? it.codigo : id, resumen: 'Error: ' + err.message });
    }
  }
  state.selected = {};
  state.toast = { titulo: 'Desestimadas en lote', lines };
  state.batchDesestimarAbierto = false;
  state.batchDesestimarEnviando = false;
  await cargarItems();
}

function dismissToast() { state.toast = null; render(); }
function toggleHistory() { state.historyOpen = !state.historyOpen; render(); }

// ---------- View model (portado de Component.buildVM) ----------

function buildVM(item) {
  const isExpanded = state.expandedId === item.correlation_id;
  const esMatriz = item.objetivos.length > 1 || item.audiencias.length > 1;
  const isManualOnly = !item.celdas.length;
  const isConfirmed = item.estado === 'confirmada';
  const isManualDone = item.estado === 'manual_hecha';
  // Rechazada: no se pautó nada y no se puede confirmar más — solo queda
  // el motivo, visible en el Historial.
  const isDesestimada = item.estado === 'desestimada';
  // El carril automático ya se publicó, pero queda alguna celda manual sin
  // marcar: la pieza sigue en la cola, aunque ya no hay nada que confirmar.
  const isPendienteManual = item.estado === 'pendiente_manual';
  // "Corregir y devolver": el Implementador la mandó de vuelta con un
  // motivo, sin tocar nada — le toca corregirla a quien la pidió (PM/
  // Cuentas). No es un rechazo (no es isDesestimada): al guardar la
  // corrección vuelve sola a Validación.
  const isDevueltaPm = item.estado === 'devuelta_pm';
  const total = item.celdas.length ? totalPct(item) : 0;
  const totalOk = Math.round(total) === 100;

  // Dos etiquetas separadas, no una combinada: una dice el tamaño del carril
  // automático (cuántos conjuntos de anuncios genera) y la otra avisa que
  // además hay trabajo manual. Son carriles distintos y se resuelven aparte.
  const celdasAuto = item.celdas.filter((c) => !c.manual);
  const hayManual = isManualOnly || item.celdas.some((c) => c.manual);

  // Columna "Anuncios": cuántos conjuntos de anuncios (celdas automáticas)
  // tiene ESTA pieza, más "Bulk (N)" si vino junto con otras piezas en la
  // misma tanda (Módulo 5, "Cantidad de piezas" > 1 — ver enviarBulkV2).
  const tags = [];
  if (celdasAuto.length) tags.push({ label: `${celdasAuto.length} conjunto${celdasAuto.length > 1 ? 's' : ''}`, clase: 'tag tag-accent' });
  if (hayManual) tags.push({ label: 'Hacer Manual', clase: 'tag tag-outline' });
  if (item.bulk_id) {
    const grupo = state.items.filter((it) => it.bulk_id === item.bulk_id).length;
    if (grupo > 1) tags.push({ label: `Bulk (${grupo})`, clase: 'tag tag-outline' });
  }

  const audienciaLabel = item.audiencias.length > 1
    ? item.audiencias[0].nombre + ' +' + (item.audiencias.length - 1) + ' más'
    : (item.audiencias[0] ? item.audiencias[0].nombre : '—');

  // Cada objetivo×audiencia es, en los hechos, un adset/anuncio propio en
  // Meta — se muestran como una lista plana de piezas independientes (no
  // como una grilla matriz×audiencia, que se pone rara con 2+ audiencias).
  const combos = [];
  item.objetivos.forEach((objetivo) => {
    item.audiencias.forEach((aud) => {
      const c = item.celdas.find((x) => x.objetivo === objetivo && x.audCodigo === aud.codigo);
      // objetivos/audiencias son los SETS distintos que aparecen en
      // item.celdas — antes de que existiera combos_excluidos, el cruce
      // completo siempre estaba, así que esto nunca fallaba. Ahora un
      // cruce puede faltar a propósito (el PM lo desactivó al pedir, ver
      // getMatrizParaPauta) — si no está, no se "recrea" con pct 0, se
      // salta directo: no tiene que aparecer acá ni bajo el mínimo.
      if (!c) return;
      const monto = Math.round(item.presupuesto * c.pct / 100);
      combos.push({
        objetivo, audCodigo: aud.codigo, audNombre: aud.nombre, manual: aud.manual, editable: !aud.manual,
        pct: c.pct, monto, montoLabel: fmtMoney(monto),
        // Estado del carril de ESTA celda: sin valor = todavía no se confirmó.
        estadoCelda: c.estadoCelda || '',
        // Cruce desactivado (ver toggleComboExcluido) — no se manda a
        // confirmar, no cuenta para el mínimo ni para el 100% del reparto.
        excluido: !!c.excluido,
        // Bloqueada: el % queda fijo, "Repartir parejo"/otros sliders no la
        // tocan (ver toggleComboBloqueado).
        bloqueado: !!c.bloqueado,
        // Cada celda automática es un conjunto de anuncios propio y Meta le
        // exige el mínimo a CADA UNO por separado (no al total de la pieza).
        bajoMinimo: !aud.manual && !c.excluido && !!item.min_por_conjunto && monto < item.min_por_conjunto,
      });
    });
  });

  let resultLines = [];
  if (isConfirmed && item.resultado) {
    resultLines = item.resultado.celdas.map((c) => ({
      objetivo: c.objetivo, audNombre: c.audNombre, pctLabel: c.pct + '%', montoLabel: fmtMoney(c.monto),
      isManual: c.manual, isAuto: !c.manual,
      nomenclatura: c.nomenclatura || '',
      ids: c.manual ? '' : [c.campaign_id, c.adset_id, c.ad_id].filter(Boolean).join(' · '),
    }));
  }

  return {
    id: item.correlation_id, codigo: item.codigo, activoNombre: item.activo_nombre, activo: item.activo, proyecto: item.proyecto,
    isDark: item.visibilidad === 'DARK', fecha: item.fecha, campana: item.campana, contenido: item.contenido, eje: item.eje, formato: item.formato,
    // Columnas "Inicio"/"Fin"/"Pendiente" de la tabla de Validación.
    fechaInicio: item.fecha_inicio || '', fechaFin: item.fecha_fin || '',
    pendienteLabel: haceCuanto(item.fecha, item.correlation_id),
    visibilidadLabel: item.visibilidad === 'DARK' ? 'Oculto (Dark)' : 'Público',
    imagenPreview: item.imagen_preview || '',
    // "Público" = siempre publicación existente — material guarda el
    // permalink del post (ver services/pedidos.js). Link para poder abrirla.
    publicacionLink: item.visibilidad === 'PUBLICO' ? (item.material || '') : '',
    // Para el mock de plataforma en el panel de abajo (ver renderMockPost).
    plataformas: parseListaClient(item.redes).map((r) => (r === 'instagram' ? 'Instagram' : 'Facebook')),
    copy: item.copy, linkDestino: item.link_destino, comentarios: item.comentarios || '',
    objetivosLabel: item.objetivos.join(' + '), audienciaLabel, presupuesto: item.presupuesto, presupuestoLabel: fmtMoney(item.presupuesto),
    // Por qué el presupuesto es el que es (Tipo/Intensidad × Tamaño de la
    // audiencia principal, ver resolverPresupuestoPorTipo) — se muestra en
    // Validación al lado del reparto.
    tipoIntensidad: item.tipo_intensidad || '',
    // Con más de una audiencia (principal + secundarias), se listan todas
    // con su propio tamaño — el presupuesto solo usa el de la principal
    // (ver resolverPresupuestoPorTipo), pero para explicar conviene ver
    // las demás igual.
    audienciasConTamano: item.audiencias.filter((a) => a.tamano).map((a) => ({ nombre: a.nombre, tamano: a.tamano })),
    tags, estadoLabel: isConfirmed ? 'Confirmada' : (isManualDone ? 'Hecha a mano' : (isDesestimada ? 'Desestimada' : (isDevueltaPm ? 'Devuelta para corrección' : (isPendienteManual ? 'Falta celda manual' : 'Pendiente')))),
    isExpanded, chevronClass: 'ph ' + (isExpanded ? 'ph-caret-down' : 'ph-caret-right'),
    selectable: item.estado === 'pendiente' && !isManualOnly && !isDesestimada && puedeEditarValidacion(),
    isSelected: !!state.selected[item.correlation_id],
    esMatriz, isManualOnly: isManualOnly && !isConfirmed && !isManualDone && !isDesestimada && !isDevueltaPm,
    isSimpleAuto: !esMatriz && !isManualOnly && !isConfirmed && !isManualDone && !isDesestimada && !isPendienteManual && !isDevueltaPm,
    isMatrizEditable: esMatriz && !isConfirmed && !isManualDone && !isDesestimada && !isPendienteManual && !isDevueltaPm,
    isConfirmed, isManualDone, isPendienteManual, isDesestimada, isDevueltaPm,
    puedeEditarPauta: (isDevueltaPm || (!isConfirmed && !isManualDone && !isDesestimada)) && puedeEditarCampos(),
    motivoDesestimacion: item.motivo_desestimacion || '',
    desestimadoPor: item.desestimado_por || '',
    desestimadoEn: (item.desestimado_en || '').slice(0, 10),
    audienciaOtraTexto: isManualOnly ? (item.audiencias[0] ? item.audiencias[0].nombre : '') : ((item.audiencias.find((a) => a.manual) || {}).nombre || ''),
    audiencias: item.audiencias, combos,
    minPorConjunto: item.min_por_conjunto || 0,
    minPorConjuntoLabel: fmtMoney(item.min_por_conjunto || 0),
    diasDuracion: item.dias_duracion || 0,
    // La duración define el mínimo que exige Meta, así que conviene tenerla
    // a la vista al repartir, no solo en el pedido.
    duracionLabel: item.dias_duracion
      ? `Duración: ${item.dias_duracion} día(s)${item.fecha_inicio ? ` (${item.fecha_inicio}${item.fecha_fin ? ` → ${item.fecha_fin}` : ''})` : ''}`
      : 'Duración: —',
    totalLabel: Math.round(total) + '%', totalMontoLabel: fmtMoney(item.presupuesto * total / 100),
    totalColor: totalOk ? 'var(--color-accent-300)' : 'var(--color-neutral-400)',
    confirmDisabled: !totalOk, resultLines,
  };
}

// ---------- Render ----------

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderRowLine(vm, columnsCss, isHistorial) {
  const checkboxCell = isHistorial
    ? '<div></div>'
    : `<div data-action="stop-prop">${vm.selectable ? `<input type="checkbox" ${vm.isSelected ? 'checked' : ''} data-action="toggle-select" data-id="${vm.id}" style="width:16px;height:16px;accent-color:var(--color-accent)">` : ''}</div>`;
  const estadoOrTipo = isHistorial
    ? `<span class="tag tag-neutral">${esc(vm.estadoLabel)}</span>`
    : `<div style="display:flex;flex-wrap:wrap;gap:4px">${vm.tags.map((t) => `<span class="${t.clase}">${esc(t.label)}</span>`).join('')}</div>`;
  const chevronCell = isHistorial ? '' : `<div style="text-align:center"><i class="${vm.chevronClass}"></i></div>`;

  return `
    <div class="row-line" style="grid-template-columns:${columnsCss}${isHistorial ? '' : ''}" data-action="toggle-expand" data-id="${vm.id}">
      ${checkboxCell}
      <div class="row-ellip">${esc(vm.activoNombre)}${vm.isDark ? ' <span class="tag tag-neutral">DARK</span>' : ''}</div>
      <div class="row-ellip">${esc(vm.eje)}</div>
      <div class="row-ellip">${esc(vm.contenido)}</div>
      <div>${estadoOrTipo}</div>
      <div class="row-ellip">${esc(vm.objetivosLabel)}</div>
      <div class="row-ellip">${esc(vm.audienciaLabel)}</div>
      <div style="font-size:13px">${esc(vm.presupuestoLabel)}</div>
      <div class="row-ellip" style="font-size:13px">${esc(vm.fechaInicio)}</div>
      <div class="row-ellip" style="font-size:13px">${esc(vm.fechaFin)}</div>
      <div class="row-ellip" style="font-size:13px">${esc(vm.pendienteLabel)}</div>
      ${chevronCell}
    </div>`;
}

// Una pieza objetivo×audiencia = un adset/anuncio propio en Meta — se
// renderiza como un ítem compacto e independiente (no una celda de grilla),
// con un único slider para repartir presupuesto en vez de la combinación
// anterior de input+barra+4 chips (ocupaba mucho más alto).
function renderCombo(vm, combo) {
  const etiqueta = `
    <div style="min-width:180px;flex:none">
      <div style="font-family:var(--font-heading);font-size:14px">${esc(combo.objetivo)}</div>
      <div class="row-ellip" style="font-size:12px;color:var(--color-neutral-500)">${esc(combo.audNombre)}</div>
    </div>`;
  const montoBloque = `
    <div style="text-align:right;flex:none;min-width:86px">
      <div style="font-family:var(--font-heading);font-size:16px">${combo.pct}%</div>
      <div style="font-size:12px;color:${combo.bajoMinimo ? 'var(--color-warning, #d08a1e)' : 'var(--color-neutral-500)'}">${esc(combo.montoLabel)}</div>
    </div>`;

  const marcando = state.accionEnCurso[`${vm.id}|${combo.objetivo}|${combo.audCodigo}`] === 'celda';

  // Carril manual: no lo publica la app. Antes de confirmar es informativo;
  // después queda pendiente hasta que alguien lo cree en Meta y lo marque acá.
  if (combo.manual) {
    const hecha = combo.estadoCelda === 'manual_hecha' || combo.estadoCelda === 'manual';
    // El botón está disponible siempre, no solo después de confirmar: este
    // carril no depende del automático. Se crea en Meta a mano cuando se
    // pueda y se marca acá.
    const accion = hecha
      ? '<div style="flex:1;font-size:12px;color:var(--color-accent-2-600)"><i class="ph ph-check"></i> Hecha a mano en Meta</div>'
      : `
        <div style="flex:1;display:flex;align-items:center;gap:10px">
          <span style="font-size:12px;color:var(--color-neutral-400)">Creala en Meta a mano y marcala acá</span>
          ${puedeEditarValidacion() ? `<button class="btn btn-secondary" style="font-size:11px;padding:5px 10px" ${marcando ? 'disabled' : ''}
            data-action="celda-hecha" data-id="${vm.id}" data-objetivo="${esc(combo.objetivo)}" data-aud="${esc(combo.audCodigo)}">
            ${marcando ? '<span class="spinner-inline"></span>Marcando…' : 'Marcar hecha'}
          </button>` : ''}
        </div>`;
    return `
      <div class="celda-manual-rayas" style="display:flex;align-items:center;gap:14px;padding:10px 14px;border:1px solid var(--color-divider);border-radius:var(--radius-md)">
        ${etiqueta}
        ${accion}
        ${montoBloque}
      </div>`;
  }

  // Carril automático ya publicado: no se toca más, se muestra el resultado.
  if (combo.estadoCelda === 'publicada') {
    return `
      <div style="display:flex;align-items:center;gap:14px;padding:10px 14px;border:1px solid var(--color-divider);border-radius:var(--radius-md)">
        ${etiqueta}
        <div style="flex:1;font-size:12px;color:var(--color-accent-2-600)"><i class="ph ph-check"></i> Publicada en Meta (en pausa)</div>
        ${montoBloque}
      </div>`;
  }

  // Público, "misma publicación" destildada: cada celda elige la SUYA (el
  // ID de la publicación real en Meta) — vacío = usa la principal de la
  // pieza, como si no se hubiera destildado nada.
  const puedeElegirPost = !vm.isDark && state.mismaPublicacion[vm.id] === false;
  const claveCelda = `${vm.id}|${combo.objetivo}|${combo.audCodigo}`;
  const postInput = puedeElegirPost ? `
    <input class="input" style="font-size:12px;min-height:28px;padding:4px 8px;margin-top:6px" placeholder="ID de la publicación (vacío = la principal de la pieza)"
      data-action="celda-post-id" data-id="${vm.id}" data-objetivo="${esc(combo.objetivo)}" data-aud="${esc(combo.audCodigo)}" value="${esc(state.celdaPostIds[claveCelda] || '')}">` : '';

  // Desactivar un cruce Objetivo×Audiencia: no se crea ese conjunto de
  // anuncios ni cuenta para el 100% del reparto (ver toggleComboExcluido).
  const incluirCheck = `
    <label style="display:flex;align-items:center;gap:6px;flex:none" title="Desmarcá para no crear este conjunto de anuncios">
      <input type="checkbox" ${combo.excluido ? '' : 'checked'} data-action="toggle-combo-excluido" data-id="${vm.id}" data-objetivo="${esc(combo.objetivo)}" data-aud="${esc(combo.audCodigo)}" style="width:16px;height:16px;accent-color:var(--color-accent)">
    </label>`;
  // Bloquear: fija el % de esta celda — "Repartir parejo" y los demás
  // sliders reparten solo entre las que quedan sin bloquear (ver
  // toggleComboBloqueado). No tiene sentido junto con excluir.
  const bloquearBtn = combo.excluido ? '' : `
    <button type="button" title="${combo.bloqueado ? 'Desbloquear — dejar que el reparto la toque' : 'Bloquear este % — repartir el resto entre las demás'}" style="cursor:pointer;border:1px solid ${combo.bloqueado ? 'var(--color-accent)' : 'var(--color-divider)'};background:transparent;color:${combo.bloqueado ? 'var(--color-accent)' : 'var(--color-neutral-400)'};padding:5px 7px;border-radius:4px;flex:none;display:flex;align-items:center" data-action="toggle-combo-bloqueado" data-id="${vm.id}" data-objetivo="${esc(combo.objetivo)}" data-aud="${esc(combo.audCodigo)}"><i class="ph ${combo.bloqueado ? 'ph-lock-simple' : 'ph-lock-simple-open'}"></i></button>`;

  return `
    <div style="border:1px solid ${combo.bajoMinimo ? 'var(--color-warning, #d08a1e)' : 'var(--color-divider)'};border-radius:var(--radius-md);padding:10px 14px${combo.excluido ? ';opacity:.5' : ''}">
      <div style="display:flex;align-items:center;gap:14px">
        ${incluirCheck}
        ${etiqueta}
        <input type="range" min="0" max="100" value="${combo.pct}" ${(combo.excluido || combo.bloqueado) ? 'disabled' : ''} style="flex:1;min-width:0;accent-color:var(--color-accent)" data-action="set-pct" data-id="${vm.id}" data-objetivo="${esc(combo.objetivo)}" data-aud="${esc(combo.audCodigo)}">
        ${montoBloque}
        ${bloquearBtn}
        ${combo.excluido ? '' : `<button style="cursor:pointer;border:1px solid var(--color-accent-700);background:transparent;color:var(--color-accent-300);font-size:11px;padding:5px 8px;border-radius:4px;flex:none" data-action="all-to-cell" data-id="${vm.id}" data-objetivo="${esc(combo.objetivo)}" data-aud="${esc(combo.audCodigo)}">Todo acá</button>`}
      </div>
      ${combo.excluido ? '' : postInput}
    </div>`;
}

// Columna "Presupuesto" del grid (Preview | Presupuesto | Matriz, ver
// renderExpandContent): el monto, por qué es ese monto (Tipo/Intensidad ×
// Tamaño de la audiencia principal — ver resolverPresupuestoPorTipo en
// escalaPresupuestos.js) y el editor, todo junto en una sola tarjeta.
function renderColumnaPresupuesto(vm, editorPresupuesto) {
  const dato = (label, valor) => `
    <div>
      <div style="color:var(--color-neutral-500);text-transform:uppercase;font-size:10px;letter-spacing:.05em">${label}</div>
      <div style="font-family:var(--font-heading);font-size:14px;margin-top:2px">${esc(valor)}</div>
    </div>`;
  // Con una sola audiencia, "Grande" alcanza. Con más de una (principal +
  // secundarias), hay que decir de cuál es cada tamaño — no alcanza con
  // tirar los valores sueltos.
  const tamanos = vm.audienciasConTamano || [];
  const bloqueTamano = !tamanos.length ? '' : tamanos.length === 1
    ? dato('Tamaño Audiencia', tamanos[0].tamano)
    : `
    <div>
      <div style="color:var(--color-neutral-500);text-transform:uppercase;font-size:10px;letter-spacing:.05em">Tamaño Audiencia</div>
      <div style="margin-top:2px;display:flex;flex-direction:column;gap:2px">
        ${tamanos.map((t) => `<div style="font-size:12px"><span style="font-family:var(--font-heading)">${esc(t.tamano)}</span> <span style="color:var(--color-neutral-500)">— ${esc(t.nombre)}</span></div>`).join('')}
      </div>
    </div>`;
  return `
    <div style="width:220px;flex:none;background:var(--color-bg);border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:14px 16px;display:flex;flex-direction:column;gap:12px">
      ${dato('Presupuesto total', vm.presupuestoLabel)}
      ${bloqueTamano}
      ${vm.tipoIntensidad ? dato('Tipo de Campaña', vm.tipoIntensidad) : ''}
      ${editorPresupuesto}
    </div>`;
}

// Los dos carriles, cada uno en su bloque y con su propia acción — porque se
// resuelven por vías distintas: el automático lo publica PAUTADOR con un
// clic, el manual lo carga una persona en Meta y después lo viene a informar.
// Uno no espera al otro.
function renderCarriles(vm, confirmando) {
  const auto = vm.combos.filter((c) => !c.manual);
  const manual = vm.combos.filter((c) => c.manual);

  // Cada bloque muestra SU propio subtotal. Antes el bloque automático
  // mostraba el total de la pieza (los dos carriles juntos) y no cerraba con
  // los montos de sus propias filas.
  const subtotal = (lista) => {
    const pct = lista.reduce((a, c) => a + c.pct, 0);
    const monto = lista.reduce((a, c) => a + c.monto, 0);
    return `${Math.round(pct)}% (${fmtMoney(monto)})`;
  };

  // Sin margin-bottom acá adentro: iba dentro de la fila que también tiene
  // el botón "Repartir parejo" con align-items:center — ese margen asimétrico
  // corría el centrado vertical y desalineaba el botón contra el título.
  const titulo = (texto, ayuda) => `
    <div style="display:flex;align-items:baseline;gap:8px">
      <span style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:var(--color-neutral-400)">${texto}</span>
      <span style="font-size:11px;color:var(--color-neutral-500)">${ayuda}</span>
    </div>`;

  // Público con más de una celda: por defecto todas usan la MISMA
  // publicación real de la pieza — un solo checkbox para destildar eso y
  // elegir una distinta por celda (ver renderCombo). Solo tiene sentido
  // con más de un conjunto automático; con uno solo no hay "las demás".
  const mismaPublicacionCheck = (!vm.isDark && auto.length > 1 && !auto.some((c) => c.estadoCelda === 'publicada')) ? `
    <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--color-neutral-400);margin-bottom:10px">
      <input type="checkbox" data-action="toggle-misma-publicacion" data-id="${vm.id}" ${state.mismaPublicacion[vm.id] === false ? '' : 'checked'}>
      Misma publicación para todas las celdas
    </label>` : '';

  let bloqueAuto = '';
  if (auto.length) {
    const yaPublicado = auto.every((c) => c.estadoCelda === 'publicada');
    bloqueAuto = `
      <div style="border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:14px 16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          ${titulo('Automático', `${auto.length} conjunto(s) — los publica PAUTADOR`)}
          ${yaPublicado ? '' : `<button class="btn btn-secondary" style="font-size:12px;padding:4px 10px" data-action="distribute-even" data-id="${vm.id}"><i class="ph ph-equals"></i>Repartir parejo</button>`}
        </div>
        ${mismaPublicacionCheck}
        <div style="display:flex;flex-direction:column;gap:8px">
          ${auto.map((c) => renderCombo(vm, c)).join('')}
        </div>
        ${avisoMinimo(vm)}
        ${yaPublicado ? '' : `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
            <div style="font-size:14px;font-family:var(--font-heading)">Este carril: ${subtotal(auto)}</div>
            <button class="btn btn-primary" ${(vm.confirmDisabled || confirmando) ? 'disabled' : ''} data-action="confirm-one" data-id="${vm.id}">${confirmando ? '<span class="spinner-inline"></span>Publicando…' : 'Confirmar y publicar'}</button>
          </div>
          ${vm.confirmDisabled ? `<div style="font-size:12px;color:var(--color-neutral-400);margin-top:6px">El reparto de los dos carriles tiene que sumar 100% — hoy suma ${vm.totalLabel}.</div>` : ''}
          ${confirmando ? `<div style="font-size:12px;color:var(--color-neutral-500);text-align:right;margin-top:6px">Publicando ${auto.length} conjunto(s) en Meta — puede tardar unos segundos, no hace falta reintentar.</div>` : ''}`}
      </div>`;
  }

  let bloqueManual = '';
  if (manual.length) {
    const pendientes = manual.filter((c) => c.estadoCelda !== 'manual_hecha' && c.estadoCelda !== 'manual').length;
    bloqueManual = `
      <div style="border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:14px 16px;margin-top:12px">
        <div style="margin-bottom:8px">${titulo('Manual', `${manual.length} conjunto(s) — los cargás vos en Meta${pendientes ? '' : ' · todo marcado'}`)}</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${manual.map((c) => renderCombo(vm, c)).join('')}
        </div>
        <div style="font-size:14px;font-family:var(--font-heading);margin-top:14px">Este carril: ${subtotal(manual)}</div>
      </div>`;
  }

  return `<div>${bloqueAuto}${bloqueManual}</div>`;
}

// Meta rechaza el conjunto si su presupuesto no supera min_daily_budget × días
// (verificado contra la API real). Como es por conjunto, repartir poco entre
// muchas celdas falla — mejor avisarlo acá que comerse el error al confirmar.
function avisoMinimo(vm) {
  if (!vm.minPorConjunto) return '';
  const flojas = vm.combos.filter((c) => c.bajoMinimo).length;
  if (!flojas) return '';
  return `
    <div style="margin-top:12px;padding:10px 12px;border:1px solid var(--color-warning, #d08a1e);border-radius:var(--radius-md);font-size:12px;color:var(--color-neutral-300)">
      <strong>${flojas} ${flojas === 1 ? 'conjunto queda' : 'conjuntos quedan'} bajo el mínimo de Meta.</strong>
      Para ${vm.diasDuracion} día(s) de duración, Meta pide más de ${esc(vm.minPorConjuntoLabel)} <em>por conjunto</em> (cada celda es un conjunto).
      Si confirmás así, Meta va a rechazar ${flojas === 1 ? 'esa celda' : 'esas celdas'}: subí el presupuesto de la pieza, acortá la duración, o concentrá el reparto en menos celdas.
    </div>`;
}

function renderExpandContent(vm) {
  // Mock de cómo se ve en Facebook/Instagram (mismo componente que el
  // preview de "Pedido de Anuncios", ver renderMockPost) — reemplaza la
  // miniatura chica + el cuadro de copy suelto que había antes acá.
  const plataformasVm = vm.plataformas && vm.plataformas.length ? vm.plataformas : ['Facebook'];
  // Array, no un string ya unido — cada mock es su propia columna del grid
  // de más abajo (pedido del usuario: "Preview FB | IG | Matriz" en vez de
  // apilado, que ocupaba mucho alto con poco uso del ancho).
  const mockPostsArr = plataformasVm.map((plataforma) => renderMockPost({
    nombrePagina: vm.activoNombre,
    copy: vm.copy,
    mediaUrl: vm.imagenPreview,
    lightboxUrl: vm.imagenPreview,
    plataforma,
  }));
  const categorias = [
    vm.visibilidadLabel,
    vm.formato,
    vm.objetivosLabel,
    vm.audienciaLabel,
  ].filter(Boolean).map((c) => `<span class="tag tag-outline">${esc(c)}</span>`).join('');
  // El PM define la Intensidad en "Pedido de Pauta" (no un monto exacto) —
  // acá, el Implementador/Administrador puede terminar de ajustarlo antes
  // de confirmar. Mismos tramos fijos que "Crear Anuncios".
  const puedeEditarPresupuesto = puedeEditarValidacion() && !vm.isConfirmed && !vm.isManualDone && !vm.isDesestimada;
  const editorPresupuesto = puedeEditarPresupuesto ? `
    <div style="display:flex;flex-direction:column;gap:6px" data-action="stop-prop">
      <select class="input" id="pto-edit-${esc(vm.id)}" style="width:100%">
        ${PRESUPUESTO_TIERS.map((v) => `<option value="${v}" ${v === vm.presupuesto ? 'selected' : ''}>${labelPresupuesto(v)}</option>`).join('')}
      </select>
      <button class="btn btn-secondary" data-action="guardar-presupuesto" data-id="${esc(vm.id)}" style="width:100%">Cambiar Presupuesto Total</button>
    </div>` : '';
  // A diferencia del presupuesto (monto exacto, solo Implementador/Admin —
  // el PM define Intensidad, no el número), desestimar un pedido propio sí
  // lo puede hacer quien lo pidió: mismo criterio que editar los campos.
  const puedeDesestimar = puedeEditarCampos() && !vm.isConfirmed && !vm.isManualDone && !vm.isDesestimada;
  const desestimarAbierto = state.desestimandoId === vm.id;
  const desestimarTrigger = (puedeDesestimar && !desestimarAbierto) ? `
    <button class="btn btn-secondary" data-action="desestimar-abrir" data-id="${esc(vm.id)}" style="font-size:14px;padding:10px 18px;flex:none"><i class="ph ph-x-circle"></i> Desestimar Pedido</button>` : '';
  // Editar campos: parejo entre PM/Cuentas e Implementador (a diferencia de
  // Desestimar/Devolver, que siguen siendo solo del Implementador) — es la
  // única acción disponible en una pieza "devuelta_pm", y una más para
  // cualquier pendiente normal.
  const editarAbierto = state.editandoId === vm.id;
  const editarTrigger = (vm.puedeEditarPauta && !editarAbierto) ? `
    <button class="btn btn-primary" data-action="editarpauta-abrir" data-id="${esc(vm.id)}" style="font-size:14px;padding:10px 18px;flex:none"><i class="ph ph-pencil-simple"></i> Editar Pedido</button>` : '';
  // Header en 3 niveles: 1) nombre de contenido, 2) características
  // (Eje/Fecha/Duración + Oculto-Público/Formato/Objetivo/Audiencias),
  // 3) Comentarios + Editar Pedido/Desestimar Pedido (apilados a la
  // derecha — si el comentario es largo y el renglón crece, los botones
  // siguen ocupando lo mismo en vez de estirarse horizontal).
  const header = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:20px;margin-bottom:8px">
      <h4 style="margin:0">${esc(vm.campana)}${vm.contenido ? ' - ' + esc(vm.contenido) : ''}</h4>
      <div style="display:flex;align-items:center;gap:14px;flex:none">
        <span class="tag tag-accent" style="font-family:monospace">${esc(vm.codigo)}</span>
        ${vm.publicacionLink ? `<a href="${esc(vm.publicacionLink)}" target="_blank" rel="noopener" style="font-size:13px;display:flex;gap:6px;align-items:center"><i class="ph ph-arrow-square-out"></i>Ver publicación</a>` : ''}
        ${vm.linkDestino ? `<a href="${esc(vm.linkDestino)}" target="_blank" rel="noopener" style="font-size:13px;display:flex;gap:6px;align-items:center"><i class="ph ph-link"></i>${esc(vm.linkDestino)}</a>` : ''}
      </div>
    </div>
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;color:var(--color-neutral-500);margin-bottom:14px">
      <span>Eje: ${esc(vm.eje)} · Fecha: ${esc(vm.fecha)} · ${esc(vm.duracionLabel)}</span>
      ${categorias}
    </div>
    <div style="display:flex;align-items:stretch;gap:16px;flex-wrap:wrap;margin-bottom:16px">
      ${vm.comentarios ? `
      <div style="flex:1;min-width:260px;font-size:13px;color:var(--color-neutral-300);background:var(--color-bg);border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:8px 12px">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--color-neutral-500)">Comentarios: </span>${esc(vm.comentarios)}
      </div>` : '<div style="flex:1"></div>'}
      <div style="display:flex;flex-direction:column;gap:8px;flex:none">
        ${editarTrigger}
        ${desestimarTrigger}
      </div>
    </div>
  `;

  const desestimarPanel = renderDesestimarPanel(vm, desestimarAbierto);
  let body = '';
  const confirmando = state.accionEnCurso[vm.id] === 'confirmar';
  const marcando = state.accionEnCurso[vm.id] === 'marcar';

  // Desestimada/devuelta se muestran igual para cualquiera que las vea
  // (PM o Implementador) — antes esto ni se evaluaba para PM, que caía
  // directo en la rama de solo-lectura de abajo y veía un resumen vacío
  // (esas piezas no tienen celdas).
  // Desestimada/devuelta/solo-lectura ya no cortan con un return propio —
  // solo fijan `body` y caen al armado del grid al final, así el layout
  // (preview al lado del contenido) queda igual para todos los estados.
  if (vm.isDesestimada) {
    body = '<div style="border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:14px 16px">'
      + '<div style="font-family:var(--font-heading);margin-bottom:6px">Desestimada — no se pautó</div>'
      + '<div style="font-size:13px;color:var(--color-neutral-300)">' + esc(vm.motivoDesestimacion || '(sin motivo registrado)') + '</div>'
      + '<div style="font-size:11px;color:var(--color-neutral-500);margin-top:8px">' + esc([vm.desestimadoPor, vm.desestimadoEn].filter(Boolean).join(' · ')) + '</div>'
      + '</div>';
  } else if (vm.isDevueltaPm) {
    body = '<div style="border:1px solid var(--color-accent-700);border-radius:var(--radius-md);padding:14px 16px">'
      + '<div style="font-family:var(--font-heading);margin-bottom:6px">Devuelta para corrección</div>'
      + '<div style="font-size:13px;color:var(--color-neutral-300)">' + esc(vm.motivoDesestimacion || '(sin motivo registrado)') + '</div>'
      + '<div style="font-size:11px;color:var(--color-neutral-500);margin-top:8px">' + esc([vm.desestimadoPor, vm.desestimadoEn].filter(Boolean).join(' · ')) + '</div>'
      + (vm.puedeEditarPauta && !editarAbierto ? '<div style="margin-top:10px"><button class="btn btn-primary" data-action="editarpauta-abrir" data-id="' + esc(vm.id) + '">Corregir esta pieza</button></div>' : '')
      + '</div>';
  // PM/Cuentas ve "Validación de Anuncios" en solo lectura — nada de chips,
  // sliders ni botones de confirmar/marcar manual, solo el estado propuesto
  // (pero SÍ puede editar los campos, ver editarTrigger/editarPanel arriba).
  } else if (!puedeEditarValidacion() && !vm.isConfirmed && !vm.isManualDone) {
    const resumen = vm.isManualOnly
      ? `Audiencia "Otra" — ${esc(vm.audienciaOtraTexto)} (se carga a mano en Meta)`
      : vm.combos.map((c) => `<span style="font-family:var(--font-heading)">${esc(c.objetivo)}</span> · ${esc(c.audNombre)}: ${c.pct}% (${esc(c.montoLabel)})`).join('<br>');
    body = `
      <div style="background:var(--color-bg);border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:14px 16px">
        <div style="font-size:13px;color:var(--color-neutral-300)">${resumen}</div>
        <div style="font-size:11px;color:var(--color-neutral-500);margin-top:8px">Solo lectura — un Implementador la confirma en esta misma pantalla.</div>
      </div>`;
  } else if (vm.isManualDone) {
    body = `<div style="font-size:13px;color:var(--color-neutral-400)">Marcada como hecha a mano — audiencia "Otra": ${esc(vm.audienciaOtraTexto)}.</div>`;
  } else if (vm.isConfirmed) {
    body = `
      <div>
        <h5 style="margin:0 0 10px;color:var(--color-neutral-400)">Resultado</h5>
        ${vm.resultLines.map((rl) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--color-divider);gap:12px">
            <div style="font-size:13px">
              <span style="font-family:var(--font-heading)">${esc(rl.objetivo)}</span> · ${esc(rl.audNombre)} · ${esc(rl.pctLabel)} · ${esc(rl.montoLabel)}
              ${rl.nomenclatura ? `<div style="font-size:11px;color:var(--color-neutral-500);font-family:monospace;margin-top:2px">${esc(rl.nomenclatura)}</div>` : ''}
            </div>
            ${rl.isManual ? '<span class="tag tag-outline" style="flex:none">Manual — crear a mano en Meta</span>' : `<span style="font-size:11px;color:var(--color-neutral-500);font-family:monospace;flex:none">${esc(rl.ids)}</span>`}
          </div>`).join('')}
      </div>`;
  } else if (vm.isManualOnly) {
    body = `
      <div style="display:flex;justify-content:space-between;align-items:center;background:var(--color-bg);border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:14px 16px;gap:16px">
        <div>
          <div style="font-family:var(--font-heading);margin-bottom:2px">Audiencia "Otra" — ${esc(vm.audienciaOtraTexto)}</div>
          <div style="font-size:12px;color:var(--color-neutral-500)">Sin ID de Meta. Esta pieza se crea a mano; no puede publicarse desde acá.</div>
        </div>
        <button class="btn btn-secondary" data-action="mark-manual" data-id="${vm.id}" style="flex:none" ${marcando ? 'disabled' : ''}>${marcando ? '<span class="spinner-inline"></span>Marcando…' : 'Marcar hecha a mano'}</button>
      </div>`;
  } else if (vm.isSimpleAuto) {
    const simpleBajoMinimo = vm.minPorConjunto && vm.presupuesto < vm.minPorConjunto;
    body = `
      <div style="background:var(--color-bg);border:1px solid ${simpleBajoMinimo ? 'var(--color-warning, #d08a1e)' : 'var(--color-divider)'};border-radius:var(--radius-md);padding:16px 18px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:22px;font-family:var(--font-heading)">100% <span style="color:var(--color-neutral-500);font-size:15px">→</span> ${esc(vm.presupuestoLabel)}</div>
          <button class="btn btn-primary" data-action="confirm-one" data-id="${vm.id}" ${confirmando ? 'disabled' : ''}>${confirmando ? '<span class="spinner-inline"></span>Confirmando…' : 'Confirmar'}</button>
        </div>
        ${simpleBajoMinimo ? `<div style="font-size:12px;color:var(--color-neutral-300);margin-top:10px">Para ${vm.diasDuracion} día(s), Meta pide más de <strong>${esc(vm.minPorConjuntoLabel)}</strong> por conjunto — con este presupuesto lo va a rechazar. Subí el presupuesto o acortá la duración.</div>` : ''}
        ${confirmando ? '<div style="font-size:12px;color:var(--color-neutral-500);margin-top:10px">Publicando en Meta (campaña, conjunto, imagen y anuncio) — puede tardar unos segundos, no hace falta reintentar.</div>' : ''}
      </div>`;
  } else if (vm.isMatrizEditable || vm.isPendienteManual) {
    body = renderCarriles(vm, confirmando);
  }

  // Grid "Preview FB | Preview IG | Matriz" — antes el/los mock(s) iban
  // arriba del todo y el resto (carriles, resultado, etc.) apilado debajo,
  // ocupando mucho alto con el ancho vacío al lado (pedido del usuario).
  // Grid de 3 columnas: Preview(s) | Presupuesto (monto + por qué + editor,
  // todo junto) | Matriz — pedido del usuario, antes el presupuesto estaba
  // suelto arriba del todo y desconectado de por qué era ese monto.
  const previewCols = mockPostsArr.map((p) => `<div style="width:260px;flex:none">${p}</div>`).join('');
  const columnaPresupuesto = renderColumnaPresupuesto(vm, editorPresupuesto);
  const grid = `<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">${previewCols}${columnaPresupuesto}<div style="flex:1;min-width:420px">${body}</div></div>`;
  return `<div class="expand-panel">${header}${desestimarPanel}${grid}</div>`;
}

// El panel de motivo, siempre inmediatamente debajo del header — no hace
// falta scrollear la matriz para llegar a esto. El trigger que lo abre
// vive en el header (ver renderExpandContent).
function renderDesestimarPanel(vm, abierto) {
  if (!abierto) return "";
  const enCurso = state.accionEnCurso[vm.id] === 'desestimar' || state.accionEnCurso[vm.id] === 'devolver';
  const err = state.desestimarError && state.desestimarError.id === vm.id ? state.desestimarError.msg : '';
  // "Corregir y pautar"/"Corregir y devolver" son del Implementador (arregla
  // él mismo o le pasa la corrección a quien pidió) — no tienen sentido para
  // un PM desestimando su propio pedido. El PM solo ve Desestimar directo.
  const opcionesImplementador = puedeEditarValidacion()
    ? '<button class="btn btn-secondary" data-action="corregir-y-pautar" data-id="' + esc(vm.id) + '" ' + (enCurso ? 'disabled' : '') + '>Corregir y pautar</button>'
      + '<button class="btn btn-secondary" data-action="devolver-confirmar" data-id="' + esc(vm.id) + '" ' + (enCurso ? 'disabled' : '') + '>' + (state.accionEnCurso[vm.id] === 'devolver' ? 'Devolviendo…' : 'Corregir y devolver') + '</button>'
    : '';
  return '<div style="margin-bottom:16px;border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:14px 16px" data-action="stop-prop">'
    + '<div style="font-family:var(--font-heading);margin-bottom:4px">¿Qué hacemos con este pedido?</div>'
    + '<div style="font-size:12px;color:var(--color-neutral-500);margin-bottom:8px">El motivo queda guardado en la pieza — es lo que va a leer quien corresponda.</div>'
    + '<textarea class="input" id="motivo-' + esc(vm.id) + '" rows="2" placeholder="Ej: el link del material no abre / la campaña se cayó / duplicada con ' + esc(vm.codigo) + '"></textarea>'
    + (err ? '<div class="error" style="margin-top:6px">' + esc(err) + '</div>' : '')
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:10px">'
    +   '<button class="btn btn-secondary" data-action="desestimar-cancelar">Cancelar</button>'
    +   opcionesImplementador
    +   '<button class="btn btn-primary" data-action="desestimar-confirmar" data-id="' + esc(vm.id) + '" ' + (enCurso ? 'disabled' : '') + '>' + (state.accionEnCurso[vm.id] === 'desestimar' ? 'Desestimando…' : 'Desestimar por completo') + '</button>'
    + '</div></div>';
}

// Campo de texto/fecha chico para el panel de edición — mismo patrón
// compacto que ya usa la corrección de filas del CSV.
function campoEditar(id, label, valor, tipo) {
  return '<div class="field"><label>' + esc(label) + '</label><input class="input" id="editarpauta-' + id + '" '
    + (tipo ? 'type="' + tipo + '"' : '') + ' value="' + esc(valor || '') + '"></div>';
}

// Panel de edición — Campaña/Objetivo/Formato/Red/Placement/Audiencia/
// Material/Copy/Fechas/Link, los mismos campos que "Pedido de Pauta"
// salvo Eje y Tipo (van codificados en `codigo`, no se pueden tocar acá —
// ver editarPauta en pedidos.js) y Presupuesto/Visibilidad (fuera de
// alcance de esta edición). Mismo desplegable-con-checkboxes que ya usa
// Objetivo en el resto del formulario, no un <select multiple> nativo.
function renderEditarModal() {
  const overlay = document.getElementById('editar-modal-overlay');
  const id = state.editandoId;
  overlay.hidden = !id;
  if (!id) return;

  const panel = document.getElementById('editar-modal-panel');
  const c = state.editarCampos;
  if (!c) {
    panel.innerHTML = state.editarError
      ? '<div class="error">' + esc(state.editarError) + '</div><div style="margin-top:16px;text-align:right"><button class="btn btn-secondary" data-action="editarpauta-cancelar">Cerrar</button></div>'
      : '<div style="padding:30px;text-align:center;color:var(--color-neutral-400)">Cargando…</div>';
    return;
  }

  const guardando = state.editarGuardando;
  const err = state.editarError || '';
  const objetivoDd = renderDropdownMulti('editarpauta-objetivo-dd', 'editarpauta-objetivo-chk', (state.pdObjetivos || []).map((o) => [o, o]), '— elegir uno o más —', c.objetivo || []);
  const redesHtml = [['facebook', 'Facebook'], ['instagram', 'Instagram']].map(([v, l]) => '<label style="display:inline-flex;align-items:center;gap:4px;margin-right:14px;font-size:13px"><input type="checkbox" class="editarpauta-redes-chk" value="' + v + '" ' + ((c.redes || []).includes(v) ? 'checked' : '') + '> ' + l + '</label>').join('');
  const placementsHtml = [['feed', 'Feed'], ['stories', 'Stories'], ['reels', 'Reels']].map(([v, l]) => '<label style="display:inline-flex;align-items:center;gap:4px;margin-right:14px;font-size:13px"><input type="checkbox" class="editarpauta-placements-chk" value="' + v + '" ' + ((c.placements || []).includes(v) ? 'checked' : '') + '> ' + l + '</label>').join('');
  const formatoOpts = '<option value="">— elegir —</option>' + (state.pdFormatos || []).map((f) => '<option value="' + esc(f.appsheet_valor) + '" ' + (f.appsheet_valor === c.formato ? 'selected' : '') + '>' + esc(f.appsheet_valor) + '</option>').join('');
  const audOpts = '<option value="">— elegir —</option>'
    + (state.pdAudiencias || []).map((a) => '<option value="' + esc(a.codigo) + '" ' + (a.codigo === c.audienciaCodigo ? 'selected' : '') + '>' + esc(a.nombre) + '</option>').join('')
    + '<option value="Otra" ' + (c.audienciaCodigo === 'Otra' ? 'selected' : '') + '>Otra (audiencia no guardada)</option>';
  const esPublico = c.visibilidad === 'PUBLICO';
  const preview = c.imagenPreview
    ? '<img src="' + esc(c.imagenPreview) + '" data-action="abrir-lightbox" data-url="' + esc(c.imagenPreview) + '" style="width:120px;height:120px;object-fit:cover;border-radius:var(--radius-md);cursor:zoom-in;flex:none" title="Ver más grande">'
    : '';

  panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px">'
    +   '<div style="display:flex;gap:14px;align-items:center">'
    +     preview
    +     '<div><h4 style="margin:0 0 4px">Corregir pieza</h4>' + (c.codigo ? '<div style="font-family:monospace;font-size:12px;color:var(--color-neutral-500)">' + esc(c.codigo) + '</div>' : '') + '</div>'
    +   '</div>'
    +   '<button type="button" class="btn btn-icon btn-ghost" data-action="editarpauta-cancelar"><i class="ph ph-x"></i></button>'
    + '</div>'
    + (err ? '<div class="error" style="margin-bottom:14px">' + esc(err) + '</div>' : '')
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">'
    +   campoEditar('campana', 'Campaña', c.campana)
    +   campoEditar('linea', 'Línea de comunicación (opcional)', c.linea)
    +   '<div class="field"><label>Objetivo</label>' + objetivoDd + '</div>'
    +   (esPublico ? '' : '<div class="field"><label>Formato</label><select class="input" id="editarpauta-formato">' + formatoOpts + '</select></div>')
    +   '<div class="field"><label>Audiencia principal</label><select class="input" id="editarpauta-audiencia">' + audOpts + '</select></div>'
    +   (c.audienciaCodigo === 'Otra' ? campoEditar('otraAudiencia', 'Descripción de la audiencia', c.otraAudiencia) : '')
    +   (esPublico ? '' : campoEditar('material', 'Material (link de Drive, o archivo ya subido)', c.material))
    +   (esPublico ? '' : campoEditar('materialStories', 'Material alternativo para Stories (opcional)', c.materialStories))
    +   campoEditar('fechaInicio', 'Fecha inicio', c.fechaInicio, 'date')
    +   campoEditar('fechaFin', 'Fecha fin', c.fechaFin, 'date')
    +   campoEditar('linkDestino', 'Link de destino del anuncio (opcional)', c.linkDestino)
    + '</div>'
    + (esPublico ? '' : ('<div class="field" style="margin-top:14px"><label>Red</label>' + redesHtml + '</div>'
      + '<div class="field" style="margin-top:8px"><label>Placement (dónde se muestra el anuncio)</label>' + placementsHtml + '</div>'
      + '<div class="field" style="margin-top:14px"><label>Copy (texto del anuncio)</label><textarea class="input" id="editarpauta-copy" rows="3">' + esc(c.copy || '') + '</textarea></div>'))
    + '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:22px;padding-top:16px;border-top:1px solid var(--color-divider)">'
    +   '<button class="btn btn-secondary" data-action="editarpauta-cancelar">Cancelar</button>'
    +   '<button class="btn btn-primary" data-action="editarpauta-guardar" data-id="' + esc(id) + '" ' + (guardando ? 'disabled' : '') + '>' + (guardando ? 'Guardando…' : 'Guardar cambios') + '</button>'
    + '</div>';
}

function renderItemRow(vm, columnsCss, isHistorial) {
  const line = renderRowLine(vm, columnsCss, isHistorial);
  const expand = vm.isExpanded ? renderExpandContent(vm) : '';
  return `<div class="row-wrap ${state.confirmadosFlash[vm.id] ? 'row-confirmada' : ''}">${line}${expand}</div>`;
}

function renderLightbox() {
  const overlay = document.getElementById('lightbox-overlay');
  overlay.hidden = !state.lightboxUrl;
  if (!state.lightboxUrl) return;
  document.getElementById('lightbox-img').src = state.lightboxUrl;
  document.getElementById('lightbox-descargar').href = state.lightboxUrl;
  document.getElementById('lightbox-abrir').href = state.lightboxUrl;
}

function renderToast() {
  const area = document.getElementById('toast-area');
  if (!state.toast) { area.innerHTML = ''; return; }
  const lines = state.toast.lines
    .map((l) => `<div style="font-size:13px;padding:4px 0;color:var(--color-neutral-300);display:flex;gap:8px"><span style="font-family:var(--font-heading);color:var(--color-text)">${esc(l.codigo)}</span><span>${esc(l.resumen)}</span></div>`)
    .join('');
  area.innerHTML = `
    <div style="margin:16px 28px 0;background:var(--color-surface);border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:14px 16px;box-shadow:var(--shadow-sm)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <h5 style="margin:0">${esc(state.toast.titulo || 'Confirmadas en lote')}</h5>
        <button class="btn btn-icon btn-ghost" data-action="dismiss-toast"><i class="ph ph-x"></i></button>
      </div>
      ${lines}
    </div>`;
}

// Código y Proyecto salieron de la tabla (Código queda en el panel al
// expandir — "sirve para decodificar más que nada"; Proyecto es redundante
// una vez que ya filtraste por uno). Campaña se fusionó con Contenido (el
// nombre de Contenido ya incluye la Campaña, ver pedidos.js) para no perder
// ancho. Se suman Inicio/Fin/Pendiente sin agrandar la tabla — misma
// cantidad de columnas que antes.
const COLS_PENDIENTES = '32px minmax(0,1fr) minmax(0,0.7fr) minmax(0,1.6fr) 130px minmax(0,0.9fr) minmax(0,0.9fr) 100px 90px 90px 100px 24px';
const COLS_HISTORIAL = '32px minmax(0,1fr) minmax(0,0.7fr) minmax(0,1.6fr) 130px minmax(0,0.9fr) minmax(0,0.9fr) 100px 90px 90px 100px';

// Selector "actuando como" del nav + qué pestañas se ven según el rol.
function renderNavUsuario() {
  const sel = document.getElementById('usuario-actual');
  sel.innerHTML = state.usuarios.map((u) => `<option value="${esc(u.id)}">${esc(u.nombre)}</option>`).join('');
  if (state.usuarioActualId) sel.value = state.usuarioActualId;

  const permitidas = tabsPermitidas();
  document.querySelectorAll('.tab-btn[data-tab]').forEach((b) => {
    b.hidden = !permitidas.includes(b.dataset.tab);
  });
}

function render() {
  // Onboarding: Login → Proyecto → Oficial/Informativo. Mientras falte
  // alguna de las 3, ni siquiera se toca el resto del render — se muestra
  // esa pantalla sola y se corta acá.
  const pantalla = pantallaActual();
  document.getElementById('pantalla-login').hidden = pantalla !== 'login';
  document.getElementById('pantalla-proyecto').hidden = pantalla !== 'proyecto';
  document.getElementById('pantalla-ecosistema').hidden = pantalla !== 'ecosistema';
  document.getElementById('app-shell').hidden = pantalla !== 'app';
  if (pantalla === 'login') { renderPantallaLogin(); return; }
  if (pantalla === 'proyecto') { renderPantallaProyecto(); return; }
  if (pantalla === 'ecosistema') { renderPantallaEcosistema(); return; }

  renderNavUsuario();
  renderNavContexto();
  renderEditarModal();

  const enPendientes = state.tabActiva === 'pendientes';
  document.getElementById('estado-carga').hidden = !enPendientes || (!state.cargando && !state.error);
  document.getElementById('estado-carga').textContent = state.error ? ('Error: ' + state.error) : 'Cargando…';
  document.getElementById('tab-pendientes').hidden = !enPendientes || (state.cargando && !state.items.length);
  document.getElementById('batch-bar').hidden = true;
  if (!enPendientes || state.cargando) return;

  document.querySelector('.grid-header').style.gridTemplateColumns = COLS_PENDIENTES;

  renderToast();

  // Orden de la cola de Validación: Día (más antiguo primero) → Intensidad
  // del Tipo (Alta primero — Pautas Army, sin Intensidad, queda al final)
  // → Fecha de fin más cercana primero. Se ordena ACÁ, sobre los items
  // crudos, así el orden se mantiene tal cual al pasar por buildVM().
  const PRIORIDAD_INTENSIDAD = { Alta: 3, Media: 2, Baja: 1 };
  const itemsOrdenados = state.items.slice().sort((a, b) => {
    const diaA = a.fecha || '';
    const diaB = b.fecha || '';
    if (diaA !== diaB) return diaA < diaB ? -1 : 1;
    const prioA = PRIORIDAD_INTENSIDAD[a.tipo_intensidad] || 0;
    const prioB = PRIORIDAD_INTENSIDAD[b.tipo_intensidad] || 0;
    if (prioA !== prioB) return prioB - prioA;
    const finA = a.fecha_fin || '9999-99-99';
    const finB = b.fecha_fin || '9999-99-99';
    if (finA !== finB) return finA < finB ? -1 : 1;
    return 0;
  });
  const vms = itemsOrdenados.map((it) => buildVM(it));

  // Sin filtros de activo/proyecto en el nav: lo que se ve ya viene acotado
  // por los proyectos que tiene permitidos el usuario (filtro del servidor).
  // pendiente_manual = el automático YA se publicó, solo queda una celda
  // manual por marcar — no es algo que siga "esperando validación" (nadie
  // tiene que decidir nada), así que va a Historial. Aplica igual si la
  // pieza se creó desde "Pedido de Pauta" o directo desde "Crear Anuncios":
  // el implementador que carga ahí ya validó al cargar, no tiene sentido
  // que la pieza vuelva a aparecer en la cola de pendientes.
  // devuelta_pm queda en Pendientes (no en Historial): a quien la pidió
  // todavía le falta corregirla y volver a mandarla a Validación — no es
  // un caso cerrado como desestimada/confirmada.
  const pendientes = vms.filter((vm) => !vm.isConfirmed && !vm.isManualDone && !vm.isDesestimada && !vm.isPendienteManual);
  const historial = vms.filter((vm) => vm.isConfirmed || vm.isManualDone || vm.isDesestimada || vm.isPendienteManual);

  document.getElementById('pendientes-count').textContent = pendientes.length + ' pendientes';

  document.getElementById('lista-pendientes').innerHTML = pendientes.length
    ? pendientes.map((vm) => renderItemRow(vm, COLS_PENDIENTES, false)).join('')
    : '<p style="color:var(--color-neutral-500);padding:16px 10px">No hay piezas esperando validación. Las que se carguen desde "Pedido de Anuncios" aparecen acá.</p>';

  const historialWrap = document.getElementById('historial-toggle-wrap');
  historialWrap.hidden = historial.length === 0;
  document.getElementById('historial-label').textContent = 'Historial (' + historial.length + ')';
  document.querySelector('#historial-toggle i').className = 'ph ' + (state.historyOpen ? 'ph-caret-down' : 'ph-caret-right');
  const listaHistorial = document.getElementById('lista-historial');
  listaHistorial.hidden = !state.historyOpen;
  if (state.historyOpen) {
    listaHistorial.innerHTML = historial.map((vm) => renderItemRow(vm, COLS_HISTORIAL, true)).join('');
  }

  // barra de selección múltiple — confirmar y desestimar son mutuamente
  // excluyentes (las dos son fixed bottom, se pisarían si mostraran juntas).
  const selectedIds = Object.keys(state.selected);
  const hayAlgoSeleccionado = selectedIds.length > 0 && puedeEditarValidacion();
  const batchBar = document.getElementById('batch-bar');
  const batchDesestimarBar = document.getElementById('batch-desestimar-bar');
  batchBar.hidden = !hayAlgoSeleccionado || state.batchDesestimarAbierto;
  batchDesestimarBar.hidden = !hayAlgoSeleccionado || !state.batchDesestimarAbierto;
  if (hayAlgoSeleccionado && !state.batchDesestimarAbierto) {
    const selectedVms = vms.filter((vm) => selectedIds.includes(vm.id));
    const readyCount = selectedVms.filter((vm) => Math.round(parseFloat(vm.totalLabel)) === 100).length;
    document.getElementById('batch-status').textContent = readyCount + ' de ' + selectedIds.length + ' listas para confirmar';
    const btn = document.getElementById('batch-confirm');
    btn.textContent = state.batchConfirmando
      ? 'Confirmando…'
      : 'Confirmar ' + selectedIds.length + ' pieza' + (selectedIds.length > 1 ? 's' : '');
    btn.disabled = state.batchConfirmando || readyCount !== selectedIds.length;
  }
  if (hayAlgoSeleccionado && state.batchDesestimarAbierto) {
    document.getElementById('batch-desestimar-count').textContent =
      selectedIds.length + ' pieza' + (selectedIds.length > 1 ? 's' : '');
    const btnD = document.getElementById('batch-desestimar-confirmar');
    btnD.disabled = state.batchDesestimarEnviando;
    btnD.textContent = state.batchDesestimarEnviando
      ? 'Desestimando…'
      : 'Desestimar ' + selectedIds.length + ' pieza' + (selectedIds.length > 1 ? 's' : '');
    document.getElementById('batch-desestimar-error').hidden = !state.batchDesestimarError;
    document.getElementById('batch-desestimar-error').textContent = state.batchDesestimarError || '';
  }
}

// ---------- Helpers compartidos ----------

// AppSheet separa multipicks con "," o "~" según el campo (ver colaPautas.js
// del backend) — acá aceptamos los dos al pre-cargar un pedido ya guardado.
function splitLista(v) {
  return String(v || '').split(/[,~]/).map((s) => s.trim()).filter(Boolean);
}

// Campos que refieren a tablas de equivalencia: siempre un menú desplegable
// de opciones válidas, nunca texto libre — así no se puede tipear un valor
// que no exista en equiv_objetivo/equiv_audiencia. Los que admiten "uno o
// más" son un desplegable que al abrirse muestra checkboxes (dropdownMulti),
// no una lista de checkboxes siempre visible.
function dropdownMultiOptions(id) {
  return Array.from(document.querySelectorAll(`#${id} .dropdown-multi-panel input[type="checkbox"]`));
}

function dropdownMultiLabel(id, placeholder) {
  const checked = dropdownMultiOptions(id).filter((el) => el.checked);
  if (!checked.length) return placeholder;
  return checked.map((el) => el.dataset.label).join(', ');
}

function renderDropdownMulti(id, claseChk, opciones, placeholder, seleccionados) {
  const marcados = seleccionados || [];
  const panel = opciones.map(([value, label]) => `
    <label class="dropdown-multi-option">
      <input type="checkbox" class="${claseChk}" value="${esc(value)}" data-label="${esc(label)}" ${marcados.includes(value) ? 'checked' : ''}> ${esc(label)}
    </label>`).join('');
  const etiquetasMarcadas = opciones.filter(([value]) => marcados.includes(value)).map(([, label]) => label);
  const labelInicial = etiquetasMarcadas.length ? etiquetasMarcadas.join(', ') : placeholder;
  return `
    <div class="dropdown-multi" id="${id}">
      <button type="button" class="input dropdown-multi-btn" data-action="dropdown-toggle" data-id="${id}">
        <span class="dropdown-multi-btn-label" data-placeholder="${esc(placeholder)}">${esc(labelInicial)}</span>
        <i class="ph ph-caret-down"></i>
      </button>
      <div class="dropdown-multi-panel" hidden>${panel}</div>
    </div>`;
}

function renderAudienciaSelect(id, audiencias, seleccionado) {
  const opts = audiencias.map((a) => `<option value="${esc(a.codigo)}" ${a.codigo === seleccionado ? 'selected' : ''}>${esc(a.nombre)} (${esc(a.codigo)})</option>`).join('');
  return `<select class="input" id="${id}"><option value="">— elegir —</option>${opts}<option value="Otra" ${seleccionado === 'Otra' ? 'selected' : ''}>Otra (audiencia no guardada)</option></select>`;
}

function renderRefuerzoDropdown(prefix, audiencias, seleccionados) {
  const opciones = audiencias.map((a) => [a.codigo, a.nombre]).concat([['Otra', 'Otra (audiencia no guardada)']]);
  return renderDropdownMulti(`${prefix}-refuerzo-dd`, `${prefix}-refuerzo-chk`, opciones, '— opcional, uno o más —', seleccionados);
}

// Red y Placement se muestran como checkboxes sueltos, no como el
// dropdown-multi de Objetivo/Refuerzo — son 2-3 opciones nomás, y el estado
// "deshabilitado" de Reels tiene que verse a simple vista, no quedar
// escondido adentro de un desplegable cerrado.
// Nunca puede quedar sin ninguna red elegida (el pedido no sabría dónde
// publicar) — cuando queda una sola tildada, esa se bloquea para que no se
// pueda destildar también.
function renderRedesCheckboxes(seleccionadas, bloqueadoPorPost, claseChk) {
  const clase = claseChk || 'pd-red-chk';
  const opciones = [['facebook', 'Facebook'], ['instagram', 'Instagram']];
  const soloQuedaUna = !bloqueadoPorPost && seleccionadas.length === 1;
  const filas = opciones.map(([val, label]) => {
    const bloqueado = bloqueadoPorPost || (soloQuedaUna && seleccionadas.includes(val));
    return `
    <label style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;font-size:13px;${bloqueado ? 'opacity:.7' : ''}">
      <input type="checkbox" class="${clase}" value="${val}" ${seleccionadas.includes(val) ? 'checked' : ''} ${bloqueado ? 'disabled' : ''}>
      ${esc(label)}
    </label>`;
  }).join('');
  return filas;
}

// Qué Placements tienen sentido para el Formato elegido — Feed siempre;
// Stories siempre (la proporción 9:16 se pide por Placement, no por
// Formato — ver DIMENSIONES_POR_PLACEMENT; si no coincide, se puede cargar
// un material específico para Stories en vez de bloquear); Reels solo si
// el Formato es video (y el material que ya se subió, si se sabe, no
// resultó ser una imagen — la proporción 9:16 de Reels se valida al subir/
// confirmar, no acá). Mismo criterio que placementDisponible() en
// metaAdapterReal.js — el servidor vuelve a chequearlo, esto es nomás para
// no ofrecer algo que ya se sabe que va a rebotar.
function placementDisponibleUI(formatoInfo, placement, materialEsImagen) {
  if (placement === 'feed') return true;
  if (!formatoInfo || formatoInfo.modo === 'carrusel') return false;
  if (placement === 'stories') return true;
  if (placement === 'reels') return formatoInfo.modo === 'video' && !materialEsImagen;
  return false;
}

// Todos los placements habilitados para el Formato — se usan para
// preseleccionar (el usuario después puede destildar los que no quiera).
function placementsDisponibles(formatoInfo, materialEsImagen) {
  return ['feed', 'stories', 'reels'].filter((p) => placementDisponibleUI(formatoInfo, p, materialEsImagen));
}

// Proporción recomendada por Placement — reemplaza la vieja idea de que la
// proporción vivía en el Formato. Debe coincidir con TOLERANCIA_PROPORCION/
// coincideProporcion() en metaMedia.js (servidor) para que un warning acá
// no contradiga lo que el servidor termina aceptando o rechazando.
const TOLERANCIA_PROPORCION_UI = 0.12;
const DIMENSIONES_POR_PLACEMENT = {
  feed: null,
  stories: { aspecto: '9:16', label: '9:16 (vertical)' },
  reels: { aspecto: '9:16', label: '9:16 (vertical)' },
};

function coincideProporcionUI(width, height, aspecto) {
  if (!width || !height || !aspecto) return null;
  const [aw, ah] = String(aspecto).split(':').map(Number);
  if (!aw || !ah) return null;
  return Math.abs((width / height) - (aw / ah)) <= TOLERANCIA_PROPORCION_UI;
}

// De los placements elegidos (o el default si no se tildó ninguno), la
// dimensión recomendada más exigente — hoy Stories y Reels piden lo mismo
// (9:16), así que alcanza con la primera que pida algo.
function dimensionRecomendada(placements) {
  return placements.map((p) => DIMENSIONES_POR_PLACEMENT[p]).find(Boolean) || null;
}

function renderPlacementsCheckboxes(seleccionados, formatoInfo, materialEsImagen, bloqueadoEnFeed, claseChk) {
  const clase = claseChk || 'pd-placement-chk';
  const opciones = [['feed', 'Feed'], ['stories', 'Stories'], ['reels', 'Reels']];
  const filas = opciones.map(([val, label]) => {
    const off = bloqueadoEnFeed ? val !== 'feed' : !placementDisponibleUI(formatoInfo, val, materialEsImagen);
    const bloqueado = bloqueadoEnFeed || off;
    const titulo = bloqueadoEnFeed
      ? (val === 'feed' ? 'title="La publicación elegida define el placement — no se puede cambiar."' : 'title="No disponible para publicar contenido existente."')
      : (off ? 'title="No disponible para este Formato"' : '');
    return `
    <label style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;font-size:13px;${off ? 'opacity:.5' : ''}" ${titulo}>
      <input type="checkbox" class="${clase}" value="${val}" ${seleccionados.includes(val) ? 'checked' : ''} ${bloqueado ? 'disabled' : ''}>
      ${esc(label)}
    </label>`;
  }).join('');
  return filas;
}

function leerCheckboxes(claseCss) {
  return Array.from(document.querySelectorAll(`.${claseCss}:checked`)).map((el) => el.value);
}

function cerrarTodosLosDropdownsMulti(exceptoId) {
  // Si el que se cierra era de una fila de CSV (Objetivo/Red/Placement),
  // recién ACÁ se revalida esa fila — mientras el panel seguía abierto no,
  // porque validar implica re-renderizar la tarjeta entera y eso cerraría
  // el desplegable de golpe en cada tilde.
  const idxsARevalidar = new Set();
  document.querySelectorAll('.dropdown-multi').forEach((d) => {
    if (d.id !== exceptoId) {
      const panel = d.querySelector('.dropdown-multi-panel');
      if (!panel.hidden) {
        const m = d.id.match(/^csv(\d+)-(?:objetivo|redes|placements)-dd$/);
        if (m) idxsARevalidar.add(Number(m[1]));
      }
      panel.hidden = true;
    }
  });
  if (idxsARevalidar.size) validarFilasCsv(Array.from(idxsARevalidar));
}

// ---------- Pestaña "Pedido de Pauta" (PM / Cuentas) ----------
// Formulario de carga individual real de AppSheet (ver AppSheet/Documentación
// Appsheet.md) — de los ~30 campos reales tomamos los de importancia Alta
// que ya tienen columna en cola_pautas (ver services/pedidos.js). El Activo
// queda fijo en Tres Empanadas por ahora (pedido del usuario, "hasta la
// reunión con Toni") — el Proyecto sí varía, para poder probar el modelo de
// permisos por proyecto.

const DURACIONES_DIAS = [1, 3, 5, 7, 10, 15, 30];

// Presupuesto siempre en tramos fijos — para más que $400.000 la pauta se
// hace manual (no hay tramo para eso, a propósito).
//
// El primer tramo se llama "Mínimo" porque Meta exige un piso por conjunto
// de anuncios. Ese piso NO es fijo: es `min_daily_budget × días de duración`
// (verificado contra la API real con validate_only — 1d: $1.503,47, 7d:
// $10.524,29, 14d: $21.048,58). Eso explica los distintos "mínimos" que
// fueron apareciendo en las pruebas: cambiaba la duración, no el piso.
//
// Por eso $20.000 acá es solo un tramo cómodo de arranque, NO una garantía:
// el aviso real, calculado con el mínimo vivo de la cuenta y la duración de
// cada pieza, se muestra en Validación de Anuncios (ver avisoMinimo()).
// Ojo: el mínimo aplica por CONJUNTO, así que una matriz de N celdas
// necesita N × ese mínimo.
const PRESUPUESTO_MINIMO = 20000;
const PRESUPUESTO_TIERS = [PRESUPUESTO_MINIMO, 25000, 50000, 75000, 100000, 150000, 200000, 250000, 300000, 400000];

function labelPresupuesto(v) {
  return v === PRESUPUESTO_MINIMO ? `Mínimo (${fmtMoney(v)})` : fmtMoney(v);
}

function sumarDiasLocal(fechaYMD, dias) {
  const d = new Date(`${fechaYMD}T00:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function finDeMesLocal(fechaYMD) {
  const d = new Date(`${fechaYMD}T00:00:00`);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

// Misma fórmula que usa AppSheet para "Contenido": Campana + (Linea si hay)
// + " (Formato)" — ver AppSheet/Campos Appsheet.xlsx, fila "Contenido".
function calcularContenido(campana, linea, formato) {
  if (!campana) return '';
  return `${campana}${linea ? ` "${linea}"` : ''}${formato ? ` (${formato})` : ''}`;
}

// Ya no antepone "Contenido:" al valor — ahora vive en un campo propio con
// su propia etiqueta ("Contenido"), repetirlo ahí adentro quedaba redundante
// (mismo criterio que ya se aplicó al desplegable de Formato).
function actualizarPreviewContenido(elId, campana, linea, formato) {
  const el = document.getElementById(elId);
  const contenido = calcularContenido(campana, linea, formato);
  el.innerHTML = contenido ? `<code>${esc(contenido)}</code>` : '<span style="color:var(--color-neutral-400)">Escribí la Campaña para previsualizarlo.</span>';
}

async function cargarDatosPedido() {
  const [rProy, rEjes, rTipos, rFormatos, rObjetivos, rAud, rLim] = await Promise.all([
    apiFetch('/api/proyectos'),
    apiFetch('/api/ejes'),
    apiFetch('/api/tipos'),
    apiFetch('/api/formatos'),
    apiFetch('/api/objetivos'),
    apiFetch('/api/audiencias?activo_key=test--tres-empanadas'),
    apiFetch('/api/limites'),
  ]);
  state.limites = rLim.ok ? await rLim.json() : { minDiario: 0, moneda: '' };
  state.pdProyectos = await rProy.json();
  // El Proyecto ya se eligió en el onboarding (pantalla 2) — el desplegable
  // queda fijo a ese, salvo que el Admin haya elegido "Ver todos los
  // proyectos" (proyectoActivo === 'TODOS'), donde sigue siendo libre.
  state.proyectosDisponiblesBloqueado = state.proyectoActivo !== 'TODOS';
  if (state.proyectosDisponiblesBloqueado && state.proyectoActivo) {
    state.pdProyectos = [state.proyectoActivo];
  }
  state.pdEjes = await rEjes.json();
  state.pdTipos = await rTipos.json();
  state.pdFormatos = await rFormatos.json();
  state.pdObjetivos = ordenarObjetivos(await rObjetivos.json());
  state.pdAudiencias = await rAud.json();
  // Proyecto/Activo compartidos, usados por el modo CSV — el resto de la
  // pantalla (los módulos) usa su propio pd2Proyecto/pd2ActivoKey.
  if (!state.pdProyecto || !state.pdProyectos.includes(state.pdProyecto)) {
    state.pdProyecto = state.pdProyectos[0] || null;
  }
  if (state.pdProyecto) await cargarActivosPedido();
}

async function cargarCampanasSugeridas(proyecto) {
  const r = await apiFetch(`/api/campanas?proyecto=${encodeURIComponent(proyecto)}`);
  return r.ok ? await r.json() : [];
}

// El desplegable de Activo muestra TODOS los activos reales del proyecto
// (pedido del usuario: "tienen que aparecer todos") — es un campo de
// referencia/registro (queda en "activo_solicitado"). La ejecución real
// (audiencias, publicaciones, y más adelante Meta) sigue siempre contra
// Tres Empanadas, el único activo con credenciales de verdad hoy.
async function cargarActivosPedido() {
  const r = await apiFetch(`/api/activos?proyecto=${encodeURIComponent(state.pdProyecto)}`);
  state.pdActivos = r.ok ? await r.json() : [];
  const activoTest = state.pdActivos.find((a) => a.activo_key === 'test--tres-empanadas');
  state.pdActivoKey = (activoTest || state.pdActivos[0] || {}).activo_key || null;
}

// ---------- "Agregar Activos / Audiencias" ----------

async function cargarDatosAdmin() {
  const r = await apiFetch('/api/activos');
  state.admActivos = r.ok ? await r.json() : [];
  state.admActivosCargados = true;
  if (!state.admAudActivoKey && state.admActivos.length) state.admAudActivoKey = state.admActivos[0].activo_key;
  if (state.admAudActivoKey) await cargarAudienciasDeActivo(state.admAudActivoKey);
  renderTabAdmin();
}

async function cargarAudienciasDeActivo(activoKey) {
  const r = await apiFetch(`/api/audiencias?activo_key=${encodeURIComponent(activoKey)}`);
  state.admAudienciasPorActivo[activoKey] = r.ok ? await r.json() : [];
}

function renderTabAdmin() {
  const proyectos = [...new Set(state.admActivos.map((a) => a.proyecto))].sort();
  // Solo proyectos existentes: el activo se cuelga de uno que ya está.
  const selProyecto = document.getElementById('adm-activo-proyecto');
  const proyectoElegido = selProyecto.value;
  selProyecto.innerHTML = proyectos.length
    ? proyectos.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('')
    : '<option value="">— no hay proyectos cargados —</option>';
  if (proyectoElegido && proyectos.includes(proyectoElegido)) selProyecto.value = proyectoElegido;

  document.getElementById('adm-activo-error').hidden = !state.admActivoError;
  document.getElementById('adm-activo-error').textContent = state.admActivoError || '';
  document.getElementById('adm-activo-exito').hidden = !state.admActivoExito;
  if (state.admActivoExito) document.getElementById('adm-activo-exito').textContent = state.admActivoExito;
  document.getElementById('adm-activos-lista').innerHTML = state.admActivos.length
    ? `${state.admActivos.length} activo(s) ya cargados: ` + state.admActivos.map((a) => `<code>${esc(a.activo_key)}</code>`).join(', ')
    : 'Todavía no hay ningún activo cargado.';

  const selActivo = document.getElementById('adm-aud-activo');
  selActivo.innerHTML = state.admActivos.map((a) => `<option value="${esc(a.activo_key)}" ${a.activo_key === state.admAudActivoKey ? 'selected' : ''}>${esc(a.proyecto)} — ${esc(a.activo)}</option>`).join('');

  document.getElementById('adm-aud-error').hidden = !state.admAudError;
  document.getElementById('adm-aud-error').textContent = state.admAudError || '';
  document.getElementById('adm-aud-exito').hidden = !state.admAudExito;
  if (state.admAudExito) document.getElementById('adm-aud-exito').textContent = state.admAudExito;

  const audiencias = state.admAudActivoKey ? (state.admAudienciasPorActivo[state.admAudActivoKey] || []) : [];
  document.getElementById('adm-audiencias-lista').innerHTML = `
    <div style="font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:var(--color-neutral-500);margin-bottom:6px">Audiencias de este activo (${audiencias.length})</div>
    ${audiencias.length
      ? audiencias.map((a) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--color-divider);font-size:13px"><span>${esc(a.nombre)}</span><code style="color:var(--color-neutral-500)">${esc(a.codigo)}</code></div>`).join('')
      : '<div style="font-size:13px;color:var(--color-neutral-500)">Ninguna todavía — con 2 o más, el Pedido de Pauta arma matriz.</div>'}`;
}

async function crearActivoAdmin() {
  state.admActivoError = null;
  state.admActivoExito = null;
  const body = {
    proyecto: document.getElementById('adm-activo-proyecto').value.trim(),
    activo: document.getElementById('adm-activo-nombre').value.trim(),
    adAccountId: document.getElementById('adm-activo-cuenta').value.trim(),
    pageId: document.getElementById('adm-activo-page').value.trim(),
    igActorId: document.getElementById('adm-activo-ig').value.trim(),
    provincia: document.getElementById('adm-activo-provincia').value.trim(),
    duracionDias: document.getElementById('adm-activo-duracion').value,
    categoria: document.getElementById('adm-activo-categoria').value,
  };
  try {
    const r = await apiFetch('/api/activos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error);
    state.admActivoExito = `Activo creado — clave "${data.activo_key}".`;
    document.getElementById('adm-activo-nombre').value = '';
    document.getElementById('adm-activo-cuenta').value = '';
    document.getElementById('adm-activo-page').value = '';
    document.getElementById('adm-activo-ig').value = '';
    document.getElementById('adm-activo-provincia').value = '';
    state.admAudActivoKey = data.activo_key;
    const r2 = await apiFetch('/api/activos');
    state.admActivos = r2.ok ? await r2.json() : state.admActivos;
    renderTabAdmin();
  } catch (err) {
    state.admActivoError = err.message;
    renderTabAdmin();
  }
}

async function crearAudienciaAdmin() {
  state.admAudError = null;
  state.admAudExito = null;
  const body = {
    activoKey: document.getElementById('adm-aud-activo').value,
    codigo: document.getElementById('adm-aud-codigo').value.trim(),
    nombre: document.getElementById('adm-aud-nombre').value.trim(),
    tamano: document.getElementById('adm-aud-tamano').value,
    savedAudienceId: document.getElementById('adm-aud-saved-id').value.trim(),
  };
  try {
    const r = await apiFetch('/api/audiencias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error);
    state.admAudExito = `Audiencia "${data.nombre}" creada.`;
    document.getElementById('adm-aud-codigo').value = '';
    document.getElementById('adm-aud-nombre').value = '';
    document.getElementById('adm-aud-saved-id').value = '';
    await cargarAudienciasDeActivo(body.activoKey);
    renderTabAdmin();
  } catch (err) {
    state.admAudError = err.message;
    renderTabAdmin();
  }
}

// ---------- Chequeo del mínimo de Meta antes de crear nada ----------

// Días que va a correr el conjunto, con la misma regla que el servidor:
// arranca 00:00 del inicio y termina 23:59 del fin, así que el día de fin
// cuenta entero. Sin fecha de fin, el default del activo son 7 días.
function diasDeLaPieza(fechaInicio, fechaFin) {
  // Igual que el servidor: si el inicio ya pasó, se cuenta desde hoy.
  const hoy = new Date().toISOString().slice(0, 10);
  const inicio = fechaInicio && fechaInicio > hoy ? fechaInicio : hoy;
  if (fechaFin) {
    const dias = Math.round((new Date(`${fechaFin}T00:00:00-0300`) - new Date(`${inicio}T00:00:00-0300`)) / 86400000);
    if (dias >= 0) return dias + 1;
  }
  return 8; // 7 días de default + el día de fin
}

// Cuántos conjuntos de anuncios va a crear esta pieza: uno por cada
// objetivo × audiencia NO manual (las audiencias "Otra" no se publican).
function conjuntosDeLaPieza(objetivos, audienciaCodigo, refuerzos) {
  const auds = [audienciaCodigo, ...(refuerzos || [])]
    .filter(Boolean)
    .filter((a, i, arr) => arr.indexOf(a) === i)
    .filter((a) => a.toLowerCase() !== 'otra');
  return (objetivos.length || 0) * auds.length;
}

// Meta rechaza el conjunto si no supera minDiario × días, y el mínimo es POR
// CONJUNTO. Devuelve null si está todo bien o si no sabemos el mínimo.
function faltaPresupuesto(presupuesto, objetivos, audienciaCodigo, refuerzos, fechaInicio, fechaFin) {
  const minDiario = state.limites && state.limites.minDiario;
  if (!minDiario) return null;

  const conjuntos = conjuntosDeLaPieza(objetivos, audienciaCodigo, refuerzos);
  if (!conjuntos) return null;

  const dias = diasDeLaPieza(fechaInicio, fechaFin);
  const minPorConjunto = minDiario * dias;
  const minTotal = minPorConjunto * conjuntos;
  if (Number(presupuesto) >= minTotal) return null;

  return { conjuntos, dias, minPorConjunto, minTotal, presupuesto: Number(presupuesto) || 0 };
}

function fmtPeso(bytes) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? mb.toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
}


// ---------- Distribuir presupuesto en "Crear Anuncios" ----------

// En "Pedido de Pauta" el reparto no va: lo hace el implementador en
// Validación. Acá no hay Validación (se publica derecho), así que si la
// pieza genera más de un conjunto hace falta poder repartir antes de crear
// — independiente de si ya se verificó el material o no.

function claveCelda(objetivo, audCodigo) { return objetivo + "||" + audCodigo; }

// Misma regla que el servidor (services/colaPautas.js): parejo con dos
// decimales y el resto a la última, para que dé 100 exacto y no 99,99.
function repartoGrupoParejo(mapa, combos, pctTotal) {
  const n = combos.length;
  if (!n) return;
  const pctBase = Math.floor((pctTotal / n) * 100) / 100;
  combos.forEach((c) => { mapa[claveCelda(c.objetivo, c.audCodigo)] = pctBase; });
  const ultima = combos[n - 1];
  mapa[claveCelda(ultima.objetivo, ultima.audCodigo)] = +(pctTotal - pctBase * (n - 1)).toFixed(2);
}

// Con 2+ audiencias, la Principal arranca con el 70% del presupuesto
// (repartido parejo entre sus objetivos habilitados) y el 30% restante se
// reparte parejo entre los refuerzos — misma regla que el servidor
// (services/colaPautas.js). Con una sola audiencia, parejo entre todo.
function repartoParejo(combos) {
  const mapa = {};
  if (!combos.length) return mapa;
  const principales = combos.filter((c) => c.principal);
  const refuerzos = combos.filter((c) => !c.principal);
  if (principales.length && refuerzos.length) {
    repartoGrupoParejo(mapa, principales, 70);
    repartoGrupoParejo(mapa, refuerzos, 30);
  } else {
    repartoGrupoParejo(mapa, combos, 100);
  }
  return mapa;
}

// Identifica la "forma" de la pieza (qué combos tiene). Si cambia — se
// agrega/saca un objetivo o una audiencia — el reparto anterior ya no
// aplica a las mismas celdas y se reinicia parejo; si no cambió, se
// respeta lo que la persona ya movió a mano en los sliders.
function clavesDeCombos(combos) {
  return combos.map((c) => claveCelda(c.objetivo, c.audCodigo)).sort().join("|");
}

// Una fila del panel: mismo patrón visual que renderCombo() en Validación
// (slider + monto + "Todo acá") para que sea la misma lógica en los dos
// lugares donde se reparte presupuesto. El checkbox de la izquierda saca
// esa combinación puntual de la pauta (ej: el refuerzo de audiencia solo
// va por un objetivo, no por todos) — no se crea el conjunto para eso.
function renderFilaReparto(c, clave, pct, monto, bajoMinimo, excluida, bloqueada) {
  return '<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;' + (excluida ? "opacity:.55;" : "") + 'border:1px solid ' + (bajoMinimo ? "var(--color-warning, #d08a1e)" : "var(--color-divider)") + ';border-radius:var(--radius-md)">'
    + '<input type="checkbox" ' + (excluida ? "" : "checked") + ' title="Incluir este conjunto de anuncios" data-action="pd-reparto-incluir" data-clave="' + esc(clave) + '" style="width:16px;height:16px;accent-color:var(--color-accent);flex:none">'
    + '<div style="min-width:170px;flex:none">'
    +   '<div style="font-family:var(--font-heading);font-size:14px">' + esc(c.objetivo) + "</div>"
    +   '<div class="row-ellip" style="font-size:12px;color:var(--color-neutral-500)">' + esc(c.audNombre) + (c.manual ? ' <span class="tag tag-outline" style="font-size:10px;vertical-align:middle">a mano</span>' : "") + (excluida ? ' <span class="tag tag-outline" style="font-size:10px;vertical-align:middle">no se crea</span>' : "") + (bloqueada ? ' <span class="tag tag-outline" style="font-size:10px;vertical-align:middle">bloqueado</span>' : "") + "</div>"
    + "</div>"
    + '<input type="range" min="0" max="100" value="' + pct + '" ' + (excluida || bloqueada ? "disabled" : "") + ' style="flex:1;accent-color:var(--color-accent)" data-action="pd-reparto-slider" data-clave="' + esc(clave) + '">'
    + '<div style="text-align:right;flex:none;min-width:86px">'
    +   '<div style="font-family:var(--font-heading);font-size:16px">' + pct + "%</div>"
    +   '<div style="font-size:12px;color:' + (bajoMinimo ? "var(--color-warning, #d08a1e)" : "var(--color-neutral-500)") + '">' + esc(fmtMoney(monto)) + "</div>"
    + "</div>"
    + '<button type="button" title="' + (bloqueada ? "Desbloquear — vuelve a moverse con el resto" : "Bloquear en " + pct + "% mientras se mueven los demás") + '" ' + (excluida ? "disabled" : "") + ' style="cursor:pointer;border:1px solid ' + (bloqueada ? "var(--color-accent-300)" : "var(--color-divider)") + ';background:' + (bloqueada ? "var(--color-accent-800, rgba(99,140,255,.12))" : "transparent") + ';color:' + (bloqueada ? "var(--color-accent-300)" : "var(--color-neutral-500)") + ';font-size:14px;width:30px;height:28px;border-radius:4px;flex:none" data-action="pd-reparto-bloquear" data-clave="' + esc(clave) + '"><i class="ph ph-' + (bloqueada ? "lock-simple" : "lock-simple-open") + '"></i></button>'
    + (excluida || bloqueada
      ? '<span style="width:78px;flex:none"></span>'
      : '<button type="button" style="cursor:pointer;border:1px solid var(--color-accent-700);background:transparent;color:var(--color-accent-300);font-size:11px;padding:5px 8px;border-radius:4px;flex:none" data-action="pd-reparto-todo-aca" data-clave="' + esc(clave) + '">Todo acá</button>')
    + "</div>";
}

// ————— Carga por CSV —————
// Para casos especiales: varias piezas juntas, cada una con su propio
// material (un link a SU Drive, no el mismo para todas). Reusa Proyecto/
// Activo del estado compartido (state.pdProyecto/pdActivoKey) — es el mismo
// concepto que ya usan Individual/Bulk, elegido una vez para todo el CSV.
// Cada fila del archivo pasa por la MISMA validación que crearPedido() usa
// para Individual (server: soloValidar) antes de poder crearse — no hay
// reglas de negocio nuevas acá, solo parseo + preview + reintento por fila.
// Eje, Tipo y Audiencia van por NOMBRE, no por código — es lo que alguien
// tiene a mano al llenar una planilla, no el código interno. Se resuelven
// contra state.pdEjes/state.pdTipos/state.pdAudiencias (ver
// armarPedidoDesdeCsv) antes de mandar nada al servidor; si el nombre no
// matchea nada real, es un error de esa fila — va a pasar seguido, hay que
// poder corregirlo fila por fila como cualquier otro error de validación.
// Tipo además acepta la forma corta ("Alta"/"Media"/"Baja"/"Army" en
// Informativo, "A"/"B"/"C" en Oficial) — ver resolverTipoPorNombre.
const CSV_COLUMNAS = ['campana', 'linea', 'eje', 'tipo', 'objetivo', 'formato', 'redes', 'placements', 'audiencia', 'otraAudiencia', 'refuerzoAudiencia', 'otrasRefuerzo', 'material', 'materialStories', 'copy', 'fechaInicio', 'fechaFin', 'linkDestino'];
// Separador para celdas con varios valores (Objetivo, Red, Placement):
// coma, no punto y coma — es lo que alguien escribe naturalmente en una
// planilla, y Google Sheets ya escapa esa celda entre comillas al
// exportar a CSV (así el parser de acá abajo no la confunde con el
// separador de columnas). Si se edita el CSV a mano en vez de generarlo
// desde Sheets, una celda así tiene que ir entre comillas: "Alcance,Interacción".
const CSV_MULTIVALOR = new Set(['objetivo', 'redes', 'placements', 'refuerzoAudiencia']);
const CSV_SEPARADOR_MULTIVALOR = ',';
// Campos que se muestran en la tarjeta compacta de cada fila — el resto
// (otraAudiencia/otrasRefuerzo/materialStories/refuerzoAudiencia) sigue
// viajando y validándose igual, solo no tiene su propio input acá: para
// tocarlos hay que volver a subir el CSV con esa columna cambiada.
const CSV_CAMPOS_VISIBLES = [
  ['campana', 'Campaña'], ['linea', 'Línea'], ['eje', 'Eje'], ['tipo', 'Tipo'],
  ['objetivo', 'Objetivo'], ['formato', 'Formato'], ['redes', 'Red'], ['placements', 'Placement'],
  ['audiencia', 'Audiencia'], ['material', 'Material'], ['copy', 'Copy'],
  ['fechaInicio', 'Fecha inicio'], ['fechaFin', 'Fecha fin'], ['linkDestino', 'Link destino'],
];

// Parser CSV chico (RFC4180-ish): comillas para campos con comas/saltos de
// línea, "" para escapar una comilla adentro de un campo entre comillas.
function parsearCSV(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let enComillas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i += 1; } else { enComillas = false; }
      } else campo += c;
    } else if (c === '"') {
      enComillas = true;
    } else if (c === ',') {
      fila.push(campo); campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i += 1;
      fila.push(campo); campo = '';
      if (fila.some((v) => v !== '')) filas.push(fila);
      fila = [];
    } else {
      campo += c;
    }
  }
  if (campo !== '' || fila.length) { fila.push(campo); if (fila.some((v) => v !== '')) filas.push(fila); }
  return filas;
}

function filaCsvACampos(valores, headers) {
  const campos = {};
  headers.forEach((h, i) => {
    const key = h.trim();
    if (!CSV_COLUMNAS.includes(key)) return;
    const v = (valores[i] || '').trim();
    campos[key] = CSV_MULTIVALOR.has(key) ? v.split(CSV_SEPARADOR_MULTIVALOR).map((s) => s.trim()).filter(Boolean) : v;
  });
  return campos;
}

// Eje y Audiencia llegan del CSV por nombre — se resuelven acá contra
// las listas reales (state.pdEjes/state.pdAudiencias, ya cargadas por
// cargarDatosPedido) ANTES de mandar nada al servidor. Un nombre que no
// matchea es un error de esa fila, tan válido como cualquier otro — va a
// pasar seguido (typos, mayúsculas, nombre viejo), y se corrige igual que
// el resto: a mano, en la tarjeta de la fila.
// "Alta"/"Media"/"Baja"/"Army" tienen que resolver contra las filas de
// Informativo ("Informativo - Alta", ..., "Pautas Army") y "A"/"B"/"C"
// contra las de Oficial (donde tipo_campana YA es literal "A"/"B"/"C") —
// exacto primero, y si no, la última palabra del nombre real (después de
// partir por espacio o guión) para no tener que hardcodear el prefijo de
// cada ecosistema acá.
function resolverTipoPorNombre(nombreCorto) {
  if (!nombreCorto) return null;
  const norm = nombreCorto.trim().toLowerCase();
  const tipos = state.pdTipos || [];
  const exacto = tipos.find((t) => (t.nombre || '').trim().toLowerCase() === norm);
  if (exacto) return exacto;
  return tipos.find((t) => {
    const tokens = (t.nombre || '').trim().toLowerCase().split(/[\s-]+/).filter(Boolean);
    return tokens[tokens.length - 1] === norm;
  }) || null;
}

function armarPedidoDesdeCsv(campos, proyecto, activoKey) {
  const errores = [];
  const ejeNombre = (campos.eje || '').trim();
  const ejeMatch = ejeNombre
    ? (state.pdEjes || []).find((e) => (e.eje || '').trim().toLowerCase() === ejeNombre.toLowerCase())
    : null;
  if (ejeNombre && !ejeMatch) errores.push(`Eje "${ejeNombre}" no encontrado.`);

  const tipoNombre = (campos.tipo || '').trim();
  const tipoMatch = resolverTipoPorNombre(tipoNombre);
  if (tipoNombre && !tipoMatch) errores.push(`Tipo "${tipoNombre}" no encontrado.`);

  const audNombre = (campos.audiencia || '').trim();
  const audMatch = audNombre
    ? (state.pdAudiencias || []).find((a) => (a.nombre || '').trim().toLowerCase() === audNombre.toLowerCase())
    : null;
  if (audNombre && !audMatch) errores.push(`Audiencia "${audNombre}" no encontrada.`);

  const redes = Array.isArray(campos.redes) ? campos.redes.map((r) => r.trim().toLowerCase()).filter(Boolean) : [];

  const datos = Object.assign({}, campos, {
    proyecto,
    activoKey,
    visibilidad: 'DARK',
    ejeCodigo: ejeMatch ? ejeMatch.codigo : '',
    tipoCodigo: tipoMatch ? tipoMatch.codigo : '',
    audienciaCodigo: audMatch ? audMatch.codigo : '',
    redes,
  });
  delete datos.eje;
  delete datos.tipo;
  delete datos.audiencia;
  return { datos, errores };
}

function descargarModeloCsv() {
  window.open('https://docs.google.com/spreadsheets/d/1ApwEvzldA0eyH_-wRuihFq4ulhTijlOkuTMfKN4wrdo/edit?gid=1283105071#gid=1283105071', '_blank', 'noopener');
}

function renderCsvSelectores() {
  const selP = document.getElementById('pd-csv-proyecto');
  selP.innerHTML = state.pdProyectos.map((p) => `<option value="${esc(p)}" ${p === state.pdProyecto ? 'selected' : ''}>${esc(p)}</option>`).join('');
  const selA = document.getElementById('pd-csv-activo');
  selA.innerHTML = state.pdActivos.map((a) => `<option value="${esc(a.activo_key)}" ${a.activo_key === state.pdActivoKey ? 'selected' : ''}>${esc(a.proyecto)} — ${esc(a.activo)}</option>`).join('');
}

async function cambiarProyectoCsv(valor) {
  state.pdProyecto = valor;
  await cargarActivosPedido();
  renderCsvSelectores();
}

async function subirCsv(file) {
  state.pdCsvErrorGeneral = null;
  let texto;
  try {
    texto = await file.text();
  } catch (err) {
    state.pdCsvErrorGeneral = 'No se pudo leer el archivo.';
    renderCsvUI();
    return;
  }
  const filas = parsearCSV(texto);
  if (filas.length < 2) {
    state.pdCsvErrorGeneral = 'El CSV tiene que tener una fila de encabezados y al menos una fila de datos.';
    state.pdCsvFilas = [];
    renderCsvUI();
    return;
  }
  const headers = filas[0].map((h) => h.trim());
  state.pdCsvFilas = filas.slice(1).map((valores) => ({ campos: filaCsvACampos(valores, headers), estado: 'validando', error: null }));
  renderCsvUI();
  await validarFilasCsv();
}

async function validarFilasCsv(indices) {
  const idxs = indices || state.pdCsvFilas.map((_, i) => i);
  if (!idxs.length) return;
  const proyecto = document.getElementById('pd-csv-proyecto').value;
  const activoKey = document.getElementById('pd-csv-activo').value;
  idxs.forEach((i) => { state.pdCsvFilas[i].estado = 'validando'; });
  renderCsvUI();

  // Resolver Eje/Audiencia por nombre ANTES de llamar al servidor — si el
  // nombre no matchea nada real, ya es un error claro acá, sin ni siquiera
  // gastar el viaje.
  const idxsAValidar = [];
  const filasAValidar = [];
  idxs.forEach((i) => {
    const { datos, errores } = armarPedidoDesdeCsv(state.pdCsvFilas[i].campos, proyecto, activoKey);
    if (errores.length) {
      state.pdCsvFilas[i].estado = 'error';
      state.pdCsvFilas[i].error = errores.join(' ');
    } else {
      idxsAValidar.push(i);
      filasAValidar.push(datos);
    }
  });
  if (!idxsAValidar.length) { renderCsvUI(); return; }

  try {
    const r = await apiFetch('/api/pedidos/validar-lote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filas: filasAValidar }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error || 'Error al validar');
    (data.resultados || []).forEach((res, j) => {
      const fila = state.pdCsvFilas[idxsAValidar[j]];
      if (!fila) return;
      fila.estado = res.ok ? 'ok' : 'error';
      fila.error = res.ok ? null : res.error;
    });
  } catch (err) {
    idxsAValidar.forEach((i) => {
      const fila = state.pdCsvFilas[i];
      if (fila) { fila.estado = 'error'; fila.error = 'No se pudo validar: ' + err.message; }
    });
  }
  renderCsvUI();
}

async function confirmarCargaCsv() {
  const idxsOk = state.pdCsvFilas.map((f, i) => (f.estado === 'ok' ? i : null)).filter((i) => i !== null);
  if (!idxsOk.length || state.pdCsvCreando) return;
  state.pdCsvCreando = true;
  state.pdCsvErrorGeneral = null;
  renderCsvUI();
  const proyecto = document.getElementById('pd-csv-proyecto').value;
  const activoKey = document.getElementById('pd-csv-activo').value;
  // Se vuelve a resolver Eje/Audiencia (no solo reusar lo ya validado) —
  // por si algo cambió justo entre el preview y este click.
  const idxsAEnviar = [];
  const filas = [];
  idxsOk.forEach((i) => {
    const { datos, errores } = armarPedidoDesdeCsv(state.pdCsvFilas[i].campos, proyecto, activoKey);
    if (errores.length) {
      state.pdCsvFilas[i].estado = 'error';
      state.pdCsvFilas[i].error = errores.join(' ');
    } else {
      idxsAEnviar.push(i);
      filas.push(datos);
    }
  });
  if (!filas.length) { state.pdCsvCreando = false; renderCsvUI(); return; }
  try {
    const r = await apiFetch('/api/pedidos/lote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filas }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error || 'Error al crear');
    (data.resultados || []).forEach((res, j) => {
      const fila = state.pdCsvFilas[idxsAEnviar[j]];
      if (!fila) return;
      if (res.ok) { fila.estado = 'creada'; fila.codigo = res.codigo; } else { fila.estado = 'error'; fila.error = res.error; }
    });
  } catch (err) {
    state.pdCsvErrorGeneral = 'No se pudo crear la carga: ' + err.message;
  }
  state.pdCsvCreando = false;
  renderCsvUI();
}

function renderCsvUI() {
  const wrapPreview = document.getElementById('pd-csv-preview');
  const errorEl = document.getElementById('pd-csv-error');
  errorEl.hidden = !state.pdCsvErrorGeneral;
  errorEl.textContent = state.pdCsvErrorGeneral || '';
  if (!wrapPreview) return;
  if (!state.pdCsvFilas || !state.pdCsvFilas.length) { wrapPreview.innerHTML = ''; return; }

  const total = state.pdCsvFilas.length;
  const ok = state.pdCsvFilas.filter((f) => f.estado === 'ok').length;
  const creadas = state.pdCsvFilas.filter((f) => f.estado === 'creada').length;
  const filasHtml = state.pdCsvFilas.map((fila, i) => renderFilaCsv(fila, i)).join('');

  wrapPreview.innerHTML = ''
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:12px;flex-wrap:wrap">'
    +   '<strong style="font-family:var(--font-heading);font-size:14px">' + total + ' pieza(s)'
    +     (creadas ? ' — ' + creadas + ' creada(s)' : '') + ' — ' + ok + ' lista(s) para crear</strong>'
    +   '<button type="button" class="btn btn-primary" data-action="pd-csv-confirmar" ' + (!ok || state.pdCsvCreando ? 'disabled' : '') + '>'
    +     (state.pdCsvCreando ? 'Creando…' : 'Confirmar carga (' + ok + ')') + '</button>'
    + '</div>'
    + '<div style="display:flex;flex-direction:column;gap:10px">' + filasHtml + '</div>';
}

// Campos que en el resto del formulario ya son un desplegable (o un grupo
// de checkboxes con opciones fijas) — en la tarjeta de corrección de una
// fila del CSV también lo son, en vez de un input de texto libre donde es
// fácil tipear algo que no matchea nada real. null = sigue siendo texto
// libre (Material, Copy, fechas, Link).
// tipo: 'select' (desplegable normal, un solo valor) o 'multi' (el mismo
// desplegable-con-checkboxes que ya usa Objetivo en el resto del
// formulario — NO un <select multiple> nativo, que se ve horrible: una
// lista siempre abierta en vez de un desplegable de verdad).
function opcionesCsvPara(key) {
  if (key === 'eje') return { tipo: 'select', opciones: (state.pdEjes || []).map((e) => [e.eje, e.eje]) };
  if (key === 'tipo') return { tipo: 'select', opciones: (state.pdTipos || []).map((t) => [t.nombre, t.nombre]) };
  if (key === 'audiencia') return { tipo: 'select', opciones: (state.pdAudiencias || []).map((a) => [a.nombre, a.nombre]) };
  if (key === 'formato') return { tipo: 'select', opciones: (state.pdFormatos || []).map((f) => [f.appsheet_valor, f.appsheet_valor]) };
  if (key === 'objetivo') return { tipo: 'multi', opciones: (state.pdObjetivos || []).map((o) => [o, o]) };
  if (key === 'redes') return { tipo: 'multi', opciones: [['Facebook', 'Facebook'], ['Instagram', 'Instagram']] };
  if (key === 'placements') return { tipo: 'multi', opciones: [['feed', 'Feed'], ['stories', 'Stories'], ['reels', 'Reels']] };
  return null;
}

function renderFilaCsv(fila, i) {
  const c = fila.campos;
  const soloLectura = fila.estado === 'creada';
  const badge = fila.estado === 'ok'
    ? '<span class="tag" style="color:var(--color-accent-2-600)">Lista</span>'
    : fila.estado === 'creada'
      ? '<span class="tag" style="color:var(--color-accent-2-600)">Creada' + (c && fila.codigo ? ' — ' + esc(fila.codigo) : '') + '</span>'
      : fila.estado === 'validando'
        ? '<span class="tag">Validando…</span>'
        : '<span class="tag" style="color:var(--color-warning, #d08a1e)">Error</span>';
  const campoHtml = ([key, label]) => {
    const opciones = opcionesCsvPara(key);
    if (opciones && opciones.tipo === 'multi') {
      const seleccionados = Array.isArray(c[key]) ? c[key] : [];
      const ddId = 'csv' + i + '-' + key + '-dd';
      const chkClass = 'csv' + i + '-' + key + '-chk';
      return '<div class="field"><label style="font-size:10px">' + esc(label) + '</label>'
        + renderDropdownMulti(ddId, chkClass, opciones.opciones, '— elegir —', seleccionados) + '</div>';
    }
    if (opciones) {
      const valorActual = c[key];
      const seleccionado = Array.isArray(valorActual) ? valorActual[0] : (valorActual || '');
      const optsHtml = '<option value="">— elegir —</option>'
        + opciones.opciones.map(([val, lbl]) => '<option value="' + esc(val) + '" ' + (val === seleccionado ? 'selected' : '') + '>' + esc(lbl) + '</option>').join('');
      return '<div class="field"><label style="font-size:10px">' + esc(label) + '</label>'
        + '<select class="input" style="font-size:12px;min-height:28px;padding:2px 6px" ' + (soloLectura ? 'disabled' : '')
        + ' data-csv-index="' + i + '" data-csv-campo="' + key + '">' + optsHtml + '</select></div>';
    }
    const valor = Array.isArray(c[key]) ? c[key].join(CSV_SEPARADOR_MULTIVALOR) : (c[key] || '');
    return '<div class="field"><label style="font-size:10px">' + esc(label) + '</label>'
      + '<input class="input" style="font-size:12px;min-height:28px;padding:4px 8px" ' + (soloLectura ? 'disabled' : '')
      + ' data-csv-index="' + i + '" data-csv-campo="' + key + '" value="' + esc(valor) + '"></div>';
  };
  return '<div style="border:1px solid ' + (fila.estado === 'error' ? 'var(--color-warning, #d08a1e)' : 'var(--color-divider)') + ';border-radius:var(--radius-md);padding:10px 12px' + (soloLectura ? ';opacity:.65' : '') + '">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
    +   '<span style="font-family:var(--font-heading);font-size:13px">Fila ' + (i + 1) + (c.campana ? ' — ' + esc(c.campana) : '') + '</span>'
    +   badge
    + '</div>'
    + (fila.error ? '<div style="font-size:12px;color:var(--color-warning, #d08a1e);margin-bottom:8px">' + esc(fila.error) + '</div>' : '')
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px">' + CSV_CAMPOS_VISIBLES.map(campoHtml).join('') + '</div>'
    + '</div>';
}

// ————— "Pedido de Pauta v2" — prueba de layout por módulos —————
// Mismo pedido de siempre (mismo /api/pedidos, mismas reglas del
// servidor), solo cambia CÓMO se completa: 4 módulos que se confirman de
// a uno, en vez de un formulario largo de una sola pantalla. Reusa las
// listas ya cargadas por cargarDatosPedido (pdProyectos/pdEjes/pdTipos/
// pdFormatos/pdObjetivos/pdAudiencias) y los mismos componentes de
// desplegable (renderDropdownMulti/renderAudienciaSelect/
// renderRefuerzoDropdown/renderPlacementsCheckboxes) — solo lo que el
// usuario va completando vive en su propio estado (pd2*), aparte del pd*
// de siempre, para que las dos pestañas no se pisen entre sí.
// Alcance: 1 a 10 piezas con la misma tarjeta (Módulo 4, "Cantidad de
// piezas") — no hay un modo "individual" separado, 1 pieza es el caso
// default. Sin Carrusel ni Material de Stories (eso sigue siendo del
// Pedido de Pauta clásico; acá es una prueba de layout, no un reemplazo).

async function cambiarProyectoPd2(valor) {
  state.pd2Proyecto = valor;
  const [rActivos, campanas] = await Promise.all([
    apiFetch(`/api/activos?proyecto=${encodeURIComponent(valor)}`),
    cargarCampanasSugeridas(valor),
  ]);
  state.pdActivos = rActivos.ok ? await rActivos.json() : [];
  state.pd2CampanasSugeridas = campanas;
  const activoTest = state.pdActivos.find((a) => a.activo_key === 'test--tres-empanadas');
  state.pd2ActivoKey = (activoTest || state.pdActivos[0] || {}).activo_key || null;
  renderTabPedido2();
}

// Publicaciones recientes del activo — usadas por el selector "Elegir
// publicación" de cada pieza (ver renderSelectorPostsBulkV2), una sola
// carga compartida por todas las piezas de la tanda.
async function cargarPostsPedidoV2() {
  state.pd2CargandoPosts = true;
  const r = await apiFetch('/api/publicaciones?activo_key=test--tres-empanadas');
  state.pd2Posts = r.ok ? await r.json() : [];
  state.pd2CargandoPosts = false;
}

// Preview de los cruces Objetivo×Audiencia que va a generar el pedido —
// pedido del usuario: "antes de mandar a pedir el anuncio el PM/Cuentas
// puede desactivar un cruce". Se arma con lo que hay tildado AHORA en el
// DOM (Objetivo del Módulo 1 no vive sincronizado en state, ver el
// comentario de más arriba) — no con state.pd2Objetivo, que está desfasado.
// Lo que se destilda acá queda en pd2CombosExcluidos y viaja con el pedido:
// ese cruce nunca se crea, ni el implementador lo ve después en Validación
// (ver getMatrizParaPauta en colaPautas.js).
function renderCrucesV2() {
  const wrap = document.getElementById('pd2-cruces-wrap');
  if (!wrap) return;
  const objetivos = leerCheckboxes('pd2-objetivo-chk');
  const audienciaEl = document.getElementById('pd2-audiencia');
  const principal = audienciaEl ? audienciaEl.value : '';
  const refuerzo = leerCheckboxes('pd2-refuerzo-chk');
  const codigos = [principal, ...refuerzo].filter(Boolean);
  const audienciasUnicas = codigos.filter((c, i) => codigos.indexOf(c) === i);

  if (objetivos.length * audienciasUnicas.length <= 1) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    return;
  }
  const nombreAud = (cod) => {
    if (cod === 'Otra') return 'Otra';
    const a = (state.pdAudiencias || []).find((x) => x.codigo === cod);
    return a ? a.nombre : cod;
  };
  const celda = (obj, cod) => {
    const clave = obj + '|' + cod;
    const excluido = !!state.pd2CombosExcluidos[clave];
    return '<td style="text-align:center;padding:6px 10px;border:1px solid var(--color-divider)' + (excluido ? ';opacity:.4' : '') + '">'
      + '<input type="checkbox" ' + (excluido ? '' : 'checked') + ' data-action="pd2-toggle-cruce" data-clave="' + esc(clave) + '" style="width:14px;height:14px;accent-color:var(--color-accent)">'
      + '</td>';
  };
  const cabecera = '<th style="padding:6px 10px;border:1px solid var(--color-divider)"></th>'
    + audienciasUnicas.map((cod) => '<th style="padding:6px 10px;border:1px solid var(--color-divider);font-size:12px;font-weight:400;color:var(--color-neutral-400)">' + esc(nombreAud(cod)) + '</th>').join('');
  const filas = objetivos.map((obj) => '<tr>'
    + '<th style="padding:6px 10px;border:1px solid var(--color-divider);font-size:12px;font-weight:400;color:var(--color-neutral-400);text-align:left;white-space:nowrap">' + esc(obj) + '</th>'
    + audienciasUnicas.map((cod) => celda(obj, cod)).join('')
    + '</tr>').join('');
  wrap.hidden = false;
  wrap.innerHTML = '<div class="field" style="margin-top:12px">'
    + '<label>Se van a crear estos cruces <span style="font-weight:400;color:var(--color-neutral-500)">(destildá para no crear alguno)</span></label>'
    + '<div style="overflow-x:auto"><table style="border-collapse:collapse;font-family:var(--font-heading)">'
    + '<thead><tr>' + cabecera + '</tr></thead><tbody>' + filas + '</tbody>'
    + '</table></div>'
    + '</div>';
}

function renderTabPedido2() {
  document.getElementById('pd2-titulo').textContent = state.pd2ModoDirecto ? 'Crear Anuncio' : 'Pedido de Anuncios';
  document.getElementById('pd2-card-anuncios-titulo').textContent = state.pd2ModoDirecto ? 'Crear Anuncios' : 'Pedido de Anuncios';
  document.getElementById('pd2-modo-carga-anuncios-label').textContent = state.pd2ModoDirecto ? 'Crear Anuncios' : 'Pedido de Anuncios';

  if (!state.pd2Proyecto) state.pd2Proyecto = state.pdProyecto || state.pdProyectos[0] || null;
  if (!state.pd2ActivoKey) {
    const activoTest = state.pdActivos.find((a) => a.activo_key === 'test--tres-empanadas');
    state.pd2ActivoKey = (activoTest || state.pdActivos[0] || {}).activo_key || null;
  }
  if (!state.pd2EjeCodigo && state.pdEjes.length) state.pd2EjeCodigo = null;
  if (!state.pdTipos.find((t) => t.codigo === state.pd2TipoCodigo)) state.pd2TipoCodigo = (state.pdTipos[0] || {}).codigo || null;

  const notaActivoEl = document.getElementById('pd2-activo-nota');
  notaActivoEl.textContent = state.pd2ActivoKey === 'test--tres-empanadas'
    ? ''
    : 'Se ejecuta sobre Tres Empanadas (sandbox) — este activo queda de registro.';
  notaActivoEl.title = state.pd2ActivoKey === 'test--tres-empanadas'
    ? ''
    : 'Por ahora, toda pauta se ejecuta igual sobre Tres Empanadas (sandbox) — este activo queda de registro hasta que se habilite el resto.';

  // Fecha de inicio arranca en hoy — se completa una sola vez ("no se puede
  // editar en AppSheet tampoco"), después el campo queda libre.
  const inputInicio2 = document.getElementById('pd2-fecha-inicio');
  if (inputInicio2 && !inputInicio2.value) inputInicio2.value = new Date().toISOString().slice(0, 10);

  // Pantalla de elegir modo (Pedido de Anuncios/CSV) vs. los módulos vs. el
  // editor de CSV — tres pantallas mutuamente excluyentes.
  document.getElementById('pd2-modo-elegir').hidden = !!state.pd2ModoCarga;
  document.getElementById('pd2-modo-carga-wrap').hidden = !state.pd2ModoCarga;
  document.getElementById('pd-csv-wrap').hidden = state.pd2ModoCarga !== 'csv';
  document.getElementById('pd2-modulos-wrap').hidden = state.pd2ModoCarga !== 'anuncios';
  document.querySelectorAll('#pd2-modo-carga-wrap [data-action="pd2-modo-carga"]').forEach((b) => b.classList.toggle('active', b.dataset.id === state.pd2ModoCarga));
  renderResultadoFinalV2();
  if (state.pd2ModoCarga !== 'anuncios') return;

  document.getElementById('pd2-bulk-crear').hidden = !state.pd2BulkItems.length;
  document.getElementById('pd2-cantidad-piezas').value = String(state.pd2BulkItems.length || 1);

  const datalist = document.getElementById('pd-campana-lista');
  if (datalist) datalist.innerHTML = state.pd2CampanasSugeridas.map((c) => `<option value="${esc(c)}">`).join('');

  // Solo "Crear Anuncios": presupuesto por tramos fijos, elegido a mano —
  // Pedido de Pauta (PM) no lo ve, el servidor lo resuelve solo (Tipo ×
  // tamaño de Audiencia).
  const presupuestoDefaultPrevio = document.getElementById('pd2-presupuesto-default').value;
  document.getElementById('pd2-presupuesto-default-wrap').hidden = !state.pd2ModoDirecto;
  if (state.pd2ModoDirecto) {
    document.getElementById('pd2-presupuesto-default-label').textContent = 'Presupuesto';
    document.getElementById('pd2-presupuesto-default').innerHTML =
      PRESUPUESTO_TIERS.map((v) => `<option value="${v}" ${String(v) === presupuestoDefaultPrevio ? 'selected' : ''}>${labelPresupuesto(v)}</option>`).join('');
  }

  const selProy2 = document.getElementById('pd2-proyecto');
  selProy2.innerHTML = state.pdProyectos.map((p) => `<option value="${esc(p)}" ${p === state.pd2Proyecto ? 'selected' : ''}>${esc(p)}</option>`).join('');
  // Ya se eligió el Proyecto en el onboarding — acá queda fijo, mismo
  // criterio que "pd-proyecto" en v1 (ver proyectosDisponiblesBloqueado).
  selProy2.disabled = state.proyectosDisponiblesBloqueado;
  document.getElementById('pd2-activo').innerHTML = state.pdActivos.map((a) => `<option value="${esc(a.activo_key)}" ${a.activo_key === state.pd2ActivoKey ? 'selected' : ''}>${esc(a.proyecto)} — ${esc(a.activo)}</option>`).join('');
  document.getElementById('pd2-tipo').innerHTML = state.pdTipos.map((t) => `<option value="${esc(t.codigo)}" ${t.codigo === state.pd2TipoCodigo ? 'selected' : ''}>${esc(t.nombre)} (${esc(t.ecosistema)})</option>`).join('');
  document.getElementById('pd2-eje').innerHTML = '<option value="">— elegir —</option>' + state.pdEjes.map((e) => `<option value="${esc(e.codigo)}" ${e.codigo === state.pd2EjeCodigo ? 'selected' : ''}>${esc(e.eje)}</option>`).join('');

  // El tildado vive en el DOM, no en state.pd2Objetivo (nunca se sincroniza
  // ahí) — hay que leerlo antes de reconstruir el dropdown o cada render
  // (ej. "Confirmar y seguir") lo pisaba con el array vacío inicial.
  const objetivoPrevio = leerCheckboxes('pd2-objetivo-chk');
  document.getElementById('pd2-objetivo-wrap').innerHTML = renderDropdownMulti('pd2-objetivo-dd', 'pd2-objetivo-chk', state.pdObjetivos.map((o) => [o, o]), '— elegir uno o más —', objetivoPrevio);
  document.getElementById('pd2-audiencia-wrap').innerHTML = renderAudienciaSelect('pd2-audiencia', state.pdAudiencias, state.pd2AudienciaCodigo);
  document.getElementById('pd2-otra-audiencia-wrap').hidden = state.pd2AudienciaCodigo !== 'Otra';
  const refuerzoPrevio = leerCheckboxes('pd2-refuerzo-chk');
  document.getElementById('pd2-refuerzo-wrap').innerHTML = renderRefuerzoDropdown('pd2', state.pdAudiencias, refuerzoPrevio);
  document.getElementById('pd2-otras-refuerzo-wrap').hidden = !refuerzoPrevio.includes('Otra');
  renderCrucesV2();

  document.getElementById('pd2-visibilidad').value = state.pd2Visibilidad;
  document.getElementById('pd2-formato-wrap').hidden = state.pd2Visibilidad !== 'DARK';
  const formatoPrevio = document.getElementById('pd2-formato') ? document.getElementById('pd2-formato').value : '';
  document.getElementById('pd2-formato').innerHTML = state.pdFormatos.map((f) => `<option value="${esc(f.appsheet_valor)}" ${f.appsheet_valor === formatoPrevio ? 'selected' : ''}>${esc(f.appsheet_valor)}</option>`).join('');
  const formatoElegido = document.getElementById('pd2-formato').value;
  const formatoInfoActual = state.pdFormatos.find((f) => f.appsheet_valor === formatoElegido);
  const bloqueadoEnFeed = state.pd2Visibilidad === 'PUBLICO';
  document.getElementById('pd2-placements-wrap').innerHTML = renderPlacementsCheckboxes(bloqueadoEnFeed ? ['feed'] : state.pd2Placements, formatoInfoActual, false, bloqueadoEnFeed, 'pd2-placement-chk');

  // Red: 2-3 checkboxes sueltos, libres — mismo criterio que "pd-redes-inner"
  // en v1 (que tampoco los bloquea contra la publicación elegida por pieza:
  // eso solo importa al armar el pedido de cada pieza "Público", ver
  // enviarBulkV2).
  document.getElementById('pd2-redes-inner').innerHTML = renderRedesCheckboxes(state.pd2Redes, false, 'pd2-red-chk');

  // Módulos: se muestran hasta pd2ModuloActivo — el resto sigue oculto. Uno
  // ya confirmado queda con un check en el título, pero sigue editable (no
  // hace falta "volver a editar": la validación final es al pedir preview).
  for (let i = 1; i <= 5; i += 1) {
    const el = document.getElementById('pd2-modulo-' + i);
    if (el) el.hidden = i > state.pd2ModuloActivo;
  }
  [1, 2, 3, 4].forEach((i) => {
    const resumenEl = document.getElementById('pd2-modulo-' + i + '-resumen');
    if (!resumenEl) return;
    const confirmado = state.pd2ModuloActivo > i;
    resumenEl.hidden = !confirmado;
    if (confirmado) resumenEl.innerHTML = '<i class="ph ph-check-circle" style="color:var(--color-accent-2-600)"></i> Confirmado';
  });
}

function moduloValido(n) {
  if (n === 1) {
    if (!state.pd2Proyecto || !state.pd2ActivoKey || !state.pd2TipoCodigo || !state.pd2EjeCodigo) return 'Completá Proyecto, Activo, Tipo y Eje.';
    if (!document.getElementById('pd2-campana').value.trim()) return 'Falta la Campaña.';
    if (!leerCheckboxes('pd2-objetivo-chk').length) return 'Elegí al menos un Objetivo.';
    return null;
  }
  if (n === 2) {
    if (!document.getElementById('pd2-audiencia').value) return 'Elegí la Audiencia principal.';
    return null;
  }
  if (n === 3) {
    if (!document.getElementById('pd2-fecha-inicio').value) return 'Falta la Fecha de inicio.';
    return null;
  }
  if (n === 4) {
    if (state.pd2Visibilidad === 'DARK' && !document.getElementById('pd2-formato').value) return 'Elegí el Formato.';
    if (state.pd2Visibilidad === 'DARK' && !state.pd2Placements.length) return 'Elegí al menos un Placement.';
    return null;
  }
  return null;
}

function confirmarModuloV2(n) {
  const error = moduloValido(n);
  const errEl = document.getElementById('pd2-modulo-' + n + '-error');
  if (error) {
    errEl.hidden = false;
    errEl.textContent = error;
    return;
  }
  errEl.hidden = true;
  state.pd2ModuloActivo = Math.max(state.pd2ModuloActivo, n + 1);
  renderTabPedido2();
  const siguiente = document.getElementById('pd2-modulo-' + (n + 1));
  if (siguiente) siguiente.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Tocar Placement/Formato/Visibilidad después de haber verificado invalida
// lo ya verificado — hay que volver a pedir "Ver preview" (mismo criterio
// que invalidarPreviewPedido() en v1, acá sobre los previews por pieza).
function invalidarPreviewsPiezasV2() {
  if (state.pd2BulkPreviews) { state.pd2BulkPreviews = null; renderResultadoBulkV2(); }
}

// ---------- v2: elegir modo (Pedido de Anuncios/CSV) ----------
// Mismo criterio que cambiarModoCarga() en v1. CSV no tiene layout propio
// que valga la pena comparar (es una tabla, no un formulario) — la tarjeta
// redirige directo al modo CSV de "Pedido de Pauta" clásico. "Pedido de
// Anuncios" arranca siempre con 1 pieza (el Módulo 4 deja subirla hasta 10).
function cambiarModoCargaV2(modo) {
  state.pd2ModoCarga = modo;
  if (modo === 'csv') {
    renderCsvSelectores();
    renderTabPedido2();
    return;
  }
  if (!state.pd2BulkItems.length) ajustarCantidadPiezasV2(1);
  if (!state.pd2CampanasSugeridas.length && state.pd2Proyecto) {
    cargarCampanasSugeridas(state.pd2Proyecto).then((c) => { state.pd2CampanasSugeridas = c; renderTabPedido2(); });
  }
  renderTabPedido2();
}

// ---------- v2: piezas del pedido (mismo espíritu que "Pedir múltiples
// anuncios" de v1, con ids propios pd2bulk* y estado pd2Bulk*, pero acá
// siempre hay al menos 1 — "individual" es simplemente 1 pieza). Los mismos
// campos compartidos de los Módulos 1-3 (Proyecto/Activo/Tipo/Eje/Campaña/
// Objetivo/Audiencia/Visibilidad/Formato/Red/Placement/Cantidad) se usan
// para toda la tanda — cada pieza solo define Línea/Audiencia (opcional)/
// Material/Copy, igual que en v1. ----------

// Cambiar la Cantidad de piezas (Módulo 4) agrega o saca tarjetas del final
// SIN reconstruir las que ya estaban — reconstruirlas de nuevo perdería
// cualquier Material ya tipeado en esa pieza (el link vive solo en el DOM
// hasta el submit, ver enviarBulkV2).
// Pieza vacía — Material (link/archivo/post), Carrusel (arranca en 2, el
// mínimo que exige Meta), Material de Stories y reparto por combo (solo
// "Crear Anuncios", ver combosDePiezaV2) son todos por pieza: cada pauta es
// independiente, no hay nada de esto que tenga sentido compartir entre
// piezas.
function crearPiezaVaciaV2(audienciaCodigo) {
  return {
    modoMaterial: 'link', postSeleccionado: null, audienciaCodigo: audienciaCodigo || '', otraAudienciaTexto: '',
    carrusel: [{ valor: '', archivo: null, subiendo: false, error: null }, { valor: '', archivo: null, subiendo: false, error: null }],
    materialStoriesModo: 'link', materialStoriesArchivo: null, materialStoriesSubiendo: false, materialStoriesError: null,
    reparto: null, repartoExcluidos: {}, repartoBloqueados: {}, repartoClaves: null, repartoAbierto: false,
  };
}

async function ajustarCantidadPiezasV2(cantidadCruda) {
  const cantidad = Math.max(1, Math.min(10, Number(cantidadCruda) || 1));
  sincronizarBulkAudienciasDesdeDOMV2();
  const actuales = state.pd2BulkItems.length;
  if (cantidad === actuales) return;

  state.pd2BulkPreviews = null;
  state.pd2BulkResultados = null;
  state.pd2BulkError = null;

  if (cantidad > actuales) {
    const audienciaCompartida = document.getElementById('pd2-audiencia') ? document.getElementById('pd2-audiencia').value : '';
    const nuevas = Array.from({ length: cantidad - actuales }, () => crearPiezaVaciaV2(audienciaCompartida));
    state.pd2BulkItems = state.pd2BulkItems.concat(nuevas);
    if (state.pd2Visibilidad === 'PUBLICO' && !state.pd2Posts.length && !state.pd2CargandoPosts) await cargarPostsPedidoV2();
    const cont = document.getElementById('pd2-bulk-items');
    let html = '';
    for (let i = actuales; i < cantidad; i += 1) html += renderItemBulkV2(i);
    cont.insertAdjacentHTML('beforeend', html);
  } else {
    state.pd2BulkItems = state.pd2BulkItems.slice(0, cantidad);
    const cont = document.getElementById('pd2-bulk-items');
    while (cont.children.length > cantidad) cont.lastElementChild.remove();
  }
  document.getElementById('pd2-bulk-crear').hidden = false;
  renderResultadoBulkV2();
  recalcularPiezasV2();
}

// Cambiar Visibilidad cambia por completo cómo se carga el Material de cada
// pieza (link/archivo vs. elegir publicación) — se reinicia esa parte para
// cada una (la Audiencia por pieza, que no depende de esto, se preserva).
function reiniciarMaterialesPiezasV2() {
  sincronizarBulkAudienciasDesdeDOMV2();
  state.pd2BulkItems.forEach((item) => {
    item.modoMaterial = 'link';
    item.postSeleccionado = null;
    item.archivoSubido = null;
    item.archivoError = null;
  });
  state.pd2BulkPreviews = null;
  state.pd2BulkResultados = null;
  renderBulkItemsV2();
  recalcularPiezasV2();
}

function formatoInfoPd2Actual() {
  const formatoEl = document.getElementById('pd2-formato');
  const valor = formatoEl ? formatoEl.value : '';
  return state.pdFormatos.find((f) => f.appsheet_valor === valor);
}

function renderMaterialBulkV2(i) {
  const item = state.pd2BulkItems[i];
  const prefix = `pd2bulk${i}`;
  if (state.pd2Visibilidad === 'PUBLICO') {
    return `
      <div class="tabs" style="padding:0;border:none;margin-bottom:10px">
        <button type="button" class="tab-btn ${item.modoMaterial === 'post' ? 'active' : ''}" data-action="pd2bulk-modo-material" data-index="${i}" data-id="post">Elegir publicación</button>
        <button type="button" class="tab-btn ${item.modoMaterial === 'link' ? 'active' : ''}" data-action="pd2bulk-modo-material" data-index="${i}" data-id="link">Pegar link</button>
      </div>
      ${item.modoMaterial === 'post' ? renderSelectorPostsBulkV2(i) : `<input class="input" id="${prefix}-material" placeholder="https://...">`}
    `;
  }
  const formatoInfoActual = formatoInfoPd2Actual();
  if (formatoInfoActual && formatoInfoActual.modo === 'carrusel') {
    // Carrusel: no es UN material, son VARIOS — editor propio (una fila por
    // imagen), no el Link/Archivo de siempre.
    return renderMaterialCarruselV2(i);
  }
  return `
    <div class="tabs" style="padding:0;border:none;margin-bottom:10px">
      <button type="button" class="tab-btn ${item.modoMaterial !== 'archivo' ? 'active' : ''}" data-action="pd2bulk-modo-material" data-index="${i}" data-id="link">Pegar link</button>
      <button type="button" class="tab-btn ${item.modoMaterial === 'archivo' ? 'active' : ''}" data-action="pd2bulk-modo-material" data-index="${i}" data-id="archivo">Subir archivo</button>
    </div>
    ${item.modoMaterial === 'archivo' ? renderMaterialArchivoBulkV2(i) : `<input class="input" id="${prefix}-material" placeholder="https://drive.google.com/... o dropbox.com/...">`}
  `;
}

function renderMaterialArchivoBulkV2(i) {
  const item = state.pd2BulkItems[i];
  if (item.archivoSubiendo) {
    return '<div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--color-neutral-400)"><span class="spinner-inline"></span>Subiendo…</div>';
  }
  if (item.archivoSubido) {
    const a = item.archivoSubido;
    const peso = a.bytes >= 1024 * 1024 ? (a.bytes / (1024 * 1024)).toFixed(1) + ' MB' : Math.max(1, Math.round(a.bytes / 1024)) + ' KB';
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--color-divider);border-radius:var(--radius-md)">'
      + '<i class="ph ph-check-circle" style="color:var(--color-accent-2-600)"></i>'
      + '<div style="flex:1;font-size:13px">' + esc(a.nombreOriginal) + ' <span style="color:var(--color-neutral-500)">— ' + (a.tipo === 'video' ? 'Video' : 'Imagen') + ' · ' + peso + '</span></div>'
      + '<button type="button" class="btn btn-secondary" data-action="pd2bulk-archivo-quitar" data-index="' + i + '" style="font-size:12px;padding:4px 10px">Quitar</button>'
      + '</div>';
  }
  return `<input class="input" type="file" id="pd2bulk${i}-material-archivo" data-index="${i}" accept="image/*,video/*">`
    + (item.archivoError ? '<div class="error" style="margin-top:6px">' + esc(item.archivoError) + '</div>' : '');
}

async function subirArchivoMaterialBulkV2(index, file) {
  const item = state.pd2BulkItems[index];
  if (!item) return;
  sincronizarBulkAudienciasDesdeDOMV2();
  item.archivoSubiendo = true;
  item.archivoError = null;
  setTimeout(renderBulkItemsV2, 0);

  const form = new FormData();
  form.append('archivo', file);
  try {
    const r = await apiFetch('/api/material/subir', { method: 'POST', body: form });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error);
    item.archivoSubido = Object.assign({ nombreOriginal: file.name }, data);
    state.pd2BulkPreviews = null;
  } catch (err) {
    item.archivoError = err.message;
  }
  item.archivoSubiendo = false;
  sincronizarBulkAudienciasDesdeDOMV2();
  renderBulkItemsV2();
}

// ---------- Carrusel por pieza (mismo criterio que renderMaterialCarrusel
// de v1: una fila por imagen, cada una con su link O su archivo subido) ----------

function renderMaterialCarruselV2(i) {
  const item = state.pd2BulkItems[i];
  const filas = item.carrusel.map((c, ci) => {
    const puedeQuitar = item.carrusel.length > 2;
    let cuerpo;
    if (c.subiendo) {
      cuerpo = '<span style="font-size:12px;color:var(--color-neutral-400)"><span class="spinner-inline"></span> Subiendo…</span>';
    } else if (c.archivo) {
      const peso = c.archivo.bytes >= 1024 * 1024 ? (c.archivo.bytes / (1024 * 1024)).toFixed(1) + ' MB' : Math.max(1, Math.round(c.archivo.bytes / 1024)) + ' KB';
      cuerpo = '<span style="font-size:12px;flex:1"><i class="ph ph-check-circle" style="color:var(--color-accent-2-600)"></i> '
        + esc(c.archivo.nombreOriginal) + ' — ' + peso + '</span>'
        + '<button type="button" class="btn btn-secondary" data-action="pd2bulk-carrusel-cambiar" data-index="' + i + '" data-sub="' + ci + '" style="font-size:11px;padding:3px 8px">Cambiar</button>';
    } else {
      cuerpo = '<label class="btn btn-secondary" style="font-size:11px;padding:5px 10px;cursor:pointer;white-space:nowrap;flex:none">Subir'
        + '<input type="file" accept="image/*" data-carrusel-archivo-v2 data-index="' + i + '" data-sub="' + ci + '" style="display:none">'
        + '</label>'
        + '<input class="input" data-carrusel-link-v2 data-index="' + i + '" data-sub="' + ci + '" placeholder="https://..." value="' + esc(c.valor || '') + '" style="flex:1">';
    }
    const puedeSubir = ci > 0;
    const puedeBajar = ci < item.carrusel.length - 1;
    const moverBotones = '<div style="display:flex;flex-direction:column">'
      + '<button type="button" class="btn btn-icon btn-ghost" data-action="pd2bulk-carrusel-mover-arriba" data-index="' + i + '" data-sub="' + ci + '" title="Mover arriba" style="height:16px;' + (puedeSubir ? '' : 'visibility:hidden') + '"><i class="ph ph-caret-up"></i></button>'
      + '<button type="button" class="btn btn-icon btn-ghost" data-action="pd2bulk-carrusel-mover-abajo" data-index="' + i + '" data-sub="' + ci + '" title="Mover abajo" style="height:16px;' + (puedeBajar ? '' : 'visibility:hidden') + '"><i class="ph ph-caret-down"></i></button>'
      + '</div>';
    return '<div style="margin-bottom:6px">'
      + '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid ' + (c.error ? 'var(--color-warning, #d08a1e)' : 'var(--color-divider)') + ';border-radius:var(--radius-md)">'
      + '<span style="font-family:var(--font-heading);font-size:12px;color:var(--color-neutral-500);flex:none">' + (ci + 1) + '.</span>'
      + cuerpo + moverBotones
      + (puedeQuitar ? '<button type="button" class="btn btn-icon btn-ghost" data-action="pd2bulk-carrusel-quitar" data-index="' + i + '" data-sub="' + ci + '" title="Quitar"><i class="ph ph-x"></i></button>' : '')
      + '</div>'
      + (c.error ? '<div class="error" style="font-size:11px;margin-top:4px">' + esc(c.error) + '</div>' : '')
      + '</div>';
  }).join('');
  const puedeAgregar = item.carrusel.length < 10;
  return '<div style="font-size:11px;color:var(--color-neutral-500);margin-bottom:8px">Carrusel: entre 2 y 10 imágenes — cada una con su link o subida a mano.</div>'
    + filas
    + (puedeAgregar ? '<button type="button" class="btn btn-secondary" data-action="pd2bulk-carrusel-agregar" data-index="' + i + '" style="font-size:12px;margin-top:4px">+ Agregar imagen</button>' : '');
}

// El link de cada fila vive en el DOM mientras se escribe — hay que
// volcarlo a estado ANTES de cualquier redibujado de esa pieza, o lo pisa
// con lo que tenía guardado (mismo motivo que sincronizarCarruselDesdeDOM
// en v1).
function sincronizarCarruselDesdeDOMV2(i) {
  const item = state.pd2BulkItems[i];
  if (!item) return;
  document.querySelectorAll(`[data-carrusel-link-v2][data-index="${i}"]`).forEach((el) => {
    const ci = Number(el.dataset.sub);
    if (item.carrusel[ci] && !item.carrusel[ci].archivo) item.carrusel[ci].valor = el.value;
  });
}

// Junta lo que hay cargado en el editor de carrusel de esta pieza: el link
// (ya sincronizado a estado) para las filas sin archivo, o el path ya
// subido para las que sí.
function resolverMaterialCarruselV2(i) {
  sincronizarCarruselDesdeDOMV2(i);
  return state.pd2BulkItems[i].carrusel.map((c) => (c.archivo ? c.archivo.material : (c.valor || '').trim())).filter(Boolean);
}

function renderMaterialWrapPiezaV2(i) {
  const el = document.getElementById(`pd2bulk${i}-material-wrap`);
  if (el) el.innerHTML = renderMaterialBulkV2(i);
}

async function subirArchivoCarruselV2(i, ci, file) {
  const item = state.pd2BulkItems[i];
  if (!item || !item.carrusel[ci]) return;
  sincronizarCarruselDesdeDOMV2(i);
  item.carrusel[ci].subiendo = true;
  item.carrusel[ci].error = null;
  setTimeout(() => renderMaterialWrapPiezaV2(i), 0);

  const form = new FormData();
  form.append('archivo', file);
  try {
    const r = await apiFetch('/api/material/subir', { method: 'POST', body: form });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error);
    item.carrusel[ci].archivo = Object.assign({ nombreOriginal: file.name }, data);
    invalidarPreviewsPiezasV2();
  } catch (err) {
    item.carrusel[ci].error = err.message;
  }
  item.carrusel[ci].subiendo = false;
  renderMaterialWrapPiezaV2(i);
}

// ---------- Material de Stories por pieza — solo tiene sentido (y solo se
// muestra) con Stories elegido JUNTO a otro Placement: Stories sola ya usa
// el material principal, y en Carrusel/Público no aplica (mismo criterio
// que "mostrarMaterialStories" en v1). ----------

function mostrarMaterialStoriesV2() {
  const formatoInfoActual = formatoInfoPd2Actual();
  const placementsCheck = state.pd2Placements.length ? state.pd2Placements : ['feed'];
  return state.pd2Visibilidad === 'DARK'
    && !(formatoInfoActual && formatoInfoActual.modo === 'carrusel')
    && placementsCheck.includes('stories') && placementsCheck.some((p) => p !== 'stories');
}

function renderMaterialArchivoStoriesV2(i) {
  const item = state.pd2BulkItems[i];
  if (item.materialStoriesSubiendo) {
    return '<div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--color-neutral-400)"><span class="spinner-inline"></span>Subiendo…</div>';
  }
  if (item.materialStoriesArchivo) {
    const a = item.materialStoriesArchivo;
    const peso = a.bytes >= 1024 * 1024 ? (a.bytes / (1024 * 1024)).toFixed(1) + ' MB' : Math.max(1, Math.round(a.bytes / 1024)) + ' KB';
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--color-divider);border-radius:var(--radius-md)">'
      + '<i class="ph ph-check-circle" style="color:var(--color-accent-2-600)"></i>'
      + '<div style="flex:1;font-size:13px">' + esc(a.nombreOriginal) + ' <span style="color:var(--color-neutral-500)">— ' + (a.tipo === 'video' ? 'Video' : 'Imagen') + ' · ' + peso + '</span></div>'
      + '<button type="button" class="btn btn-secondary" data-action="pd2bulk-archivo-stories-quitar" data-index="' + i + '" style="font-size:12px;padding:4px 10px">Quitar</button>'
      + '</div>';
  }
  return `<input class="input" type="file" id="pd2bulk${i}-material-stories-archivo" data-index="${i}" accept="image/*">`
    + (item.materialStoriesError ? '<div class="error" style="margin-top:6px">' + esc(item.materialStoriesError) + '</div>' : '');
}

function renderMaterialStoriesBlockV2(i) {
  const item = state.pd2BulkItems[i];
  const prefix = `pd2bulk${i}`;
  return `
    <div class="tabs" style="padding:0;border:none;margin-bottom:10px">
      <button type="button" class="tab-btn ${item.materialStoriesModo !== 'archivo' ? 'active' : ''}" data-action="pd2bulk-modo-material-stories" data-index="${i}" data-id="link">Pegar link</button>
      <button type="button" class="tab-btn ${item.materialStoriesModo === 'archivo' ? 'active' : ''}" data-action="pd2bulk-modo-material-stories" data-index="${i}" data-id="archivo">Subir archivo</button>
    </div>
    ${item.materialStoriesModo === 'archivo' ? renderMaterialArchivoStoriesV2(i) : `<input class="input" id="${prefix}-material-stories" placeholder="https://...">`}
  `;
}

function renderMaterialStoriesWrapV2(i) {
  const el = document.getElementById(`pd2bulk${i}-material-stories-wrap`);
  if (el) el.innerHTML = renderMaterialStoriesBlockV2(i);
}

async function subirArchivoMaterialStoriesV2(i, file) {
  const item = state.pd2BulkItems[i];
  if (!item) return;
  item.materialStoriesSubiendo = true;
  item.materialStoriesError = null;
  setTimeout(() => renderMaterialStoriesWrapV2(i), 0);

  const form = new FormData();
  form.append('archivo', file);
  try {
    const r = await apiFetch('/api/material/subir', { method: 'POST', body: form });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error);
    if (data.tipo !== 'imagen') throw new Error('El material de Stories tiene que ser una imagen.');
    item.materialStoriesArchivo = Object.assign({ nombreOriginal: file.name }, data);
  } catch (err) {
    item.materialStoriesError = err.message;
  }
  item.materialStoriesSubiendo = false;
  renderMaterialStoriesWrapV2(i);
}

function renderSelectorPostsBulkV2(i) {
  const item = state.pd2BulkItems[i];
  if (state.pd2CargandoPosts) return '<div style="font-size:13px;color:var(--color-neutral-500)">Cargando publicaciones…</div>';
  if (!state.pd2Posts.length) return '<div style="font-size:13px;color:var(--color-neutral-500)">Sin publicaciones recientes.</div>';
  const grid = state.pd2Posts.map((post) => {
    const seleccionado = item.postSeleccionado && item.postSeleccionado.id === post.id;
    const imgTag = post.imagen
      ? `<img src="${esc(post.imagen)}" loading="lazy">`
      : `<div style="width:100%;height:90px;display:flex;align-items:center;justify-content:center;color:var(--color-neutral-600)"><i class="ph ph-image" style="font-size:22px"></i></div>`;
    return `
      <div class="post-card ${seleccionado ? 'selected' : ''}" data-action="pd2bulk-seleccionar-post" data-index="${i}" data-id="${esc(post.id)}">
        ${imgTag}
        <div class="post-body">
          <span class="tag ${post.plataforma === 'Instagram' ? 'tag-accent-2' : 'tag-accent'}">${esc(post.plataforma)}</span>
          ${post.esReel ? '<span class="tag tag-outline">Reel</span>' : ''}
          <div class="post-caption">${esc(post.caption) || '<span style="color:var(--color-neutral-600)">Sin texto</span>'}</div>
        </div>
      </div>`;
  }).join('');
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px">${grid}</div>`;
}

// ---------- Reparto de presupuesto por pieza (solo "Crear Anuncios", y
// solo si esa pieza arma más de un conjunto objetivo × audiencia) — mismo
// motor que combosDelFormulario/repartoParejo/repartoConExclusiones/
// repartoTrasMoverSlider/renderFilaReparto de v1 (funciones puras, se
// reusan tal cual), pero el ESTADO del reparto (armado/excluidos/
// bloqueados) vive en la pieza en vez de en state.pdReparto — cada pauta
// reparte SU presupuesto entre SUS combos, no hay uno compartido entre
// piezas. ----------

function combosDePiezaV2(i) {
  const item = state.pd2BulkItems[i];
  const objetivos = leerCheckboxes('pd2-objetivo-chk');
  const audienciaEl = document.getElementById(`pd2bulk${i}-audiencia`);
  const principal = audienciaEl ? audienciaEl.value : (item.audienciaCodigo || '');
  const refuerzos = leerCheckboxes('pd2-refuerzo-chk');
  const codigos = [principal].concat(refuerzos).filter(Boolean).filter((a, idx, arr) => arr.indexOf(a) === idx);
  const nombre = (codigo) => {
    if (codigo === 'Otra') {
      const otraEl = document.getElementById(`pd2bulk${i}-otra-audiencia`);
      const texto = otraEl ? otraEl.value : (item.otraAudienciaTexto || '');
      return texto ? 'Otra — ' + texto : 'Otra (a mano)';
    }
    const a = state.pdAudiencias.find((x) => x.codigo === codigo);
    return a ? a.nombre : codigo;
  };
  const combos = [];
  objetivos.forEach((objetivo) => { codigos.forEach((codigo) => { combos.push({ objetivo, audCodigo: codigo, audNombre: nombre(codigo), manual: codigo === 'Otra', principal: codigo === principal }); }); });
  return combos;
}

function totalRepartoV2(item) {
  return Object.values(item.reparto || {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

function hayQueRepartirPiezaV2(i) {
  return state.pd2ModoDirecto && combosDePiezaV2(i).length > 1;
}

function repartoInvalidoV2(i) {
  const item = state.pd2BulkItems[i];
  return hayQueRepartirPiezaV2(i) && Math.round(totalRepartoV2(item) * 100) / 100 !== 100;
}

function asegurarRepartoV2(item, combos) {
  const claves = clavesDeCombos(combos);
  if (item.reparto && item.repartoClaves === claves) return;
  item.repartoExcluidos = {};
  item.repartoBloqueados = {};
  item.reparto = repartoParejo(combos);
  item.repartoClaves = claves;
}

function repartoConExclusionesV2(item, combos) {
  const anterior = item.reparto || {};
  const libres = combos.filter((c) => {
    const clave = claveCelda(c.objetivo, c.audCodigo);
    return !item.repartoExcluidos[clave] && !item.repartoBloqueados[clave];
  });
  const bloqueadosSum = combos.reduce((a, c) => {
    const clave = claveCelda(c.objetivo, c.audCodigo);
    return item.repartoBloqueados[clave] ? a + (Number(anterior[clave]) || 0) : a;
  }, 0);
  const restante = Math.max(0, +(100 - bloqueadosSum).toFixed(2));

  const mapa = {};
  combos.forEach((c) => {
    const clave = claveCelda(c.objetivo, c.audCodigo);
    if (item.repartoExcluidos[clave]) mapa[clave] = 0;
    else if (item.repartoBloqueados[clave]) mapa[clave] = Number(anterior[clave]) || 0;
  });
  if (libres.length) {
    const pctBase = Math.floor((restante / libres.length) * 100) / 100;
    libres.forEach((c) => { mapa[claveCelda(c.objetivo, c.audCodigo)] = pctBase; });
    const ultimaClave = claveCelda(libres[libres.length - 1].objetivo, libres[libres.length - 1].audCodigo);
    mapa[ultimaClave] = +(restante - pctBase * (libres.length - 1)).toFixed(2);
  }
  return mapa;
}

function repartoTrasMoverSliderV2(item, combos, claveMovida, valorNuevo) {
  const anterior = item.reparto || {};
  const activos = combos.filter((c) => {
    const clave = claveCelda(c.objetivo, c.audCodigo);
    return !item.repartoExcluidos[clave] && !item.repartoBloqueados[clave];
  });
  const otros = activos.filter((c) => claveCelda(c.objetivo, c.audCodigo) !== claveMovida);

  const mapa = {};
  let bloqueadosSum = 0;
  combos.forEach((c) => {
    const clave = claveCelda(c.objetivo, c.audCodigo);
    if (item.repartoExcluidos[clave]) {
      mapa[clave] = 0;
    } else if (item.repartoBloqueados[clave]) {
      mapa[clave] = Number(anterior[clave]) || 0;
      bloqueadosSum += mapa[clave];
    }
  });
  const disponible = Math.max(0, +(100 - bloqueadosSum).toFixed(2));
  const valorAplicado = Math.min(valorNuevo, disponible);

  if (!otros.length) {
    mapa[claveMovida] = disponible;
    return mapa;
  }

  mapa[claveMovida] = valorAplicado;
  const restante = Math.max(0, +(disponible - valorAplicado).toFixed(2));
  const pesoAnterior = otros.reduce((a, c) => a + (Number(anterior[claveCelda(c.objetivo, c.audCodigo)]) || 0), 0);

  otros.forEach((c) => {
    const clave = claveCelda(c.objetivo, c.audCodigo);
    mapa[clave] = pesoAnterior > 0
      ? +(restante * (Number(anterior[clave]) || 0) / pesoAnterior).toFixed(2)
      : +(restante / otros.length).toFixed(2);
  });

  const ultimaClave = claveCelda(otros[otros.length - 1].objetivo, otros[otros.length - 1].audCodigo);
  const sumaTotal = Object.values(mapa).reduce((a, v) => a + (Number(v) || 0), 0);
  mapa[ultimaClave] = +(mapa[ultimaClave] + (100 - sumaTotal)).toFixed(2);

  return mapa;
}

// El botón "Distribuir presupuesto" aparece solo con más de un conjunto. El
// panel se abre a pedido, no de entrada (mismo criterio que
// renderDistribuirPresupuesto en v1).
function renderDistribuirPresupuestoV2(i) {
  const wrap = document.getElementById(`pd2bulk${i}-reparto-wrap`);
  if (!wrap) return;
  const item = state.pd2BulkItems[i];
  const combos = combosDePiezaV2(i);
  if (!state.pd2ModoDirecto || combos.length < 2) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    item.repartoAbierto = false;
    return;
  }
  wrap.hidden = false;
  asegurarRepartoV2(item, combos);

  if (!item.repartoAbierto) {
    wrap.innerHTML = `<button type="button" class="btn btn-secondary" data-action="pd2bulk-reparto-abrir" data-index="${i}"><i class="ph ph-chart-pie-slice"></i> Distribuir presupuesto (${combos.length} conjuntos)</button>`;
    return;
  }

  const presupuestoEl = document.getElementById(`pd2bulk${i}-presupuesto`);
  const presupuesto = Number(presupuestoEl ? presupuestoEl.value : 0) || 0;
  const dias = diasDeLaPieza(document.getElementById('pd2-fecha-inicio').value, document.getElementById('pd2-fecha-fin').value);
  const minDiario = state.limites && state.limites.minDiario;
  const minPorConjunto = minDiario ? minDiario * dias : 0;

  // Cada fila envuelta con data-pieza-index: renderFilaReparto() es la misma
  // función pura de v1 (checkbox/slider/lock/"todo acá" con data-action
  // "pd-reparto-*" y data-clave) — como acá hay una pieza por cada reparto
  // en vez de uno solo global, el handler delegado resuelve a qué pieza
  // pertenece cada click buscando el data-pieza-index más cercano.
  const filas = combos.map((c) => {
    const clave = claveCelda(c.objetivo, c.audCodigo);
    const excluida = !!item.repartoExcluidos[clave];
    const bloqueada = !!item.repartoBloqueados[clave];
    const pct = Number((item.reparto || {})[clave]) || 0;
    const monto = Math.round(presupuesto * pct / 100);
    const bajoMinimo = !c.manual && !excluida && minPorConjunto && pct > 0 && monto < minPorConjunto;
    return `<div data-pieza-index="${i}">` + renderFilaReparto(c, clave, pct, monto, bajoMinimo, excluida, bloqueada) + '</div>';
  }).join('');

  const total = totalRepartoV2(item);
  const ok = Math.round(total * 100) / 100 === 100;
  const flojas = combos.filter((c) => {
    if (c.manual || !minPorConjunto) return false;
    const pct = Number((item.reparto || {})[claveCelda(c.objetivo, c.audCodigo)]) || 0;
    return pct > 0 && Math.round(presupuesto * pct / 100) < minPorConjunto;
  }).length;

  wrap.innerHTML = ''
    + '<div style="border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:14px 16px">'
    +   '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'
    +     '<strong style="font-family:var(--font-heading);font-size:14px">Distribuir presupuesto</strong>'
    +     '<button type="button" class="btn btn-secondary" style="font-size:12px;padding:4px 10px" data-action="pd2bulk-reparto-parejo" data-index="' + i + '"><i class="ph ph-equals"></i> Repartir parejo</button>'
    +   '</div>'
    +   '<div style="font-size:11px;color:var(--color-neutral-500);margin-bottom:10px">Cada objetivo × audiencia es un conjunto de anuncios propio en Meta, con su parte del presupuesto. Desmarcá uno para no crearlo (ej: el refuerzo solo va por un objetivo).</div>'
    +   '<div style="display:flex;flex-direction:column;gap:8px">' + filas + '</div>'
    +   '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:13px;font-family:var(--font-heading)">'
    +     '<span style="color:' + (ok ? 'var(--color-accent-300)' : 'var(--color-warning, #d08a1e)') + '">Total: ' + (Math.round(total * 100) / 100) + '%</span>'
    +     '<span>' + esc(fmtMoney(presupuesto)) + '</span>'
    +   '</div>'
    +   (ok ? '' : '<div style="font-size:12px;color:var(--color-neutral-400);margin-top:6px">Tiene que sumar 100% para poder crear.</div>')
    +   (flojas ? '<div style="font-size:12px;color:var(--color-neutral-300);margin-top:8px;padding:8px 10px;border:1px solid var(--color-warning, #d08a1e);border-radius:var(--radius-md)"><strong>' + flojas + ' conjunto(s) bajo el mínimo de Meta.</strong> Para ' + dias + ' día(s) Meta pide más de ' + esc(fmtMoney(minPorConjunto)) + ' por conjunto: si publicás así, va a rechazar esos.</div>' : '')
    + '</div>';
}

// Línea/Audiencia/Material/Copy son lo único que varía por pieza — el resto
// (Objetivo/Formato/Red/Placement/Link de destino/Tipo) es compartido, ver
// Módulos 1-4. La Audiencia arranca precargada con la del Módulo 2, pero se
// puede pisar por pieza (mismo criterio que renderItemBulk en v1).
function renderItemBulkV2(i) {
  const prefix = `pd2bulk${i}`;
  const item = state.pd2BulkItems[i];
  const copyBloque = state.pd2Visibilidad === 'DARK'
    ? `<div class="field" style="grid-column:1 / -1"><label>Copy</label><textarea class="input" id="${prefix}-copy" rows="2" placeholder="Texto del anuncio"></textarea></div>`
    : '';
  const audienciaBloque = `<div class="field">
      <label>Audiencia principal</label>
      <div style="display:flex;gap:8px;align-items:flex-start">
        <div style="flex:1;min-width:0">${renderAudienciaSelect(`${prefix}-audiencia`, state.pdAudiencias, item.audienciaCodigo || '')}</div>
        <div id="${prefix}-otra-audiencia-wrap" style="flex:1;min-width:0" ${item.audienciaCodigo === 'Otra' ? '' : 'hidden'}>
          <input class="input" id="${prefix}-otra-audiencia" placeholder="Descripción de la audiencia" value="${esc(item.otraAudienciaTexto || '')}">
        </div>
      </div>
    </div>`;
  // Mismo criterio que "pd-presupuesto-content" en v1: tramos fijos, solo
  // "Crear Anuncios" — Pedido de Pauta (PM) no lo ve, el servidor lo
  // resuelve solo (Tipo × tamaño de Audiencia).
  const presupuestoPrevio = document.getElementById(`${prefix}-presupuesto`) ? document.getElementById(`${prefix}-presupuesto`).value : '';
  const defaultVal = document.getElementById('pd2-presupuesto-default') ? document.getElementById('pd2-presupuesto-default').value : '';
  const presupuestoBloque = state.pd2ModoDirecto
    ? `<div class="field"><label>Presupuesto</label>
        <select class="input" id="${prefix}-presupuesto">${PRESUPUESTO_TIERS.map((v) => `<option value="${v}" ${String(v) === (presupuestoPrevio || defaultVal) ? 'selected' : ''}>${labelPresupuesto(v)}</option>`).join('')}</select>
      </div>`
    : '';
  const materialStoriesBloque = mostrarMaterialStoriesV2()
    ? `<div class="field" style="grid-column:1 / -1"><label>Material para Stories <span style="font-weight:400;color:var(--color-neutral-500)">(opcional — si no lo cargás, se usa el mismo material de arriba)</span></label><div id="${prefix}-material-stories-wrap">${renderMaterialStoriesBlockV2(i)}</div></div>`
    : '';

  return `
    <div class="card" style="gap:12px">
      <div class="card-title">Pieza N°${i + 1}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
        <div class="field"><label>Línea <span style="font-weight:400;color:var(--color-neutral-500)">(opcional)</span></label><input class="input" id="${prefix}-linea"></div>
        ${audienciaBloque}
        ${presupuestoBloque}
        <div class="field" style="grid-column:1 / -1"><label>Material</label><div id="${prefix}-material-wrap">${renderMaterialBulkV2(i)}</div></div>
        ${materialStoriesBloque}
        ${copyBloque}
      </div>
      <div id="${prefix}-reparto-wrap" hidden></div>
      <div id="${prefix}-aviso-presupuesto" hidden></div>
    </div>`;
}

// Recalcula, para todas las piezas, el panel de reparto y el aviso de
// mínimo — mismo criterio que el listener global de v1
// (renderDistribuirPresupuesto/renderAvisoPresupuesto en cada 'change'/
// 'click' del formulario), pero acá corre por pieza.
function recalcularPiezasV2() {
  if (!state.pd2ModoDirecto) return;
  state.pd2BulkItems.forEach((item, i) => renderDistribuirPresupuestoV2(i));
  renderAvisoPresupuestoV2();
}

// El botón "Confirmar" queda deshabilitado si ALGUNA pieza no llega al
// mínimo de Meta o tiene un reparto que no suma 100% — mismo criterio que
// renderAvisoPresupuesto()/repartoInvalido() en v1, evaluado por pieza.
function renderAvisoPresupuestoV2() {
  if (!state.pd2ModoDirecto) return;
  let algunaFalla = false;
  state.pd2BulkItems.forEach((item, i) => {
    const el = document.getElementById(`pd2bulk${i}-aviso-presupuesto`);
    if (!el) return;
    const presupuestoEl = document.getElementById(`pd2bulk${i}-presupuesto`);
    const audienciaEl = document.getElementById(`pd2bulk${i}-audiencia`);
    const falta = faltaPresupuesto(
      presupuestoEl ? presupuestoEl.value : '',
      leerCheckboxes('pd2-objetivo-chk'),
      audienciaEl ? audienciaEl.value : (item.audienciaCodigo || ''),
      leerCheckboxes('pd2-refuerzo-chk'),
      document.getElementById('pd2-fecha-inicio').value,
      document.getElementById('pd2-fecha-fin').value
    );
    el.hidden = !falta;
    if (falta) {
      algunaFalla = true;
      el.innerHTML = `
        <div style="padding:10px 12px;border:1px solid var(--color-warning, #d08a1e);border-radius:var(--radius-md);font-size:12px;color:var(--color-neutral-300)">
          <strong>Pieza ${i + 1}: el presupuesto no alcanza para el mínimo de Meta.</strong>
          Son ${falta.conjuntos} conjunto(s) de anuncios × ${falta.dias} día(s), y Meta pide más de
          <strong>${fmtMoney(falta.minPorConjunto)} por conjunto</strong> → hacen falta al menos
          <strong>${fmtMoney(falta.minTotal)}</strong> y hay ${fmtMoney(falta.presupuesto)}.
        </div>`;
    }
    if (repartoInvalidoV2(i)) algunaFalla = true;
  });
  const btn = document.getElementById('pd2-bulk-crear');
  if (btn && !state.pd2BulkEnviando && !state.pd2BulkVerificando) btn.disabled = algunaFalla;
}

// La Audiencia principal de cada pieza vive en el DOM mientras se edita —
// hay que volcarla a estado ANTES de cualquier renderBulkItemsV2(), o ese
// mismo redibujado la pisa (mismo motivo que sincronizarBulkAudienciasDesdeDOM
// en v1).
function sincronizarBulkAudienciasDesdeDOMV2() {
  state.pd2BulkItems.forEach((item, i) => {
    const sel = document.getElementById(`pd2bulk${i}-audiencia`);
    if (sel) item.audienciaCodigo = sel.value;
    const otra = document.getElementById(`pd2bulk${i}-otra-audiencia`);
    if (otra) item.otraAudienciaTexto = otra.value;
  });
}

function renderBulkItemsV2() {
  document.getElementById('pd2-bulk-items').innerHTML = state.pd2BulkItems.map((item, i) => renderItemBulkV2(i)).join('');
}

// Campos del Módulo 1-4 (compartidos por todas las piezas de la tanda) —
// se arman una sola vez y se reusan tanto para validar el preview (sin
// crear nada) como para la creación real, así los dos caminos mandan
// EXACTAMENTE los mismos datos y no se puede confirmar algo que el preview
// nunca vio.
function armarContextoBulkV2() {
  return {
    objetivo: leerCheckboxes('pd2-objetivo-chk'),
    audienciaCodigo: document.getElementById('pd2-audiencia').value,
    otraAudiencia: document.getElementById('pd2-otra-audiencia').value.trim(),
    refuerzoAudiencia: leerCheckboxes('pd2-refuerzo-chk'),
    otrasRefuerzo: document.getElementById('pd2-otras-refuerzo').value.trim(),
    linkDestino: document.getElementById('pd2-link-destino').value.trim(),
    formatoInput: document.getElementById('pd2-formato'),
    fechaInicio: document.getElementById('pd2-fecha-inicio').value,
    fechaFin: document.getElementById('pd2-fecha-fin').value,
    campana: document.getElementById('pd2-campana').value.trim(),
    comentarios: document.getElementById('pd2-comentarios').value.trim(),
    bulkId: state.pd2BulkItems.length > 1 ? 'BULK-' + Date.now() : null,
  };
}

// El payload que espera /api/pedidos y /api/anuncios/crear-directo para UNA
// pieza — mismo shape para validar (soloValidar, ver verificarMaterialesBulkV2)
// y para crear de verdad (ver enviarBulkV2).
function armarDatosPiezaV2(i, ctx) {
  const item = state.pd2BulkItems[i];
  const prefix = `pd2bulk${i}`;
  const formatoInfoPieza = formatoInfoPd2Actual();
  const usaCarrusel = state.pd2Visibilidad !== 'PUBLICO' && formatoInfoPieza && formatoInfoPieza.modo === 'carrusel';
  const materialCarrusel = usaCarrusel ? resolverMaterialCarruselV2(i).join('|') : null;
  const materialInput = document.getElementById(`${prefix}-material`);
  const copyInput = document.getElementById(`${prefix}-copy`);
  const linea = document.getElementById(`${prefix}-linea`).value.trim();
  const presupuestoEl = document.getElementById(`${prefix}-presupuesto`);
  const presupuesto = state.pd2ModoDirecto && presupuestoEl ? presupuestoEl.value : null;

  // Material de Stories: solo se manda si el bloque está visible (Stories +
  // otro placement) — igual que el material principal, archivo subido gana
  // sobre el link tipeado.
  const materialStoriesWrap = document.getElementById(`${prefix}-material-stories-wrap`);
  const materialStoriesArchivo = item.materialStoriesModo === 'archivo' && item.materialStoriesArchivo
    ? item.materialStoriesArchivo.material
    : null;
  const materialStoriesInput = document.getElementById(`${prefix}-material-stories`);
  const materialStoriesFinal = (materialStoriesWrap && !materialStoriesWrap.hidden)
    ? (materialStoriesArchivo || (materialStoriesInput ? materialStoriesInput.value.trim() : ''))
    : '';

  const redesCompartidas = state.pd2Visibilidad === 'PUBLICO' ? [] : state.pd2Redes;

  return {
    proyecto: state.pd2Proyecto,
    activoKey: state.pd2ActivoKey,
    ejeCodigo: state.pd2EjeCodigo,
    tipoCodigo: state.pd2TipoCodigo,
    campana: ctx.campana,
    linea,
    visibilidad: state.pd2Visibilidad,
    formato: ctx.formatoInput ? ctx.formatoInput.value : '',
    objetivo: ctx.objetivo,
    audienciaCodigo: item.audienciaCodigo || ctx.audienciaCodigo,
    otraAudiencia: item.audienciaCodigo === 'Otra' ? (item.otraAudienciaTexto || '') : ctx.otraAudiencia,
    refuerzoAudiencia: ctx.refuerzoAudiencia,
    otrasRefuerzo: ctx.otrasRefuerzo,
    material: materialCarrusel || (item.modoMaterial === 'archivo' && item.archivoSubido
      ? item.archivoSubido.material
      : (materialInput ? materialInput.value.trim() : '')),
    materialStories: materialStoriesFinal,
    post: state.pd2Visibilidad === 'PUBLICO' && item.modoMaterial === 'post' ? item.postSeleccionado : null,
    copy: copyInput ? copyInput.value.trim() : '',
    presupuesto,
    fechaInicio: ctx.fechaInicio,
    fechaFin: ctx.fechaFin,
    linkDestino: ctx.linkDestino,
    redes: state.pd2Visibilidad === 'PUBLICO' && item.postSeleccionado
      ? [item.postSeleccionado.plataforma === 'Instagram' ? 'instagram' : 'facebook']
      : redesCompartidas,
    placements: state.pd2Visibilidad === 'PUBLICO' ? [] : state.pd2Placements,
    // Solo "Crear Anuncios": el reparto que se definió para esta pieza.
    reparto: hayQueRepartirPiezaV2(i) ? item.reparto : null,
    comentarios: ctx.comentarios,
    combosExcluidos: Object.keys(state.pd2CombosExcluidos),
    bulkId: ctx.bulkId,
  };
}

// Mismo criterio que verificarMaterialesBulk() en v1: se verifican TODAS
// las piezas primero y no se manda nada si alguna falla. Además del
// material (esto), se valida contra el server TODO lo demás que exige
// crearPedido (Copy, Formato, Link de destino con Objetivo Tráfico, etc.)
// — antes eso recién se descubría al confirmar, con el formulario ya
// bloqueado y sin forma de corregirlo (ver reporte de bug del usuario).
async function verificarMaterialesBulkV2(ctxParam) {
  const ctx = ctxParam || armarContextoBulkV2();
  state.pd2BulkVerificando = true;
  state.pd2BulkPreviews = null;
  const btn = document.getElementById('pd2-bulk-crear');
  btn.disabled = true;
  btn.textContent = 'Verificando materiales…';

  const previews = [];
  for (let i = 0; i < state.pd2BulkItems.length; i++) {
    const item = state.pd2BulkItems[i];
    if (state.pd2Visibilidad === 'PUBLICO' && item.modoMaterial === 'post') {
      previews.push(item.postSeleccionado
        ? { i, ok: true, tipo: 'publicación existente', previewUrl: item.postSeleccionado.imagen || '' }
        : { i, ok: false, error: 'No elegiste la publicación.' });
      continue;
    }
    const formatoInfoPieza = formatoInfoPd2Actual();
    if (state.pd2Visibilidad !== 'PUBLICO' && formatoInfoPieza && formatoInfoPieza.modo === 'carrusel') {
      // Carrusel: son varias imágenes, no una — el chequeo de tipo/
      // proporción de cada una se hace recién al confirmar (server-side),
      // acá solo se junta lo que hay cargado y se pide el mínimo de 2
      // (mismo criterio que verificarYPrevisualizar() en v1).
      const materiales = resolverMaterialCarruselV2(i);
      if (materiales.length < 2) {
        previews.push({ i, ok: false, error: 'Cargá al menos 2 imágenes para el carrusel (link o archivo).' });
        continue;
      }
      const primeraConPreview = item.carrusel.filter((c) => c.archivo && c.archivo.previewUrl)[0];
      previews.push({ i, ok: true, tipo: 'imagen', previewUrl: primeraConPreview ? primeraConPreview.archivo.previewUrl : '', carruselCantidad: materiales.length });
      continue;
    }
    if (item.modoMaterial === 'archivo') {
      previews.push(item.archivoSubido
        ? { i, ok: true, tipo: item.archivoSubido.tipo, contentType: item.archivoSubido.contentType, bytes: item.archivoSubido.bytes, previewUrl: item.archivoSubido.previewUrl || '' }
        : { i, ok: false, error: 'Subí el archivo de esta pieza.' });
      continue;
    }
    const input = document.getElementById('pd2bulk' + i + '-material');
    const material = input ? input.value.trim() : '';
    if (!material) { previews.push({ i, ok: false, error: 'Falta el link del material.' }); continue; }
    try {
      const r = await apiFetch('/api/material/verificar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ material }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detalle || data.error);
      previews.push(Object.assign({ i, ok: true }, data));
    } catch (err) {
      previews.push({ i, ok: false, error: err.message });
    }
  }

  // El material puede estar perfecto y aun así faltar algo que solo sabe
  // crearPedido (Copy, Formato, Link de destino con Objetivo Tráfico,
  // Activo/Eje/Tipo, reparto) — se valida acá TAMBIÉN contra el servidor
  // (soloValidar: corre todas las validaciones, no crea nada) antes de dar
  // el preview por bueno y bloquear el formulario.
  try {
    const filas = state.pd2BulkItems.map((item, i) => armarDatosPiezaV2(i, ctx));
    const r = await apiFetch('/api/pedidos/validar-lote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filas, publicar: state.pd2ModoDirecto }),
    });
    const data = await r.json();
    if (r.ok && Array.isArray(data.resultados)) {
      data.resultados.forEach((res) => {
        if (res.ok) return;
        const preview = previews.find((p) => p.i === res.index);
        // El material ya tenía su propio error, más específico — no lo piso.
        if (preview && preview.ok) { preview.ok = false; preview.error = res.error; }
      });
    }
  } catch (err) {
    // Si este chequeo no responde, no bloqueamos el preview de material por
    // eso — el servidor igual va a rechazar al confirmar.
  }

  state.pd2BulkPreviews = previews;
  state.pd2BulkVerificando = false;
  btn.disabled = false;
  renderResultadoBulkV2();
}

// "AB" a partir de "Activo de Prueba" — el avatar del mock de abajo
// (no hay foto de perfil real de la Página disponible del lado del front).
function inicialesDe(nombre) {
  const palabras = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  return ((palabras[0] ? palabras[0][0] : '') + (palabras[1] ? palabras[1][0] : '')).toUpperCase();
}

// Simula cómo se ve el anuncio en Facebook o Instagram (foto de perfil +
// nombre de página + copy + material) — a diferencia del preview viejo (una
// miniatura suelta con un ícono de ok/error), esto es lo que pidió el
// usuario: "que simule ser la publicación... interfaz de plataforma", con
// el look de cada red (orden distinto: Instagram pone el copy DESPUÉS de la
// imagen, Facebook antes). Colores fijos de cada plataforma a propósito (no
// los del tema de PAUTADOR): esto simula la plataforma, no la app.
function renderMockPost(o) {
  const lightbox = o.lightboxUrl ? ' data-action="abrir-lightbox" data-url="' + esc(o.lightboxUrl) + '" style="width:100%;max-height:320px;object-fit:cover;display:block;cursor:zoom-in" title="Ver más grande"' : ' style="width:100%;max-height:320px;object-fit:cover;display:block"';
  const media = o.mediaUrl
    ? (o.esVideo
      ? '<video src="' + esc(o.mediaUrl) + '" style="width:100%;max-height:320px;object-fit:cover;display:block;background:#000" controls></video>'
      : '<img src="' + esc(o.mediaUrl) + '"' + lightbox + '>')
    : '<div style="height:160px;background:#f0f2f5;display:flex;align-items:center;justify-content:center;color:#8a8d91"><i class="ph ph-image" style="font-size:28px"></i></div>';
  const badge = o.badge ? '<span style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.6);color:#fff;font-size:10px;padding:2px 6px;border-radius:10px">' + esc(o.badge) + '</span>' : '';
  const iniciales = esc(inicialesDe(o.nombrePagina));

  if (o.plataforma === 'Instagram') {
    const avatar = '<div style="width:34px;height:34px;border-radius:50%;padding:2px;background:linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888);flex:none">'
      + '<div style="width:100%;height:100%;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#262626">' + (iniciales || '<i class="ph ph-storefront"></i>') + '</div>'
      + '</div>';
    return '<div style="border:1px solid #dbdbdb;border-radius:8px;overflow:hidden;background:#fff;font-family:Helvetica,Arial,sans-serif;color:#262626">'
      + '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px">'
      +   avatar
      +   '<div style="line-height:1.2;flex:1;min-width:0">'
      +     '<div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(o.nombrePagina || 'tu_pagina') + '</div>'
      +     '<div style="font-size:11px;color:#8e8e8e">Publicidad</div>'
      +   '</div>'
      +   '<i class="ph ph-dots-three" style="font-size:18px"></i>'
      + '</div>'
      + '<div style="position:relative">' + media + badge + '</div>'
      + '<div style="display:flex;align-items:center;gap:14px;padding:9px 12px 4px;font-size:20px">'
      +   '<i class="ph ph-heart"></i><i class="ph ph-chat-circle"></i><i class="ph ph-paper-plane-tilt"></i>'
      +   '<span style="flex:1"></span><i class="ph ph-bookmark-simple"></i>'
      + '</div>'
      + (o.copy ? '<div style="padding:2px 12px 12px;font-size:13px;line-height:1.35;word-break:break-word"><strong>' + esc(o.nombrePagina || 'tu_pagina') + '</strong> ' + esc(o.copy) + '</div>' : '<div style="padding-bottom:10px"></div>')
      + '</div>';
  }

  return '<div style="border:1px solid #dddfe2;border-radius:8px;overflow:hidden;background:#fff;font-family:Helvetica,Arial,sans-serif;color:#050505">'
    + '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px">'
    +   '<div style="width:34px;height:34px;border-radius:50%;background:#1877f2;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex:none">' + (iniciales || '<i class="ph ph-storefront"></i>') + '</div>'
    +   '<div style="line-height:1.25;min-width:0">'
    +     '<div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(o.nombrePagina || 'Tu página') + '</div>'
    +     '<div style="font-size:11px;color:#65676b">Patrocinado · <i class="ph ph-globe" style="font-size:10px"></i></div>'
    +   '</div>'
    + '</div>'
    + (o.copy ? '<div style="padding:0 12px 10px;font-size:13px;line-height:1.35;white-space:pre-wrap;word-break:break-word">' + esc(o.copy) + '</div>' : '')
    + '<div style="position:relative">' + media + badge + '</div>'
    + '<div style="display:flex;justify-content:space-around;padding:7px 4px;font-size:12px;color:#65676b;border-top:1px solid #eee">'
    +   '<span><i class="ph ph-thumbs-up"></i> Me gusta</span>'
    +   '<span><i class="ph ph-chat-circle"></i> Comentar</span>'
    +   '<span><i class="ph ph-share-fat"></i> Compartir</span>'
    + '</div>'
    + '</div>';
}

function renderPreviewsBulkV2() {
  const previews = state.pd2BulkPreviews;
  if (!previews) return '';
  const activo = (state.pdActivos || []).find((a) => a.activo_key === state.pd2ActivoKey);
  const nombrePagina = activo ? activo.activo : '';
  const unaSola = previews.length === 1;
  const tarjetas = previews.map(function (p) {
    if (!p.ok) {
      return '<div style="border:1px solid var(--color-warning, #d08a1e);border-radius:var(--radius-md);padding:14px;font-size:12px;color:var(--color-neutral-300)">'
        + (unaSola ? '' : '<strong>Pieza ' + (p.i + 1) + '</strong><br>') + esc(p.error) + '</div>';
    }
    const item = state.pd2BulkItems[p.i];
    const copyEl = document.getElementById('pd2bulk' + p.i + '-copy');
    const copy = p.tipo === 'publicación existente'
      ? ((item && item.postSeleccionado && item.postSeleccionado.caption) || '')
      : (copyEl ? copyEl.value.trim() : '');
    // Publicación existente: la red es la del post elegido (ya se sabe cuál
    // es). Material subido: puede ir a Facebook, Instagram o ambas a la vez
    // (state.pd2Redes) — se muestra un mock por cada una, con el look real
    // de esa red (pedido del usuario: "que simule Instagram cuando es
    // Instagram una de las redes").
    const plataformas = p.tipo === 'publicación existente'
      ? [(item && item.postSeleccionado && item.postSeleccionado.plataforma) || 'Facebook']
      : ((state.pd2Redes && state.pd2Redes.length) ? state.pd2Redes.map((r) => (r === 'instagram' ? 'Instagram' : 'Facebook')) : ['Facebook']);
    const post = plataformas.map((plataforma) => renderMockPost({
      nombrePagina,
      copy,
      mediaUrl: p.previewUrl,
      esVideo: p.tipo === 'video',
      badge: p.carruselCantidad ? '1/' + p.carruselCantidad : '',
      plataforma,
    })).join('<div style="height:10px"></div>');
    return unaSola ? post : ('<div>' + post + '<div style="font-size:11px;color:var(--color-neutral-500);margin-top:4px">Pieza ' + (p.i + 1) + '</div></div>');
  }).join('');

  const fallan = previews.filter(function (p) { return !p.ok; }).length;
  const cabecera = fallan
    ? '<div class="error" style="margin-bottom:10px">' + fallan + ' pieza(s) con el material mal: corregí el link y verificá de nuevo. No se creó nada.</div>'
    : '<div style="margin-bottom:10px;font-size:12px;color:var(--color-neutral-400)">Así se va a ver en Meta. Revisá que sean las piezas correctas y confirmá.</div>';

  return cabecera + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-bottom:14px">' + tarjetas + '</div>';
}

// Banner que queda en la pantalla de elegir modo después de un pedido
// exitoso (ver resetPedidoAnunciosV2) — mismo contenido que
// renderResultadoBulkV2 mostraba dentro del módulo, pero sobrevive al reset.
function renderResultadoFinalV2() {
  const el = document.getElementById('pd2-resultado-final');
  const resultados = state.pd2BulkResultados;
  if (!resultados || !resultados.length) { el.hidden = true; return; }
  el.hidden = false;
  const unaSola = resultados.length === 1;
  document.getElementById('pd2-resultado-final-body').innerHTML = resultados.map((r, i) => {
    if (!r.ok) return `<div class="error">${unaSola ? '' : `Pieza ${i + 1}: `}${esc(r.error)}</div>`;
    const estado = r.publicado ? 'publicada en Meta (en pausa)' : 'creada';
    const prefijo = unaSola ? 'Código' : `Pieza ${i + 1}: código`;
    return `<div style="color:var(--color-accent-2-600)">${prefijo} <code>${esc(r.codigo)}</code> — ${estado}.</div>`;
  }).join('');
}

// Vuelve la pantalla de "Pedido de Anuncios"/"Crear Anuncios" al estado
// inicial (las 2 tarjetas) después de un pedido 100% exitoso — sin esto,
// el próximo pedido arrancaba con la Campaña/Objetivo/Audiencia del
// anterior todavía cargados (ver reporte de bug del usuario).
function resetPedidoAnunciosV2() {
  state.pd2ModuloActivo = 1;
  state.pd2ModoCarga = null;
  state.pd2EjeCodigo = null;
  state.pd2CampanasSugeridas = [];
  state.pd2Objetivo = [];
  state.pd2AudienciaCodigo = '';
  state.pd2Refuerzo = [];
  state.pd2CombosExcluidos = {};
  state.pd2Visibilidad = 'DARK';
  state.pd2Redes = ['facebook', 'instagram'];
  state.pd2Placements = [];
  state.pd2Posts = [];
  state.pd2CargandoPosts = false;
  state.pd2BulkItems = [];
  state.pd2BulkPreviews = null;
  state.pd2BulkError = null;
  document.getElementById('pd2-fecha-inicio').value = '';
  document.getElementById('pd2-fecha-fin').value = '';
  document.getElementById('pd2-campana').value = '';
  document.getElementById('pd2-link-destino').value = '';
  document.getElementById('pd2-comentarios').value = '';
}

function renderResultadoBulkV2() {
  const resultados = state.pd2BulkResultados || [];
  const unaSola = resultados.length === 1;
  const filas = resultados.map((r, i) => {
    if (!r.ok) return `<div class="error">${unaSola ? '' : `Pieza ${i + 1}: `}${esc(r.error)}</div>`;
    const estado = r.publicado ? 'publicada en Meta (en pausa)' : 'creada';
    const prefijo = unaSola ? 'Código' : `Pieza ${i + 1}: código`;
    return `<div style="color:var(--color-accent-2-600)">${prefijo} <code>${esc(r.codigo)}</code> — ${estado}.</div>`;
  }).join('');

  const ok = resultados.filter((r) => r.ok);
  const pendientes = ok.filter((r) => !r.publicado);
  let nota = '';
  if (ok.length && !pendientes.length) {
    nota = '<div style="margin-top:8px;font-size:12px;color:var(--color-neutral-400)">Ya está' + (ok.length > 1 ? 'n' : '') + ' en Meta, en pausa — revisala' + (ok.length > 1 ? 's y activalas' : ' y activala') + ' desde Ads Manager.</div>';
  } else if (pendientes.length) {
    nota = `<div style="margin-top:8px;font-size:12px;color:var(--color-neutral-400)">${unaSola ? 'Quedó pendiente' : `${pendientes.length} pieza(s) quedaron pendientes`} en <strong>Validación de Anuncios</strong>: hay que confirmar${unaSola ? 'la' : 'las'} ahí para que se publique${unaSola ? '' : 'n'}. <button type="button" class="btn btn-ghost" data-action="ir-a-validacion" style="padding:2px 8px;font-size:12px">Ir a Validación →</button></div>`;
  }
  document.getElementById('pd2-bulk-resultado').innerHTML = renderPreviewsBulkV2() + filas + nota;

  const btn = document.getElementById('pd2-bulk-crear');
  const listo = !!(state.pd2BulkPreviews && state.pd2BulkPreviews.length && state.pd2BulkPreviews.every((p) => p.ok));
  if (btn && !state.pd2BulkEnviando && !state.pd2BulkVerificando) {
    btn.textContent = listo ? (state.pd2BulkItems.length > 1 ? 'Confirmar pedidos' : 'Confirmar pedido') : 'Ver preview';
  }
  bloquearFormularioV2(listo);
}

// Con el preview ya generado y sin errores, se bloquea todo el formulario
// (módulos 1-4, piezas y comentarios) para que lo que se manda a confirmar
// sea EXACTAMENTE lo que se previsualizó — antes se podía seguir editando
// Material/Copy después de "Ver preview" sin que eso invalidara nada.
// "Editar" (ver acción pd2-editar-bloqueo) tira el preview y desbloquea.
function bloquearFormularioV2(bloqueado) {
  ['pd2-modulo-1', 'pd2-modulo-2', 'pd2-modulo-3', 'pd2-modulo-4', 'pd2-bulk-items', 'pd2-comentarios-wrap'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.pointerEvents = bloqueado ? 'none' : '';
    el.style.opacity = bloqueado ? '.55' : '';
  });
  const btnEditar = document.getElementById('pd2-editar-bloqueo');
  if (btnEditar) btnEditar.hidden = !bloqueado;
}

async function enviarBulkV2() {
  sincronizarBulkAudienciasDesdeDOMV2();
  const ctx = armarContextoBulkV2();

  state.pd2BulkError = null;
  if (!ctx.objetivo.length) { state.pd2BulkError = 'Elegí el Objetivo (módulo 1) antes de crear los pedidos.'; renderBulkErrorV2(); return; }
  if (!ctx.campana) { state.pd2BulkError = 'Escribí la Campaña / Comunicación (módulo 1) antes de crear los pedidos.'; renderBulkErrorV2(); return; }
  if (!ctx.audienciaCodigo) { state.pd2BulkError = 'Elegí la Audiencia principal (módulo 2) antes de crear los pedidos.'; renderBulkErrorV2(); return; }
  if (!state.pd2BulkItems.length) { state.pd2BulkError = 'Elegí la Cantidad de piezas (módulo 4) antes de continuar.'; renderBulkErrorV2(); return; }

  // Mismo chequeo que en v1, pieza por pieza: si alguna no llega al mínimo
  // de Meta o tiene un reparto que no suma 100%, no se manda nada (mejor
  // que crear la mitad). Pedido de Pauta (PM): no aplica, el servidor
  // resuelve el monto solo.
  if (state.pd2ModoDirecto) {
    const flojas = [];
    state.pd2BulkItems.forEach((item, i) => {
      const presEl = document.getElementById(`pd2bulk${i}-presupuesto`);
      const audEl = document.getElementById(`pd2bulk${i}-audiencia`);
      const falta = faltaPresupuesto(
        presEl ? presEl.value : '', ctx.objetivo, audEl ? audEl.value : (item.audienciaCodigo || ''),
        ctx.refuerzoAudiencia, ctx.fechaInicio, ctx.fechaFin
      );
      if (falta) flojas.push({ i, falta });
      if (repartoInvalidoV2(i)) flojas.push({ i, reparto: true });
    });
    if (flojas.length) {
      const conFalta = flojas.find((f) => f.falta);
      state.pd2BulkError = conFalta
        ? `Pieza ${conFalta.i + 1}: el presupuesto no llega al mínimo de Meta. Son ${conFalta.falta.conjuntos} conjunto(s) × ${conFalta.falta.dias} día(s): hacen falta al menos ${fmtMoney(conFalta.falta.minTotal)} (${fmtMoney(conFalta.falta.minPorConjunto)} por conjunto).`
        : `Pieza ${flojas[0].i + 1}: el reparto de presupuesto tiene que sumar 100% antes de crear.`;
      renderBulkErrorV2();
      return;
    }
  }

  if (!state.pd2BulkPreviews || state.pd2BulkPreviews.some((p) => !p.ok)) {
    await verificarMaterialesBulkV2(ctx);
    return;
  }

  state.pd2BulkEnviando = true;
  state.pd2BulkResultados = [];
  const btn = document.getElementById('pd2-bulk-crear');
  btn.disabled = true;
  btn.textContent = 'Creando…';
  renderResultadoBulkV2();

  const endpoint = state.pd2ModoDirecto ? '/api/anuncios/crear-directo' : '/api/pedidos';

  for (let i = 0; i < state.pd2BulkItems.length; i++) {
    try {
      const r = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(armarDatosPiezaV2(i, ctx)),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detalle || data.error);
      state.pd2BulkResultados.push({ ok: true, codigo: data.codigo, publicado: !!data.publicado });
    } catch (err) {
      state.pd2BulkResultados.push({ ok: false, error: err.message });
    }
    renderResultadoBulkV2();
  }

  state.pd2BulkEnviando = false;
  state.pd2BulkPreviews = null;

  // Todo salió bien: reseteo la vista para el próximo pedido en vez de
  // dejar la Campaña/Objetivo/Audiencia del anterior cargados. Si hubo
  // algún error, me quedo en el módulo para que se pueda corregir.
  if (state.pd2BulkResultados.length && state.pd2BulkResultados.every((r) => r.ok)) {
    resetPedidoAnunciosV2();
    renderTabPedido2();
    return;
  }

  // El bloqueo de campos (bloquearFormularioV2) asume que lo que se manda a
  // confirmar es EXACTAMENTE lo que se previsualizó — pero acá ya se sabe
  // que al menos una pieza falló al confirmar (campos obligatorios, límite
  // de Meta, lo que sea). Dejar los campos bloqueados le sacaba la única
  // forma de corregir sin pasar por "Editar" — que además no tenía handler
  // (ver acción pd2-editar-bloqueo).
  bloquearFormularioV2(false);
  btn.disabled = false;
  btn.textContent = 'Ver preview';
}

function editarBloqueoV2() {
  state.pd2BulkPreviews = null;
  state.pd2BulkError = null;
  bloquearFormularioV2(false);
  renderResultadoBulkV2();
}

function renderBulkErrorV2() {
  document.getElementById('pd2-bulk-error').hidden = !state.pd2BulkError;
  document.getElementById('pd2-bulk-error').textContent = state.pd2BulkError || '';
}

// ---------- Pestaña "Crear Anuncios" (Implementadores) ----------
// Siempre arranca desde cero — no hay una cola de pedidos que procesar acá
// (ver mensaje del usuario: "Crear anuncio siempre es desde cero, no parte
// de un pedido"). Reusa el formulario/DOM entero de "Pedido de Pauta"
// (mismos ids) — la única diferencia real es a qué endpoint pega el submit
// y quién puede entrar a la pestaña (ver cambiarTab).

function cambiarTab(tab) {
  if (!tabsPermitidas().includes(tab)) return;
  state.pd2ModoDirecto = tab === 'crear';
  state.tabActiva = tab;
  document.querySelectorAll('.tab-btn[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  // "Crear Anuncios" reusa el contenedor de "Pedido de Pauta" — no hay un
  // tab-crear propio, el modo lo decide state.pd2ModoDirecto.
  document.getElementById('tab-pedido2').hidden = !(tab === 'pedido2' || tab === 'crear');
  document.getElementById('tab-pendientes').hidden = tab !== 'pendientes';
  document.getElementById('tab-admin').hidden = tab !== 'admin';
  if (tab === 'pedido2' || tab === 'crear') { if (!state.pdProyectos.length) cargarDatosPedido().then(renderTabPedido2); else renderTabPedido2(); }
  if (tab === 'pendientes') cargarItems();
  if (tab === 'admin') { if (!state.admActivosCargados) cargarDatosAdmin(); else renderTabAdmin(); }
  render();
}

// ---------- Onboarding: Login → Proyecto → Oficial/Informativo ----------
// Tres pantallas obligatorias antes de llegar a las pestañas de siempre.
// Cada elección restringe lo que se ve después (Proyecto acota Validación,
// Ecosistema acota qué Tipo de campaña se puede elegir) — ver
// middleware/usuarioActual.js para la validación server-side equivalente.

// Oficial todavía no arrancó (Fase 3, ver equiv_tipo.notas) — queda visible
// pero bloqueado en la pantalla 3 y en el botón de cambiar del nav, para no
// tener que tocar esto de nuevo cuando se habilite.
const ECOSISTEMAS_HABILITADOS = ['Informativo'];
const ECOSISTEMAS_VALIDOS = ['Oficial', 'Informativo'];

function esAdmin() {
  const u = usuarioActual();
  return !!u && u.rol === 'administrador';
}

// Qué pantalla corresponde mostrar AHORA MISMO, según lo que ya se eligió y
// si sigue siendo válido para el usuario actual (cambiar de usuario en el
// selector del nav puede invalidar un Proyecto que el nuevo usuario no
// tiene permitido — acá se re-chequea en cada render, no hace falta lógica
// aparte para detectarlo).
function pantallaActual() {
  if (!state.usuarioActualId || !usuarioActual()) return 'login';
  const permitidos = proyectosPermitidos();
  const proyectoValido = state.proyectoActivo === 'TODOS'
    ? esAdmin()
    : !!state.proyectoActivo && (permitidos === 'todos' || permitidos.includes(state.proyectoActivo));
  if (!proyectoValido) return 'proyecto';
  const ecosistemaValido = state.ecosistemaActivo === 'TODOS'
    ? esAdmin()
    : ECOSISTEMAS_VALIDOS.includes(state.ecosistemaActivo);
  if (!ecosistemaValido) return 'ecosistema';
  return 'app';
}

// Si con la última elección ya se completaron las 3 pantallas, arranca la
// app de verdad (carga de datos + primera pestaña). Si todavía falta una,
// el próximo render ya muestra la pantalla que corresponde.
function avanzarSiCorresponde() {
  if (pantallaActual() === 'app') entrarAlApp();
}

async function entrarAlApp() {
  const permitidas = tabsPermitidas();
  if (!permitidas.includes(state.tabActiva)) state.tabActiva = permitidas[0] || 'pendientes';
  cambiarTab(state.tabActiva);
}

// Proyectos disponibles + (Implementador y Administrador, que son quienes
// validan) cuántos pendientes tiene cada uno — se pide de una sola vez al
// llegar a la pantalla 2, no en cada render. pm_cuentas no valida, así que
// no ve el globo.
async function prepararPantallaProyecto() {
  const r = await apiFetch('/api/proyectos');
  state.proyectosDisponibles = r.ok ? await r.json() : [];
  const u = usuarioActual();
  if (u && (u.rol === 'implementador' || u.rol === 'administrador')) {
    const r2 = await apiFetch('/api/proyectos-pendientes');
    state.pendientesPorProyecto = r2.ok ? await r2.json() : {};
  } else {
    state.pendientesPorProyecto = {};
  }
  render();
}

function elegirUsuario(id) {
  state.usuarioActualId = id;
  localStorage.setItem('pautador_usuario_id', id);
  state.items = [];
  state.pdProyectos = [];
  render();
  if (pantallaActual() === 'proyecto') prepararPantallaProyecto();
  else avanzarSiCorresponde();
}

function elegirProyecto(valor) {
  state.proyectoActivo = valor;
  localStorage.setItem('pautador_proyecto_activo', valor);
  // El Ecosistema (Oficial/Informativo) se vuelve a preguntar en CADA
  // cambio de Proyecto — antes quedaba guardado en localStorage y una vez
  // elegido una vez, pantallaActual() saltaba esa pantalla para siempre,
  // incluso al cambiar a un Proyecto distinto.
  state.ecosistemaActivo = null;
  localStorage.removeItem('pautador_ecosistema_activo');
  state.items = [];
  state.pdProyectos = [];
  render();
  avanzarSiCorresponde();
}

function elegirEcosistema(valor) {
  state.ecosistemaActivo = valor;
  localStorage.setItem('pautador_ecosistema_activo', valor);
  // Fuerza a recargar /api/tipos con el filtro nuevo — vaciar solo pdTipos
  // no alcanza: cambiarTab() solo vuelve a pedir datos cuando pdProyectos
  // está vacío (ver cambiarTab), así que hay que vaciar eso también aunque
  // el Proyecto en sí no haya cambiado.
  state.pdTipos = [];
  state.pdProyectos = [];
  render();
  avanzarSiCorresponde();
}

// Botón "Cambiar de Proyecto" del nav — vuelve a la pantalla 2 sin tocar
// Ecosistema (son elecciones independientes, cada una con su propio botón).
function cambiarDeProyecto() {
  state.proyectoActivo = null;
  localStorage.removeItem('pautador_proyecto_activo');
  render();
  prepararPantallaProyecto();
}

// Botón del nav "Pasar a 'Oficial'"/"Pasar a 'Informativo'" — con solo dos
// valores reales, alterna directo sin pantalla intermedia. Si el usuario
// tenía "Ver ambos" (solo Admin) no hay un "otro" binario claro, así que
// manda de vuelta a la pantalla 3 para elegir uno de los tres.
function toggleEcosistema() {
  if (state.ecosistemaActivo === 'TODOS' || !ECOSISTEMAS_VALIDOS.includes(state.ecosistemaActivo)) {
    state.ecosistemaActivo = null;
    localStorage.removeItem('pautador_ecosistema_activo');
    render();
    return;
  }
  const otro = state.ecosistemaActivo === 'Informativo' ? 'Oficial' : 'Informativo';
  if (!ECOSISTEMAS_HABILITADOS.includes(otro)) return; // botón ya se muestra disabled
  elegirEcosistema(otro);
}

function renderPantallaLogin() {
  document.getElementById('pantalla-login-error').hidden = !state.loginError;
  document.getElementById('pantalla-login-error').textContent = state.loginError || '';
  document.getElementById('pantalla-login-google').hidden = !state.googleHabilitado;
  document.getElementById('pantalla-login-form').hidden = state.googleHabilitado;
  const btn = document.getElementById('pantalla-login-submit');
  btn.disabled = state.loginEnviando;
  btn.textContent = state.loginEnviando ? 'Entrando…' : 'Entrar';
}

// Login "fake" mientras Sistemas termina de dar de alta el OAuth Client de
// Google (ver services/usuarios.js loginPorEmail) — el mail reemplaza la
// lista de usuarios de demo que había antes. El transporte de acá para
// abajo no cambia (localStorage + header x-pautador-usuario, ver
// elegirUsuario): cuando el OAuth real esté listo, esta función es lo único
// que se reemplaza.
async function loginPorMail(email) {
  state.loginEnviando = true;
  state.loginError = null;
  render();
  try {
    const r = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'No se pudo entrar');
    state.loginEnviando = false;
    if (!state.usuarios.find((u) => u.id === data.id)) state.usuarios.push(data);
    elegirUsuario(data.id);
    return;
  } catch (err) {
    state.loginError = err.message;
  }
  state.loginEnviando = false;
  render();
}

function renderPantallaProyecto() {
  const u = usuarioActual();
  document.getElementById('pantalla-proyecto-usuario').textContent = u ? u.nombre : '';

  // Versión de prueba (no hay login real todavía): cambiar de usuario sin
  // volver a la pantalla de Login — útil para probar cómo ve esta misma
  // pantalla un rol distinto (ej. el globo de pendientes solo lo ve
  // Implementador).
  const selUsuario = document.getElementById('pantalla-proyecto-usuario-select');
  selUsuario.innerHTML = state.usuarios.map((usr) => `<option value="${esc(usr.id)}">${esc(usr.nombre)}</option>`).join('');
  if (state.usuarioActualId) selUsuario.value = state.usuarioActualId;

  const opciones = (state.proyectosDisponibles || []).map((p) => {
    const pendientes = state.pendientesPorProyecto[p] || 0;
    const badge = pendientes > 0 ? '<span class="pantalla-onboarding-badge">' + pendientes + '</span>' : '';
    return '<button type="button" class="pantalla-onboarding-opcion" data-action="elegir-proyecto" data-id="' + esc(p) + '">'
      + '<span class="titulo">' + esc(p) + '</span>' + badge + '</button>';
  }).join('');
  const opcionTodos = esAdmin()
    ? '<button type="button" class="pantalla-onboarding-opcion" data-action="elegir-proyecto" data-id="TODOS" style="border-style:dashed">'
      + '<span class="titulo">Ver todos los proyectos</span></button>'
    : '';
  document.getElementById('pantalla-proyecto-lista').innerHTML = opciones + opcionTodos
    || '<p style="color:var(--color-neutral-500);font-size:13px">Todavía no te asignaron ningún Proyecto — mientras tanto, elegí más abajo con qué usuario entrar.</p>';
}

function renderPantallaEcosistema() {
  document.getElementById('pantalla-ecosistema-contexto').textContent =
    state.proyectoActivo === 'TODOS' ? 'Todos los proyectos' : (state.proyectoActivo || '');
  const opciones = ECOSISTEMAS_VALIDOS.map((eco) => {
    const habilitado = ECOSISTEMAS_HABILITADOS.includes(eco);
    return '<button type="button" class="pantalla-onboarding-opcion" data-action="elegir-ecosistema" data-id="' + esc(eco) + '" ' + (habilitado ? '' : 'disabled title="Todavía no está habilitado"') + '>'
      + '<span class="titulo">' + esc(eco) + '</span>' + (habilitado ? '' : '<span class="subtitulo">Próximamente</span>') + '</button>';
  }).join('');
  const opcionAmbos = esAdmin()
    ? '<button type="button" class="pantalla-onboarding-opcion" data-action="elegir-ecosistema" data-id="TODOS" style="border-style:dashed"><span class="titulo">Ver ambos</span></button>'
    : '';
  document.getElementById('pantalla-ecosistema-lista').innerHTML = opciones + opcionAmbos;
}

function renderNavContexto() {
  document.getElementById('nav-proyecto-actual').innerHTML =
    '<i class="ph ph-buildings"></i> ' + esc(state.proyectoActivo === 'TODOS' ? 'Todos los proyectos' : (state.proyectoActivo || ''));

  const btnEco = document.getElementById('nav-ecosistema-actual');
  if (state.ecosistemaActivo === 'TODOS') {
    btnEco.textContent = 'Oficial + Informativo — cambiar';
    btnEco.disabled = false;
    btnEco.title = 'Elegir un ecosistema';
  } else {
    const otro = state.ecosistemaActivo === 'Informativo' ? 'Oficial' : 'Informativo';
    const puedeIr = ECOSISTEMAS_HABILITADOS.includes(otro);
    btnEco.textContent = (state.ecosistemaActivo || '') + ' — pasar a "' + otro + '"';
    btnEco.disabled = !puedeIr;
    btnEco.title = puedeIr ? ('Pasar a "' + otro + '"') : (otro + ' todavía no está habilitado');
  }
}

async function cambiarUsuario(id) {
  state.usuarioActualId = id;
  localStorage.setItem('pautador_usuario_id', id);
  // Cambiar de usuario puede cambiar qué pestañas y qué datos se ven — se
  // recarga todo lo que ya se había pedido para que quede consistente.
  // También puede invalidar el Proyecto/Ecosistema activos (el nuevo
  // usuario no tiene acceso a ese proyecto): pantallaActual() lo detecta
  // solo y manda de vuelta a la pantalla que corresponda.
  state.items = [];
  state.pdProyectos = [];
  render();
  const pantalla = pantallaActual();
  if (pantalla === 'proyecto') { prepararPantallaProyecto(); return; }
  if (pantalla === 'ecosistema') return;
  const permitidas = tabsPermitidas();
  if (!permitidas.includes(state.tabActiva)) state.tabActiva = permitidas[0] || 'pendientes';
  cambiarTab(state.tabActiva);
}

async function iniciarApp() {
  // Vuelta de /auth/google/callback (ver routes/auth.js): trae el id ya
  // resuelto y validado en la URL, o un error para mostrar en el Login.
  // Se lee y se limpia de la URL antes de cualquier otra cosa.
  const params = new URLSearchParams(location.search);
  const uidGoogle = params.get('uid');
  const loginErrorUrl = params.get('loginError');
  if (uidGoogle || loginErrorUrl) {
    params.delete('uid');
    params.delete('loginError');
    const resto = params.toString();
    history.replaceState(null, '', location.pathname + (resto ? '?' + resto : ''));
  }
  if (loginErrorUrl) state.loginError = loginErrorUrl;

  // Si esto falla (ej. el server no puede leer usuarios), NO puede dejar la
  // pantalla en blanco sin dibujar nada — mejor mostrar el error en el
  // Login que un blanco que solo se arregla si el usuario toca algo que
  // dispare un render() de casualidad (bug real que pasó en producción).
  try {
    const [rUsuarios, rConfig] = await Promise.all([apiFetch('/api/usuarios'), apiFetch('/api/auth/config')]);
    const dataUsuarios = await rUsuarios.json();
    if (!rUsuarios.ok) throw new Error(dataUsuarios.detalle || dataUsuarios.error || 'No se pudo cargar la lista de usuarios.');
    state.usuarios = Array.isArray(dataUsuarios) ? dataUsuarios : [];
    state.googleHabilitado = rConfig.ok ? (await rConfig.json()).googleHabilitado : false;
  } catch (err) {
    state.usuarios = [];
    state.googleHabilitado = false;
    state.loginError = err.message;
    render();
    return;
  }

  const idElegido = uidGoogle || state.usuarioActualId;
  const usuarioValido = state.usuarios.find((u) => u.id === idElegido);
  // A diferencia de antes, si no hay un usuario guardado válido NO se elige
  // el primero de la lista solo: se queda en null y la pantalla de Login lo
  // pide — recién ahí arranca el resto del onboarding.
  state.usuarioActualId = usuarioValido ? usuarioValido.id : null;
  if (usuarioValido) localStorage.setItem('pautador_usuario_id', usuarioValido.id);
  render();
  const pantalla = pantallaActual();
  if (pantalla === 'proyecto') { prepararPantallaProyecto(); return; }
  if (pantalla === 'ecosistema') return;
  if (pantalla === 'app') await entrarAlApp();
}

// ---------- Delegación de eventos ----------

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id;

  if (action === 'stop-prop') { e.stopPropagation(); return; }
  if (action === 'elegir-usuario') { elegirUsuario(id); return; }
  if (action === 'elegir-proyecto') { elegirProyecto(id); return; }
  if (action === 'elegir-ecosistema') { elegirEcosistema(id); return; }
  if (action === 'cambiar-de-proyecto') { cambiarDeProyecto(); return; }
  if (action === 'toggle-ecosistema') { toggleEcosistema(); return; }
  if (action === 'toggle-expand') { toggleExpand(id); return; }
  if (action === 'dropdown-toggle') {
    e.stopPropagation();
    const panel = document.querySelector(`#${id} .dropdown-multi-panel`);
    const abrir = panel.hidden;
    cerrarTodosLosDropdownsMulti(id);
    panel.hidden = !abrir;
    // Cerrar el propio con su mismo botón no pasa por
    // cerrarTodosLosDropdownsMulti (queda afuera a propósito, es el que se
    // está tocando) — si se acaba de CERRAR (no abrir) y es de una fila de
    // CSV, revalidar acá.
    if (!abrir) {
      const m = id.match(/^csv(\d+)-(?:objetivo|redes|placements)-dd$/);
      if (m) validarFilasCsv([Number(m[1])]);
    }
    return;
  }
  if (action === 'all-to-cell') { e.stopPropagation(); allToCell(id, el.dataset.objetivo, el.dataset.aud); return; }
  if (action === 'toggle-combo-bloqueado') { e.stopPropagation(); toggleComboBloqueado(id, el.dataset.objetivo, el.dataset.aud); return; }
  if (action === 'celda-hecha') { e.stopPropagation(); marcarCeldaHecha(id, el.dataset.objetivo, el.dataset.aud); return; }
  if (action === 'distribute-even') { e.stopPropagation(); distributeEven(id); return; }
  if (action === 'confirm-one') { e.stopPropagation(); confirmOne(id); return; }
  if (action === 'mark-manual') { e.stopPropagation(); markManual(id); return; }
  if (action === 'desestimar-abrir') { e.stopPropagation(); state.desestimandoId = id; state.desestimarError = null; state.editandoId = null; render(); return; }
  if (action === 'desestimar-cancelar') { e.stopPropagation(); state.desestimandoId = null; state.desestimarError = null; render(); return; }
  if (action === 'desestimar-confirmar') { e.stopPropagation(); desestimar(id); return; }
  if (action === 'devolver-confirmar') { e.stopPropagation(); devolverConMotivo(id); return; }
  if (action === 'corregir-y-pautar') { e.stopPropagation(); abrirEditar(id); return; }
  if (action === 'editarpauta-abrir') { e.stopPropagation(); abrirEditar(id); return; }
  if (action === 'editarpauta-cancelar') { e.stopPropagation(); cerrarEditar(); return; }
  if (action === 'editarpauta-guardar') { e.stopPropagation(); guardarEditar(id); return; }
  if (action === 'guardar-presupuesto') {
    e.stopPropagation();
    const valor = document.getElementById(`pto-edit-${id}`).value;
    guardarPresupuesto(id, valor);
    return;
  }
  if (action === 'dismiss-toast') { dismissToast(); return; }
  if (action === 'abrir-lightbox') { e.stopPropagation(); state.lightboxUrl = el.dataset.url; renderLightbox(); return; }
  if (action === 'cerrar-lightbox') { state.lightboxUrl = null; renderLightbox(); return; }
  if (action === 'pd2-resultado-final-cerrar') { state.pd2BulkResultados = null; renderResultadoFinalV2(); return; }
  if (action === 'ir-a-validacion') { cambiarTab('pendientes'); return; }
  // Mismo botón, dos pasos: sin preview verifica; con preview crea.
  if (action === 'pd2-confirmar-modulo') { confirmarModuloV2(Number(id)); return; }
  if (action === 'pd2-modo-carga') { cambiarModoCargaV2(id); return; }
  if (action === 'pd2-bulk-crear') { enviarBulkV2(); return; }
  if (action === 'pd2-editar-bloqueo') { editarBloqueoV2(); return; }
  if (action === 'pd2bulk-modo-material') {
    const idx = Number(el.dataset.index);
    const item = state.pd2BulkItems[idx];
    item.modoMaterial = id;
    (async () => {
      if (id === 'post' && !state.pd2Posts.length && !state.pd2CargandoPosts) await cargarPostsPedidoV2();
      document.getElementById(`pd2bulk${idx}-material-wrap`).innerHTML = renderMaterialBulkV2(idx);
    })();
    return;
  }
  if (action === 'pd2bulk-archivo-quitar') {
    const idx = Number(el.dataset.index);
    const item = state.pd2BulkItems[idx];
    item.archivoSubido = null;
    item.archivoError = null;
    state.pd2BulkPreviews = null;
    document.getElementById(`pd2bulk${idx}-material-wrap`).innerHTML = renderMaterialBulkV2(idx);
    return;
  }
  if (action === 'pd2bulk-seleccionar-post') {
    const idx = Number(el.dataset.index);
    state.pd2BulkItems[idx].postSeleccionado = state.pd2Posts.find((p) => p.id === id) || null;
    document.getElementById(`pd2bulk${idx}-material-wrap`).innerHTML = renderMaterialBulkV2(idx);
    return;
  }
  if (action === 'pd2bulk-modo-material-stories') {
    const idx = Number(el.dataset.index);
    state.pd2BulkItems[idx].materialStoriesModo = id;
    renderMaterialStoriesWrapV2(idx);
    return;
  }
  if (action === 'pd2bulk-archivo-stories-quitar') {
    const idx = Number(el.dataset.index);
    state.pd2BulkItems[idx].materialStoriesArchivo = null;
    state.pd2BulkItems[idx].materialStoriesError = null;
    renderMaterialStoriesWrapV2(idx);
    return;
  }
  if (action === 'pd2bulk-carrusel-agregar') {
    const idx = Number(el.dataset.index);
    sincronizarCarruselDesdeDOMV2(idx);
    state.pd2BulkItems[idx].carrusel.push({ valor: '', archivo: null, subiendo: false, error: null });
    renderMaterialWrapPiezaV2(idx);
    return;
  }
  if (action === 'pd2bulk-carrusel-quitar') {
    const idx = Number(el.dataset.index);
    const sub = Number(el.dataset.sub);
    sincronizarCarruselDesdeDOMV2(idx);
    state.pd2BulkItems[idx].carrusel.splice(sub, 1);
    renderMaterialWrapPiezaV2(idx);
    return;
  }
  if (action === 'pd2bulk-carrusel-cambiar') {
    const idx = Number(el.dataset.index);
    const sub = Number(el.dataset.sub);
    sincronizarCarruselDesdeDOMV2(idx);
    state.pd2BulkItems[idx].carrusel[sub].archivo = null;
    renderMaterialWrapPiezaV2(idx);
    return;
  }
  if (action === 'pd2bulk-carrusel-mover-arriba' || action === 'pd2bulk-carrusel-mover-abajo') {
    const idx = Number(el.dataset.index);
    const sub = Number(el.dataset.sub);
    sincronizarCarruselDesdeDOMV2(idx);
    const arr = state.pd2BulkItems[idx].carrusel;
    const otro = action === 'pd2bulk-carrusel-mover-arriba' ? sub - 1 : sub + 1;
    if (otro >= 0 && otro < arr.length) { const tmp = arr[sub]; arr[sub] = arr[otro]; arr[otro] = tmp; }
    renderMaterialWrapPiezaV2(idx);
    return;
  }
  if (action === 'pd2bulk-reparto-abrir') {
    state.pd2BulkItems[Number(el.dataset.index)].repartoAbierto = true;
    return;
  }
  if (action === 'pd2bulk-reparto-parejo') {
    const idx = Number(el.dataset.index);
    const item = state.pd2BulkItems[idx];
    const combos = combosDePiezaV2(idx);
    item.reparto = repartoConExclusionesV2(item, combos);
    item.repartoClaves = clavesDeCombos(combos);
    return;
  }
  if (action === 'pd-reparto-todo-aca') {
    const idx = Number(el.closest('[data-pieza-index]').dataset.piezaIndex);
    const item = state.pd2BulkItems[idx];
    const clave = el.dataset.clave;
    const anterior = item.reparto || {};
    const mapa = {};
    let bloqueadosSum = 0;
    Object.keys(anterior).forEach((k) => {
      if (item.repartoBloqueados[k]) { mapa[k] = Number(anterior[k]) || 0; bloqueadosSum += mapa[k]; } else mapa[k] = 0;
    });
    mapa[clave] = Math.max(0, +(100 - bloqueadosSum).toFixed(2));
    item.reparto = mapa;
    return;
  }
  if (action === 'pd-reparto-bloquear') {
    const idx = Number(el.closest('[data-pieza-index]').dataset.piezaIndex);
    const item = state.pd2BulkItems[idx];
    const clave = el.dataset.clave;
    item.repartoBloqueados = Object.assign({}, item.repartoBloqueados);
    if (item.repartoBloqueados[clave]) delete item.repartoBloqueados[clave];
    else item.repartoBloqueados[clave] = true;
    return;
  }
  if (action === 'pd-csv-modelo') { descargarModeloCsv(); return; }
  if (action === 'pd-csv-confirmar') { confirmarCargaCsv(); return; }
  if (action === 'adm-crear-activo') { crearActivoAdmin(); return; }
  if (action === 'adm-crear-audiencia') { crearAudienciaAdmin(); return; }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'pd-csv-archivo') {
    const archivo = e.target.files && e.target.files[0];
    if (archivo) subirCsv(archivo);
    e.target.value = '';
    return;
  }
  if (e.target.id === 'pd-csv-proyecto') { cambiarProyectoCsv(e.target.value); return; }
  if (e.target.id === 'pd-csv-activo') { state.pdActivoKey = e.target.value; return; }
  if (e.target.id === 'pd2-proyecto') { cambiarProyectoPd2(e.target.value); return; }
  if (e.target.id === 'pd2-activo') { state.pd2ActivoKey = e.target.value; return; }
  if (e.target.id === 'pd2-tipo') { state.pd2TipoCodigo = e.target.value; return; }
  if (e.target.id === 'pd2-eje') { state.pd2EjeCodigo = e.target.value; return; }
  if (e.target.id === 'pd2-audiencia') {
    state.pd2AudienciaCodigo = e.target.value;
    document.getElementById('pd2-otra-audiencia-wrap').hidden = e.target.value !== 'Otra';
    // Las piezas ya creadas (Módulo 5 arranca con 1 antes de llegar acá)
    // todavía no tienen Audiencia principal — se las precarga con esta,
    // sin pisar una que ya se haya tocado a mano por pieza.
    state.pd2BulkItems.forEach((item, i) => {
      if (!item.audienciaCodigo) {
        item.audienciaCodigo = e.target.value;
        const sel = document.getElementById(`pd2bulk${i}-audiencia`);
        if (sel) sel.value = e.target.value;
      }
    });
    renderCrucesV2();
    return;
  }
  if (e.target.id === 'pd2-visibilidad') {
    state.pd2Visibilidad = e.target.value;
    reiniciarMaterialesPiezasV2();
    renderTabPedido2();
    return;
  }
  if (e.target.id === 'pd2-formato') {
    // Antes de verificar/subir nada no se sabe si el material de cada pieza
    // es imagen o video (son varias, no una) — Reels queda habilitado acá,
    // el servidor lo bloquea igual si corresponde (mismo criterio que
    // materialEsImagenConocida() en v1, que tampoco lo sabe hasta verificar).
    const formatoInfo = state.pdFormatos.find((f) => f.appsheet_valor === e.target.value);
    state.pd2Placements = state.pd2Placements.filter((p) => placementDisponibleUI(formatoInfo, p, false));
    // Las piezas ya renderizadas quedan con el editor de Material (link/
    // archivo suelto vs. una fila por imagen) del Formato con el que se
    // crearon — si el nuevo Formato es Carrusel, o el anterior lo era, esa
    // forma cambia por completo y hay que refrescarlo. Para el resto de los
    // casos (imagen ↔ video) no se toca, para no perder un link ya tipeado.
    const esCarruselAhora = formatoInfo && formatoInfo.modo === 'carrusel';
    state.pd2BulkItems.forEach((item, i) => {
      const wrap = document.getElementById(`pd2bulk${i}-material-wrap`);
      if (!wrap) return;
      const eraCarrusel = !!wrap.querySelector('[data-carrusel-link-v2], [data-carrusel-archivo-v2]');
      if (esCarruselAhora || eraCarrusel) wrap.innerHTML = renderMaterialBulkV2(i);
    });
    setTimeout(renderTabPedido2, 0);
    return;
  }
  if (e.target.id === 'pd2-cantidad-piezas') { ajustarCantidadPiezasV2(e.target.value); return; }
  if (e.target.id === 'pd2-duracion') {
    const inicioEl = document.getElementById('pd2-fecha-inicio');
    const finEl = document.getElementById('pd2-fecha-fin');
    if (e.target.value) {
      const inicio = inicioEl.value || new Date().toISOString().slice(0, 10);
      if (!inicioEl.value) inicioEl.value = inicio;
      finEl.value = e.target.value === 'fin-de-mes' ? finDeMesLocal(inicio) : sumarDiasLocal(inicio, Number(e.target.value));
    }
    return;
  }
  if (e.target.classList.contains('pd2-objetivo-chk') || e.target.classList.contains('pd2-refuerzo-chk')) {
    const dd = e.target.closest('.dropdown-multi');
    if (dd) {
      const placeholder = dd.querySelector('.dropdown-multi-btn-label').dataset.placeholder;
      dd.querySelector('.dropdown-multi-btn-label').textContent = dropdownMultiLabel(dd.id, placeholder);
    }
    if (e.target.classList.contains('pd2-refuerzo-chk')) {
      document.getElementById('pd2-otras-refuerzo-wrap').hidden = !leerCheckboxes('pd2-refuerzo-chk').includes('Otra');
    }
    renderCrucesV2();
    return;
  }
  if (e.target.dataset.action === 'pd2-toggle-cruce') {
    const clave = e.target.dataset.clave;
    // No se puede destildar el último cruce que queda: la pieza necesita
    // al menos uno para poder pedirse.
    const checkedCount = document.querySelectorAll('#pd2-cruces-wrap input[type=checkbox]:checked').length;
    if (!e.target.checked && checkedCount === 0) {
      e.target.checked = true;
      return;
    }
    if (e.target.checked) delete state.pd2CombosExcluidos[clave];
    else state.pd2CombosExcluidos[clave] = true;
    renderCrucesV2();
    return;
  }
  if (e.target.classList.contains('pd2-placement-chk')) {
    state.pd2Placements = e.target.checked
      ? [...new Set([...state.pd2Placements, e.target.value])]
      : state.pd2Placements.filter((v) => v !== e.target.value);
    invalidarPreviewsPiezasV2();
    return;
  }
  if (e.target.classList.contains('pd2-red-chk')) {
    const val = e.target.value;
    state.pd2Redes = e.target.checked
      ? [...new Set([...state.pd2Redes, val])]
      : state.pd2Redes.filter((v) => v !== val);
    setTimeout(() => {
      document.getElementById('pd2-redes-inner').innerHTML = renderRedesCheckboxes(state.pd2Redes, false, 'pd2-red-chk');
    }, 0);
    return;
  }
  if (/^pd2bulk\d+-audiencia$/.test(e.target.id)) {
    const otraWrap = document.getElementById(`${e.target.id.replace('-audiencia', '')}-otra-audiencia-wrap`);
    if (otraWrap) otraWrap.hidden = e.target.value !== 'Otra';
    return;
  }
  if (e.target.hasAttribute('data-index') && /^pd2bulk\d+-material-archivo$/.test(e.target.id)) {
    const archivo = e.target.files && e.target.files[0];
    if (archivo) subirArchivoMaterialBulkV2(Number(e.target.dataset.index), archivo);
    return;
  }
  if (e.target.hasAttribute('data-carrusel-archivo-v2')) {
    const archivo = e.target.files && e.target.files[0];
    if (archivo) subirArchivoCarruselV2(Number(e.target.dataset.index), Number(e.target.dataset.sub), archivo);
    return;
  }
  if (e.target.hasAttribute('data-index') && /^pd2bulk\d+-material-stories-archivo$/.test(e.target.id)) {
    const archivo = e.target.files && e.target.files[0];
    if (archivo) subirArchivoMaterialStoriesV2(Number(e.target.dataset.index), archivo);
    return;
  }
  if (e.target.id === 'editarpauta-audiencia') {
    if (state.editarCampos) {
      sincronizarEditarDesdeDOM();
      state.editarCampos.audienciaCodigo = e.target.value;
      render();
    }
    return;
  }
  if (e.target.hasAttribute('data-csv-campo')) {
    // Campos de un solo valor (select normal) o texto libre — los
    // multivalor (Objetivo/Red/Placement) no pasan por acá, son el
    // desplegable-con-checkboxes de más abajo.
    const idx = Number(e.target.dataset.csvIndex);
    const campo = e.target.dataset.csvCampo;
    const fila = state.pdCsvFilas[idx];
    if (!fila) return;
    fila.campos[campo] = e.target.value;
    validarFilasCsv([idx]);
    return;
  }
  {
    // Checkbox de un desplegable-con-checkboxes de una fila de CSV
    // (Objetivo/Red/Placement) — mismo componente que ya usa Objetivo en
    // el resto del formulario. No se revalida ACÁ (eso cerraría el panel
    // de golpe en cada tilde) — se revalida cuando el desplegable se
    // cierra, ver cerrarTodosLosDropdownsMulti.
    const m = Array.from(e.target.classList).map((c) => c.match(/^csv(\d+)-(objetivo|redes|placements)-chk$/)).find(Boolean);
    if (m) {
      const idx = Number(m[1]);
      const campo = m[2];
      const fila = state.pdCsvFilas[idx];
      if (fila) fila.campos[campo] = leerCheckboxes(`csv${idx}-${campo}-chk`);
      const dd = e.target.closest('.dropdown-multi');
      if (dd) {
        const placeholder = dd.querySelector('.dropdown-multi-btn-label').dataset.placeholder;
        dd.querySelector('.dropdown-multi-btn-label').textContent = dropdownMultiLabel(dd.id, placeholder);
      }
      return;
    }
  }
  if (e.target.dataset.action === 'pd-reparto-incluir') {
    const idx = Number(e.target.closest('[data-pieza-index]').dataset.piezaIndex);
    const item = state.pd2BulkItems[idx];
    const clave = e.target.dataset.clave;
    item.repartoExcluidos = Object.assign({}, item.repartoExcluidos);
    if (e.target.checked) {
      delete item.repartoExcluidos[clave];
    } else {
      item.repartoExcluidos[clave] = true;
      // Excluir y bloquear son mutuamente excluyentes — si estaba
      // bloqueada, se saca el bloqueo (no tendría sentido "no se crea" y
      // "bloqueado en X%" a la vez).
      if (item.repartoBloqueados[clave]) {
        item.repartoBloqueados = Object.assign({}, item.repartoBloqueados);
        delete item.repartoBloqueados[clave];
      }
    }
    // Al sumar o sacar un conjunto se reparte parejo de nuevo entre los que
    // quedan — si no, el total dejaría de sumar 100 y habría que ir a
    // corregir a mano cada vez.
    item.reparto = repartoConExclusionesV2(item, combosDePiezaV2(idx));
    return;
  }
  if (e.target.dataset.action === 'pd-reparto-slider') {
    const idx = Number(e.target.closest('[data-pieza-index]').dataset.piezaIndex);
    const item = state.pd2BulkItems[idx];
    const valor = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));
    item.reparto = repartoTrasMoverSliderV2(item, combosDePiezaV2(idx), e.target.dataset.clave, valor);
    return;
  }
  if (e.target.dataset.action === 'toggle-select') {
    e.stopPropagation();
    toggleSelect(e.target.dataset.id);
  } else if (e.target.dataset.action === 'set-pct') {
    setPct(e.target.dataset.id, e.target.dataset.objetivo, e.target.dataset.aud, parseFloat(e.target.value));
  } else if (e.target.dataset.action === 'toggle-combo-excluido') {
    toggleComboExcluido(e.target.dataset.id, e.target.dataset.objetivo, e.target.dataset.aud);
  } else if (e.target.dataset.action === 'toggle-misma-publicacion') {
    state.mismaPublicacion[e.target.dataset.id] = e.target.checked;
    render();
  } else if (e.target.dataset.action === 'celda-post-id') {
    const clave = `${e.target.dataset.id}|${e.target.dataset.objetivo}|${e.target.dataset.aud}`;
    state.celdaPostIds[clave] = e.target.value.trim();
  } else {
    const dd = e.target.closest('.dropdown-multi');
    if (dd) {
      const placeholder = dd.querySelector('.dropdown-multi-btn-label').dataset.placeholder;
      dd.querySelector('.dropdown-multi-btn-label').textContent = dropdownMultiLabel(dd.id, placeholder);
    }
    if (e.target.id === 'adm-aud-activo') {
      state.admAudActivoKey = e.target.value;
      state.admAudError = null;
      state.admAudExito = null;
      (async () => {
        if (!state.admAudienciasPorActivo[state.admAudActivoKey]) await cargarAudienciasDeActivo(state.admAudActivoKey);
        renderTabAdmin();
      })();
    }
  }
});

// Cierra cualquier menú desplegable (checkbox) abierto al clickear afuera —
// se registra en fase de captura para llegar antes que "stop-prop" de otros
// handlers de click.
document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown-multi')) cerrarTodosLosDropdownsMulti(null);
}, true);

// Cualquier cambio del formulario puede mover el mínimo exigido (presupuesto,
// fechas, cantidad de objetivos/audiencias) — se recalcula el aviso y el
// reparto de cada pieza siempre, pero solo importa en "Crear Anuncios".
['change', 'click'].forEach((evento) => {
  document.addEventListener(evento, (e) => {
    if (state.tabActiva !== 'pedido2' && state.tabActiva !== 'crear') return;
    if (!e.target.closest || !e.target.closest('#tab-pedido2')) return;
    if (state.pd2ModoCarga !== 'anuncios') return;
    setTimeout(recalcularPiezasV2, 0);
  });
});

document.getElementById('historial-toggle').addEventListener('click', toggleHistory);
document.getElementById('batch-confirm').addEventListener('click', confirmBatch);
document.getElementById('batch-desestimar-abrir').addEventListener('click', () => {
  state.batchDesestimarAbierto = true;
  state.batchDesestimarError = null;
  render();
});
document.getElementById('batch-desestimar-cancelar').addEventListener('click', () => {
  state.batchDesestimarAbierto = false;
  render();
});
document.getElementById('batch-desestimar-confirmar').addEventListener('click', desestimarBatch);

document.querySelectorAll('.tab-btn[data-tab]').forEach((btn) => btn.addEventListener('click', () => cambiarTab(btn.dataset.tab)));

document.getElementById('usuario-actual').addEventListener('change', (e) => cambiarUsuario(e.target.value));
document.getElementById('pantalla-proyecto-usuario-select').addEventListener('change', (e) => cambiarUsuario(e.target.value));

// Línea de cada pieza de "Pedir múltiples anuncios" (elementos creados
// dinámicamente al "Generar piezas" — delegado, no hay un listener directo
// posible al momento en que se define este bloque).
document.addEventListener('input', (e) => {
  // Si se toca el material, lo verificado deja de valer: hay que volver a
  // verificar antes de poder crear.
  if (e.target.id && /^pd2bulk\d+-material$/.test(e.target.id) && state.pd2BulkPreviews) {
    state.pd2BulkPreviews = null;
    renderResultadoBulkV2();
  }
});

// Tocar el logo vuelve todo a cero — un recargado de página en vez de
// intentar resetear a mano cada pestaña/formulario, así queda garantizado
// que no se olvida ningún estado suelto (igual que cerrar y volver a abrir
// la pestaña). El usuario "actuando como" no se pierde: vive en
// localStorage, no en este estado en memoria.
document.getElementById('nav-brand-reset').addEventListener('click', () => {
  location.reload();
});

document.getElementById('pantalla-login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const email = document.getElementById('pantalla-login-email').value.trim();
  if (!state.loginEnviando) loginPorMail(email);
});

iniciarApp();
