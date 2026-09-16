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
const ORDEN_OBJETIVOS = ['Alcance', 'Interacción', 'Impresiones', 'Views', 'Tráfico', 'Conversión'];
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
  // Abierto por default: sin audiencia manual ni Validación intermedia
  // (MVP), "Pendientes" queda vacío por construcción — si el historial
  // arrancara plegado, la pantalla se vería vacía sin motivo aparente.
  historyOpen: true,
  // Historial desde la hoja CodigosContenido (ver renderHistorialSheet).
  historial: { filas: [], cargado: false, cargando: false, error: null, desde: '', sinHoja: false, busqueda: '', activo: '', expandido: null, marcando: null },
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
  modoActivo: localStorage.getItem('pautador_modo_activo') || null,
  proyectosDisponibles: [],
  pendientesPorProyecto: {},
  // Una entrada por pieza pendiente ({proyecto, modo, ecosistema,
  // plataformas}) — alimenta los globos de TODAS las pantallas del
  // onboarding (Proyecto → Modo → Ecosistema → Plataforma).
  pendientesDetalle: [],
  pendientesDetalleCargado: false,
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
  // Plataformas del Pedido Normal (GET /api/plataformas) y la elegida en
  // Módulo 1 — en automatizado solo viene Meta y el selector no se muestra.
  pdPlataformas: [],
  // Plataformas elegidas en la cuadrícula (multipick) al entrar a "Pedido
  // de Anuncios"; hasta que se confirma (pd2PlataformaElegida) no se
  // muestran los módulos.
  pd2Plataformas: ['Meta'],
  pd2PlataformaElegida: false,
  // [{proyecto, cliente}] de GET /api/proyectos?detalle=1 — la pantalla de
  // Proyecto los agrupa por cliente y el nav muestra "Cliente · Proyecto".
  proyectosDetalle: [],
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
  // Pestaña Creatividades (solo superadmin): datos del server y filtros.
  creaDatos: null, creaCargando: false, creaError: '',
  creaFiltro: { proyecto: '', campana: '', texto: '', vencidas: false },
  // Cruces Objetivo|Audiencia que el PM desactivó antes de pedir, y cómo se
  // reparte el % de inversión entre los que quedan — ver renderCrucesV2.
  // Viven fuera de pd2BulkItems porque Objetivo/Audiencia son compartidos
  // por todas las piezas del pedido, no por pieza. Mismo motor que el
  // reparto de "Crear Anuncios" bulk (repartoParejo/repartoConExclusionesV2/
  // repartoTrasMoverSliderV2 en vez de duplicar la lógica).
  pd2CombosExcluidos: {},
  pd2Reparto: null,
  pd2RepartoBloqueados: {},
  pd2RepartoFirma: null,
  pd2RepartoSugerido: null,
  // Presupuesto total resuelto por el servidor (Tipo × tamaño de Audiencia)
  // — en "Pedido de Pauta" nunca se elige a mano, así que el panel de
  // reparto lo pide solo para mostrar montos en pesos (ver
  // actualizarPresupuestoPreviewPd2). null = todavía no se pudo calcular
  // (por eso el panel muestra solo % en ese caso, no $).
  pd2PresupuestoPreview: null,
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

  // ---- pestaña "Panel Usuarios" (solo administradores) ----
  // usuDatos: respuesta de GET /api/admin/usuarios ({usuarios, proyectos,
  // roles, yo}). usuEdit: copia de trabajo del usuario seleccionado —
  // accesos como Set de "proyecto|activo_key" ("proyecto|" = todo el
  // proyecto) hasta que se aprieta Guardar.
  usuDatos: null,
  usuCargando: false,
  usuSelId: null,
  usuEdit: null,
  usuError: null,
  usuExito: null,
  usuNuevoError: null,
  usuGuardando: false,
  usuProyectos: [],
  usuProyectoCambiando: null,

};

function apiFetch(url, opts = {}) {
  const headers = Object.assign({}, opts.headers, {
    'x-pautador-usuario': state.usuarioActualId || '',
    'x-pautador-proyecto': state.proyectoActivo || '',
    'x-pautador-ecosistema': state.ecosistemaActivo || '',
    'x-pautador-modo': state.modoActivo || '',
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
// "crear" (Crear Anuncios) quedó redundante con "pedido2" (Pedido de
// Anuncios) una vez que ambos modos (Automatizado/Normal, ver la pantalla
// de onboarding) publican en Meta en el mismo request sin instancia de
// Validación — las dos pestañas hacían lo mismo con distinta pantalla. El
// Implementador pasa a usar "pedido2" igual que PM/Cuentas (mismo
// presupuesto automático por escala, ya no lo tipea a mano) y arranca en
// "pendientes" (Historial: ahí están sus tareas — piezas manuales para
// cargar y marcar hechas). administrador conserva "crear" por si hace
// falta el camino de presupuesto manual para algún caso puntual.
const TABS_POR_ROL = {
  pm_cuentas: ['pedido2', 'pendientes'],
  implementador: ['pendientes', 'pedido2'],
  // "Crear Anuncios" (publicar directo con presupuesto a mano) se sacó el
  // 2026-09-12: era redundante — Pedido Automatizado ya publica directo y
  // el presupuesto se cambia desde Historial. state.pd2ModoDirecto queda
  // siempre en false.
  administrador: ['pedido2', 'pendientes', 'admin', 'usuarios'],
};

function tabsPermitidas() {
  const u = usuarioActual();
  if (!u) return [];
  let tabs = TABS_POR_ROL[u.rol] || [];
  // Biblioteca de creatividades: solo superadmin (usuario, 2026-09-14).
  // "Agregar Activos / Audiencias": también solo superadmin por ahora
  // (usuario, 2026-09-15).
  tabs = u.es_superadmin ? [...tabs, 'creatividades'] : tabs.filter((t) => t !== 'admin');
  // Entrada ADMIN (todos los proyectos): sin pedidos — un pedido siempre es
  // de un proyecto concreto.
  if (state.proyectoActivo === 'TODOS') tabs = tabs.filter((t) => t !== 'pedido2');
  return tabs;
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
    const [r] = await Promise.all([apiFetch('/api/items'), cargarHistorialSheet()]);
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
// activoKey: el de la pauta que se está por editar (audiencias son por
// activo, no hay una lista fija) — sin eso, no se piden audiencias acá,
// quien llame ya las tendrá si hace falta (ej. Módulo 1 de Pedido de Anuncios).
async function asegurarDatosReferencia(activoKey) {
  const tareas = [];
  if (!state.pdFormatos.length) tareas.push(apiFetch('/api/formatos').then((r) => (r.ok ? r.json() : [])).then((d) => { state.pdFormatos = d; }));
  if (!state.pdObjetivos.length) tareas.push(apiFetch('/api/objetivos').then((r) => (r.ok ? r.json() : [])).then((d) => { state.pdObjetivos = ordenarObjetivos(d); }));
  if (activoKey) tareas.push(cargarAudienciasPorActivo(activoKey));
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
  try {
    const r = await apiFetch('/api/pauta/' + encodeURIComponent(id));
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error || 'No se pudo cargar la pieza');
    const p = data.pauta;
    await asegurarDatosReferencia(p.activo);
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

// Marca TODAS las celdas manuales pendientes de una — antes había que ir
// celda por celda con "Marcar hecha" aunque para quien lo carga en Meta sea
// un solo trámite (el carril entero, no una celda a la vez).
async function marcarTodoManualHecho(id) {
  const it = findItem(id);
  if (!it) return;
  const pendientes = it.celdas.filter((c) => c.manual && c.estadoCelda !== 'manual_hecha' && c.estadoCelda !== 'manual');
  if (!pendientes.length) return;
  const clave = `${id}|__todo_manual`;
  state.accionEnCurso[clave] = 'celda';
  render();
  try {
    for (let i = 0; i < pendientes.length; i += 1) {
      const c = pendientes[i];
      // eslint-disable-next-line no-await-in-loop
      const r = await apiFetch(`/api/pauta/${encodeURIComponent(id)}/celda-hecha`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objetivo: c.objetivo, audiencia_codigo: c.audCodigo }),
      });
      // eslint-disable-next-line no-await-in-loop
      const data = await r.json();
      if (!r.ok) throw new Error(data.detalle || data.error || 'No se pudo marcar');
    }
    state.toast = { titulo: 'Marcado hecho a mano', lines: [{ codigo: it.codigo, resumen: `${pendientes.length} conjunto(s) manual(es) cargados a mano en Meta.` }] };
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
    state.batchDesestimarError = 'Escribí el motivo — se aplica a todos los contenidos seleccionados.';
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
  if (item.error_publicacion && !isConfirmed && !isManualDone && !isDesestimada) tags.push({ label: 'Error al publicar', clase: 'tag tag-outline', estilo: 'border-color:var(--color-error, #c0392b);color:var(--color-error, #c0392b)' });
  if (celdasAuto.length) tags.push({ label: `${celdasAuto.length} conjunto${celdasAuto.length > 1 ? 's' : ''}`, clase: 'tag tag-accent' });
  if (hayManual) tags.push({ label: 'A mano', clase: 'tag tag-outline' });
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
      adId: c.manual ? '' : (c.ad_id || ''),
      adsetId: c.manual ? '' : (c.adset_id || ''),
    }));
  }

  return {
    id: item.correlation_id, codigo: item.codigo, activoNombre: item.activo_nombre, activo: item.activo, proyecto: item.proyecto, adAccountId: item.ad_account_id || '',
    isDark: item.visibilidad === 'DARK', fecha: item.fecha, campana: item.campana, contenido: item.contenido, eje: item.eje, formato: item.formato,
    linkDestino: item.link_destino || '',
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
    tags, estadoLabel: isConfirmed ? 'Confirmada' : (isManualDone ? 'Hecha a mano' : (isDesestimada ? 'Desestimada' : (isDevueltaPm ? 'Devuelta para corrección' : (isPendienteManual ? 'Cargar a mano' : 'Pendiente')))),
    isExpanded, chevronClass: 'ph ' + (isExpanded ? 'ph-caret-down' : 'ph-caret-right'),
    selectable: item.estado === 'pendiente' && !isManualOnly && !isDesestimada && puedeEditarValidacion(),
    isSelected: !!state.selected[item.correlation_id],
    esMatriz, isManualOnly: isManualOnly && !isConfirmed && !isManualDone && !isDesestimada && !isDevueltaPm,
    isSimpleAuto: !esMatriz && !isManualOnly && !isConfirmed && !isManualDone && !isDesestimada && !isPendienteManual && !isDevueltaPm,
    isMatrizEditable: esMatriz && !isConfirmed && !isManualDone && !isDesestimada && !isPendienteManual && !isDevueltaPm,
    isConfirmed, isManualDone, isPendienteManual, isDesestimada, isDevueltaPm,
    puedeEditarPauta: (isDevueltaPm || (!isConfirmed && !isManualDone && !isDesestimada)) && puedeEditarCampos(),
    motivoDesestimacion: item.motivo_desestimacion || '',
    errorPublicacion: item.error_publicacion || '',
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

// El carril automático (audiencia real, lo publica PAUTADOR) y el manual
// (audiencia "Otra", se carga a mano) se resuelven por vías separadas — uno
// no espera al otro (ver renderCarriles). Antes convivían en una sola fila
// de la cola de Validación aunque uno pudiera cerrarse sin el otro; acá se
// separan en dos filas de la lista, cada una con su propio expand. Las
// acciones de todo el pedido (Desestimar/Editar/Comentarios) siguen
// apuntando al mismo vm.id — siguen siendo el mismo pedido, solo se lo
// muestra en dos filas porque el trabajo de cada parte es independiente.
function splitVMSiMixto(vm) {
  if (!vm.combos.length) return [vm];
  const comboAuto = vm.combos.filter((c) => !c.manual);
  const comboManual = vm.combos.filter((c) => c.manual);
  if (!comboAuto.length || !comboManual.length) return [vm];

  const etiquetaAudiencias = (combos) => {
    const nombres = combos.map((c) => c.audNombre).filter((v, i, arr) => arr.indexOf(v) === i);
    return nombres.length > 1 ? nombres[0] + ' +' + (nombres.length - 1) + ' más' : (nombres[0] || '—');
  };
  const etiquetaObjetivos = (combos) => combos.map((c) => c.objetivo).filter((v, i, arr) => arr.indexOf(v) === i).join(' + ');
  const montoDe = (combos) => combos.reduce((a, c) => a + c.monto, 0);
  const bulkTag = vm.tags.find((t) => t.label.indexOf('Bulk') === 0);

  const parte = (sufijo, combos, tagsParte, soloParte) => {
    const rowKey = vm.id + '::' + sufijo;
    return Object.assign({}, vm, {
      rowKey,
      isExpanded: state.expandedId === rowKey,
      chevronClass: 'ph ' + (state.expandedId === rowKey ? 'ph-caret-down' : 'ph-caret-right'),
      combos,
      tags: tagsParte,
      objetivosLabel: etiquetaObjetivos(combos),
      audienciaLabel: etiquetaAudiencias(combos),
      presupuestoLabel: fmtMoney(montoDe(combos)),
      soloParte,
    });
  };

  const tagsAuto = [{ label: `${comboAuto.length} conjunto${comboAuto.length > 1 ? 's' : ''}`, clase: 'tag tag-accent' }].concat(bulkTag ? [bulkTag] : []);
  const tagsManual = [{ label: 'A mano', clase: 'tag tag-outline' }].concat(bulkTag ? [bulkTag] : []);

  return [
    parte('auto', comboAuto, tagsAuto, 'auto'),
    parte('manual', comboManual, tagsManual, 'manual'),
  ];
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
    : `<div style="display:flex;flex-wrap:wrap;gap:4px">${vm.tags.map((t) => `<span class="${t.clase}"${t.estilo ? ` style="${t.estilo}"` : ''}>${esc(t.label)}</span>`).join('')}</div>`;
  const chevronCell = isHistorial ? '' : `<div style="text-align:center"><i class="${vm.chevronClass}"></i></div>`;

  return `
    <div class="row-line" style="grid-template-columns:${columnsCss}${isHistorial ? '' : ''}" data-action="toggle-expand" data-id="${vm.rowKey || vm.id}">
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
      ${dato(vm.soloParte ? 'Presupuesto de esta parte' : 'Presupuesto total', vm.presupuestoLabel)}
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
          ${titulo('Automático', `${auto.length} combinación(es) objetivo × audiencia — las publica PAUTADOR`)}
          ${yaPublicado ? '' : `<button class="btn btn-secondary" style="font-size:12px;padding:4px 10px" data-action="distribute-even" data-id="${vm.id}"><i class="ph ph-equals"></i>Repartir parejo</button>`}
        </div>
        ${mismaPublicacionCheck}
        <div style="display:flex;flex-direction:column;gap:8px">
          ${auto.map((c) => renderCombo(vm, c)).join('')}
        </div>
        ${avisoMinimo(vm)}
        ${yaPublicado ? '' : `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
            <div style="font-size:14px;font-family:var(--font-heading)">Subtotal: ${subtotal(auto)}</div>
            <button class="btn btn-primary" ${(vm.confirmDisabled || confirmando) ? 'disabled' : ''} data-action="confirm-one" data-id="${vm.id}">${confirmando ? '<span class="spinner-inline"></span>Publicando…' : 'Confirmar y publicar'}</button>
          </div>
          ${vm.confirmDisabled ? `<div style="font-size:12px;color:var(--color-neutral-400);margin-top:6px">El reparto (automático + a mano) tiene que sumar 100% — hoy suma ${vm.totalLabel}.</div>` : ''}
          ${confirmando ? `<div style="font-size:12px;color:var(--color-neutral-500);text-align:right;margin-top:6px">Publicando ${auto.length} combinación(es) en Meta — puede tardar unos segundos, no hace falta reintentar.</div>` : ''}`}
      </div>`;
  }

  let bloqueManual = '';
  if (manual.length) {
    const pendientes = manual.filter((c) => c.estadoCelda !== 'manual_hecha' && c.estadoCelda !== 'manual').length;
    const marcandoTodo = state.accionEnCurso[`${vm.id}|__todo_manual`] === 'celda';
    bloqueManual = `
      <div style="border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:14px 16px;margin-top:12px">
        <div style="margin-bottom:8px">${titulo('A mano', `${manual.length} combinación(es) objetivo × audiencia — las cargás vos en la plataforma${pendientes ? '' : ' · todo marcado'}`)}</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${manual.map((c) => renderCombo(vm, c)).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
          <div style="font-size:14px;font-family:var(--font-heading)">Subtotal: ${subtotal(manual)}</div>
          ${(pendientes > 1 && puedeEditarValidacion()) ? `<button class="btn btn-primary" ${marcandoTodo ? 'disabled' : ''} data-action="marcar-todo-manual" data-id="${vm.id}">${marcandoTodo ? '<span class="spinner-inline"></span>Marcando…' : 'Marcar todo hecho'}</button>` : ''}
        </div>
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
      Si confirmás así, Meta va a rechazar ${flojas === 1 ? 'esa celda' : 'esas celdas'}: subí el presupuesto del contenido, acortá la duración, o concentrá el reparto en menos celdas.
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
    linkDestino: vm.linkDestino || '',
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
  // siguen ocupando lo mismo en vez de estirarse horizontal). Sin
  // comentarios no tiene sentido reservar ese renglón entero solo para los
  // botones: se suman a la fila del título (pedido del usuario — ocupaba
  // mucho espacio vacío) y se salta la fila 3 por completo.
  const tieneComentarios = !!vm.comentarios;
  const accionesTriggers = `${editarTrigger}${desestimarTrigger}`;
  const filaComentarios = tieneComentarios ? `
    <div style="display:flex;align-items:stretch;gap:16px;flex-wrap:wrap;margin-bottom:16px">
      <div style="flex:1;min-width:260px;font-size:13px;color:var(--color-neutral-300);background:var(--color-bg);border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:8px 12px">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--color-neutral-500)">Comentarios: </span>${esc(vm.comentarios)}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;flex:none">
        ${accionesTriggers}
      </div>
    </div>` : '';
  const header = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:8px;flex-wrap:wrap">
      <h4 style="margin:0">${esc(vm.contenido || vm.campana)}</h4>
      <div style="display:flex;align-items:center;gap:14px;flex:none;flex-wrap:wrap">
        ${tieneComentarios ? '' : accionesTriggers}
        <span class="tag tag-accent" style="font-family:monospace">${esc(vm.codigo)}</span>
        ${vm.publicacionLink ? `<a href="${esc(vm.publicacionLink)}" target="_blank" rel="noopener" style="font-size:13px;display:flex;gap:6px;align-items:center"><i class="ph ph-arrow-square-out"></i>Ver publicación</a>` : ''}
        ${vm.linkDestino ? `<a href="${esc(vm.linkDestino)}" target="_blank" rel="noopener" style="font-size:13px;display:flex;gap:6px;align-items:center"><i class="ph ph-link"></i>${esc(vm.linkDestino)}</a>` : ''}
      </div>
    </div>
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;color:var(--color-neutral-500);margin-bottom:14px">
      <span>Eje: ${esc(vm.eje)} · Fecha: ${esc(vm.fecha)} · ${esc(vm.duracionLabel)}</span>
      ${categorias}
    </div>
    ${filaComentarios}
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
      + (vm.puedeEditarPauta && !editarAbierto ? '<div style="margin-top:10px"><button class="btn btn-primary" data-action="editarpauta-abrir" data-id="' + esc(vm.id) + '">Corregir este contenido</button></div>' : '')
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
            ${rl.isManual
              ? '<span class="tag tag-outline" style="flex:none">A mano — cargar en la plataforma</span>'
              : (rl.adsetId
                ? `<a class="btn btn-ghost" style="font-size:12px;padding:2px 8px;flex:none" target="_blank" rel="noopener" title="${esc(rl.ids)}" href="https://adsmanager.facebook.com/adsmanager/manage/adsets?${vm.adAccountId ? 'act=' + esc(vm.adAccountId) + '&' : ''}selected_adset_ids=${esc(rl.adsetId)}"><i class="ph ph-arrow-square-out"></i> Ver en Ads Manager</a>`
                : '')}
          </div>`).join('')}
      </div>`;
  } else if (vm.isManualOnly) {
    body = `
      <div style="display:flex;justify-content:space-between;align-items:center;background:var(--color-bg);border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:14px 16px;gap:16px">
        <div>
          <div style="font-family:var(--font-heading);margin-bottom:2px">Audiencia "Otra" — ${esc(vm.audienciaOtraTexto)}</div>
          <div style="font-size:12px;color:var(--color-neutral-500)">Sin ID de Meta. Este contenido se crea a mano; no puede publicarse desde acá.</div>
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
  // Falló la publicación en Meta (o un paso previo) en el último intento:
  // el motivo va arriba de todo, antes del reparto, para que se vea sin
  // buscarlo — la pieza sigue pendiente y se puede volver a pedir.
  const avisoError = vm.errorPublicacion && !vm.isConfirmed && !vm.isManualDone && !vm.isDesestimada
    ? '<div style="border:1px solid var(--color-error, #c0392b);border-radius:var(--radius-md);padding:10px 14px;margin-bottom:12px;font-size:13px">'
      + '<div style="font-family:var(--font-heading);color:var(--color-error, #c0392b);margin-bottom:4px">No se pudo publicar en Meta</div>'
      + '<div style="color:var(--color-neutral-300)">' + esc(vm.errorPublicacion) + '</div>'
      + '</div>'
    : '';
  const grid = avisoError + `<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">${previewCols}${columnaPresupuesto}<div style="flex:1;min-width:420px">${body}</div></div>`;
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
    + '<div style="font-size:12px;color:var(--color-neutral-500);margin-bottom:8px">El motivo queda guardado en el contenido — es lo que va a leer quien corresponda.</div>'
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
  // "Otra" (audiencia manual) se ofrece en los dos modos — en Automatizado
  // ese cruce se carga a mano (ver renderAudienciaSelect).
  const audOpts = '<option value="">— elegir —</option>'
    + (state.pdAudiencias || []).map((a) => '<option value="' + esc(a.codigo) + '" ' + (a.codigo === c.audienciaCodigo ? 'selected' : '') + '>' + esc(a.nombre) + '</option>').join('')
    + '<option value="Otra" ' + (c.audienciaCodigo === 'Otra' ? 'selected' : '') + '>Otra</option>';
  const esPublico = c.visibilidad === 'PUBLICO';
  const preview = c.imagenPreview
    ? '<img src="' + esc(c.imagenPreview) + '" data-action="abrir-lightbox" data-url="' + esc(c.imagenPreview) + '" style="width:120px;height:120px;object-fit:cover;border-radius:var(--radius-md);cursor:zoom-in;flex:none" title="Ver más grande">'
    : '';

  panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px">'
    +   '<div style="display:flex;gap:14px;align-items:center">'
    +     preview
    +     '<div><h4 style="margin:0 0 4px">Corregir contenido</h4>' + (c.codigo ? '<div style="font-family:monospace;font-size:12px;color:var(--color-neutral-500)">' + esc(c.codigo) + '</div>' : '') + '</div>'
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
  // "Actuar como" es una herramienta de prueba: solo el superadmin cambia
  // de usuario (usuario, 2026-09-14). El resto ve su nombre y nada más.
  const u = usuarioActual();
  const puedeCambiar = puedeCambiarUsuario();
  sel.hidden = !puedeCambiar;
  const nombre = document.getElementById('usuario-actual-nombre');
  if (nombre) { nombre.hidden = puedeCambiar || !u; nombre.textContent = u ? u.nombre : ''; }

  const permitidas = tabsPermitidas();
  document.querySelectorAll('.tab-btn[data-tab]').forEach((b) => {
    b.hidden = !permitidas.includes(b.dataset.tab);
  });
}

function render() {
  // Onboarding: Login → Proyecto → Modo → (Normal) Ecosistema. Mientras
  // falte alguna, ni siquiera se toca el resto del render — se muestra esa
  // pantalla sola y se corta acá.
  const pantalla = pantallaActual();
  document.getElementById('pantalla-login').hidden = pantalla !== 'login';
  document.getElementById('pantalla-proyecto').hidden = pantalla !== 'proyecto';
  document.getElementById('pantalla-modo').hidden = pantalla !== 'modo';
  document.getElementById('pantalla-ecosistema').hidden = pantalla !== 'ecosistema';
  document.getElementById('app-shell').hidden = pantalla !== 'app';
  if (pantalla === 'login') { renderPantallaLogin(); return; }
  if (pantalla === 'proyecto') { renderPantallaProyecto(); return; }
  if (pantalla === 'modo') { renderPantallaModo(); return; }
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

  document.querySelectorAll('.grid-header').forEach((h) => { h.style.gridTemplateColumns = COLS_PENDIENTES; });

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
  // "Para cargar a mano": sección propia (pedido del usuario 2026-09-12) —
  // es trabajo pendiente del implementador, no historial. Cuenta en el nav
  // junto con las que esperan validación, igual que en la pantalla de Proyecto.
  const paraMano = vms.filter((vm) => vm.isPendienteManual);
  const historial = vms.filter((vm) => vm.isConfirmed || vm.isManualDone || vm.isDesestimada);

  document.getElementById('pendientes-count').textContent = (pendientes.length + paraMano.length) + ' pendientes';

  const manualWrap = document.getElementById('manual-wrap');
  manualWrap.hidden = paraMano.length === 0;
  document.getElementById('manual-label').textContent = 'Para cargar a mano (' + paraMano.length + ')';
  const filasMano = paraMano.reduce((acc, vm) => acc.concat(splitVMSiMixto(vm)), []);
  document.getElementById('lista-manual').innerHTML = filasMano.map((vm) => renderItemRow(vm, COLS_PENDIENTES, false)).join('');

  // Si una pieza mezcla celdas automáticas y manuales (audiencia "Otra" +
  // audiencia real, por ejemplo), se muestra como dos filas separadas — cada
  // carril se confirma/marca por su cuenta (ver splitVMSiMixto).
  const filasPendientes = pendientes.reduce((acc, vm) => acc.concat(splitVMSiMixto(vm)), []);
  document.getElementById('lista-pendientes').innerHTML = filasPendientes.length
    ? filasPendientes.map((vm) => renderItemRow(vm, COLS_PENDIENTES, false)).join('')
    : '<p style="color:var(--color-neutral-500);padding:16px 10px">No hay contenidos pendientes. Las que se carguen desde "Pedido de Anuncios" aparecen acá.</p>';

  renderHistorialSheet(vms);

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
      : 'Confirmar ' + selectedIds.length + ' contenido' + (selectedIds.length > 1 ? 's' : '');
    btn.disabled = state.batchConfirmando || readyCount !== selectedIds.length;
  }
  if (hayAlgoSeleccionado && state.batchDesestimarAbierto) {
    document.getElementById('batch-desestimar-count').textContent =
      selectedIds.length + ' contenido' + (selectedIds.length > 1 ? 's' : '');
    const btnD = document.getElementById('batch-desestimar-confirmar');
    btnD.disabled = state.batchDesestimarEnviando;
    btnD.textContent = state.batchDesestimarEnviando
      ? 'Desestimando…'
      : 'Desestimar ' + selectedIds.length + ' contenido' + (selectedIds.length > 1 ? 's' : '');
    document.getElementById('batch-desestimar-error').hidden = !state.batchDesestimarError;
    document.getElementById('batch-desestimar-error').textContent = state.batchDesestimarError || '';
  }
}

// ---------- Historial desde la hoja CodigosContenido ----------
// Pedido del usuario (2026-09-12): el Historial es lo que se cargó en AppSheet
// + PAUTADOR (misma hoja), desde septiembre, del proyecto y canal elegidos y
// solo lo propio (admin ve todo). Estados: "Pautado" / "Ver en Asana" /
// "Desestimada". Una fila que creó PAUTADOR se expande con el detalle de
// siempre (preview, reparto, Ads Manager); una de AppSheet muestra la ficha
// y "Marcar pautado".
const COLS_HISTORIAL_SHEET = '32px 88px 130px minmax(0,0.9fr) minmax(0,1.6fr) 90px minmax(0,0.8fr) minmax(0,0.9fr) 110px 24px';

async function cargarHistorialSheet() {
  state.historial.cargando = true;
  try {
    const r = await apiFetch('/api/historial');
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error || 'No se pudo leer el historial.');
    state.historial.filas = data.filas || [];
    state.historial.desde = data.desde || '';
    state.historial.sinHoja = !!data.sinHoja;
    state.historial.error = null;
  } catch (err) {
    state.historial.error = err.message;
  }
  state.historial.cargando = false;
  state.historial.cargado = true;
}

// Filtros del Historial por categoría (usuario, 2026-09-15): además del
// texto y el activo, proyecto (útil en la entrada ADMIN), canal, plataforma,
// estado, eje y quién lo cargó. Cada uno es un desplegable con "Todos".
const FILTROS_HISTORIAL = [
  ['proyecto', 'proyecto', 'Todos los proyectos'],
  ['activo', 'activo', 'Todos los activos'],
  ['canal', 'ecosistema', 'Ambos canales'],
  ['plataforma', 'plataforma', 'Todas las plataformas'],
  ['estado', 'estado', 'Todos los estados'],
  ['eje', 'eje', 'Todos los ejes'],
  ['creador', 'creador', 'Cargado por (todos)'],
];
function filasHistorialFiltradas() {
  const h = state.historial;
  const q = (h.busqueda || '').trim().toLowerCase();
  return (h.filas || []).filter((f) =>
    FILTROS_HISTORIAL.every(([clave, campo]) => !h[clave] || String(f[campo] || '') === h[clave])
    && (!q || [f.codigo, f.campana, f.contenido, f.activo, f.audiencia, f.proyecto].some((v) => String(v || '').toLowerCase().includes(q))));
}

function tagEstadoHistorial(estado) {
  if (estado === 'Pautado') return '<span class="tag tag-accent-2">Pautado</span>';
  if (estado === 'Desestimada') return '<span class="tag tag-neutral">Desestimada</span>';
  return '<span class="tag tag-outline">Ver en Asana</span>';
}

function renderFilaHistorialSheet(f, vms) {
  const vm = f.correlation_id ? vms.find((v) => v.id === f.correlation_id) : null;
  const expandida = vm ? vm.isExpanded : state.historial.expandido === f.codigo;
  const fecha = f.fecha ? f.fecha.slice(8, 10) + '/' + f.fecha.slice(5, 7) : '';
  const linea = `
    <div class="row-line" style="grid-template-columns:${COLS_HISTORIAL_SHEET}" data-action="hist-toggle" data-id="${esc(f.codigo)}">
      <div></div>
      <div class="row-ellip" style="font-size:13px">${esc(fecha)}</div>
      <div class="row-ellip" style="font-size:12px;font-family:monospace">${esc(f.codigo)}</div>
      <div class="row-ellip">${esc(f.activo)}</div>
      <div class="row-ellip">${esc(f.contenido || f.campana)}</div>
      <div class="row-ellip" style="font-size:12px">${esc(f.plataforma)}</div>
      <div class="row-ellip" style="font-size:12px">${esc(f.objetivo)}</div>
      <div class="row-ellip" style="font-size:12px">${esc(f.audiencia)}</div>
      <div>${tagEstadoHistorial(f.estado)}</div>
      <div style="text-align:center"><i class="ph ${expandida ? 'ph-caret-up' : 'ph-caret-down'}"></i></div>
    </div>`;
  let detalle = '';
  if (expandida) {
    if (vm) {
      detalle = renderExpandContent(vm);
    } else {
      const marcando = state.historial.marcando === f.codigo;
      const puedeMarcar = puedeEditarValidacion() && f.estado !== 'Pautado';
      const dato = (k, v) => (v ? `<div><span style="color:var(--color-neutral-500)">${k}:</span> ${esc(v)}</div>` : '');
      detalle = `
        <div style="padding:14px 16px 16px 48px;background:var(--color-bg);border-top:1px solid var(--color-divider);font-size:13px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px 20px">
          ${dato('Código', f.codigo)}${dato('Fecha', f.fecha)}${dato('Tipo', f.tipo)}${dato('Eje', f.eje)}${dato('Campaña', f.campana)}${dato('Formato', f.formato)}${dato('Visibilidad', f.visibilidad)}${dato('Plataforma', f.plataforma)}${dato('Objetivo', f.objetivo)}${dato('Audiencia', f.audiencia)}${dato('Cargado por', f.creador)}${f.marcado_por ? dato('Marcado pautado por', f.marcado_por + (f.marcado_en ? ' · ' + String(f.marcado_en).slice(0, 10) : '')) : ''}
          <div style="grid-column:1 / -1;margin-top:8px;display:flex;gap:10px;align-items:center">
            <span style="color:var(--color-neutral-500)">Cargada por AppSheet — el seguimiento está en Asana.</span>
            ${puedeMarcar ? `<button class="btn btn-primary" style="font-size:12px;padding:4px 10px" data-action="hist-marcar-pautado" data-id="${esc(f.codigo)}" ${marcando ? 'disabled' : ''}>${marcando ? 'Marcando…' : 'Marcar pautado'}</button>` : ''}
          </div>
        </div>`;
    }
  }
  return `<div class="row-wrap">${linea}${detalle}</div>`;
}

function renderHistorialSheet(vms) {
  const wrap = document.getElementById('historial-toggle-wrap');
  const h = state.historial;
  wrap.hidden = false;
  const filtradas = filasHistorialFiltradas();
  document.getElementById('historial-label').textContent = 'Historial (' + (h.cargando && !h.cargado ? '…' : filtradas.length) + ')';
  document.querySelector('#historial-toggle i').className = 'ph ' + (state.historyOpen ? 'ph-caret-down' : 'ph-caret-right');
  document.getElementById('historial-cuerpo').hidden = !state.historyOpen;
  if (!state.historyOpen) return;

  // Un desplegable por categoría, con los valores que hay en las filas
  // cargadas. Proyecto solo se muestra si hay más de uno (entrada ADMIN).
  FILTROS_HISTORIAL.forEach(([clave, campo, todos]) => {
    const sel = document.getElementById('hist-' + clave);
    if (!sel) return;
    const valores = [...new Set((h.filas || []).map((f) => String(f[campo] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    sel.innerHTML = `<option value="">${esc(todos)}</option>` + valores.map((v) => `<option value="${esc(v)}" ${v === h[clave] ? 'selected' : ''}>${esc(v)}</option>`).join('');
    sel.hidden = clave === 'proyecto' ? valores.length < 2 : valores.length < 2 && !h[clave];
  });
  document.getElementById('hist-desde').textContent = h.desde ? 'desde el ' + h.desde.slice(8, 10) + '/' + h.desde.slice(5, 7) + '/' + h.desde.slice(0, 4) : '';
  document.getElementById('hist-grid-header').style.gridTemplateColumns = COLS_HISTORIAL_SHEET;

  const lista = document.getElementById('lista-historial');
  if (h.error) { lista.innerHTML = `<p class="error" style="padding:12px 10px">${esc(h.error)}</p>`; return; }
  if (h.sinHoja) { lista.innerHTML = '<p style="color:var(--color-neutral-500);padding:16px 10px">La hoja CodigosContenido no está configurada (CODIGOS_SHEET_ID).</p>'; return; }
  if (h.cargando && !h.cargado) { lista.innerHTML = '<p style="color:var(--color-neutral-500);padding:16px 10px">Cargando historial…</p>'; return; }
  lista.innerHTML = filtradas.length
    ? filtradas.map((f) => renderFilaHistorialSheet(f, vms)).join('')
    : '<p style="color:var(--color-neutral-500);padding:16px 10px">Nada cargado en este período para este proyecto y canal.</p>';
}

function toggleHistorialFila(codigo) {
  const f = (state.historial.filas || []).find((x) => x.codigo === codigo);
  if (!f) return;
  if (f.correlation_id) { toggleExpand(f.correlation_id); return; }
  state.historial.expandido = state.historial.expandido === codigo ? null : codigo;
  render();
}

async function marcarPautadoHistorial(codigo) {
  state.historial.marcando = codigo;
  render();
  try {
    const r = await apiFetch('/api/historial/' + encodeURIComponent(codigo) + '/pautado', { method: 'POST' });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error || 'No se pudo marcar.');
    const f = state.historial.filas.find((x) => x.codigo === codigo);
    if (f) { f.estado = 'Pautado'; f.marcado_por = data.marcado_por; f.marcado_en = data.marcado_en; }
    state.toast = { titulo: 'Marcada como pautada', lines: [{ codigo, resumen: 'Queda como "Pautado" en el Historial.' }] };
  } catch (err) {
    state.toast = { titulo: 'No se pudo marcar', lines: [{ codigo, resumen: err.message }] };
  }
  state.historial.marcando = null;
  render();
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

// "Otra" (audiencia manual) se ofrece en los dos modos (usuario,
// 2026-09-14): en Automatizado la pieza sale igual pero ese cruce se carga
// a mano y queda en Pendientes — ver renderAvisoOtraV2 y pedidos.js.
// Pedido Manual: las más usadas del Proyecto × Canal (ya vienen ordenadas
// del server) y "Otra" para escribir cuál es.
function renderAudienciaSelect(id, audiencias, seleccionado) {
  const opts = audiencias.map((a) => `<option value="${esc(a.codigo)}" ${a.codigo === seleccionado ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('');
  const otra = `<option value="Otra" ${seleccionado === 'Otra' ? 'selected' : ''}>Otra</option>`;
  return `<select class="input" id="${id}"><option value="">— elegir —</option>${opts}${otra}</select>`;
}

function renderRefuerzoDropdown(prefix, audiencias, seleccionados) {
  const opciones = audiencias.map((a) => [a.codigo, a.nombre]);
  opciones.push(['Otra', 'Otra']);
  return renderDropdownMulti(`${prefix}-refuerzo-dd`, `${prefix}-refuerzo-chk`, opciones, '— opcional, uno o más —', seleccionados);
}

// Aviso del Módulo 2 en Automatizado cuando hay "Otra" entre las audiencias
// (usuario, 2026-09-14): la pieza se pide igual, pero ese cruce no lo
// publica PAUTADOR — lo cargan a mano los implementadores desde Pendientes.
function renderAvisoOtraV2() {
  const el = document.getElementById('pd2-aviso-otra');
  if (!el) return;
  const auds = audienciasDelPd2();
  const hayOtra = state.modoActivo === 'automatizado' && auds.some((a) => a.manual);
  el.hidden = !hayOtra;
  if (!hayOtra) return;
  const soloOtra = auds.every((a) => a.manual);
  el.innerHTML = `<div style="padding:10px 12px;border:1px solid var(--color-warning, #d08a1e);border-radius:var(--radius-md);font-size:12px;color:var(--color-neutral-300)">
      <i class="ph ph-hand"></i> <strong>La audiencia "Otra" no está automatizada.</strong>
      ${soloOtra
    ? 'El pedido se carga igual, pero este contenido no sale solo: la cargan a mano los implementadores en Meta y queda en Pendientes hasta que la marquen hecha.'
    : 'Los cruces con las otras audiencias salen solos; el cruce con "Otra" lo cargan a mano los implementadores y queda en Pendientes hasta que lo marquen hecho.'}
    </div>`;
}

// Red y Placement se muestran como checkboxes sueltos, no como el
// dropdown-multi de Objetivo/Refuerzo — son 2-3 opciones nomás, y el estado
// "deshabilitado" de Reels tiene que verse a simple vista, no quedar
// escondido adentro de un desplegable cerrado.
// Nunca puede quedar sin ninguna red elegida (el pedido no sabría dónde
// publicar) — cuando queda una sola tildada, esa se bloquea para que no se
// pueda destildar también.
// Instagram se ofrece siempre: sin cuenta de IG conectada, Meta publica
// igual con la identidad de la Página (verificado 2026-09-14 con Gaceta
// Santafesina) — el creative simplemente no lleva instagram_user_id.
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

// Proporción recomendada por Placement — reemplaza la vieja idea de que la
// proporción vivía en el Formato. Debe coincidir con TOLERANCIA_PROPORCION/
// coincideProporcion() en metaMedia.js (servidor) para que un warning acá
// no contradiga lo que el servidor termina aceptando o rechazando.
const TOLERANCIA_PROPORCION_UI = 0.12;
// Specs del equipo (AppSheet/Specs Meta.xlsx, 2026-09-11): Feed 1:1 o 4:5,
// Stories y Reels 9:16. Se muestran como ayuda debajo de Placement y las usa
// evaluarSpecsPieza() para avisar/bloquear antes de confirmar.
const DIMENSIONES_POR_PLACEMENT = {
  feed: { aspectos: ['1:1', '4:5'], label: '1:1 (1080×1080) o 4:5 (1080×1350)' },
  stories: { aspecto: '9:16', aspectos: ['9:16'], label: '9:16 (1080×1920)' },
  reels: { aspecto: '9:16', aspectos: ['9:16'], label: '9:16 (1080×1920)' },
};

function coincideProporcionUI(width, height, aspecto) {
  if (!width || !height || !aspecto) return null;
  const [aw, ah] = String(aspecto).split(':').map(Number);
  if (!aw || !ah) return null;
  return Math.abs((width / height) - (aw / ah)) <= TOLERANCIA_PROPORCION_UI;
}

// Texto de ayuda con las medidas recomendadas de los placements elegidos.
function dimensionRecomendada(placements) {
  const nombre = { feed: 'Feed', stories: 'Stories', reels: 'Reels' };
  const partes = (placements || [])
    .filter((p) => DIMENSIONES_POR_PLACEMENT[p])
    .map((p) => nombre[p] + ' ' + DIMENSIONES_POR_PLACEMENT[p].label);
  return partes.length ? partes.join(' · ') : null;
}

// Regla acordada con el usuario: se BLOQUEA solo lo que Meta rechaza de
// verdad (Stories/Reels no verticales, carrusel de video que no es 1:1,
// carrusel con proporciones mezcladas); todo lo demás es un AVISO y deja
// seguir. Misma tolerancia que el servidor (metaMedia.js), para que un aviso
// acá no contradiga lo que el servidor termina aceptando.
function evaluarSpecsPieza({ placements, modo, esVideo, conLink, medidas }) {
  const bloqueos = [];
  const avisos = [];
  const lista = (medidas || []).filter((m) => m && m.width && m.height);
  const fmt = (m) => m.width + '×' + m.height;
  if (!lista.length) {
    avisos.push('No pude medir este contenido desde acá — Meta la va a revisar al confirmar (Stories/Reels piden 9:16; Feed 1:1 o 4:5).');
    return { bloqueos, avisos };
  }
  const m = lista[0];
  const es = (asp) => coincideProporcionUI(m.width, m.height, asp);
  const tieneFeed = placements.includes('feed');
  const tieneStories = placements.includes('stories');
  const tieneReels = placements.includes('reels');

  if (modo === 'carrusel') {
    const ratios = lista.map((x) => x.width / x.height);
    if (ratios.some((r) => Math.abs(r - ratios[0]) > TOLERANCIA_PROPORCION_UI)) {
      bloqueos.push('Carrusel: todas las imágenes tienen que tener la misma proporción (hoy: ' + lista.map(fmt).join(', ') + ').');
    }
    if (esVideo && !es('1:1')) bloqueos.push('Carrusel de video: Meta solo acepta 1:1 (1080×1080). Este contenido es ' + fmt(m) + '.');
    else if (!es('1:1')) avisos.push('Carrusel en pauta va 1:1 (1080×1080) porque lleva link. Este contenido es ' + fmt(m) + '.');
    return { bloqueos, avisos };
  }

  if (tieneStories && !es('9:16')) bloqueos.push('Stories pide 9:16 (1080×1920). Este contenido es ' + fmt(m) + (m.height > m.width ? '' : ', no es vertical') + '.');
  if (tieneReels && !es('9:16')) bloqueos.push('Reels pide 9:16 (1080×1920). Este contenido es ' + fmt(m) + '.');
  if (tieneStories && es('9:16')) avisos.push('Stories: dejá libre el 14% de arriba (~250 px) y el 20% de abajo (~350 px) — ahí Meta pone el nombre y los botones.');
  if (tieneReels && es('9:16')) avisos.push('Reels: dejá libre 14% arriba, 40% abajo y 6% de cada lado. Si además sale en Feed se recorta a 4:5: lo importante, centrado.');
  if (tieneFeed) {
    if (!es('1:1') && !es('4:5')) avisos.push('Feed recomienda 1:1 (1080×1080) o 4:5 (1080×1350). Este contenido es ' + fmt(m) + ' — Meta la va a reencuadrar.');
    else if (es('4:5') && conLink) avisos.push('4:5 con link suele traer problemas con el botón (CTA) — con link el equipo recomienda 1:1 (1080×1080).');
  }
  return { bloqueos, avisos };
}

// Mide la pieza en el navegador (sin subir nada ni pedirle al servidor):
// Image() para imágenes, <video> con preload=metadata para videos. null si
// no se pudo (URL vacía, no carga, tarda más de 6 s).
function medirMedia(url, esVideo) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const timeout = setTimeout(() => resolve(null), 6000);
    if (esVideo) {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = () => { clearTimeout(timeout); resolve({ width: v.videoWidth, height: v.videoHeight }); };
      v.onerror = () => { clearTimeout(timeout); resolve(null); };
      v.src = url;
    } else {
      const im = new Image();
      im.onload = () => { clearTimeout(timeout); resolve({ width: im.naturalWidth, height: im.naturalHeight }); };
      im.onerror = () => { clearTimeout(timeout); resolve(null); };
      im.src = url;
    }
  });
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

async function cargarDatosPedido() {
  const [rProy, rEjes, rTipos, rFormatos, rObjetivos, rLim, rPlat] = await Promise.all([
    apiFetch('/api/proyectos?detalle=1'),
    apiFetch('/api/ejes'),
    apiFetch('/api/tipos'),
    apiFetch('/api/formatos'),
    apiFetch('/api/objetivos'),
    apiFetch('/api/limites'),
    apiFetch('/api/plataformas'),
  ]);
  state.limites = rLim.ok ? await rLim.json() : { minDiario: 0, moneda: '' };
  state.pdPlataformas = rPlat.ok ? await rPlat.json() : [];
  state.pd2Plataformas = state.pd2Plataformas.filter((n) => state.pdPlataformas.find((p) => p.nombre === n && p.habilitada !== false));
  if (!state.pd2Plataformas.length) state.pd2Plataformas = ['Meta'];
  state.proyectosDetalle = rProy.ok ? await rProy.json() : [];
  state.pdProyectos = state.proyectosDetalle.map((p) => p.proyecto);
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
  // Proyecto/Activo compartidos, usados por el modo CSV — el resto de la
  // pantalla (los módulos) usa su propio pd2Proyecto/pd2ActivoKey.
  if (!state.pdProyecto || !state.pdProyectos.includes(state.pdProyecto)) {
    state.pdProyecto = state.pdProyectos[0] || null;
  }
  if (state.pdProyecto) await cargarActivosPedido();
  // Las Audiencias son del Activo, no de un fetch único — recién acá ya se
  // sabe cuál quedó elegido por default (ver cargarActivosPedido).
  await cargarAudienciasPorActivo(state.pdActivoKey);
}

// Audiencias de un Activo puntual (equiv_audiencia) — se vuelve a pedir
// cada vez que cambia el Activo elegido (Módulo 1/CSV), nunca es un fetch
// fijo: cada Activo tiene sus propias audiencias guardadas en Meta.
async function cargarAudienciasPorActivo(activoKey) {
  if (!activoKey) { state.pdAudiencias = []; state.pdAudienciasDe = ''; return; }
  const r = await apiFetch(`/api/audiencias?activo_key=${encodeURIComponent(activoKey)}`);
  state.pdAudiencias = r.ok ? await r.json() : [];
  // De qué activo son las audiencias cargadas — el CSV lo chequea antes de
  // resolver nombres (si no, con el Activo recién cambiado o todavía
  // cargando, "Audiencia X no encontrada" aunque exista; visto 2026-09-15).
  state.pdAudienciasDe = activoKey;
}

async function asegurarAudienciasDe(activoKey) {
  if (activoKey && state.pdAudienciasDe !== activoKey) await cargarAudienciasPorActivo(activoKey);
}

async function cargarCampanasSugeridas(proyecto) {
  const r = await apiFetch(`/api/campanas?proyecto=${encodeURIComponent(proyecto)}`);
  return r.ok ? await r.json() : [];
}

// Desplegable de "Campaña / Comunicación" (usuario, 2026-09-14): con el
// campo vacío muestra las últimas 20 campañas del proyecto (el server las
// manda de la más reciente a la más vieja); al tipear busca sobre TODAS
// las del proyecto y muestra hasta 20 coincidencias. Lo que no está en la
// lista se acepta igual como campaña nueva.
const MAX_CAMPANAS_VISIBLES = 20;
function renderCampanasDatalistPd2() {
  const datalist = document.getElementById('pd-campana-lista');
  const input = document.getElementById('pd2-campana');
  if (!datalist) return;
  const texto = (input ? input.value : '').trim().toLowerCase();
  const todas = state.pd2CampanasSugeridas || [];
  const lista = (texto ? todas.filter((c) => c.toLowerCase().includes(texto)) : todas).slice(0, MAX_CAMPANAS_VISIBLES);
  datalist.innerHTML = lista.map((c) => `<option value="${esc(c)}">`).join('');
}

// El desplegable de Activo muestra TODOS los activos reales del proyecto
// (pedido del usuario: "tienen que aparecer todos") — es un campo de
// referencia/registro (queda en "activo_solicitado"), y también el que
// define contra qué cuenta/página de Meta se ejecuta de verdad (ver
// cola_pautas.activo en crearPedido).
async function cargarActivosPedido() {
  // soloHabilitados=1 solo en modo "automatizado" — "normal" ve todos los
  // activos del proyecto, no está atado a qué activos tienen la
  // automatización (System User de Meta) lista.
  const soloHabilitados = state.modoActivo === 'automatizado' ? '&soloHabilitados=1' : '';
  const r = await apiFetch(`/api/activos?proyecto=${encodeURIComponent(state.pdProyecto)}${soloHabilitados}`);
  state.pdActivos = r.ok ? await r.json() : [];
  state.pdActivoKey = (state.pdActivos[0] || {}).activo_key || null;
}

// ---------- "Agregar Activos / Audiencias" ----------

async function cargarDatosAdmin() {
  // todos=1: la pestaña de administración ve TODOS los activos, sin el
  // recorte por canal (Oficial/Informativo) que aplica al Pedido.
  const r = await apiFetch('/api/activos?todos=1');
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
  // Nombres agrupados por proyecto (antes eran las claves internas).
  const porProyecto = {};
  state.admActivos.forEach((a) => { (porProyecto[a.proyecto] = porProyecto[a.proyecto] || []).push(a.activo || a.activo_key); });
  document.getElementById('adm-activos-lista').innerHTML = state.admActivos.length
    ? `${state.admActivos.length} activo(s) ya cargados:` + Object.keys(porProyecto).sort((x, y) => x.localeCompare(y, 'es')).map((p) => `<div style="margin-top:4px"><strong>${esc(p)}</strong>: ${porProyecto[p].map(esc).join(' · ')}</div>`).join('')
    : 'Todavía no hay ningún activo cargado.';

  const selActivo = document.getElementById('adm-aud-activo');
  selActivo.innerHTML = state.admActivos.map((a) => `<option value="${esc(a.activo_key)}" ${a.activo_key === state.admAudActivoKey ? 'selected' : ''}>${esc(a.activo)}</option>`).join('');

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
    const r2 = await apiFetch('/api/activos?todos=1');
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

// ---------- Pestaña "Panel Usuarios" (solo administradores) ----------
// Alta por mail + accesos por Proyecto y Activo. El server decide qué se
// puede hacer (superadmin, deshabilitar, cambiar rol — ver
// services/usuarios.js); acá se refleja lo mismo en la UI pero la regla
// real es la del server.

const ROL_LABEL = { pm_cuentas: 'PM / Cuentas', implementador: 'Implementador', administrador: 'Administrador' };

async function cargarPanelUsuarios(forzar) {
  if (state.usuCargando) return;
  if (state.usuDatos && !forzar) { renderTabUsuarios(); return; }
  state.usuCargando = true;
  state.usuError = null;
  renderTabUsuarios();
  try {
    const r = await apiFetch('/api/admin/usuarios');
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'No se pudo leer la lista de usuarios.');
    state.usuDatos = data;
    if (state.usuSelId && !data.usuarios.find((u) => u.id === state.usuSelId)) state.usuSelId = null;
    if (state.usuSelId) armarEdicionUsuario(state.usuSelId);
  } catch (err) {
    state.usuError = err.message;
  }
  state.usuCargando = false;
  renderTabUsuarios();
}

function claveAcceso(proyecto, activoKey) {
  return proyecto + '|' + (activoKey || '');
}

function armarEdicionUsuario(id) {
  const u = (state.usuDatos.usuarios || []).find((x) => x.id === id);
  if (!u) { state.usuEdit = null; return; }
  state.usuEdit = {
    id: u.id,
    nombre: u.nombre || '',
    rol: u.rol,
    habilitado: u.habilitado !== false,
    accesos: new Set((u.accesos || []).map((a) => claveAcceso(a.proyecto, a.activo_key))),
  };
}

function seleccionarUsuarioPanel(id) {
  state.usuSelId = id;
  state.usuError = null;
  state.usuExito = null;
  armarEdicionUsuario(id);
  renderTabUsuarios();
}

// Tildar "todo el proyecto" pisa los activos sueltos de ese proyecto (y los
// deshabilita en la grilla); destildarlo deja el proyecto sin nada.
function toggleAccesoPanel(proyecto, activoKey, marcado) {
  if (!state.usuEdit) return;
  const set = state.usuEdit.accesos;
  if (!activoKey) {
    [...set].filter((k) => k.startsWith(proyecto + '|')).forEach((k) => set.delete(k));
    if (marcado) set.add(claveAcceso(proyecto, ''));
  } else if (marcado) {
    set.add(claveAcceso(proyecto, activoKey));
  } else {
    set.delete(claveAcceso(proyecto, activoKey));
  }
  renderTabUsuarios();
}

function accesosParaEnviar() {
  return [...state.usuEdit.accesos].map((k) => {
    const i = k.indexOf('|');
    return { proyecto: k.slice(0, i), activo_key: k.slice(i + 1) };
  });
}

async function crearUsuarioPanel() {
  state.usuNuevoError = null;
  const body = {
    email: document.getElementById('usu-nuevo-email').value.trim(),
    nombre: document.getElementById('usu-nuevo-nombre').value.trim(),
    rol: document.getElementById('usu-nuevo-rol').value,
  };
  try {
    const r = await apiFetch('/api/admin/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'No se pudo dar de alta.');
    document.getElementById('usu-nuevo-email').value = '';
    document.getElementById('usu-nuevo-nombre').value = '';
    state.usuDatos.usuarios.push(data);
    state.usuDatos.usuarios.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    if (!state.usuarios.find((u) => u.id === data.id)) state.usuarios.push(data);
    state.usuSelId = data.id;
    state.usuExito = `"${data.nombre}" dado de alta — ahora asignale accesos.`;
    armarEdicionUsuario(data.id);
  } catch (err) {
    state.usuNuevoError = err.message;
  }
  renderTabUsuarios();
}

async function guardarUsuarioPanel() {
  if (!state.usuEdit || state.usuGuardando) return;
  // Por si el click en Guardar llegó antes que el "change" del input.
  const inpNombre = document.getElementById('usu-edit-nombre');
  if (inpNombre) state.usuEdit.nombre = inpNombre.value;
  state.usuGuardando = true;
  state.usuError = null;
  state.usuExito = null;
  renderTabUsuarios();
  const body = {
    nombre: state.usuEdit.nombre,
    rol: state.usuEdit.rol,
    habilitado: state.usuEdit.habilitado,
    accesos: state.usuEdit.rol === 'administrador' ? [] : accesosParaEnviar(),
  };
  try {
    const r = await apiFetch('/api/admin/usuarios/' + encodeURIComponent(state.usuEdit.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'No se pudo guardar.');
    const i = state.usuDatos.usuarios.findIndex((u) => u.id === data.id);
    if (i >= 0) state.usuDatos.usuarios[i] = data; else state.usuDatos.usuarios.push(data);
    // El selector "actuando como" del nav usa state.usuarios — se refleja
    // ahí también (rol/proyectos nuevos, o desaparece si se deshabilitó).
    const j = state.usuarios.findIndex((u) => u.id === data.id);
    if (data.habilitado === false) { if (j >= 0) state.usuarios.splice(j, 1); } else if (j >= 0) state.usuarios[j] = data; else state.usuarios.push(data);
    armarEdicionUsuario(data.id);
    state.usuExito = 'Guardado.';
  } catch (err) {
    state.usuError = err.message;
  }
  state.usuGuardando = false;
  renderTabUsuarios();
  renderNavUsuario();
}

// ---- Proyectos (Activar / Desactivar) dentro de Panel Usuarios ----
async function cargarProyectosPanel() {
  const r = await apiFetch('/api/admin/proyectos');
  state.usuProyectos = r.ok ? await r.json() : [];
  renderProyectosPanel();
}

// Panel de Proyectos (2026-09-15): el universo es la hoja "Proyectos" de la
// planilla de insumos (catálogo, la edita el usuario) más los que tienen
// activos. "Habilitar" = visible 5 días y vuelve a la regla de 45 días;
// "Deshabilitar" = oculto hasta que se habilite o se pase a automático.
function renderProyectosPanel() {
  const cont = document.getElementById('usu-proyectos');
  if (!cont) return;
  // Solo los que cumplen los requisitos para prenderse (usuario, 2026-09-15):
  // Activos en la hoja Proyectos y con al menos un activo cargado. Los demás
  // no se pueden prender, así que no se listan.
  const todos = (state.usuProyectos || []).filter((p) => p.activoEnCatalogo && p.tieneActivos);
  if (!(state.usuProyectos || []).length) { cont.innerHTML = '<p style="font-size:13px;color:var(--color-neutral-500)">Cargando proyectos…</p>'; return; }
  if (!todos.length) { cont.innerHTML = '<p style="font-size:13px;color:var(--color-neutral-500)">Ningún proyecto cumple los requisitos (Activo en la hoja Proyectos y con activos cargados).</p>'; return; }
  const fecha = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—');
  const filtro = (state.usuProyectosFiltro || '').trim().toLowerCase();
  const soloVisibles = !!state.usuProyectosSoloVisibles;
  const lista = todos
    .filter((p) => !filtro || [p.proyecto, p.cliente, p.codigo].join(' ').toLowerCase().includes(filtro))
    .filter((p) => !soloVisibles || p.visible)
    .sort((a, b) => (b.visible - a.visible) || a.cliente.localeCompare(b.cliente, 'es') || a.proyecto.localeCompare(b.proyecto, 'es'));
  const visibles = todos.filter((p) => p.visible).length;
  const barra = `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px;font-size:13px">
      <input class="input" id="usu-proyectos-filtro" placeholder="Buscar proyecto, cliente o código…" value="${esc(state.usuProyectosFiltro || '')}" style="max-width:300px">
      <label style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" id="usu-proyectos-solo-visibles" ${soloVisibles ? 'checked' : ''}> Solo los que se ofrecen</label>
      <span style="color:var(--color-neutral-500)">${visibles} de ${todos.length} se ofrecen · ${lista.length} en la lista</span>
    </div>`;
  cont.innerHTML = barra + '<div class="lista-scroll"><div style="display:grid;grid-template-columns:minmax(0,1.5fr) 70px minmax(0,1fr) 100px 70px minmax(0,1.7fr) 280px;gap:10px;min-width:980px;font-size:13px">'
    + '<div class="grid-header" style="display:contents"><div>Proyecto</div><div>Código</div><div>Cliente</div><div>Último pedido</div><div>45 días</div><div>Estado</div><div></div></div>'
    + lista.map((p) => {
      const chip = p.visible ? '<span class="tag tag-accent-2">Se ofrece</span>' : '<span class="tag tag-neutral">Oculto</span>';
      const cambiando = state.usuProyectoCambiando === p.proyecto;
      const bloqueado = !p.activoEnCatalogo || !p.tieneActivos;
      const btn = (estado, label, activo, title) => `<button type="button" class="btn ${activo ? 'btn-primary' : 'btn-secondary'}" style="font-size:12px;padding:3px 8px" title="${esc(title || '')}" data-action="usu-proyecto-estado" data-id="${esc(p.proyecto)}" data-estado="${estado}" ${cambiando || activo || bloqueado ? 'disabled' : ''}>${label}</button>`;
      const fila = 'padding:8px 0;border-top:1px solid var(--color-divider)';
      return `<div style="display:contents">
        <div style="${fila};font-weight:600">${esc(p.proyecto)}${p.enCatalogo ? '' : ' <span class="tag tag-outline" style="font-size:10px" title="No está en la hoja Proyectos de la planilla de insumos">sin catálogo</span>'}</div>
        <div style="${fila};font-family:var(--font-mono, monospace);font-size:12px">${esc(p.codigo || '')}</div>
        <div style="${fila};color:var(--color-neutral-500)">${esc(p.cliente)}</div>
        <div style="${fila}">${esc(fecha(p.ultimaFecha))}</div>
        <div style="${fila}">${p.volumen}</div>
        <div style="${fila}">${chip} <span style="font-size:11px;color:var(--color-neutral-500)">${esc(p.motivo)}</span></div>
        <div style="padding:6px 0;border-top:1px solid var(--color-divider);display:flex;gap:6px;justify-content:flex-end">
          ${btn('activado', 'Habilitar 5 días', p.estadoManual === 'activado', 'Se ofrece 5 días aunque no tenga pedidos; después vuelve a la regla de 45 días')}${btn('desactivado', 'Deshabilitar', p.estadoManual === 'desactivado', 'No se ofrece hasta que se habilite o se pase a automático')}${btn('automatico', 'Automático', p.estadoManual === 'automatico', 'Manda la regla de 45 días')}
        </div>
      </div>`;
    }).join('')
    + '</div></div>';
}

async function cambiarEstadoProyectoPanel(proyecto, estado) {
  state.usuProyectoCambiando = proyecto;
  renderProyectosPanel();
  try {
    const r = await apiFetch('/api/admin/proyectos/' + encodeURIComponent(proyecto), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'No se pudo cambiar.');
    state.proyectosDetalle = []; // la pantalla de Proyecto se vuelve a pedir
    await cargarProyectosPanel();
  } catch (err) {
    state.toast = { titulo: 'No se pudo cambiar el proyecto', lines: [{ codigo: proyecto, resumen: err.message }] };
    render();
  }
  state.usuProyectoCambiando = null;
  renderProyectosPanel();
}

// ---------- Panel Usuarios → Uso (solo superadmin) ----------
async function cargarUsoPanel() {
  const sel = document.getElementById('usu-uso-dias');
  const dias = sel ? Number(sel.value) || 30 : 30;
  state.usuUsoCargando = true;
  renderUsoPanel();
  try {
    const r = await apiFetch('/api/admin/uso?dias=' + dias);
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error || 'No se pudo cargar el uso.');
    state.usuUso = data; state.usuUsoError = '';
  } catch (err) {
    state.usuUso = null; state.usuUsoError = err.message;
  }
  state.usuUsoCargando = false;
  renderUsoPanel();
}

function renderUsoPanel() {
  const panel = document.getElementById('usu-uso-panel');
  const cont = document.getElementById('usu-uso');
  if (!panel || !cont) return;
  const u = usuarioActual();
  if (!(u && u.es_superadmin)) { panel.hidden = true; return; }
  if (panel.hidden) return;
  if (state.usuUsoCargando) { cont.innerHTML = '<p style="font-size:13px;color:var(--color-neutral-500)">Cargando…</p>'; return; }
  if (state.usuUsoError) { cont.innerHTML = `<p class="error">${esc(state.usuUsoError)}</p>`; return; }
  const d = state.usuUso;
  if (!d) { cont.innerHTML = ''; return; }
  const fechaHora = (iso) => { const x = new Date(iso); return Number.isNaN(x.getTime()) ? String(iso || '') : x.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
  const tarjeta = (n, label) => `<div style="padding:10px 14px;border:1px solid var(--color-divider);border-radius:var(--radius-md);min-width:120px"><div style="font-family:var(--font-heading);font-size:20px">${n}</div><div style="font-size:11px;color:var(--color-neutral-500)">${label}</div></div>`;
  const t = d.totales;
  const vivos = d.enVivo || [];
  const enVivo = `<h6 style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--color-neutral-500)"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--color-success, #1f8a4c);margin-right:6px;vertical-align:middle"></span>En vivo ahora: ${vivos.length}</h6>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">${vivos.length ? vivos.map((v) => `<div style="padding:8px 12px;border:1px solid var(--color-success, #1f8a4c);border-radius:var(--radius-md);font-size:12px"><strong>${esc(v.nombre)}</strong> <span style="color:var(--color-neutral-500)">${esc(v.rol)}</span><br>${esc(v.pantalla || '—')}${v.proyecto ? ' · ' + esc(v.proyecto) : ''}${v.modo ? ' · ' + esc(v.modo) : ''}${v.canal ? ' · ' + esc(v.canal) : ''}<br><span style="color:var(--color-neutral-500)">hace ${v.minutos} min que entró</span></div>`).join('') : '<span style="font-size:13px;color:var(--color-neutral-500)">Nadie conectado en los últimos 2 minutos.</span>'}</div>`;
  const tarjetas = enVivo + `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">${tarjeta(t.usuariosHoy, 'usuarios hoy')}${tarjeta(t.usuarios7, 'usuarios 7 días')}${tarjeta(t.usuarios30, `usuarios ${d.dias} días`)}${tarjeta(t.pedidos7, 'pedidos 7 días')}${tarjeta(t.acciones7, 'acciones 7 días')}${tarjeta(t.errores7, 'errores 7 días')}</div>`;
  const fila = 'padding:6px 0;border-top:1px solid var(--color-divider)';
  const porUsuario = `<h6 style="margin:10px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--color-neutral-500)">Por usuario (${d.dias} días)</h6>
    <div style="display:grid;grid-template-columns:minmax(0,1.4fr) 110px 120px 80px 80px 80px;gap:10px;font-size:13px;min-width:640px">
      <div class="grid-header" style="display:contents"><div>Usuario</div><div>Rol</div><div>Última acción</div><div>Acciones</div><div>Pedidos</div><div>Errores</div></div>
      ${d.porUsuario.map((x) => `<div style="display:contents"><div style="${fila};font-weight:600">${esc(x.nombre)}</div><div style="${fila};color:var(--color-neutral-500)">${esc(x.rol)}</div><div style="${fila}">${esc(fechaHora(x.ultimo))}</div><div style="${fila}">${x.acciones} <span style="color:var(--color-neutral-500)">(${x.acciones7} en 7d)</span></div><div style="${fila}">${x.pedidos}</div><div style="${fila};${x.errores ? 'color:var(--color-error, #c0392b)' : ''}">${x.errores}</div></div>`).join('') || '<div style="grid-column:1 / -1;color:var(--color-neutral-500);padding:8px 0">Todavía no hay actividad registrada.</div>'}
    </div>`;
  const porProyecto = d.porProyecto.length ? `<h6 style="margin:14px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--color-neutral-500)">Pedidos por proyecto</h6><div style="font-size:13px;display:flex;flex-wrap:wrap;gap:6px">${d.porProyecto.map((p) => `<span class="tag tag-outline">${esc(p.proyecto)} · ${p.pedidos}</span>`).join('')}</div>` : '';
  const ultimos = `<h6 style="margin:14px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--color-neutral-500)">Últimas acciones</h6>
    <div class="lista-scroll" style="max-height:360px"><div style="display:grid;grid-template-columns:110px minmax(0,1fr) minmax(0,1.2fr) minmax(0,1fr) minmax(0,2fr) 60px;gap:10px;font-size:12px;min-width:900px">
      <div class="grid-header" style="display:contents"><div>Cuándo</div><div>Usuario</div><div>Acción</div><div>Proyecto</div><div>Detalle</div><div></div></div>
      ${d.ultimos.map((e) => `<div style="display:contents"><div style="${fila}">${esc(fechaHora(e.fecha))}</div><div style="${fila}">${esc(e.usuario_nombre || e.usuario_id || '—')}</div><div style="${fila}">${esc(e.accion || e.ruta || '')}</div><div style="${fila};color:var(--color-neutral-500)">${esc(e.proyecto || '')}${e.modo ? ' · ' + esc(e.modo) : ''}</div><div style="${fila};color:var(--color-neutral-500);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc((e.referencia ? e.referencia + ' · ' : '') + (e.detalle || '') + (e.error ? ' — ' + e.error : ''))}">${e.referencia ? '<code>' + esc(e.referencia) + '</code> ' : ''}${esc(e.detalle || '')}${e.error ? ' <span style="color:var(--color-error, #c0392b)">' + esc(e.error) + '</span>' : ''}</div><div style="${fila}">${e.resultado === 'error' ? '<span class="tag" style="font-size:10px;color:var(--color-error, #c0392b)">error</span>' : '<span class="tag tag-accent-2" style="font-size:10px">ok</span>'}</div></div>`).join('')}
    </div></div>`;
  cont.innerHTML = tarjetas + '<div style="overflow-x:auto">' + porUsuario + '</div>' + porProyecto + ultimos;
}

// Sub-pestañas del Panel Usuarios: Admin Usuarios | Proyectos | Uso (solo
// superadmin). Cada una carga sus datos recién al entrar.
function cambiarSubtabUsuarios(id) {
  const yo = usuarioActual();
  if (id === 'uso' && !(yo && yo.es_superadmin)) id = 'usuarios';
  state.usuSubtab = id;
  renderTabUsuarios();
}

function renderTabUsuarios() {
  const cont = document.getElementById('tab-usuarios');
  if (!cont || cont.hidden) return;
  const yo = usuarioActual();
  const yoSuper = !!(yo && yo.es_superadmin);
  const sub = state.usuSubtab || 'usuarios';
  document.querySelectorAll('#usu-subtabs [data-action="usu-subtab"]').forEach((b) => b.classList.toggle('active', b.dataset.id === sub));
  const btnUso = document.getElementById('usu-subtab-uso');
  if (btnUso) btnUso.hidden = !yoSuper;
  document.getElementById('usu-sec-usuarios').hidden = sub !== 'usuarios';
  document.getElementById('usu-sec-proyectos').hidden = sub !== 'proyectos';
  document.getElementById('usu-uso-panel').hidden = !(sub === 'uso' && yoSuper);
  if (sub === 'proyectos') { if (!state.usuProyectos || !state.usuProyectos.length) cargarProyectosPanel(); else renderProyectosPanel(); }
  if (sub === 'uso' && yoSuper) {
    if (!state.usuUso && !state.usuUsoCargando && !state.usuUsoError) cargarUsoPanel(); else renderUsoPanel();
    // "En vivo" se refresca solo cada 30 s mientras la pestaña Uso está abierta.
    if (!state.usuUsoTimer) state.usuUsoTimer = setInterval(() => { const p = document.getElementById('usu-uso-panel'); if (p && !p.hidden && state.tabActiva === 'usuarios' && !state.usuUsoCargando) cargarUsoPanel(); }, 30 * 1000);
  }
  if (sub !== 'usuarios') return;
  const datos = state.usuDatos;
  const lista = document.getElementById('usu-lista');
  const detalle = document.getElementById('usu-detalle');
  document.getElementById('usu-nuevo-error').hidden = !state.usuNuevoError;
  document.getElementById('usu-nuevo-error').textContent = state.usuNuevoError || '';

  if (!datos) {
    lista.innerHTML = `<p style="font-size:13px;color:var(--color-neutral-500)">${state.usuCargando ? 'Cargando usuarios…' : esc(state.usuError || '')}</p>`;
    detalle.innerHTML = '';
    return;
  }
  const soySuper = !!(datos.yo && datos.yo.es_superadmin);
  const selRol = document.getElementById('usu-nuevo-rol');
  if (!selRol.options.length) {
    selRol.innerHTML = datos.roles.map((r) => `<option value="${esc(r)}">${esc(ROL_LABEL[r] || r)}</option>`).join('');
  }
  // Solo un superadmin puede dar de alta administradores.
  [...selRol.options].forEach((o) => { o.disabled = o.value === 'administrador' && !soySuper; });
  if (selRol.value === 'administrador' && !soySuper) selRol.value = 'pm_cuentas';

  const filas = datos.usuarios.map((u) => {
    const activo = u.id === state.usuSelId;
    const resumen = u.rol === 'administrador'
      ? 'todos los proyectos'
      : (() => {
        const proyectos = new Set((u.accesos || []).map((a) => a.proyecto));
        const sueltos = (u.accesos || []).filter((a) => a.activo_key).length;
        if (!proyectos.size) return 'sin accesos';
        return `${proyectos.size} proyecto(s)` + (sueltos ? ` · ${sueltos} activo(s) suelto(s)` : '');
      })();
    return `<button type="button" data-action="usu-seleccionar" data-id="${esc(u.id)}"
      style="display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 10px;border-radius:8px;border:1px solid ${activo ? 'var(--color-accent)' : 'var(--color-divider)'};background:${activo ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'transparent'};color:inherit;font:inherit;cursor:pointer;margin-bottom:6px${u.habilitado === false ? ';opacity:.55' : ''}">
      <span style="min-width:0">
        <span style="display:block;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.nombre)}${u.es_superadmin ? ' <span class="tag tag-accent" style="font-size:10px">superadmin</span>' : ''}${u.habilitado === false ? ' <span class="tag" style="font-size:10px">deshabilitado</span>' : ''}</span>
        <span style="display:block;font-size:11px;color:var(--color-neutral-500);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.email || u.id)} · ${esc(resumen)}</span>
      </span>
      <span class="tag" style="flex:none;font-size:10px">${esc(ROL_LABEL[u.rol] || u.rol)}</span>
    </button>`;
  }).join('');
  lista.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
      <span style="font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:var(--color-neutral-500)">Usuarios (${datos.usuarios.length})</span>
      <button type="button" class="btn btn-ghost" data-action="usu-recargar" style="font-size:12px;padding:2px 6px">Recargar</button>
    </div>${filas}`;

  const ed = state.usuEdit;
  if (!ed) {
    detalle.innerHTML = '<p style="font-size:13px;color:var(--color-neutral-500);margin:0">Elegí un usuario de la lista para ver y editar sus accesos.</p>';
    return;
  }
  const original = datos.usuarios.find((u) => u.id === ed.id) || {};
  const esSuperObjetivo = original.es_superadmin === true;
  const soyYo = datos.yo && datos.yo.id === ed.id;
  // Mismas reglas que verificarPuedeEditar en el server.
  const puedeTocarRol = soySuper || (ed.rol !== 'administrador' && original.rol !== 'administrador');
  const bloqueadoTodo = esSuperObjetivo && !soyYo;
  const puedeDeshabilitar = !esSuperObjetivo && !soyYo && !bloqueadoTodo;

  const opcionesRol = datos.roles.map((r) => {
    const deshab = r === 'administrador' ? !soySuper : (esSuperObjetivo);
    return `<option value="${esc(r)}" ${ed.rol === r ? 'selected' : ''} ${deshab ? 'disabled' : ''}>${esc(ROL_LABEL[r] || r)}</option>`;
  }).join('');

  let grilla = '';
  if (ed.rol === 'administrador') {
    grilla = '<p style="font-size:13px;color:var(--color-neutral-500);margin:0">Los administradores ven todos los proyectos y todos los activos — no hace falta asignar nada.</p>';
  } else {
    grilla = datos.proyectos.map((p) => {
      const completo = ed.accesos.has(claveAcceso(p.proyecto, ''));
      const marcados = p.activos.filter((a) => ed.accesos.has(claveAcceso(p.proyecto, a.activo_key))).length;
      const estado = completo ? 'todo el proyecto' : (marcados ? `${marcados} de ${p.activos.length} activos` : 'sin acceso');
      return `<div style="border:1px solid var(--color-divider);border-radius:8px;padding:10px 12px;margin-bottom:8px${completo || marcados ? '' : ';opacity:.8'}">
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;cursor:pointer">
          <input type="checkbox" data-usu-proyecto="${esc(p.proyecto)}" ${completo ? 'checked' : ''} ${bloqueadoTodo ? 'disabled' : ''}>
          <span style="flex:1">${esc(p.proyecto)}</span>
          <span style="font-size:11px;font-weight:400;color:var(--color-neutral-500)">${esc(estado)}</span>
        </label>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px 14px;margin:8px 0 0 24px">
          ${p.activos.map((a) => `<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer${completo ? ';opacity:.6' : ''}">
            <input type="checkbox" data-usu-proyecto="${esc(p.proyecto)}" data-usu-activo="${esc(a.activo_key)}" ${completo || ed.accesos.has(claveAcceso(p.proyecto, a.activo_key)) ? 'checked' : ''} ${completo || bloqueadoTodo ? 'disabled' : ''}>
            <span>${esc(a.activo)}</span>${a.habilitado ? '' : '<span style="font-size:10px;color:var(--color-neutral-500)">(no habilitado)</span>'}
          </label>`).join('')}
        </div>
      </div>`;
    }).join('');
  }

  detalle.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:4px">
      <h5 style="margin:0">${esc(original.nombre || ed.id)}</h5>
      <span style="font-size:12px;color:var(--color-neutral-500)">${esc(original.email || ed.id)}</span>
    </div>
    ${bloqueadoTodo ? '<p style="font-size:12px;color:var(--color-neutral-500);margin:0 0 12px">A un superadmin solo lo puede editar él mismo.</p>' : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
      <div class="field"><label>Nombre</label><input class="input" id="usu-edit-nombre" value="${esc(ed.nombre)}" ${bloqueadoTodo ? 'disabled' : ''}></div>
      <div class="field"><label>Rol</label><select class="input" id="usu-edit-rol" ${puedeTocarRol && !bloqueadoTodo ? '' : 'disabled'}>${opcionesRol}</select></div>
    </div>
    ${!puedeTocarRol && !bloqueadoTodo ? '<p style="font-size:12px;color:var(--color-neutral-500);margin:6px 0 0">Solo un superadmin puede designar o revocar administradores.</p>' : ''}
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin:12px 0 16px;cursor:pointer">
      <input type="checkbox" id="usu-edit-habilitado" ${ed.habilitado ? 'checked' : ''} ${puedeDeshabilitar ? '' : 'disabled'}>
      <span>Habilitado</span>
      <span style="font-size:11px;color:var(--color-neutral-500)">${esSuperObjetivo ? '(el superadmin no se deshabilita)' : soyYo ? '(no podés deshabilitarte a vos mismo)' : 'deshabilitado = no puede entrar, pero conserva su historial'}</span>
    </label>
    <div style="font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:var(--color-neutral-500);margin-bottom:8px">Proyectos y activos</div>
    ${grilla}
    <p id="usu-edit-error" class="error" style="margin:12px 0 0" ${state.usuError ? '' : 'hidden'}>${esc(state.usuError || '')}</p>
    <p style="margin:12px 0 0;font-size:13px;color:var(--color-accent-2-600)" ${state.usuExito ? '' : 'hidden'}>${esc(state.usuExito || '')}</p>
    <button class="btn btn-primary" data-action="usu-guardar" style="margin-top:14px" ${bloqueadoTodo || state.usuGuardando ? 'disabled' : ''}>${state.usuGuardando ? 'Guardando…' : 'Guardar'}</button>`;
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

// Mismo formato de clave que combos_excluidos y que colaPautas.js del
// servidor ("Objetivo|codigo_audiencia") — antes usaba "||" acá nomás, sin
// motivo real (nada la parsea de vuelta, es una key opaca), así que quedaba
// desalineada con lo que el servidor espera para leer el reparto a mano.
function claveCelda(objetivo, audCodigo) { return objetivo + "|" + audCodigo; }

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
  selA.innerHTML = state.pdActivos.map((a) => `<option value="${esc(a.activo_key)}" ${a.activo_key === state.pdActivoKey ? 'selected' : ''}>${esc(a.activo)}</option>`).join('');
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
  await asegurarAudienciasDe(activoKey);

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
  await asegurarAudienciasDe(activoKey);
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
    +   '<strong style="font-family:var(--font-heading);font-size:14px">' + total + ' contenido(s)'
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
    // Fila en error: "Reintentar" vuelve a validarla tal cual (sirve para
    // errores pasajeros, ej. Drive que no respondió a tiempo al crear; visto
    // 2026-09-15) — antes había que tocar un campo para que se revalidara.
    + (fila.error ? '<div style="display:flex;gap:10px;align-items:center;font-size:12px;color:var(--color-warning, #d08a1e);margin-bottom:8px"><span style="flex:1">' + esc(fila.error) + '</span>'
      + (fila.estado === 'error' ? '<button type="button" class="btn btn-secondary" style="font-size:12px;padding:3px 10px;flex:none" data-action="pd-csv-reintentar" data-id="' + i + '"><i class="ph ph-arrows-clockwise"></i> Reintentar</button>' : '') + '</div>' : '')
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
  // soloHabilitados=1 solo en modo "automatizado" — ver cargarActivosPedido.
  const soloHabilitados = state.modoActivo === 'automatizado' ? '&soloHabilitados=1' : '';
  const [rActivos, campanas] = await Promise.all([
    apiFetch(`/api/activos?proyecto=${encodeURIComponent(valor)}${soloHabilitados}`),
    cargarCampanasSugeridas(valor),
  ]);
  state.pdActivos = rActivos.ok ? await rActivos.json() : [];
  state.pd2CampanasSugeridas = campanas;
  state.pd2ActivoKey = (state.pdActivos[0] || {}).activo_key || null;
  state.pd2Posts = []; // activo distinto → los posts "Elegir publicación" ya no aplican
  await cargarAudienciasPorActivo(state.pd2ActivoKey);
  renderTabPedido2();
}

// Se llama cada vez que cambia el Activo elegido en el Módulo 1 (ver el
// listener de 'change' de #pd2-activo) — audiencias y posts son de ESE
// activo, no de uno fijo.
async function cambiarActivoPd2(valor) {
  state.pd2ActivoKey = valor;
  state.pd2Posts = [];
  await cargarAudienciasPorActivo(valor);
  // En "Público" el bloque de Material depende del activo (página vinculada
  // o no, ver renderMaterialBulkV2): se vuelve a armar al cambiarlo.
  if (state.pd2Visibilidad === 'PUBLICO') reiniciarMaterialesPiezasV2();
  renderTabPedido2();
  actualizarPresupuestoPreviewPd2();
}

// Publicaciones recientes del activo — usadas por el selector "Elegir
// publicación" de cada pieza (ver renderSelectorPostsBulkV2), una sola
// carga compartida por todas las piezas de la tanda.
// ¿El activo elegido tiene su página de Meta vinculada a la App? Sin eso
// no se pueden listar ni resolver publicaciones: en "Público" solo se pide
// el link del posteo (usuario, 2026-09-15). Sin dato, se asume que sí.
function activoVinculadoPd2() {
  const a = (state.pdActivos || []).find((x) => x.activo_key === state.pd2ActivoKey);
  return !a || a.vinculado !== false;
}

async function cargarPostsPedidoV2() {
  if (!activoVinculadoPd2()) { state.pd2Posts = []; return; }
  state.pd2CargandoPosts = true;
  const r = await apiFetch(`/api/publicaciones?activo_key=${encodeURIComponent(state.pd2ActivoKey || '')}`);
  state.pd2Posts = r.ok ? await r.json() : [];
  state.pd2CargandoPosts = false;
}

// "Pegar link" en Público: el link orgánico que se copia de un posteo (ej.
// permalink.php?story_fbid=...&id=... o instagram.com/p/...) no es un
// archivo descargable — nunca lo fue, verificarMaterial() siempre lo iba a
// rechazar ("devolvió una página web"). Lo resuelve el servidor
// (POST /api/publicaciones/resolver, ver metaContent.js:
// resolverPostDesdeLink) contra la Graph API real — NO alcanza con
// comparar el link a mano contra state.pd2Posts: el id que trae un link de
// "Copiar enlace" (story_fbid, formato "pfbid...") no es comparable como
// texto contra los id que devuelve /{page_id}/posts, son dos codificaciones
// distintas del mismo posteo y solo Graph sabe traducir una a la otra.
async function resolverPostDesdeLinkV2(link) {
  const r = await apiFetch('/api/publicaciones/resolver', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activo_key: state.pd2ActivoKey, link }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.detalle || data.error);
  return data;
}

// Preview de los cruces Objetivo×Audiencia que va a generar el pedido —
// pedido del usuario: "antes de mandar a pedir el anuncio el PM/Cuentas
// puede desactivar un cruce". Se arma con lo que hay tildado AHORA en el
// DOM (Objetivo del Módulo 1 no vive sincronizado en state, ver el
// comentario de más arriba) — no con state.pd2Objetivo, que está desfasado.
// Lo que se destilda acá queda en pd2CombosExcluidos y viaja con el pedido:
// ese cruce nunca se crea, ni el implementador lo ve después en Validación
// (ver getMatrizParaPauta en colaPautas.js).
// Reparto en DOS niveles (pedido explícito del usuario): primero qué % del
// presupuesto va a cada Objetivo, y dentro de cada Objetivo cómo se reparte
// ese % entre las Audiencias. El % final de cada conjunto de anuncios sale
// de multiplicar los dos. Los pesos se guardan crudos y se normalizan a 100
// recién al mostrar/mandar (normalizar100), así SIEMPRE suma 100 exacto por
// más que se muevan sliders, se excluyan cruces o cambien Objetivo/Audiencia.
function audienciasDelPd2() {
  const audienciaEl = document.getElementById('pd2-audiencia');
  const principal = audienciaEl ? audienciaEl.value : (state.pd2AudienciaCodigo || '');
  const refuerzos = leerCheckboxes('pd2-refuerzo-chk');
  const codigos = [principal].concat(refuerzos).filter(Boolean).filter((a, i, arr) => arr.indexOf(a) === i);
  return codigos.map((codigo) => {
    const a = (state.pdAudiencias || []).find((x) => x.codigo === codigo);
    return {
      codigo,
      nombre: codigo === 'Otra' ? 'Otra (a mano)' : (a ? a.nombre : codigo),
      manual: codigo === 'Otra',
      principal: codigo === principal,
    };
  });
}

function combosDelPd2() {
  const objetivos = leerCheckboxes('pd2-objetivo-chk');
  const auds = audienciasDelPd2();
  const combos = [];
  objetivos.forEach((objetivo) => auds.forEach((a) => combos.push({
    objetivo, audCodigo: a.codigo, audNombre: a.nombre, manual: a.manual, principal: a.principal,
  })));
  return combos;
}

function pesosParejos(claves) {
  const mapa = {};
  claves.forEach((k) => { mapa[k] = 100 / (claves.length || 1); });
  return mapa;
}

// Si cambió la "forma" (otros Objetivos u otras Audiencias), el reparto
// anterior ya no aplica: se vuelve a parejo en los dos niveles.
// Reparto plano: una línea por cruce Objetivo × Audiencia (usuario,
// 2026-09-14), cada una con su % del total, se puede desactivar (checkbox)
// o bloquear (candado: no se mueve cuando se ajustan las demás). Nadie ve
// montos acá — el presupuesto lo resuelve el servidor.
// state.pd2Reparto = { "Objetivo|codigo": pct }, state.pd2RepartoBloqueados
// = { clave: true }, state.pd2CombosExcluidos = { clave: true }.
function combosRepartoPd2() {
  const objetivos = leerCheckboxes('pd2-objetivo-chk');
  const auds = audienciasDelPd2();
  const combos = [];
  objetivos.forEach((obj) => auds.forEach((a) => combos.push({ objetivo: obj, audiencia: a, clave: obj + '|' + a.codigo })));
  return combos;
}

function asegurarRepartoPd2() {
  const combos = combosRepartoPd2();
  const firma = combos.map((c) => c.clave).join('~');
  if (state.pd2RepartoFirma === firma && state.pd2Reparto) return;
  state.pd2RepartoFirma = firma;
  state.pd2Reparto = normalizar100({}, combos.map((c) => c.clave));
  state.pd2RepartoBloqueados = {};
  state.pd2CombosExcluidos = {};
  state.pd2RepartoSugerido = null;
  pedirRepartoSugeridoPd2(firma, combos);
}

// Predefinido de esta primera etapa: lo mismo que se asignó la última vez
// en este mismo cruce Activo × Tipo × Objetivos × Audiencias (servidor:
// /api/reparto-sugerido). Si no hay historial, queda parejo.
async function pedirRepartoSugeridoPd2(firma, combos) {
  if (!combos.length || !state.pd2ActivoKey || !state.pd2TipoCodigo) return;
  const objetivos = [...new Set(combos.map((c) => c.objetivo))];
  const audiencias = [...new Set(combos.map((c) => c.audiencia.codigo))];
  try {
    const r = await apiFetch('/api/reparto-sugerido?activoKey=' + encodeURIComponent(state.pd2ActivoKey)
      + '&tipoCodigo=' + encodeURIComponent(state.pd2TipoCodigo)
      + '&objetivos=' + encodeURIComponent(objetivos.join(','))
      + '&audiencias=' + encodeURIComponent(audiencias.join(',')));
    const data = r.ok ? await r.json() : null;
    if (!data || !data.reparto || state.pd2RepartoFirma !== firma) return;
    const claves = combos.map((c) => c.clave);
    const conDatos = claves.filter((k) => data.reparto[k] !== undefined);
    if (!conDatos.length) return;
    state.pd2Reparto = normalizar100(Object.fromEntries(claves.map((k) => [k, Number(data.reparto[k]) || 0])), claves);
    claves.forEach((k) => { if (!(Number(data.reparto[k]) > 0)) state.pd2CombosExcluidos[k] = true; });
    state.pd2RepartoSugerido = { codigo: data.codigo, fecha: data.fecha };
    renderCrucesV2();
  } catch (e) { /* sin sugerencia: queda parejo */ }
}

// Pasa pesos crudos a porcentajes que suman 100 EXACTO (el resto del
// redondeo va a la última clave, mismo criterio que el servidor).
function normalizar100(pesos, claves) {
  const mapa = {};
  if (!claves.length) return mapa;
  const total = claves.reduce((a, k) => a + (Number(pesos[k]) || 0), 0);
  let acum = 0;
  claves.forEach((k, i) => {
    if (i === claves.length - 1) { mapa[k] = +(100 - acum).toFixed(2); return; }
    const v = total > 0
      ? +(((Number(pesos[k]) || 0) * 100) / total).toFixed(2)
      : +(100 / claves.length).toFixed(2);
    mapa[k] = v;
    acum = +(acum + v).toFixed(2);
  });
  return mapa;
}

// Mueve una línea: las bloqueadas no se tocan, las demás activas absorben
// el resto proporcional a lo que tenían. Siempre cierra en 100.
function moverPesoConBloqueos(pesos, clavesActivas, bloqueados, claveMovida, valor) {
  const libres = clavesActivas.filter((k) => !bloqueados[k]);
  const fijas = clavesActivas.filter((k) => bloqueados[k] && k !== claveMovida);
  const sumaFijas = fijas.reduce((a, k) => a + (Number(pesos[k]) || 0), 0);
  const disponible = Math.max(0, +(100 - sumaFijas).toFixed(2));
  const v = Math.max(0, Math.min(disponible, valor));
  const nuevo = {};
  fijas.forEach((k) => { nuevo[k] = Number(pesos[k]) || 0; });
  nuevo[claveMovida] = v;
  const otros = libres.filter((k) => k !== claveMovida);
  const restante = Math.max(0, +(disponible - v).toFixed(2));
  const pesoAnterior = otros.reduce((a, k) => a + (Number(pesos[k]) || 0), 0);
  otros.forEach((k) => {
    nuevo[k] = pesoAnterior > 0 ? +((restante * (Number(pesos[k]) || 0)) / pesoAnterior).toFixed(2) : +(restante / (otros.length || 1)).toFixed(2);
  });
  const suma = clavesActivas.reduce((a, k) => a + (nuevo[k] || 0), 0);
  const ajuste = otros.length ? otros[otros.length - 1] : claveMovida;
  nuevo[ajuste] = +((nuevo[ajuste] || 0) + (100 - suma)).toFixed(2);
  return nuevo;
}

// Cierra en 100 respetando bloqueadas: las fijas quedan como están y el
// resto se reparte entre las libres proporcional a lo que tenían.
function cerrarConBloqueos(pesos, clavesActivas, bloqueados) {
  const fijas = clavesActivas.filter((k) => bloqueados[k]);
  const libres = clavesActivas.filter((k) => !bloqueados[k]);
  const sumaFijas = fijas.reduce((a, k) => a + (Number(pesos[k]) || 0), 0);
  const nuevo = {};
  fijas.forEach((k) => { nuevo[k] = Number(pesos[k]) || 0; });
  if (!libres.length) return nuevo;
  const disponible = Math.max(0, +(100 - sumaFijas).toFixed(2));
  const prop = normalizar100(pesos, libres);
  libres.forEach((k) => { nuevo[k] = +((prop[k] * disponible) / 100).toFixed(2); });
  const suma = clavesActivas.reduce((a, k) => a + (nuevo[k] || 0), 0);
  const ultima = libres[libres.length - 1];
  nuevo[ultima] = +((nuevo[ultima] || 0) + (100 - suma)).toFixed(2);
  return nuevo;
}

// Única fuente de verdad de los porcentajes: la usan el render y el envío.
// Devuelve una línea por cruce; las desactivadas van en 0.
function repartoResueltoPd2() {
  asegurarRepartoPd2();
  const combos = combosRepartoPd2();
  const activas = combos.filter((c) => !state.pd2CombosExcluidos[c.clave]).map((c) => c.clave);
  const pct = normalizar100(state.pd2Reparto || {}, activas);
  return combos.map((c) => ({
    objetivo: c.objetivo,
    audiencia: c.audiencia,
    clave: c.clave,
    excluida: !!state.pd2CombosExcluidos[c.clave],
    bloqueada: !!state.pd2RepartoBloqueados[c.clave],
    pct: state.pd2CombosExcluidos[c.clave] ? 0 : (pct[c.clave] || 0),
  }));
}

// {"Objetivo|codigo_audiencia": pct} — formato que espera el servidor.
function repartoPlanoPd2() {
  const mapa = {};
  repartoResueltoPd2().forEach((f) => { if (!f.excluida && f.pct > 0) mapa[f.clave] = f.pct; });
  const claves = Object.keys(mapa);
  if (claves.length) {
    const suma = claves.reduce((a, k) => a + mapa[k], 0);
    const ultima = claves[claves.length - 1];
    mapa[ultima] = +(mapa[ultima] + (100 - suma)).toFixed(2);
  }
  return mapa;
}

// Excluidos que viajan con el pedido: los destildados MÁS los que quedaron
// en 0% — para el servidor son lo mismo (ese cruce no se crea).
function excluidosParaEnvioPd2() {
  const fuera = Object.assign({}, state.pd2CombosExcluidos);
  repartoResueltoPd2().forEach((f) => { if (f.excluida || f.pct <= 0) fuera[f.clave] = true; });
  return Object.keys(fuera);
}

// "Pedido de Pauta" nunca elige el presupuesto a mano — se lo pide al
// servidor solo para validar mínimos; acá no se muestra ningún monto.
async function actualizarPresupuestoPreviewPd2() {
  if (state.pd2ModoDirecto) return;
  const activoKey = state.pd2ActivoKey;
  const tipoCodigo = state.pd2TipoCodigo;
  const audEl = document.getElementById('pd2-audiencia');
  const audienciaCodigo = audEl ? audEl.value : state.pd2AudienciaCodigo;
  if (!activoKey || !tipoCodigo || !audienciaCodigo) { state.pd2PresupuestoPreview = null; return; }
  try {
    const r = await apiFetch(`/api/presupuesto-preview?activoKey=${encodeURIComponent(activoKey)}&tipoCodigo=${encodeURIComponent(tipoCodigo)}&audienciaCodigo=${encodeURIComponent(audienciaCodigo)}`);
    const data = r.ok ? await r.json() : { presupuesto: null };
    state.pd2PresupuestoPreview = data.presupuesto;
  } catch (e) {
    state.pd2PresupuestoPreview = null;
  }
  renderCrucesV2();
}

function renderCrucesV2() {
  renderAvisoOtraV2();
  const wrap = document.getElementById('pd2-cruces-wrap');
  if (!wrap) return;
  const filas = repartoResueltoPd2();
  if (filas.length <= 1) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    return;
  }

  // Cuadrícula (usuario, 2026-09-14): audiencias en filas, objetivos en
  // columnas; cada celda es un cruce con su %, slider, activar y candado.
  const COLORES = ['var(--color-accent)', '#2a9d8f', '#e76f51', '#8d6cab', '#c9a227', '#5c7cfa'];
  const objetivos = [...new Set(filas.map((f) => f.objetivo))];
  const audiencias = [];
  filas.forEach((f) => { if (!audiencias.find((a) => a.codigo === f.audiencia.codigo)) audiencias.push(f.audiencia); });
  const colorDe = (obj) => COLORES[objetivos.indexOf(obj) % COLORES.length];
  const activas = filas.filter((f) => !f.excluida);
  const libres = activas.filter((f) => !f.bloqueada);
  const porClave = {};
  filas.forEach((f) => { porClave[f.clave] = f; });

  const tramos = filas.filter((f) => !f.excluida && f.pct > 0).map((f, i) => '<div title="' + esc(f.objetivo + ' · ' + f.audiencia.nombre + ': ' + f.pct + '%') + '" style="width:' + f.pct + '%;background:' + colorDe(f.objetivo) + ';opacity:' + (i % 2 ? '.72' : '1') + ';border-right:1px solid var(--color-surface, #fff)"></div>');
  const barra = '<div style="display:flex;height:12px;border-radius:6px;overflow:hidden;background:var(--color-divider);margin-bottom:10px">' + tramos.join('') + '</div>';

  const celda = (f) => {
    const datos = 'data-clave="' + esc(f.clave) + '"';
    const fijo = f.excluida || activas.length <= 1 || f.bloqueada || (libres.length <= 1 && !f.bloqueada);
    const color = colorDe(f.objetivo);
    return '<td style="padding:8px 10px;border-top:1px solid var(--color-divider);border-left:1px solid var(--color-divider);vertical-align:top' + (f.excluida ? ';opacity:.45' : '') + '">'
      + '<div style="display:flex;align-items:center;gap:6px">'
      +   '<input type="checkbox" ' + (f.excluida ? '' : 'checked') + ' title="' + (f.excluida ? 'Activar este cruce' : 'Desactivar este cruce') + '" data-action="pd2-excluir-cruce" ' + datos + ' style="width:15px;height:15px;accent-color:' + color + ';flex:none">'
      +   '<input type="number" min="0" max="100" step="1" value="' + Math.round(f.pct) + '" ' + (fijo ? 'disabled ' : '') + 'data-action="pd2-cruce-slider" ' + datos + ' title="% del total" style="width:58px;padding:4px 6px;text-align:right;border:1px solid var(--color-divider);border-radius:4px;background:var(--color-surface, #fff);color:inherit;font-family:var(--font-heading);font-size:13px;flex:none' + (fijo ? ';opacity:.6' : '') + '">'
      +   '<span style="font-size:12px;color:var(--color-neutral-500)">%</span>'
      +   '<input type="range" min="0" max="100" step="1" value="' + Math.round(f.pct) + '" ' + (fijo ? 'disabled ' : '') + 'data-action="pd2-cruce-slider" ' + datos + ' style="flex:1;min-width:90px;margin:0 6px;accent-color:' + color + (fijo ? ';opacity:.4' : '') + '">'
      +   '<button type="button" title="' + (f.bloqueada ? 'Desbloquear' : 'Bloquear en ' + Math.round(f.pct) + '%') + '" ' + (f.excluida ? 'disabled ' : '') + 'data-action="pd2-cruce-bloquear" ' + datos + ' style="cursor:pointer;border:1px solid ' + (f.bloqueada ? color : 'var(--color-divider)') + ';background:' + (f.bloqueada ? color : 'transparent') + ';color:' + (f.bloqueada ? '#fff' : 'var(--color-neutral-500)') + ';font-size:13px;width:26px;height:26px;border-radius:4px;flex:none"><i class="ph ph-' + (f.bloqueada ? 'lock-simple' : 'lock-simple-open') + '"></i></button>'
      +   '<button type="button" title="Todo el presupuesto a este cruce" ' + (f.excluida || activas.length <= 1 ? 'disabled ' : '') + 'data-action="pd2-cruce-todo" ' + datos + ' style="cursor:pointer;border:1px solid var(--color-divider);background:transparent;color:var(--color-neutral-500);font-size:13px;width:26px;height:26px;border-radius:4px;flex:none"><i class="ph ph-target"></i></button>'
      + '</div>'
      + '</td>';
  };

  const cabecera = '<tr>'
    + '<th style="text-align:left;padding:8px 10px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--color-neutral-500);font-weight:500">Audiencia \\ Objetivo</th>'
    + objetivos.map((o) => '<th style="text-align:left;padding:8px 10px;border-left:1px solid var(--color-divider);font-family:var(--font-heading);font-size:13px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + colorDe(o) + ';margin-right:6px;vertical-align:middle"></span>' + esc(o) + '</th>').join('')
    + '</tr>';
  const cuerpo = audiencias.map((a) => '<tr>'
    + '<td style="padding:8px 10px;border-top:1px solid var(--color-divider);font-size:13px;vertical-align:top;max-width:260px">' + esc(a.nombre) + (a.manual ? ' <span class="tag tag-outline" style="font-size:10px">a mano</span>' : '') + '</td>'
    + objetivos.map((o) => { const f = porClave[o + '|' + a.codigo]; return f ? celda(f) : '<td></td>'; }).join('')
    + '</tr>').join('');

  wrap.hidden = false;
  wrap.innerHTML = '<div class="field" style="margin-top:12px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
    +   '<label style="margin:0">Distribución de la inversión <span style="font-weight:400;color:var(--color-neutral-500)">(% del total en cada cruce — el resto se acomoda solo; el candado fija una celda)</span></label>'
    +   '<button type="button" class="btn btn-secondary" style="font-size:12px;padding:4px 10px" data-action="pd2-reparto-parejo"><i class="ph ph-equals"></i> Repartir parejo</button>'
    + '</div>'
    + barra
    + '<div style="overflow-x:auto;border:1px solid var(--color-divider);border-radius:var(--radius-md)"><table style="width:100%;border-collapse:collapse"><thead>' + cabecera + '</thead><tbody>' + cuerpo + '</tbody></table></div>'
    + '<div style="margin-top:8px;font-size:13px;font-family:var(--font-heading);color:var(--color-accent-300)">Total: 100%' + (activas.length !== filas.length ? ' <span style="color:var(--color-neutral-500);font-weight:400">(' + (filas.length - activas.length) + ' cruce(s) desactivado(s))</span>' : '') + '</div>'
    + '</div>';
}

// "Oficial" / "Informativo" / "Oficial + Informativo" (admin con "Ver ambos").
function etiquetaEcosistema() {
  if (state.ecosistemaActivo === 'TODOS') return 'Oficial + Informativo';
  return state.ecosistemaActivo || '';
}
function claseEcosistema() {
  if (state.ecosistemaActivo === 'Oficial') return 'eco-oficial';
  if (state.ecosistemaActivo === 'Informativo') return 'eco-informativo';
  return 'eco-todos';
}

function renderTabPedido2() {
  // Título con la marca de ecosistema y el proyecto (pedido del usuario:
  // "que se sepa desde la interfaz", ej. "Pedido de Anuncios — INFORMATIVO ·
  // Gobierno del Chubut") + franja de color en el panel.
  const base = state.pd2ModoDirecto ? 'Crear Anuncio' : 'Pedido de Anuncios';
  const proyectoTitulo = state.proyectoActivo === 'TODOS' ? 'Todos los proyectos' : (state.proyectoActivo || '');
  document.getElementById('pd2-titulo').innerHTML = esc(base)
    + ' <span class="eco-chip ' + claseEcosistema() + '" style="vertical-align:middle;margin:0 6px">' + esc(etiquetaEcosistema()) + '</span>'
    + '<span style="font-weight:400;color:var(--color-neutral-500)">· ' + esc(proyectoTitulo) + '</span>'
    + (proyectoSoloInformativo() ? '<div style="font-size:12px;font-weight:400;color:var(--color-warning, #d08a1e);margin-top:4px"><i class="ph ph-info"></i> ' + esc(LEYENDA_SOLO_INFORMATIVO) + '</div>' : '');
  const panelPedido = document.querySelector('#tab-pedido2 > .expand-panel');
  if (panelPedido) { panelPedido.classList.remove('eco-oficial', 'eco-informativo', 'eco-todos'); panelPedido.classList.add(claseEcosistema()); }
  document.getElementById('pd2-card-anuncios-titulo').textContent = state.pd2ModoDirecto ? 'Crear Anuncios' : 'Pedido de Anuncios';
  document.getElementById('pd2-modo-carga-anuncios-label').textContent = state.pd2ModoDirecto ? 'Crear Anuncios' : 'Pedido de Anuncios';

  if (!state.pd2Proyecto) state.pd2Proyecto = state.pdProyecto || state.pdProyectos[0] || null;
  // Fallback sincrónico si por algún motivo todavía no se eligió Activo acá
  // (el camino normal ya lo hace en cargarActivosPedido/cambiarProyectoPd2,
  // que además disparan la carga de audiencias de ESE activo — este
  // fallback no lo hace, es solo para no dejar el <select> vacío).
  if (!state.pd2ActivoKey) state.pd2ActivoKey = (state.pdActivos[0] || {}).activo_key || null;
  if (!state.pd2EjeCodigo && state.pdEjes.length) state.pd2EjeCodigo = null;
  if (!state.pdTipos.find((t) => t.codigo === state.pd2TipoCodigo)) state.pd2TipoCodigo = (state.pdTipos[0] || {}).codigo || null;

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
  if (state.pd2ModoCarga !== 'anuncios') { document.getElementById('pd2-plataforma-elegir').hidden = true; return; }

  // Paso previo: la cuadrícula de plataformas. Hasta confirmar, los
  // módulos quedan ocultos.
  document.getElementById('pd2-plataforma-elegir').hidden = state.pd2PlataformaElegida;
  document.getElementById('pd2-modulos-wrap').hidden = !state.pd2PlataformaElegida;
  if (!state.pd2PlataformaElegida) { renderGrillaPlataformas(); return; }

  document.getElementById('pd2-bulk-crear').hidden = !state.pd2BulkItems.length;
  document.getElementById('pd2-cantidad-piezas').value = String(state.pd2BulkItems.length || 1);

  renderCampanasDatalistPd2();

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

  // Plataforma(s) elegidas en la cuadrícula — resumen arriba del Módulo 1
  // con la opción de volver a elegir.
  const platInfo = plataformaPd2Actual();
  const esMetaPd2 = platInfo.esMeta;
  document.getElementById('pd2-plataforma-resumen').innerHTML =
    '<span style="color:var(--color-neutral-500)">Plataforma' + (state.pd2Plataformas.length > 1 ? 's' : '') + ':</span> '
    + state.pd2Plataformas.map((n) => '<span class="tag"><i class="ph ' + esc(iconoPlataforma(n)) + '"></i> ' + esc(n) + '</span>').join('')
    + ' <button type="button" class="btn btn-ghost" data-action="pd2-plataforma-cambiar" style="font-size:12px;padding:2px 6px">cambiar</button>';

  const selProy2 = document.getElementById('pd2-proyecto');
  selProy2.innerHTML = state.pdProyectos.map((p) => `<option value="${esc(p)}" ${p === state.pd2Proyecto ? 'selected' : ''}>${esc(p)}</option>`).join('');
  // Ya se eligió el Proyecto en el onboarding — acá queda fijo, mismo
  // criterio que "pd-proyecto" en v1 (ver proyectosDisponiblesBloqueado).
  selProy2.disabled = state.proyectosDisponiblesBloqueado;
  document.getElementById('pd2-activo').innerHTML = state.pdActivos.map((a) => `<option value="${esc(a.activo_key)}" ${a.activo_key === state.pd2ActivoKey ? 'selected' : ''}>${esc(a.activo)}</option>`).join('');
  document.getElementById('pd2-tipo').innerHTML = state.pdTipos.map((t) => `<option value="${esc(t.codigo)}" ${t.codigo === state.pd2TipoCodigo ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('');
  document.getElementById('pd2-eje').innerHTML = '<option value="">— elegir —</option>' + state.pdEjes.map((e) => `<option value="${esc(e.codigo)}" ${e.codigo === state.pd2EjeCodigo ? 'selected' : ''}>${esc(e.eje)}</option>`).join('');

  // El tildado vive en el DOM, no en state.pd2Objetivo (nunca se sincroniza
  // ahí) — hay que leerlo antes de reconstruir el dropdown o cada render
  // (ej. "Confirmar y seguir") lo pisaba con el array vacío inicial.
  const objetivoPrevio = leerCheckboxes('pd2-objetivo-chk');
  // Otra plataforma: solo sus objetivos (ver src/config/plataformas.js).
  const objetivosPd2 = platInfo.objetivos ? state.pdObjetivos.filter((o) => platInfo.objetivos.includes(o)) : state.pdObjetivos;
  document.getElementById('pd2-objetivo-wrap').innerHTML = renderDropdownMulti('pd2-objetivo-dd', 'pd2-objetivo-chk', objetivosPd2.map((o) => [o, o]), '— elegir uno o más —', objetivoPrevio.filter((o) => objetivosPd2.includes(o)));
  document.getElementById('pd2-audiencia-wrap').innerHTML = renderAudienciaSelect('pd2-audiencia', state.pdAudiencias, state.pd2AudienciaCodigo);
  document.getElementById('pd2-otra-audiencia-wrap').hidden = state.pd2AudienciaCodigo !== 'Otra';
  const refuerzoPrevio = leerCheckboxes('pd2-refuerzo-chk');
  document.getElementById('pd2-refuerzo-wrap').innerHTML = renderRefuerzoDropdown('pd2', state.pdAudiencias, refuerzoPrevio);
  document.getElementById('pd2-otras-refuerzo-wrap').hidden = !refuerzoPrevio.includes('Otra');
  renderCrucesV2();

  // "Público" existe en Meta, Youtube, Tik Tok y X (promocionar una
  // publicación que ya existe en esa red); Display no (usuario, 2026-09-15).
  // Con varias plataformas, la Visibilidad vale para todas; Display queda
  // siempre Oculto. Red y Placement siguen siendo solo de Meta.
  const tienePublicoPd2 = plataformasPd2().some((n) => n !== 'Display');
  if (!tienePublicoPd2 && state.pd2Visibilidad !== 'DARK') state.pd2Visibilidad = 'DARK';
  const selVis = document.getElementById('pd2-visibilidad');
  selVis.value = state.pd2Visibilidad;
  selVis.disabled = !tienePublicoPd2;
  // El Formato se pide también en Público (compañeros, 2026-09-16): arma el
  // nombre del contenido y la Categoría de pieza; antes quedaba "(Publicación)".
  document.getElementById('pd2-formato-wrap').hidden = false;
  const formatoPrevio = document.getElementById('pd2-formato') ? document.getElementById('pd2-formato').value : '';
  const formatosPd2 = formatosPd2Disponibles();
  document.getElementById('pd2-formato').innerHTML = formatosPd2.map((f) => `<option value="${esc(f.appsheet_valor)}" ${f.appsheet_valor === formatoPrevio ? 'selected' : ''}>${esc(f.appsheet_valor)}</option>`).join('');
  const formatoElegido = document.getElementById('pd2-formato').value;
  const formatoInfoActual = formatosPd2.find((f) => f.appsheet_valor === formatoElegido);
  const ayudaFormato = document.getElementById('pd2-formato-ayuda');
  ayudaFormato.hidden = !platInfo.ayudaMaterial;
  ayudaFormato.textContent = platInfo.ayudaMaterial || '';
  document.getElementById('pd2-redes-wrap').hidden = !esMetaPd2;
  document.getElementById('pd2-placements-field').hidden = !esMetaPd2;
  const bloqueadoEnFeed = state.pd2Visibilidad === 'PUBLICO';
  // Placement arranca con Feed elegido (pedido del usuario 2026-09-12: "que
  // arranque eligiendo uno") — antes quedaba vacío y frenaba el módulo.
  if (esMetaPd2 && !bloqueadoEnFeed && !state.pd2Placements.length) state.pd2Placements = ['feed'];
  if (esMetaPd2) {
    document.getElementById('pd2-placements-wrap').innerHTML = renderPlacementsCheckboxes(bloqueadoEnFeed ? ['feed'] : state.pd2Placements, formatoInfoActual, false, bloqueadoEnFeed, 'pd2-placement-chk');
    // Medidas recomendadas de los placements elegidos (specs del equipo) —
    // ayuda ANTES de cargar la pieza; el chequeo real es al verificar.
    const medidasHint = dimensionRecomendada(bloqueadoEnFeed ? ['feed'] : (state.pd2Placements.length ? state.pd2Placements : ['feed']));
    if (medidasHint) {
      document.getElementById('pd2-placements-wrap').insertAdjacentHTML('beforeend', '<div style="font-size:11px;color:var(--color-neutral-500);margin-top:6px">Medidas: ' + esc(medidasHint) + '</div>');
    }
  }
  // Categoría de pieza (por Formato) y Gobernador: solo Pedido Normal.
  const esNormalPd2 = state.modoActivo !== 'automatizado';
  const categorias = esNormalPd2 && state.pd2Visibilidad === 'DARK' ? ((platInfo.categorias || {})[formatoElegido] || []) : [];
  const selCat = document.getElementById('pd2-categoria-pieza');
  const catPrevia = selCat.value;
  document.getElementById('pd2-categoria-wrap').hidden = !categorias.length;
  selCat.innerHTML = '<option value="">— sin definir —</option>' + categorias.map((c) => `<option value="${esc(c)}" ${c === catPrevia ? 'selected' : ''}>${esc(c)}</option>`).join('');
  document.getElementById('pd2-gobernador-wrap').hidden = !esNormalPd2;
  document.getElementById('pd2-link-destino-hint').textContent = platInfo.requiereLink
    ? `(obligatorio en ${platInfo.nombre})`
    : '(opcional, obligatorio con Objetivo Tráfico)';

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
    // Nombra solo lo que falta (antes decía "Completá Proyecto, Activo, Tipo
    // y Eje" aunque solo faltara el Eje).
    const faltan = [];
    if (!state.pd2Proyecto) faltan.push('el Proyecto');
    if (!state.pd2ActivoKey) faltan.push('el Activo');
    if (!state.pd2TipoCodigo) faltan.push('el Tipo');
    if (!state.pd2EjeCodigo) faltan.push('el Eje');
    if (!document.getElementById('pd2-campana').value.trim()) faltan.push('la Campaña');
    if (!leerCheckboxes('pd2-objetivo-chk').length) faltan.push('al menos un Objetivo');
    if (faltan.length === 1) return 'Falta ' + faltan[0] + '.';
    if (faltan.length > 1) return 'Falta ' + faltan.slice(0, -1).join(', ') + ' y ' + faltan[faltan.length - 1] + '.';
    return null;
  }
  if (n === 2) {
    if (!document.getElementById('pd2-audiencia').value) return 'Elegí la Audiencia principal.';
    // El reparto siempre cierra en 100 solo (se normaliza en
    // repartoResueltoPd2), así que acá no hace falta validar la suma.
    return null;
  }
  if (n === 3) {
    if (!document.getElementById('pd2-fecha-inicio').value) return 'Falta la Fecha de inicio.';
    return null;
  }
  if (n === 4) {
    const plat = plataformaPd2Actual();
    if (!document.getElementById('pd2-formato').value) return 'Elegí el Formato.';
    if (plat.esMeta && state.pd2Visibilidad === 'DARK' && !state.pd2Placements.length) return 'Elegí al menos un Placement.';
    if (plat.requiereLink && !document.getElementById('pd2-link-destino').value.trim()) return `En ${plat.nombre} el Link de destino es obligatorio.`;
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
  // "Ni bien toca Pedido de Anuncios": la cuadrícula de plataformas se
  // pregunta siempre al entrar (queda lo elegido la última vez como default).
  if (modo === 'anuncios') state.pd2PlataformaElegida = false;
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
  return formatosPd2Disponibles().find((f) => f.appsheet_valor === valor);
}

const ICONO_PLATAFORMA = { Meta: 'ph-meta-logo', Youtube: 'ph-youtube-logo', 'Tik Tok': 'ph-tiktok-logo', X: 'ph-x-logo', Display: 'ph-monitor' };
function iconoPlataforma(nombre) { return ICONO_PLATAFORMA[nombre] || 'ph-megaphone'; }
const FORMATO_GENERICO_UI = { imagen: 'Placa Fija', video: 'Video', carrusel: 'Carrusel' };
// Orden fijo del desplegable de Formato en Meta (nombres de AppSheet).
const ORDEN_FORMATOS = ['Placa Fija', 'Placa Animada', 'Video', 'Carrusel'];

// Las plataformas elegidas, combinadas en una sola "vista" — mismo criterio
// que combinarPlataformas() en el server: con una sola, sus formatos/
// objetivos; con varias, los formatos genéricos (Imagen/Video/Carrusel)
// que TODAS soportan y la intersección de objetivos; link obligatorio o
// "solo video" si alguna lo exige. esMeta = Meta y nada más (la única que
// tiene Red/Placement/Público/preview real).
function plataformaPd2Actual() {
  const infos = state.pd2Plataformas.map((n) => state.pdPlataformas.find((p) => p.nombre === n)).filter(Boolean);
  if (!infos.length) return { nombres: ['Meta'], nombre: 'Meta', esMeta: true, formatos: null, objetivos: null, requiereLink: false, soloVideo: false, ayudaMaterial: '', categorias: {} };
  const nombres = infos.map((p) => p.nombre);
  const esMeta = nombres.length === 1 && nombres[0] === 'Meta';
  let formatos;
  if (nombres.length === 1) {
    formatos = infos[0].formatos ? infos[0].formatos.map((f) => ({ appsheet_valor: f, modo: (infos[0].modos || {})[f] || 'imagen' })) : null;
  } else {
    formatos = ['imagen', 'video', 'carrusel']
      .filter((m) => infos.every((p) => Object.values(p.modos || {}).includes(m)))
      .map((m) => ({ appsheet_valor: FORMATO_GENERICO_UI[m], modo: m }));
  }
  const conObjetivos = infos.filter((p) => p.objetivos);
  const objetivos = conObjetivos.length ? conObjetivos[0].objetivos.filter((o) => conObjetivos.every((p) => p.objetivos.includes(o))) : null;
  // Categorías de pieza: las de Meta si está (tiene Imagen/Video/Carrusel), si no las de la primera.
  const fuenteCat = infos.find((p) => p.nombre === 'Meta') || infos[0];
  return {
    nombres, nombre: nombres.join(', '), esMeta, formatos, objetivos,
    requiereLink: infos.some((p) => p.requiereLink),
    soloVideo: infos.some((p) => p.soloVideo),
    ayudaMaterial: infos.map((p) => p.ayudaMaterial).filter(Boolean).join(' '),
    categorias: fuenteCat.categorias || {},
  };
}

// Meta sola: los de equiv_formato (con modo imagen/video/carrusel). Otra
// cosa: la lista combinada, con el mismo shape para que el resto del
// formulario (carrusel, preview) no tenga que distinguir.
function formatosPd2Disponibles() {
  const plat = plataformaPd2Actual();
  return plat.formatos || state.pdFormatos;
}

// Cuadrícula de plataformas (logos, multipick). En Automatizado solo Meta
// está habilitada (el server ya devuelve solo Meta en ese modo).
function renderGrillaPlataformas() {
  asegurarPendientesDetalle(renderGrillaPlataformas);
  const lista = state.pdPlataformas.length ? state.pdPlataformas : [{ nombre: 'Meta', habilitada: true }];
  document.getElementById('pd2-plataforma-eyebrow').textContent = etiquetaEcosistema() + ' · ' + (state.proyectoActivo === 'TODOS' ? 'Todos los proyectos' : (state.proyectoActivo || ''));
  const detalle = (p) => (p.formatos ? p.formatos.join(' · ') : 'Feed · Stories · Reels · Carrusel');
  document.getElementById('pd2-plataforma-grid').innerHTML = lista.map((p) => {
    const elegida = state.pd2Plataformas.includes(p.nombre);
    const deshabilitada = p.habilitada === false;
    return '<button type="button" class="plataforma-card' + (elegida ? ' elegida' : '') + '" data-action="pd2-plataforma-toggle" data-id="' + esc(p.nombre) + '" ' + (deshabilitada ? 'disabled title="Solo en Pedido Manual"' : '') + '>'
      + badgePendientes(contarPendientes({ plataforma: p.nombre }))
      + '<i class="ph ' + esc(iconoPlataforma(p.nombre)) + '"></i>'
      + '<span class="nombre">' + esc(p.nombre) + '</span>'
      + '<span class="detalle">' + esc(detalle(p)) + '</span>'
      + '</button>';
  }).join('');
  const comb = plataformaPd2Actual();
  const formatosComunes = comb.formatos ? comb.formatos.map((f) => f.appsheet_valor) : ORDEN_FORMATOS;
  const nota = document.getElementById('pd2-plataforma-nota');
  if (!state.pd2Plataformas.length) nota.textContent = 'Elegí al menos una plataforma.';
  else if (state.pd2Plataformas.length > 1) nota.textContent = formatosComunes.length ? ('Formatos en común: ' + formatosComunes.join(' · ') + (comb.objetivos ? ' — objetivos: ' + comb.objetivos.join(' · ') : '')) : 'Estas plataformas no comparten ningún formato — sacá alguna.';
  else nota.textContent = comb.esMeta ? 'Meta publica solo (en pausa) desde PAUTADOR.' : (comb.nombre + ' se carga a mano en la plataforma y se marca hecha desde Historial.');
  document.getElementById('pd2-plataforma-continuar').disabled = !state.pd2Plataformas.length || !formatosComunes.length;
}

function togglePlataformaPd2(nombre) {
  const i = state.pd2Plataformas.indexOf(nombre);
  if (i >= 0) state.pd2Plataformas.splice(i, 1); else state.pd2Plataformas.push(nombre);
  renderGrillaPlataformas();
}

function confirmarPlataformasPd2() {
  if (!state.pd2Plataformas.length) return;
  state.pd2PlataformaElegida = true;
  state.pd2Placements = [];
  state.pd2Visibilidad = 'DARK';
  const selFormato = document.getElementById('pd2-formato');
  if (selFormato) selFormato.innerHTML = '';
  reiniciarMaterialesPiezasV2();
  renderTabPedido2();
}

// Material de un contenido. Con una sola plataforma Meta: como siempre
// (publicación / link / archivo / carrusel). Con varias plataformas, o una
// sola que no es Meta: una fila por plataforma, cada una con su link
// (usuario, 2026-09-15: "una fila de link por plataforma"). Display admite
// un link a carpeta de Drive/Dropbox o varias imágenes, una por línea.
function renderMaterialBulkV2(i) {
  const plats = plataformasPd2();
  if (plats.length === 1 && plats[0] === 'Meta') return renderMaterialMetaV2(i);
  return plats.map((n) => `
    <div style="margin-bottom:10px">
      <div style="font-size:12px;font-weight:600;margin-bottom:4px"><i class="ph ${ICONO_PLATAFORMA[n] || 'ph-globe'}"></i> ${esc(n)}</div>
      ${n === 'Meta' ? renderMaterialMetaV2(i) : renderMaterialOtraPlataformaV2(i, n, plats.length === 1)}
    </div>`).join('');
}

const SLUG_PLATAFORMA = { Meta: 'meta', Youtube: 'youtube', 'Tik Tok': 'tiktok', X: 'x', Display: 'display' };
const LINK_PUBLICO_PD2 = {
  Meta: /^https?:\/\/(www\.|m\.|business\.)?(facebook\.com|fb\.com|fb\.watch|instagram\.com)\//i,
  Youtube: /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/|live\/)|youtu\.be\/)/i,
  'Tik Tok': /^https?:\/\/(www\.|vm\.|vt\.)?tiktok\.com\//i,
  X: /^https?:\/\/(www\.|mobile\.)?(x\.com|twitter\.com)\//i,
};
function esLinkCarpetaPd2(url) {
  return /^https?:\/\/(drive\.google\.com\/drive\/(u\/\d+\/)?folders\/|(www\.)?dropbox\.com\/(scl\/fo\/|sh\/|home\/))/i.test(String(url || '').trim());
}
function plataformasPd2() { return plataformaPd2Actual().nombres || ['Meta']; }
function idMaterialPlataforma(i, n) { return `pd2bulk${i}-material-${SLUG_PLATAFORMA[n] || 'otra'}`; }

// Fila de material para una plataforma que no es Meta. `sola` = es la única
// plataforma del pedido: en Oculto conserva "Subir archivo" (un archivo por
// contenido) además del link.
function renderMaterialOtraPlataformaV2(i, n, sola) {
  const item = state.pd2BulkItems[i];
  const id = idMaterialPlataforma(i, n);
  const previo = (item.materiales && item.materiales[n]) || '';
  if (n === 'Display') {
    return `<textarea class="input" id="${id}" rows="2" placeholder="Link a la carpeta de Drive o Dropbox con los banners, o un link por línea (una imagen por línea)">${esc(previo.split('|').join('\n'))}</textarea>`;
  }
  if (state.pd2Visibilidad === 'PUBLICO') {
    const ej = { Youtube: 'https://www.youtube.com/watch?v=...', 'Tik Tok': 'https://www.tiktok.com/@cuenta/video/...', X: 'https://x.com/cuenta/status/...' }[n] || 'https://...';
    return `<input class="input" id="${id}" placeholder="Link de la publicación en ${esc(n)} — ${ej}" value="${esc(previo)}">`;
  }
  if (sola) {
    const prefix = `pd2bulk${i}`;
    return `
    <div class="tabs" style="padding:0;border:none;margin-bottom:10px">
      <button type="button" class="tab-btn ${item.modoMaterial !== 'archivo' ? 'active' : ''}" data-action="pd2bulk-modo-material" data-index="${i}" data-id="link">Pegar link</button>
      <button type="button" class="tab-btn ${item.modoMaterial === 'archivo' ? 'active' : ''}" data-action="pd2bulk-modo-material" data-index="${i}" data-id="archivo">Subir archivo</button>
    </div>
    ${item.modoMaterial === 'archivo' ? renderMaterialArchivoBulkV2(i) : `<input class="input" id="${prefix}-material" placeholder="${n === 'Youtube' ? 'https://www.youtube.com/watch?v=... (video ya subido) o link de Drive' : 'https://drive.google.com/... o dropbox.com/...'}" value="${esc(previo)}">`}`;
  }
  return `<input class="input" id="${id}" placeholder="${n === 'Youtube' ? 'Link de YouTube (video ya subido) o de Drive' : 'Link de Drive o Dropbox con el material para ' + esc(n)}" value="${esc(previo)}">`;
}

// Lee el material tipeado para una plataforma que no es Meta (o el archivo
// subido, si es la única plataforma y eligió "Subir archivo").
function leerMaterialPlataformaV2(i, n, sola) {
  const item = state.pd2BulkItems[i];
  if (sola && n !== 'Display' && state.pd2Visibilidad !== 'PUBLICO') {
    if (item.modoMaterial === 'archivo') return item.archivoSubido ? item.archivoSubido.material : '';
    const el = document.getElementById(`pd2bulk${i}-material`);
    return el ? el.value.trim() : '';
  }
  const el = document.getElementById(idMaterialPlataforma(i, n));
  if (!el) return '';
  return el.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).join('|');
}

// Valida el material de una plataforma que no es Meta desde el navegador
// (misma regla que el servidor): Público → link de esa red; Oculto → link de
// YouTube (Youtube), carpeta (Display) o archivo verificado.
async function validarMaterialPlataformaV2(n, material) {
  if (!material) return { ok: false, error: `Falta el material de ${n}.` };
  if (n !== 'Display' && state.pd2Visibilidad === 'PUBLICO') {
    return LINK_PUBLICO_PD2[n] && LINK_PUBLICO_PD2[n].test(material) ? { ok: true, detalle: 'publicación (se carga a mano)' } : { ok: false, error: `${n}: pegá el link de la publicación en ${n}.` };
  }
  const lista = material.split('|').map((s) => s.trim()).filter(Boolean);
  const detalles = [];
  for (const m of lista) {
    if (n === 'Youtube' && LINK_PUBLICO_PD2.Youtube.test(m)) { detalles.push('video de YouTube'); continue; }
    if (n === 'Display' && esLinkCarpetaPd2(m)) { detalles.push('carpeta'); continue; }
    if (/^(creatividad:|uploads\/)/.test(m)) { detalles.push('archivo subido'); continue; }
    try {
      const r = await apiFetch('/api/material/verificar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ material: m }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detalle || data.error);
      if ((n === 'Youtube' || n === 'Tik Tok') && data.tipo !== 'video') throw new Error(`${n} solo acepta video, y esto es ${data.tipo}`);
      if (n === 'Display' && data.tipo !== 'imagen') throw new Error(`Display solo acepta imágenes o un link a carpeta, y esto es ${data.tipo}`);
      detalles.push(data.tipo);
    } catch (err) {
      return { ok: false, error: `${n}: ${err.message}` };
    }
  }
  return { ok: true, detalle: lista.length > 1 ? `${lista.length} materiales` : detalles[0] || 'material' };
}

function renderMaterialMetaV2(i) {
  const item = state.pd2BulkItems[i];
  const prefix = `pd2bulk${i}`;
  if (state.pd2Visibilidad === 'PUBLICO' && !activoVinculadoPd2()) {
    // Página no vinculada a la App: ni grilla de posteos ni resolución
    // contra Meta — solo el link, y la pieza se carga a mano.
    return `
      <label style="font-size:12px;color:var(--color-neutral-500);display:block;margin-bottom:6px">Link de la publicación <span style="font-weight:400">(esta página no está vinculada a la App: la pieza se carga a mano)</span></label>
      <input class="input" id="${prefix}-material" placeholder="https://www.facebook.com/... o instagram.com/p/...">
    `;
  }
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
    ${item.modoMaterial === 'archivo' ? renderMaterialArchivoBulkV2(i) : `<input class="input" id="${prefix}-material" placeholder="${aceptaLinkYoutubePd2() ? 'https://www.youtube.com/watch?v=... (video ya subido) o link de Drive' : 'https://drive.google.com/... o dropbox.com/...'}">`}
  `;
}

// Youtube sola: el material puede ser el link del video ya subido al canal —
// se acepta tal cual, sin verificarlo como archivo (misma regla que
// esLinkYoutube en src/config/plataformas.js).
function aceptaLinkYoutubePd2() {
  const n = plataformaPd2Actual().nombres || [];
  return n.length === 1 && n[0] === 'Youtube';
}
function esLinkYoutubePd2(url) {
  return /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/|live\/)|youtu\.be\/)/i.test(String(url || '').trim());
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
  // Youtube: el "Copy" es el título y la descripción del video (usuario,
  // 2026-09-15) — en la hoja sigue yendo como Copy.
  const esYoutube = (plataformaPd2Actual().nombres || []).includes('Youtube');
  const copyBloque = state.pd2Visibilidad === 'DARK'
    ? `<div class="field" style="grid-column:1 / -1"><label>${esYoutube ? 'Copy / Título y Descripción' : 'Copy'}</label><textarea class="input" id="${prefix}-copy" rows="2" placeholder="${esYoutube ? 'Título y descripción del video' : 'Texto del anuncio'}"></textarea></div>`
    : '';
  // Con una sola pieza, la audiencia es la general del Módulo 2 — no se
  // vuelve a pedir. Con 2 o más, cada pieza puede tener una distinta.
  const audienciaBloque = state.pd2BulkItems.length < 2 ? '' : `<div class="field">
      <label>Audiencia principal <span style="font-weight:400;color:var(--color-neutral-500)">(si es distinta a la general)</span></label>
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
      <div class="card-title" style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">Contenido N°${i + 1} <span id="${prefix}-nombre" style="font-weight:400;font-size:12px;color:var(--color-neutral-500)" title="Así se va a llamar este contenido (Campaña, Línea y Formato)">${esc(nombreContenidoV2(i))}</span></div>
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

// Nombre con el que va a quedar el contenido (usuario, 2026-09-15: "que el
// nombre del contenido acompañe la creación"): la misma fórmula que arma el
// servidor en crearPedido — Campaña, Línea entre comillas si hay, y el
// Formato entre paréntesis. Se muestra al lado del título de cada tarjeta
// y se actualiza al tipear Campaña/Línea o cambiar el Formato.
function nombreContenidoV2(i) {
  const campanaEl = document.getElementById('pd2-campana');
  const lineaEl = document.getElementById(`pd2bulk${i}-linea`);
  const formatoEl = document.getElementById('pd2-formato');
  const campana = (campanaEl ? campanaEl.value : '').trim();
  const linea = (lineaEl ? lineaEl.value : '').trim();
  const formato = ((formatoEl && formatoEl.value) || '').trim();
  return `${campana || 'Campaña'}${linea ? ` "${linea}"` : ''}${formato ? ` (${formato})` : ''}`;
}

function actualizarNombresContenidoV2() {
  (state.pd2BulkItems || []).forEach((item, i) => {
    const el = document.getElementById(`pd2bulk${i}-nombre`);
    if (el) el.textContent = nombreContenidoV2(i);
  });
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
          <strong>Contenido ${i + 1}: el presupuesto no alcanza para el mínimo de Meta.</strong>
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
    plataforma: plataformaPd2Actual().nombre,
    categoriaPieza: document.getElementById('pd2-categoria-wrap').hidden ? '' : document.getElementById('pd2-categoria-pieza').value,
    gobernador: document.getElementById('pd2-gobernador-wrap').hidden ? '' : document.getElementById('pd2-gobernador').value,
    fechaInicio: document.getElementById('pd2-fecha-inicio').value,
    fechaFin: document.getElementById('pd2-fecha-fin').value,
    campana: document.getElementById('pd2-campana').value.trim(),
    comentarios: document.getElementById('pd2-comentarios').value.trim(),
    bulkId: state.pd2BulkItems.length > 1 ? 'BULK-' + Date.now() : null,
  };
}

// Material "principal" del contenido (columna material): el de Meta si Meta
// está entre las plataformas (carrusel / archivo / link / publicación); si
// no, el de la primera plataforma.
function materialMetaPiezaV2(i, item, materialCarrusel, materialInput) {
  if (state.pd2Visibilidad === 'PUBLICO') return item.postSeleccionado ? (item.postSeleccionado.permalink || '') : (materialInput ? materialInput.value.trim() : '');
  return materialCarrusel || (item.modoMaterial === 'archivo' && item.archivoSubido
    ? item.archivoSubido.material
    : (materialInput ? materialInput.value.trim() : ''));
}
function materialesPiezaV2(i, item, materialCarrusel, materialInput) {
  const plats = plataformasPd2();
  const out = {};
  plats.forEach((n) => {
    if (n === 'Meta') out.Meta = materialMetaPiezaV2(i, item, materialCarrusel, materialInput);
    else out[n] = (item.materiales && item.materiales[n]) || leerMaterialPlataformaV2(i, n, plats.length === 1);
  });
  return out;
}
function materialPiezaV2(i, item, materialCarrusel, materialInput) {
  const plats = plataformasPd2();
  if (plats.includes('Meta')) return materialMetaPiezaV2(i, item, materialCarrusel, materialInput);
  const m = materialesPiezaV2(i, item, materialCarrusel, materialInput);
  return plats.map((n) => m[n]).find(Boolean) || '';
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
    material: materialPiezaV2(i, item, materialCarrusel, materialInput),
    // Material por plataforma (varias plataformas): {Meta: ..., Youtube: ...}.
    materiales: materialesPiezaV2(i, item, materialCarrusel, materialInput),
    materialStories: materialStoriesFinal,
    // "post" viaja tanto si se eligió de la grilla como si se resolvió desde
    // "Pegar link" (ver buscarPostPorLinkV2, en ambos casos queda en
    // item.postSeleccionado) — el server (crearPedido) exige post.id para
    // Público sin importar cómo se llegó a él.
    post: state.pd2Visibilidad === 'PUBLICO' ? item.postSeleccionado : null,
    copy: copyInput ? copyInput.value.trim() : '',
    presupuesto,
    fechaInicio: ctx.fechaInicio,
    fechaFin: ctx.fechaFin,
    linkDestino: ctx.linkDestino,
    redes: state.pd2Visibilidad === 'PUBLICO' && item.postSeleccionado
      ? [item.postSeleccionado.plataforma === 'Instagram' ? 'instagram' : 'facebook']
      : redesCompartidas,
    placements: state.pd2Visibilidad === 'PUBLICO' ? [] : state.pd2Placements,
    // El reparto propio de la pieza (solo "Crear Anuncios" con más de un
    // conjunto, ver "Distribuir presupuesto" en Módulo 5) pisa al reparto
    // compartido de "Se van a crear estos cruces" (Módulo 2, mismo para
    // todas las piezas) — si no hay uno propio, se manda el compartido.
    reparto: hayQueRepartirPiezaV2(i) ? item.reparto : (combosDelPd2().length > 1 ? repartoPlanoPd2() : null),
    comentarios: ctx.comentarios,
    combosExcluidos: combosDelPd2().length > 1 ? excluidosParaEnvioPd2() : Object.keys(state.pd2CombosExcluidos),
    bulkId: ctx.bulkId,
    plataforma: ctx.plataforma,
    categoriaPieza: ctx.categoriaPieza,
    gobernador: ctx.gobernador,
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
  const platsPreview = plataformasPd2();
  const incluyeMetaPreview = platsPreview.includes('Meta');
  for (let i = 0; i < state.pd2BulkItems.length; i++) {
    const item = state.pd2BulkItems[i];
    // Plataformas que no son Meta: cada una valida su material (usuario,
    // 2026-09-15). Si alguna falla, el contenido falla; si no hay Meta, con
    // esto alcanza.
    item.materiales = {};
    let errorOtra = null;
    const detallesOtras = [];
    for (const n of platsPreview) {
      if (n === 'Meta') continue;
      const mat = leerMaterialPlataformaV2(i, n, platsPreview.length === 1);
      // eslint-disable-next-line no-await-in-loop
      const r = await validarMaterialPlataformaV2(n, mat);
      if (!r.ok) { errorOtra = r.error; break; }
      item.materiales[n] = mat;
      detallesOtras.push(`${n}: ${r.detalle}`);
    }
    if (errorOtra) { previews.push({ i, ok: false, error: errorOtra }); continue; }
    if (!incluyeMetaPreview) { previews.push({ i, ok: true, tipo: detallesOtras.join(' · ') || 'material', previewUrl: '' }); continue; }
    if (state.pd2Visibilidad === 'PUBLICO' && !activoVinculadoPd2()) {
      // Página no vinculada: el link va tal cual, sin resolver contra Meta.
      const inputLink = document.getElementById('pd2bulk' + i + '-material');
      const link = inputLink ? inputLink.value.trim() : '';
      if (!/^https?:\/\//i.test(link)) {
        item.postSeleccionado = null;
        previews.push({ i, ok: false, error: 'Pegá el link de la publicación (empieza con https://).' });
        continue;
      }
      item.postSeleccionado = { id: '', permalink: link, caption: '', imagen: '', plataforma: /instagram\.com/i.test(link) ? 'Instagram' : 'Facebook' };
      previews.push({ i, ok: true, tipo: 'link de publicación (se carga a mano)', previewUrl: '' });
      continue;
    }
    if (state.pd2Visibilidad === 'PUBLICO' && item.modoMaterial === 'post') {
      previews.push(item.postSeleccionado
        ? { i, ok: true, tipo: 'publicación existente', previewUrl: item.postSeleccionado.imagen || '' }
        : { i, ok: false, error: 'No elegiste la publicación.' });
      continue;
    }
    if (state.pd2Visibilidad === 'PUBLICO' && item.modoMaterial === 'link') {
      // "Pegar link" en Público: no es un material para subir, es el atajo
      // para no tener que buscar la publicación en la grilla cuando es
      // vieja (no está entre los últimos 12 que trae "Elegir
      // publicación") — se resuelve contra Meta de verdad (ver
      // resolverPostDesdeLinkV2).
      const inputLink = document.getElementById('pd2bulk' + i + '-material');
      const link = inputLink ? inputLink.value.trim() : '';
      if (!link) {
        previews.push({ i, ok: false, error: 'Falta el link de la publicación.' });
        continue;
      }
      try {
        const encontrado = await resolverPostDesdeLinkV2(link);
        item.postSeleccionado = encontrado;
        previews.push({ i, ok: true, tipo: 'publicación existente', previewUrl: encontrado.imagen || '' });
      } catch (err) {
        item.postSeleccionado = null;
        previews.push({ i, ok: false, error: err.message });
      }
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
    if (aceptaLinkYoutubePd2() && esLinkYoutubePd2(material)) {
      previews.push({ i, ok: true, tipo: 'video', previewUrl: '', youtube: true });
      continue;
    }
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

  // Specs de Placement (AppSheet/Specs Meta.xlsx): se mide cada pieza desde
  // el navegador (o con las medidas que ya mandó /subir) y se evalúa contra
  // los placements elegidos — bloqueos y avisos quedan en el preview
  // (renderPreviewsBulkV2) y los bloqueos frenan "Crear" (enviarBulkV2).
  // Público no aplica: la publicación ya existe, Meta ya la aceptó.
  // Specs de Meta (proporciones por Placement) — otra plataforma no tiene
  // placements de Meta, solo se miden las piezas para mostrar el tamaño.
  if (state.pd2Visibilidad !== 'PUBLICO' && plataformaPd2Actual().esMeta) {
    const placementsElegidos = state.pd2Placements && state.pd2Placements.length ? state.pd2Placements : ['feed'];
    const formatoSpecs = formatoInfoPd2Actual();
    for (const p of previews) {
      if (!p.ok) continue;
      const item = state.pd2BulkItems[p.i];
      let medidas = [];
      if (p.carruselCantidad) {
        const urls = (item.carrusel || []).map((c) => (c.archivo && c.archivo.previewUrl) || '').filter(Boolean);
        // eslint-disable-next-line no-await-in-loop
        medidas = await Promise.all(urls.map((u) => medirMedia(u, false)));
      } else if (p.width && p.height) {
        medidas = [{ width: p.width, height: p.height }];
      } else {
        // eslint-disable-next-line no-await-in-loop
        medidas = [await medirMedia(p.previewUrl, p.tipo === 'video')];
      }
      p.medidas = medidas.filter(Boolean);
      const specs = evaluarSpecsPieza({
        placements: placementsElegidos,
        modo: formatoSpecs ? formatoSpecs.modo : (p.carruselCantidad ? 'carrusel' : p.tipo),
        esVideo: p.tipo === 'video',
        conLink: !!ctx.linkDestino,
        medidas: p.medidas,
      });
      p.bloqueos = specs.bloqueos;
      p.avisos = specs.avisos;
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
  // Con un bloqueo de specs el botón queda apagado: no tiene sentido dejar
  // que lo intente si Meta lo va a rechazar (enviarBulkV2 lo vuelve a
  // chequear por las dudas).
  btn.disabled = previews.some((p) => p.ok && p.bloqueos && p.bloqueos.length);
  renderResultadoBulkV2();
}

// "AB" a partir de "Activo de Prueba" — el avatar del mock de abajo
// (no hay foto de perfil real de la Página disponible del lado del front).
function inicialesDe(nombre) {
  const palabras = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  return ((palabras[0] ? palabras[0][0] : '') + (palabras[1] ? palabras[1][0] : '')).toUpperCase();
}

// "https://www.chubut.gov.ar/obras?x=1" -> "chubut.gov.ar" (lo que Meta
// muestra arriba del título en la tarjeta de link).
function dominioDe(url) {
  const texto = String(url || '').trim();
  try {
    return new URL(/^https?:\/\//i.test(texto) ? texto : 'https://' + texto).hostname.replace(/^www\./, '');
  } catch (e) {
    return texto.replace(/^https?:\/\//i, '').split('/')[0];
  }
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

  // Con Link de destino, Meta muestra la tarjeta de link (dominio + título
  // + botón) en Facebook y una barra "Más información" en Instagram — el
  // preview lo refleja para que se vea cómo queda la pieza con link. El
  // botón real hoy es siempre "Más información" (LEARN_MORE).
  const dominio = o.linkDestino ? dominioDe(o.linkDestino) : '';
  const tarjetaLinkFb = dominio
    ? '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#f0f2f5;border-top:1px solid #e4e6eb">'
      + '<div style="flex:1;min-width:0">'
      +   '<div style="font-size:11px;color:#65676b;text-transform:uppercase;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(dominio) + '</div>'
      +   '<div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(o.nombrePagina || 'Tu página') + '</div>'
      + '</div>'
      + '<div style="flex:none;background:#e4e6eb;color:#050505;font-size:13px;font-weight:600;padding:8px 12px;border-radius:6px">Más información</div>'
      + '</div>'
    : '';
  const barraLinkIg = dominio
    ? '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;font-size:13px;font-weight:600;color:#0095f6;border-bottom:1px solid #efefef">Más información <i class="ph ph-caret-right"></i></div>'
    : '';

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
      + barraLinkIg
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
    + tarjetaLinkFb
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
  const linkDestinoEl = document.getElementById('pd2-link-destino');
  const linkDestino = linkDestinoEl ? linkDestinoEl.value.trim() : '';
  const unaSola = previews.length === 1;
  const tarjetas = previews.map(function (p) {
    if (!p.ok) {
      return '<div style="border:1px solid var(--color-warning, #d08a1e);border-radius:var(--radius-md);padding:14px;font-size:12px;color:var(--color-neutral-300)">'
        + (unaSola ? '' : '<strong>Pieza ' + (p.i + 1) + '</strong><br>') + esc(p.error) + '</div>';
    }
    // Specs (evaluarSpecsPieza): los bloqueos van en rojo y frenan el
    // "Crear"; los avisos son recomendaciones, se muestran y se puede seguir.
    const bloqueosHtml = (p.bloqueos || []).map((b) => '<div class="error" style="margin-top:8px;font-size:12px"><i class="ph ph-x-circle"></i> ' + esc(b) + '</div>').join('');
    const avisosHtml = (p.avisos || []).map((a) => '<div style="margin-top:8px;padding:8px 10px;border:1px solid var(--color-warning, #d08a1e);border-radius:var(--radius-md);font-size:12px;color:var(--color-neutral-300)"><i class="ph ph-warning"></i> ' + esc(a) + '</div>').join('');
    const medidasHtml = p.medidas && p.medidas.length
      ? '<div style="font-size:11px;color:var(--color-neutral-500);margin-top:4px">' + p.medidas.map((m) => m.width + '×' + m.height).join(' · ') + ' px</div>'
      : '';
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
    const platPd2 = plataformaPd2Actual();
    const plataformas = !platPd2.esMeta
      ? ['Facebook'] // no hay mock propio de Youtube/Tik Tok/X/Display: se muestra la pieza en un marco genérico
      : (p.tipo === 'publicación existente'
        ? [(item && item.postSeleccionado && item.postSeleccionado.plataforma) || 'Facebook']
        : ((state.pd2Redes && state.pd2Redes.length) ? state.pd2Redes.map((r) => (r === 'instagram' ? 'Instagram' : 'Facebook')) : ['Facebook']));
    const post = plataformas.map((plataforma) => renderMockPost({
      nombrePagina,
      copy,
      mediaUrl: p.previewUrl,
      esVideo: p.tipo === 'video',
      badge: p.carruselCantidad ? '1/' + p.carruselCantidad : '',
      plataforma,
      // Publicación existente: el post ya tiene su propio contenido, no se
      // le agrega tarjeta de link.
      linkDestino: p.tipo === 'publicación existente' ? '' : linkDestino,
    })).join('<div style="height:10px"></div>');
    const extras = medidasHtml + bloqueosHtml + avisosHtml;
    return unaSola
      ? '<div>' + post + extras + '</div>'
      : ('<div>' + post + '<div style="font-size:11px;color:var(--color-neutral-500);margin-top:4px">Pieza ' + (p.i + 1) + '</div>' + extras + '</div>');
  }).join('');

  const fallan = previews.filter(function (p) { return !p.ok; }).length;
  const bloqueadas = previews.filter(function (p) { return p.ok && p.bloqueos && p.bloqueos.length; }).length;
  const cabecera = fallan
    ? '<div class="error" style="margin-bottom:10px">' + fallan + ' pieza(s) con el material mal: corregí el link y verificá de nuevo. No se creó nada.</div>'
    : (bloqueadas
      ? '<div class="error" style="margin-bottom:10px">' + bloqueadas + ' pieza(s) con una medida que Meta rechaza para el Placement elegido (ver abajo). Corregí el material o el Placement y verificá de nuevo.</div>'
      : (plataformaPd2Actual().esMeta
        ? '<div style="margin-bottom:10px;font-size:12px;color:var(--color-neutral-400)">Así se va a ver en Meta. Revisá que sean las piezas correctas y confirmá.</div>'
        : '<div style="margin-bottom:10px;font-size:12px;color:var(--color-neutral-400)">Pieza para <strong>' + esc(plataformaPd2Actual().nombre) + '</strong> — se carga a mano en cada plataforma y se marca hecha desde Historial. El marco de abajo es solo para revisar el material.</div>'));

  return cabecera + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-bottom:14px">' + tarjetas + '</div>';
}

// Banner que queda en la pantalla de elegir modo después de un pedido
// exitoso (ver resetPedidoAnunciosV2) — mismo contenido que
// renderResultadoBulkV2 mostraba dentro del módulo, pero sobrevive al reset.
// Al confirmar, el pedido sale de su pantalla y acá se dice claro si salió
// o no (usuario, 2026-09-14). Si algo falló, el formulario queda cargado y
// "Corregir el pedido" vuelve a él.
// Texto de estado de una pieza creada (resultado parcial y final). Sin
// "(en pausa)": desde el lanzamiento el estado inicial lo define
// AUTOMATIZADO_ESTADO_INICIAL en el server. Los cruces con audiencia "Otra"
// en Automatizado quedan manual_pendiente (Pendientes de implementadores).
function estadoResultadoPiezaV2(r) {
  if (r.publicado && r.manuales) return 'publicada en Meta; el cruce con la audiencia "Otra" queda para cargar a mano (Pendientes)';
  if (r.publicado) return 'publicada en Meta';
  if (r.motivo && state.modoActivo === 'automatizado') return 'creada — la audiencia "Otra" no está automatizada: la cargan a mano los implementadores (Pendientes)';
  return 'creada — queda para cargar a mano' + (r.plataforma && r.plataforma !== 'Meta' ? ' en ' + r.plataforma : '') + ' y marcar hecha desde Historial';
}

function renderResultadoFinalV2() {
  const el = document.getElementById('pd2-resultado-final');
  const resultados = state.pd2BulkResultados;
  if (!resultados || !resultados.length) { el.hidden = true; return; }
  el.hidden = false;
  const unaSola = resultados.length === 1;
  const ok = resultados.filter((r) => r.ok).length;
  const fallidas = resultados.length - ok;
  const todoOk = fallidas === 0;
  const color = todoOk ? 'var(--color-success, #1f8a4c)' : (ok ? 'var(--color-warning, #d08a1e)' : 'var(--color-error, #c0392b)');
  el.style.borderColor = color;
  el.style.boxShadow = 'inset 4px 0 0 ' + color;
  const titulo = document.getElementById('pd2-resultado-final-titulo');
  if (titulo) {
    titulo.style.color = color;
    titulo.innerHTML = todoOk
      ? '<i class="ph ph-check-circle"></i> ' + (unaSola ? 'El pedido salió' : `Salieron ${ok} de ${resultados.length} contenidos`)
      : (ok ? `<i class="ph ph-warning"></i> Salieron ${ok} de ${resultados.length} contenidos — ${fallidas} no` : '<i class="ph ph-x-circle"></i> ' + (unaSola ? 'El pedido NO salió' : 'Ningún contenido salió'));
  }
  const filas = resultados.map((r, i) => {
    if (!r.ok) return `<div class="error" style="margin:4px 0">${unaSola ? '' : `Contenido ${i + 1}: `}${esc(r.error)}</div>`;
    const estado = estadoResultadoPiezaV2(r);
    const prefijo = unaSola ? 'Código' : `Contenido ${i + 1}: código`;
    return `<div style="margin:4px 0">${prefijo} <code>${esc(r.codigo)}</code> — ${estado}.</div>`;
  }).join('');
  const acciones = fallidas
    ? '<div style="margin-top:10px"><button type="button" class="btn btn-primary" data-action="pd2-resultado-corregir">Corregir el pedido</button> <span style="font-size:12px;color:var(--color-neutral-500);margin-left:8px">Lo que cargaste sigue ahí.</span></div>'
    : '<div style="margin-top:8px;font-size:12px;color:var(--color-neutral-500)">Lo ves en Historial de Anuncios.</div>';
  document.getElementById('pd2-resultado-final-body').innerHTML = filas + acciones;
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
  state.pd2Reparto = null;
  state.pd2RepartoBloqueados = {};
  state.pd2RepartoFirma = null;
  state.pd2RepartoSugerido = null;
  state.pd2PresupuestoPreview = null;
  state.pd2Visibilidad = 'DARK';
  state.pd2Redes = ['facebook', 'instagram'];
  state.pd2Placements = [];
  state.pd2Plataformas = ['Meta'];
  state.pd2PlataformaElegida = false;
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
    if (!r.ok) return `<div class="error">${unaSola ? '' : `Contenido ${i + 1}: `}${esc(r.error)}</div>`;
    const estado = estadoResultadoPiezaV2(r);
    const prefijo = unaSola ? 'Código' : `Contenido ${i + 1}: código`;
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
  // Specs de Placement: si el preview marcó un bloqueo (medida que Meta
  // rechaza), no se manda nada — ver evaluarSpecsPieza.
  const conBloqueo = (state.pd2BulkPreviews || []).filter((p) => p.ok && p.bloqueos && p.bloqueos.length);
  if (conBloqueo.length) {
    state.pd2BulkError = conBloqueo.length + ' pieza(s) con una medida que Meta rechaza para el Placement elegido (ver el preview). Corregí el material o el Placement antes de crear.';
    renderBulkErrorV2();
    return;
  }

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
        ? `Contenido ${conFalta.i + 1}: el presupuesto no llega al mínimo de Meta. Son ${conFalta.falta.conjuntos} conjunto(s) × ${conFalta.falta.dias} día(s): hacen falta al menos ${fmtMoney(conFalta.falta.minTotal)} (${fmtMoney(conFalta.falta.minPorConjunto)} por conjunto).`
        : `Contenido ${flojas[0].i + 1}: el reparto de presupuesto tiene que sumar 100% antes de crear.`;
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
      // Cruces que quedaron para cargar a mano (audiencia "Otra" en
      // Automatizado): el server los deja manual_pendiente; si TODA la
      // pieza es manual no publica nada y lo explica en `motivo`.
      const celdas = (data.resultado && data.resultado.celdas) || [];
      const manuales = celdas.filter((c) => c.estado_celda === 'manual_pendiente').length;
      state.pd2BulkResultados.push({ ok: true, codigo: data.codigo, publicado: !!data.publicado, manuales, motivo: data.motivo || '' });
    } catch (err) {
      state.pd2BulkResultados.push({ ok: false, error: err.message });
    }
    renderResultadoBulkV2();
  }

  state.pd2BulkEnviando = false;
  state.pd2BulkPreviews = null;

  // Salga bien o mal, se deja la pantalla del pedido y el resultado se
  // muestra arriba, claro (usuario, 2026-09-14). Si todo salió: formulario
  // limpio para el próximo. Si algo falló: el formulario queda cargado y
  // desbloqueado, y "Corregir el pedido" vuelve a él.
  const todoOk = state.pd2BulkResultados.length && state.pd2BulkResultados.every((r) => r.ok);
  if (todoOk) {
    resetPedidoAnunciosV2();
  } else {
    bloquearFormularioV2(false);
    btn.disabled = false;
    btn.textContent = 'Ver preview';
    state.pd2ModoCarga = null;
  }
  renderTabPedido2();
  renderResultadoFinalV2();
  const banner = document.getElementById('pd2-resultado-final');
  if (banner) banner.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
  document.getElementById('tab-usuarios').hidden = tab !== 'usuarios';
  document.getElementById('tab-creatividades').hidden = tab !== 'creatividades';
  if (tab === 'pedido2' || tab === 'crear') { if (!state.pdProyectos.length) cargarDatosPedido().then(renderTabPedido2); else renderTabPedido2(); }
  if (tab === 'pendientes') cargarItems();
  if (tab === 'admin') { if (!state.admActivosCargados) cargarDatosAdmin(); else renderTabAdmin(); }
  if (tab === 'usuarios') cargarPanelUsuarios();
  if (tab === 'creatividades') { if (!state.creaDatos) cargarCreatividades(); else renderTabCreatividades(); }
  if (typeof mandarLatido === 'function') mandarLatido();
  render();
}

// ---------- Pestaña Creatividades (solo superadmin) ----------
// Biblioteca del bucket privado con los datos del pedido asociado a cada
// archivo (usuario, 2026-09-14). Todo viene armado del server
// (GET /api/admin/creatividades); acá solo se filtra y se dibuja.

async function cargarCreatividades() {
  state.creaCargando = true; state.creaError = '';
  renderTabCreatividades();
  try {
    const r = await apiFetch('/api/admin/creatividades' + (state.creaFiltro.vencidas ? '?vencidas=1' : ''));
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error || 'No se pudo cargar la biblioteca.');
    state.creaDatos = data;
  } catch (err) {
    state.creaError = err.message;
  }
  state.creaCargando = false;
  renderTabCreatividades();
}

function fmtBytesCrea(n) {
  n = Number(n) || 0;
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}
function fmtFechaCrea(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function renderTabCreatividades() {
  const lista = document.getElementById('crea-lista');
  const estado = document.getElementById('crea-estado');
  if (!lista) return;
  const f = state.creaFiltro;
  const datos = state.creaDatos;
  if (state.creaCargando) { estado.textContent = 'Cargando…'; lista.innerHTML = ''; return; }
  if (state.creaError) { estado.innerHTML = '<span class="error">' + esc(state.creaError) + '</span>'; lista.innerHTML = ''; return; }
  if (!datos) { estado.textContent = ''; lista.innerHTML = ''; return; }
  const todas = datos.creatividades || [];
  // Filtros: proyecto y campaña salen de las etiquetas y de los pedidos.
  const proyectoDe = (c) => [c.etiquetas.proyecto, ...c.pedidos.map((p) => p.proyecto)].filter(Boolean);
  const campanaDe = (c) => [c.etiquetas.campana, ...c.pedidos.map((p) => p.campana)].filter(Boolean);
  const proyectos = [...new Set(todas.flatMap(proyectoDe))].sort((a, b) => a.localeCompare(b, 'es'));
  const campanas = [...new Set(todas.filter((c) => !f.proyecto || proyectoDe(c).includes(f.proyecto)).flatMap(campanaDe))].sort((a, b) => a.localeCompare(b, 'es'));
  const selP = document.getElementById('crea-proyecto');
  const selC = document.getElementById('crea-campana');
  selP.innerHTML = '<option value="">Todos</option>' + proyectos.map((p) => `<option value="${esc(p)}" ${p === f.proyecto ? 'selected' : ''}>${esc(p)}</option>`).join('');
  selC.innerHTML = '<option value="">Todas</option>' + campanas.map((p) => `<option value="${esc(p)}" ${p === f.campana ? 'selected' : ''}>${esc(p)}</option>`).join('');
  document.getElementById('crea-vencidas').checked = !!f.vencidas;
  const texto = (f.texto || '').trim().toLowerCase();
  const visibles = todas.filter((c) => {
    if (f.proyecto && !proyectoDe(c).includes(f.proyecto)) return false;
    if (f.campana && !campanaDe(c).includes(f.campana)) return false;
    if (texto) {
      const bolsa = [c.nombre, c.id, c.etiquetas.codigo, c.etiquetas.activo, c.etiquetas.campana, c.subido_por, ...c.pedidos.flatMap((p) => [p.codigo, p.activo, p.campana, p.creador])].filter(Boolean).join(' ').toLowerCase();
      if (!bolsa.includes(texto)) return false;
    }
    return true;
  });
  const sinUsar = visibles.filter((c) => !c.pedidos.length).length;
  estado.innerHTML = `${visibles.length} de ${todas.length} creatividades` + (sinUsar ? ` · ${sinUsar} sin pedido asociado` : '')
    + (datos.storageActivo ? '' : ' · <span style="color:var(--color-warning, #d08a1e)"><i class="ph ph-warning"></i> El servidor no está guardando en el bucket (CREATIVIDADES_STORAGE apagado): lo nuevo va al disco y se pierde en el próximo deploy.</span>');
  if (!visibles.length) { lista.innerHTML = '<p style="color:var(--color-neutral-500);font-size:13px">No hay creatividades con ese filtro.</p>'; return; }
  lista.innerHTML = visibles.map(renderTarjetaCreatividad).join('');
}

function renderTarjetaCreatividad(c) {
  const esVideo = /^video\//.test(c.content_type || '');
  let media;
  if (c.borrado_en) media = '<div style="height:170px;display:flex;align-items:center;justify-content:center;color:var(--color-neutral-500);font-size:12px;background:var(--color-divider)">Vencida y borrada el ' + esc(fmtFechaCrea(c.borrado_en)) + '</div>';
  else if (!c.previewUrl) media = '<div style="height:170px;display:flex;align-items:center;justify-content:center;color:var(--color-neutral-500);font-size:12px;background:var(--color-divider)">Sin vista previa</div>';
  else if (esVideo) media = '<video src="' + esc(c.previewUrl) + '" controls preload="metadata" style="width:100%;height:170px;object-fit:contain;background:#000;display:block"></video>';
  else media = '<img src="' + esc(c.previewUrl) + '" data-action="abrir-lightbox" data-url="' + esc(c.previewUrl) + '" style="width:100%;height:170px;object-fit:cover;display:block;cursor:zoom-in" title="Ver más grande">';
  const medidas = c.width && c.height ? ` · ${c.width}×${c.height}` : '';
  const vence = c.expira_en ? `vence ${fmtFechaCrea(c.expira_en)}` : '';
  const cabecera = `<div style="padding:10px 12px 6px">
      <div style="font-family:var(--font-heading);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(c.nombre || c.id)}">${esc(c.nombre || c.id)}</div>
      <div style="font-size:11px;color:var(--color-neutral-500);margin-top:2px">${esc((c.content_type || '').split('/')[1] || c.content_type || '')} · ${fmtBytesCrea(c.bytes)}${medidas} · subida ${esc(fmtFechaCrea(c.creado_en))}${c.subido_por ? ' por ' + esc(c.subido_por) : ''}${vence ? ' · ' + vence : ''}</div>
    </div>`;
  let pedidos;
  if (!c.pedidos.length) {
    pedidos = '<div style="padding:8px 12px 12px;font-size:12px;color:var(--color-neutral-500)"><span class="tag tag-outline" style="font-size:10px">sin pedido asociado</span>' + (c.etiquetas.codigo ? ' ' + esc(c.etiquetas.codigo) : '') + '</div>';
  } else {
    pedidos = c.pedidos.map((p) => {
      const estadoTag = p.estado === 'confirmada' ? 'tag-accent' : '';
      const metaTxt = p.meta.conjuntos ? `${p.meta.publicadas}/${p.meta.conjuntos} conjuntos en Meta` : 'sin conjuntos en Meta';
      const objetivos = String(p.objetivo || '').split(',').map((s) => s.trim()).filter(Boolean).join(' + ');
      return `<div style="padding:8px 12px 10px;border-top:1px solid var(--color-divider);font-size:12px">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
            <code style="font-size:12px">${esc(p.codigo || p.correlation_id)}</code>
            <span class="tag ${estadoTag}" style="font-size:10px">${esc(p.estado || '')}</span>
          </div>
          <div style="margin-top:4px"><strong>${esc(p.campana || '')}</strong></div>
          <div style="color:var(--color-neutral-400)">${esc(p.proyecto || '')} · ${esc(p.activo || '')}${p.eje ? ' · ' + esc(p.eje) : ''}</div>
          <div style="color:var(--color-neutral-400)">${esc(objetivos)}${p.audiencia ? ' · ' + esc(p.audiencia) : ''}${p.presupuesto ? ' · ' + fmtMoney(p.presupuesto) : ''}</div>
          <div style="color:var(--color-neutral-500);margin-top:2px">${esc(fmtFechaCrea(p.fecha))}${p.creador ? ' · ' + esc(p.creador) : ''} · ${metaTxt}${p.origen === 'ingesta' ? ' · ingesta' : ''}</div>
        </div>`;
    }).join('');
  }
  return `<div class="expand-panel" style="padding:0;overflow:hidden${c.borrado_en ? ';opacity:.6' : ''}">${media}${cabecera}${pedidos}</div>`;
}

// ---------- Onboarding: Login → Proyecto → Modo → (Normal) Ecosistema ----------
// Pantallas obligatorias antes de llegar a las pestañas de siempre. Cada
// elección restringe lo que se ve después (Proyecto acota Historial, Modo
// acota qué Tipo/Objetivo/Activo se puede elegir y si PAUTADOR publica
// solo o queda para cargar a mano, Ecosistema acota además qué Tipo de
// campaña aparece) — ver middleware/usuarioActual.js para la validación
// server-side equivalente.
//
// Modo (automatizado/normal) es un eje DISTINTO de Ecosistema
// (Oficial/Informativo): separa CÓMO se ejecuta el pedido, no A QUIÉN
// pertenece el contenido. Los dos modos preguntan Ecosistema como cuarto
// paso del onboarding (desde 2026-09-11 Oficial también está prendido en
// Automatizado: Tipos A/B/C y activos con uso Oficial en AppSheet).
const MODOS_HABILITADOS = ['automatizado', 'normal'];
const MODOS_VALIDOS = ['automatizado', 'normal'];
// Único ecosistema alcanzable en modo "automatizado" (ahí no hay pantalla
// propia, se manda siempre este valor) — Oficial todavía no arrancó (Fase
// 3, ver equiv_tipo.notas), así que en "normal" queda visible pero
// bloqueado en su propia pantalla.
// Desde 2026-09-11 ("prendé Oficial") los dos ecosistemas están
// habilitados y se preguntan en los dos modos (ver pantallaActual).
const ECOSISTEMAS_HABILITADOS = ['Oficial', 'Informativo'];
const ECOSISTEMAS_VALIDOS = ['Oficial', 'Informativo'];

// Copy visible de la pantalla de elegir camino.
const MODO_COPY = {
  automatizado: {
    titulo: 'Pedido Automatizado',
    detalle: 'Solo canal Informativo. Meta, intensidad Media o Baja, objetivo Alcance o Interacción — se publica solo (en pausa), sin revisión previa.',
  },
  normal: {
    titulo: 'Pedido Manual',
    detalle: 'Todo lo demás (incluye lo del automatizado): intensidad Alta, otras plataformas y objetivos. Se carga a mano en Meta y se marca hecho.',
  },
};

function esAdmin() {
  const u = usuarioActual();
  return !!u && u.rol === 'administrador';
}
function esSuperadmin() {
  const u = usuarioActual();
  return !!u && u.es_superadmin === true;
}

// Entrada ADMIN desde la pantalla de Proyecto (solo superadmin): todo junto
// — Historial de todos los proyectos, los dos modos y los dos canales — sin
// la pestaña de pedidos (un pedido siempre es de un proyecto concreto).
function elegirAdminTodo() {
  if (!esSuperadmin()) return;
  state.proyectoActivo = 'TODOS'; localStorage.setItem('pautador_proyecto_activo', 'TODOS');
  state.modoActivo = 'TODOS'; localStorage.setItem('pautador_modo_activo', 'TODOS');
  state.ecosistemaActivo = 'TODOS'; localStorage.setItem('pautador_ecosistema_activo', 'TODOS');
  state.items = [];
  state.pdProyectos = [];
  state.tabActiva = 'pendientes';
  render();
  avanzarSiCorresponde();
}

// Proyecto de un cliente habilitado solo para Informativo (Córdoba, por
// ahora) — viene de GET /api/proyectos?detalle=1 (CLIENTES_SOLO_INFORMATIVO).
function proyectoSoloInformativo(proyecto) {
  const p = (state.proyectosDetalle || []).find((d) => d.proyecto === (proyecto || state.proyectoActivo));
  return !!(p && p.soloInformativo);
}
const LEYENDA_SOLO_INFORMATIVO = 'Por ahora solo canal Informativo — el canal Oficial va a tener su propio módulo.';

// Tiene al menos un activo con automatización (lo dice /api/proyectos?detalle=1).
// Sin eso no se puede elegir "Pedido Automatizado" (usuario, 2026-09-14).
function proyectoAutomatizable(proyecto) {
  // Sin el detalle cargado todavía (recarga con proyecto guardado) no se
  // bloquea: se decide cuando llega.
  if (!state.proyectosDetalle || !state.proyectosDetalle.length) return true;
  const p = state.proyectosDetalle.find((d) => d.proyecto === (proyecto || state.proyectoActivo));
  return !!(p && p.automatizable);
}
const LEYENDA_SIN_AUTOMATIZACION = 'Este proyecto no tiene activos con automatización — solo Pedido Manual.';
function activosAutomatizablesDe(proyecto) {
  const p = (state.proyectosDetalle || []).find((d) => d.proyecto === (proyecto || state.proyectoActivo));
  return (p && p.activosAutomatizables) || [];
}
// Recarga con un proyecto ya guardado: el detalle (automatización, solo
// Informativo) todavía no está — se pide y se vuelve a dibujar la pantalla.
function asegurarProyectosDetalle(volverADibujar) {
  if (state.proyectosDetalle && state.proyectosDetalle.length) return;
  if (state.proyectosDetalleCargando) return;
  state.proyectosDetalleCargando = true;
  apiFetch('/api/proyectos?detalle=1').then(async (r) => {
    state.proyectosDetalle = r.ok ? await r.json() : [];
    state.proyectosDetalleCargando = false;
    render();
  }).catch(() => { state.proyectosDetalleCargando = false; });
}

// Qué pantalla corresponde mostrar AHORA MISMO, según lo que ya se eligió y
// si sigue siendo válido para el usuario actual (cambiar de usuario en el
// selector del nav puede invalidar un Proyecto que el nuevo usuario no
// tiene permitido — acá se re-chequea en cada render, no hace falta lógica
// aparte para detectarlo).
function pantallaActual() {
  if (!state.usuarioActualId || !usuarioActual()) return 'login';
  const permitidos = proyectosPermitidos();
  // 'TODOS' = entrada ADMIN (solo superadmin, usuario 2026-09-15): ve todo
  // junto (Historial de todos los proyectos, paneles) menos pedidos. Para
  // cualquier otro, un 'TODOS' guardado manda de vuelta a elegir proyecto.
  const proyectoValido = state.proyectoActivo === 'TODOS'
    ? esSuperadmin()
    : (!!state.proyectoActivo && (permitidos === 'todos' || permitidos.includes(state.proyectoActivo)));
  if (!proyectoValido) return 'proyecto';
  const modoValido = state.modoActivo === 'TODOS'
    ? esAdmin()
    : (MODOS_VALIDOS.includes(state.modoActivo) && !(state.modoActivo === 'automatizado' && !proyectoAutomatizable()));
  if (!modoValido) return 'modo';
  // Canal (Oficial/Informativo) se pregunta en los dos modos — salvo en
  // un proyecto "solo Informativo" (ej. Córdoba): ahí ni se pregunta, queda
  // Informativo fijo (el aviso está en la tarjeta del proyecto).
  if (proyectoSoloInformativo()) {
    if (state.ecosistemaActivo !== 'Informativo') {
      state.ecosistemaActivo = 'Informativo';
      localStorage.setItem('pautador_ecosistema_activo', 'Informativo');
    }
    return 'app';
  }
  // Pedido Automatizado es solo canal Informativo (usuario, 2026-09-14): la
  // pantalla se muestra igual, con Oficial inhabilitado — un "Oficial" o
  // "Ver ambos" guardado de otra sesión manda a elegir de nuevo.
  const ecosistemaValido = state.modoActivo === 'automatizado'
    ? state.ecosistemaActivo === 'Informativo'
    : (state.ecosistemaActivo === 'TODOS' ? esAdmin() : ECOSISTEMAS_VALIDOS.includes(state.ecosistemaActivo));
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
  // Registro de uso: "Entró al app" con proyecto/modo/canal (lo anota el
  // servidor; si falla no pasa nada).
  apiFetch('/api/uso/entrada', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proyecto: state.proyectoActivo, modo: state.modoActivo, canal: state.ecosistemaActivo, pantalla: NOMBRE_PANTALLA[state.tabActiva] || state.tabActiva }) }).catch(() => {});
  cambiarTab(state.tabActiva);
  arrancarLatido();
}

// Presencia en vivo (Panel Usuarios → Uso, "En vivo"): un latido por minuto
// mientras la pestaña del navegador está visible, y otro al cambiar de
// pestaña del app. Lo guarda el servidor en memoria, no en la base.
const NOMBRE_PANTALLA = { pedido2: 'Pedido de Anuncios', pendientes: 'Historial', admin: 'Agregar Activos', usuarios: 'Panel Usuarios', creatividades: 'Creatividades' };
function mandarLatido() {
  if (!state.usuarioActualId || document.visibilityState !== 'visible' || pantallaActual() !== 'app') return;
  apiFetch('/api/uso/latido', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pantalla: NOMBRE_PANTALLA[state.tabActiva] || state.tabActiva || '', proyecto: state.proyectoActivo, modo: state.modoActivo, canal: state.ecosistemaActivo }) }).catch(() => {});
}
let latidoTimer = null;
function arrancarLatido() {
  if (latidoTimer) return;
  latidoTimer = setInterval(mandarLatido, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') mandarLatido(); });
}

// Proyectos disponibles + (Implementador y Administrador, que son quienes
// validan) cuántos pendientes tiene cada uno — se pide de una sola vez al
// llegar a la pantalla 2, no en cada render. pm_cuentas no valida, así que
// no ve el globo.
async function prepararPantallaProyecto() {
  const r = await apiFetch('/api/proyectos?detalle=1');
  state.proyectosDetalle = r.ok ? await r.json() : [];
  state.proyectosDisponibles = state.proyectosDetalle.map((p) => p.proyecto);
  await cargarPendientesDetalle(true);
  render();
}

// Globos de pendientes: los ven Implementador y Administrador (son quienes
// validan). Se cargan una vez y se recuentan en el front para cada
// pantalla (contarPendientes); `forzar` los vuelve a pedir.
async function cargarPendientesDetalle(forzar) {
  const u = usuarioActual();
  if (!u || !(u.rol === 'implementador' || u.rol === 'administrador')) {
    state.pendientesDetalle = [];
    state.pendientesPorProyecto = {};
    state.pendientesDetalleCargado = true;
    return;
  }
  if (state.pendientesDetalleCargado && !forzar) return;
  const r = await apiFetch('/api/pendientes-detalle');
  state.pendientesDetalle = r.ok ? await r.json() : [];
  state.pendientesDetalleCargado = true;
  state.pendientesPorProyecto = {};
  state.pendientesDetalle.forEach((p) => { state.pendientesPorProyecto[p.proyecto] = (state.pendientesPorProyecto[p.proyecto] || 0) + 1; });
}

// Cuenta pendientes que matchean el filtro; lo ya elegido en el onboarding
// (proyecto/modo/ecosistema) acota, salvo 'TODOS'. plataforma: la pieza
// cuenta si la incluye entre las suyas.
function contarPendientes(filtro) {
  const f = Object.assign({ proyecto: state.proyectoActivo, modo: state.modoActivo, ecosistema: state.ecosistemaActivo }, filtro || {});
  return (state.pendientesDetalle || []).filter((p) =>
    (!f.proyecto || f.proyecto === 'TODOS' || p.proyecto === f.proyecto)
    && (!f.modo || f.modo === 'TODOS' || p.modo === f.modo)
    && (!f.ecosistema || f.ecosistema === 'TODOS' || p.ecosistema === f.ecosistema)
    && (!f.plataforma || p.plataformas.includes(f.plataforma))).length;
}
function badgePendientes(n, extra) {
  return n > 0 ? '<span class="pantalla-onboarding-badge" ' + (extra || '') + ' title="' + n + ' pendiente(s) de validar">' + n + '</span>' : '';
}
// Las pantallas de Modo/Ecosistema/Plataforma pueden abrirse sin pasar por
// la de Proyecto (toggles del nav, recarga) — si no hay conteo, se pide y
// se vuelve a dibujar.
function asegurarPendientesDetalle(volverADibujar) {
  if (state.pendientesDetalleCargado) return;
  cargarPendientesDetalle().then(volverADibujar);
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
  // Modo y Ecosistema se vuelven a preguntar en CADA cambio de Proyecto —
  // antes quedaban guardados en localStorage y una vez elegidos,
  // pantallaActual() saltaba esas pantallas para siempre, incluso al
  // cambiar a un Proyecto distinto.
  state.modoActivo = null;
  localStorage.removeItem('pautador_modo_activo');
  state.ecosistemaActivo = null;
  localStorage.removeItem('pautador_ecosistema_activo');
  state.items = [];
  state.pdProyectos = [];
  render();
  avanzarSiCorresponde();
}

function elegirModo(valor) {
  state.modoActivo = valor;
  localStorage.setItem('pautador_modo_activo', valor);
  // El Ecosistema se vuelve a pedir cada vez que se elige un modo, no queda
  // pegado de una elección anterior (mismo criterio que el Proyecto).
  state.ecosistemaActivo = null;
  localStorage.removeItem('pautador_ecosistema_activo');
  // Fuerza a recargar /api/tipos con el filtro nuevo — vaciar solo pdTipos
  // no alcanza: cambiarTab() solo vuelve a pedir datos cuando pdProyectos
  // está vacío (ver cambiarTab), así que hay que vaciar eso también aunque
  // el Proyecto en sí no haya cambiado.
  state.pdTipos = [];
  state.pdProyectos = [];
  render();
  avanzarSiCorresponde();
}

function elegirEcosistema(valor) {
  state.ecosistemaActivo = valor;
  localStorage.setItem('pautador_ecosistema_activo', valor);
  state.pdTipos = [];
  state.pdProyectos = [];
  render();
  avanzarSiCorresponde();
}

// Botón "Cambiar de Proyecto" del nav — vuelve a la pantalla 2 sin tocar
// Modo (son elecciones independientes, cada una con su propio botón).
function cambiarDeProyecto() {
  state.proyectoActivo = null;
  localStorage.removeItem('pautador_proyecto_activo');
  render();
  prepararPantallaProyecto();
}

// Botón del nav "Pasar a 'Automatizados'"/"Pasar a 'Normal'" — con solo dos
// valores reales, alterna directo sin pantalla intermedia. Si el usuario
// tenía "Ver ambos" (solo Admin) no hay un "otro" binario claro, así que
// manda de vuelta a la pantalla 3 para elegir uno de los dos.
function toggleModo() {
  if (state.modoActivo === 'TODOS' || !MODOS_VALIDOS.includes(state.modoActivo)) {
    state.modoActivo = null;
    localStorage.removeItem('pautador_modo_activo');
    render();
    return;
  }
  const otro = state.modoActivo === 'automatizado' ? 'normal' : 'automatizado';
  if (!MODOS_HABILITADOS.includes(otro)) return; // botón ya se muestra disabled
  if (otro === 'automatizado' && !proyectoAutomatizable()) return;
  elegirModo(otro);
}

// Botón del nav "Pasar a 'Oficial'"/"Pasar a 'Informativo'" — solo visible
// en modo "normal" (en "automatizado" no hay Ecosistema para elegir, ver
// renderNavContexto). Si el usuario tenía "Ver ambos" (solo Admin) manda
// de vuelta a la pantalla para elegir uno de los dos.
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
  // Solo el superadmin puede "entrar como" otro (usuario, 2026-09-14).
  document.getElementById('pantalla-proyecto-cambiar-usuario').hidden = !puedeCambiarUsuario();

  // Agrupado por Cliente (config_activos.cliente): el cliente como título y
  // debajo sus proyectos — un cliente con un solo proyecto se ve como
  // siempre (pedido del usuario 2026-09-11, "opción 2: anidar").
  // volumen15: códigos de los últimos 15 días (viene ordenado desc del
  // server) — se muestra chico al lado del nombre y ordena todo.
  const volumenDe = {};
  (state.proyectosDetalle || []).forEach((d) => { volumenDe[d.proyecto] = d.volumen15 || 0; });
  const opcionProyecto = (p) => {
    const pendientes = state.pendientesPorProyecto[p] || 0;
    const badge = pendientes > 0 ? '<span class="pantalla-onboarding-badge">' + pendientes + '</span>' : '';
    // El volumen de 15 días solo ordena (pedido del usuario 2026-09-12): no se muestra.
    // Proyecto solo Informativo (Córdoba): el aviso va acá mismo, en la
    // tarjeta — después no se pregunta el canal.
    const soloInf = proyectoSoloInformativo(p);
    const automatizable = proyectoAutomatizable(p);
    // Con automatización: solo el recuadro en verde (usuario, 2026-09-14).
    return '<button type="button" class="pantalla-onboarding-opcion" data-action="elegir-proyecto" data-id="' + esc(p) + '" ' + (soloInf ? 'title="' + esc(LEYENDA_SOLO_INFORMATIVO) + '"' : (automatizable ? 'title="Tiene activos con automatización"' : 'title="' + esc(LEYENDA_SIN_AUTOMATIZACION) + '"'))
      + (automatizable ? ' style="border-color:var(--color-success, #1f8a4c);box-shadow:inset 0 0 0 1px var(--color-success, #1f8a4c)"' : '') + '>'
      + '<span style="display:flex;flex-direction:column;gap:3px;min-width:0"><span class="titulo">' + esc(p) + '</span>'
      + (soloInf ? '<span class="subtitulo" style="margin:0;color:var(--color-warning, #d08a1e)"><i class="ph ph-info"></i> Solo canal Informativo por ahora</span>' : '')
      + '</span>' + badge + '</button>';
  };
  const detalle = state.proyectosDetalle && state.proyectosDetalle.length
    ? state.proyectosDetalle
    : (state.proyectosDisponibles || []).map((p) => ({ proyecto: p, cliente: '', volumen15: 0 }));
  const porCliente = new Map();
  detalle.forEach((d) => {
    const c = d.cliente || d.proyecto;
    if (!porCliente.has(c)) porCliente.set(c, []);
    porCliente.get(c).push(d.proyecto);
  });
  // Cuadrícula: una tarjeta por cliente con sus proyectos adentro — todas
  // iguales, así un cliente de un solo proyecto no parece "colgar" del
  // anterior. Clientes ordenados por el volumen total de sus proyectos y
  // los proyectos por el suyo (los de más contenido, primero).
  const volCliente = (proyectos) => proyectos.reduce((a, p) => a + (volumenDe[p] || 0), 0);
  const tarjetas = [...porCliente.entries()]
    .sort((a, b) => volCliente(b[1]) - volCliente(a[1]) || a[0].localeCompare(b[0], 'es'))
    .map(([cliente, proyectos]) => '<div class="cliente-card">'
      + '<div class="cliente-nombre"><i class="ph ph-buildings"></i> ' + esc(cliente) + '</div>'
      + proyectos.sort((x, y) => (volumenDe[y] || 0) - (volumenDe[x] || 0) || x.localeCompare(y, 'es')).map(opcionProyecto).join('')
      + '</div>').join('');
  // Entrada ADMIN (solo superadmin, usuario 2026-09-15): todo junto menos
  // pedidos. Va arriba de la cuadrícula de clientes.
  const tarjetaAdmin = (u && u.es_superadmin)
    ? '<button type="button" class="pantalla-onboarding-opcion" data-action="elegir-admin" style="border-style:dashed;margin-bottom:14px;width:100%">'
      + '<span style="display:flex;flex-direction:column;gap:3px;min-width:0"><span class="titulo"><i class="ph ph-shield-check"></i> ADMIN — ver todo junto</span>'
      + '<span class="subtitulo" style="margin:0">Historial de todos los proyectos, los dos modos y los dos canales. Sin pedidos: para pedir, entrá a un proyecto.</span></span></button>'
    : '';
  const opciones = tarjetas ? tarjetaAdmin + '<div class="cliente-grid">' + tarjetas + '</div>' : tarjetaAdmin;
  // Sin "Ver todos los proyectos" para el resto (sacado a pedido del usuario
  // 2026-09-11): siempre se trabaja sobre un proyecto concreto.
  // Sin proyectos asignados (usuario nuevo del dominio): botón "Pedir
  // asignación de Proyectos" → mail a los administradores (usuario,
  // 2026-09-14). Un admin sin proyectos es raro (ve todos): texto simple.
  document.getElementById('pantalla-proyecto-lista').innerHTML = opciones || renderSinProyectos(u);
}

function renderSinProyectos(u) {
  const esAdmin = !!(u && u.rol === 'administrador');
  const r = state.pedidoAsignacion || {};
  const cuerpo = esAdmin
    ? 'Todavía no hay proyectos para mostrar.'
    : 'Todavía no te asignaron ningún Proyecto. Pedile a un administrador que te lo asigne desde acá:';
  let accion = '';
  if (!esAdmin) {
    if (r.ok) accion = `<p style="margin:10px 0 0;font-size:13px;color:var(--color-success, #1f8a4c)"><i class="ph ph-check-circle"></i> ${esc(r.mensaje || 'Listo: avisamos a los administradores.')}</p>`;
    else accion = `<div style="margin-top:12px"><button type="button" class="btn btn-primary" data-action="pedir-asignacion" ${r.enviando ? 'disabled' : ''}><i class="ph ph-paper-plane-tilt"></i> ${r.enviando ? 'Avisando…' : 'Pedir asignación de Proyectos'}</button></div>`
      + (r.error ? `<p class="error" style="margin:8px 0 0">${esc(r.error)}</p>` : '');
  }
  return `<p style="color:var(--color-neutral-500);font-size:13px;margin:0">${cuerpo}</p>${accion}`;
}

async function pedirAsignacionProyectos() {
  state.pedidoAsignacion = { enviando: true };
  renderPantallaProyecto();
  try {
    const r = await apiFetch('/api/usuarios/pedir-asignacion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalle || data.error || 'No se pudo mandar el aviso.');
    state.pedidoAsignacion = { ok: true, mensaje: data.mensaje };
  } catch (err) {
    state.pedidoAsignacion = { error: err.message };
  }
  renderPantallaProyecto();
}

function renderPantallaModo() {
  asegurarPendientesDetalle(renderPantallaModo);
  asegurarProyectosDetalle();
  document.getElementById('pantalla-modo-contexto').textContent =
    state.proyectoActivo === 'TODOS' ? 'Todos los proyectos' : (state.proyectoActivo || '');
  const opciones = MODOS_VALIDOS.map((modo) => {
    // "Pedido Automatizado" solo si el proyecto tiene algún activo con
    // automatización (usuario, 2026-09-14).
    const sinAutomatizacion = modo === 'automatizado' && !proyectoAutomatizable();
    const habilitado = MODOS_HABILITADOS.includes(modo) && !sinAutomatizacion;
    const motivo = sinAutomatizacion ? LEYENDA_SIN_AUTOMATIZACION : 'Todavía no está habilitado';
    const copy = MODO_COPY[modo] || { titulo: modo, detalle: '' };
    // En Automatizado se dice qué activos del proyecto pueden automatizar.
    const activosAuto = modo === 'automatizado' && habilitado ? activosAutomatizablesDe() : [];
    return '<button type="button" class="pantalla-onboarding-opcion" data-action="elegir-modo" data-id="' + esc(modo) + '" ' + (habilitado ? '' : 'disabled title="' + esc(motivo) + '"') + '>'
      + '<span style="display:flex;flex-direction:column;gap:2px">'
      +   '<span class="titulo">' + esc(copy.titulo) + '</span>'
      +   (activosAuto.length ? '<span class="subtitulo" style="margin:0;color:var(--color-success, #1f8a4c)"><i class="ph ph-lightning"></i> Activos que se automatizan: ' + esc(activosAuto.join(', ')) + '</span>' : '')
      +   '<span class="subtitulo">' + esc(habilitado ? copy.detalle : motivo) + '</span>'
      + '</span>'
      + (habilitado ? badgePendientes(contarPendientes({ modo, ecosistema: null })) : '<span class="subtitulo" style="flex:none">Apagado</span>')
      + '</button>';
  }).join('');
  const opcionAmbos = esAdmin()
    ? '<button type="button" class="pantalla-onboarding-opcion" data-action="elegir-modo" data-id="TODOS" style="border-style:dashed"><span class="titulo">Ver todo, sin restricciones</span>' + badgePendientes(contarPendientes({ modo: null, ecosistema: null })) + '</button>'
    : '';
  document.getElementById('pantalla-modo-lista').innerHTML = opciones + opcionAmbos;
}

// Canal (Oficial / Informativo) — se pregunta en los dos modos.
function renderPantallaEcosistema() {
  asegurarPendientesDetalle(renderPantallaEcosistema);
  asegurarProyectosDetalle();
  document.getElementById('pantalla-ecosistema-contexto').textContent =
    (state.proyectoActivo === 'TODOS' ? 'Todos los proyectos' : (state.proyectoActivo || ''))
    + (state.modoActivo && state.modoActivo !== 'TODOS' ? ' · ' + ((MODO_COPY[state.modoActivo] || {}).titulo || state.modoActivo) : '');
  const detalleEco = { Oficial: 'Cuentas oficiales de gobierno y funcionarios.', Informativo: 'Medios y portales informativos.' };
  const soloInf = proyectoSoloInformativo();
  const esAutomatizado = state.modoActivo === 'automatizado';
  const opciones = ECOSISTEMAS_VALIDOS.map((eco) => {
    const habilitado = ECOSISTEMAS_HABILITADOS.includes(eco) && !((soloInf || esAutomatizado) && eco === 'Oficial');
    const motivo = eco === 'Oficial' && soloInf ? LEYENDA_SOLO_INFORMATIVO
      : (eco === 'Oficial' && esAutomatizado ? 'Pedido Automatizado es solo canal Informativo.' : 'Todavía no está habilitado');
    return '<button type="button" class="pantalla-onboarding-opcion" data-action="elegir-ecosistema" data-id="' + esc(eco) + '" ' + (habilitado ? '' : 'disabled title="' + esc(motivo) + '"') + '>'
      + '<span style="display:flex;flex-direction:column;gap:2px">'
      +   '<span class="titulo"><span class="eco-chip ' + (eco === 'Oficial' ? 'eco-oficial' : 'eco-informativo') + '">' + esc(eco) + '</span></span>'
      +   '<span class="subtitulo">' + esc(habilitado ? (detalleEco[eco] || '') : motivo) + '</span>'
      + '</span>'
      + (habilitado ? badgePendientes(contarPendientes({ ecosistema: eco })) : '<span class="subtitulo">Apagado</span>')
      + '</button>';
  }).join('');
  const opcionAmbos = esAdmin() && !soloInf && !esAutomatizado
    ? '<button type="button" class="pantalla-onboarding-opcion" data-action="elegir-ecosistema" data-id="TODOS" style="border-style:dashed"><span class="titulo">Ver ambos canales</span>' + badgePendientes(contarPendientes({ ecosistema: null })) + '</button>'
    : '';
  document.getElementById('pantalla-ecosistema-lista').innerHTML = opciones + opcionAmbos;
}

function renderNavContexto() {
  const detalleProy = (state.proyectosDetalle || []).find((p) => p.proyecto === state.proyectoActivo);
  const clienteNav = detalleProy && detalleProy.cliente && detalleProy.cliente !== state.proyectoActivo ? detalleProy.cliente + ' · ' : '';
  document.getElementById('nav-proyecto-actual').innerHTML =
    '<i class="ph ph-buildings"></i> ' + esc(state.proyectoActivo === 'TODOS' ? 'Todos los proyectos' : (clienteNav + (state.proyectoActivo || '')));

  const btnModo = document.getElementById('nav-modo-actual');
  const tituloDe = (modo) => (MODO_COPY[modo] || {}).titulo || modo;
  // Chips cortos (pedido del usuario 2026-09-12): el nombre y un ▾; el
  // "pasar a…" queda en el title (tooltip).
  if (state.modoActivo === 'TODOS') {
    btnModo.textContent = 'Automatizado + Normal ▾';
    btnModo.disabled = false;
    btnModo.title = 'Elegir un modo';
  } else {
    const otro = state.modoActivo === 'automatizado' ? 'normal' : 'automatizado';
    const sinAuto = otro === 'automatizado' && !proyectoAutomatizable();
    const puedeIr = MODOS_HABILITADOS.includes(otro) && !sinAuto;
    btnModo.textContent = tituloDe(state.modoActivo) + (puedeIr ? ' ▾' : '');
    btnModo.disabled = !puedeIr;
    btnModo.title = puedeIr ? ('Pasar a "' + tituloDe(otro) + '"') : (sinAuto ? LEYENDA_SIN_AUTOMATIZACION : (tituloDe(otro) + ' todavía no está habilitado'));
  }

  // Botón de Ecosistema: en los dos modos, con el color del ecosistema
  // (Oficial / Informativo) para que se distinga de un vistazo.
  const btnEco = document.getElementById('nav-ecosistema-actual');
  btnEco.hidden = false;
  btnEco.classList.remove('eco-chip', 'eco-oficial', 'eco-informativo', 'eco-todos');
  btnEco.classList.add('eco-chip', claseEcosistema());
  if (!btnEco.hidden) {
    if (state.ecosistemaActivo === 'TODOS') {
      btnEco.textContent = 'Oficial + Informativo ▾';
      btnEco.disabled = false;
      btnEco.title = 'Elegir un canal';
    } else {
      const otroEco = state.ecosistemaActivo === 'Informativo' ? 'Oficial' : 'Informativo';
      // Pedido Automatizado es solo Informativo: el chip queda fijo, sin
      // ofrecer "Pasar a Oficial" (pantallaActual lo forzaría igual).
      const soloInf = proyectoSoloInformativo() || state.modoActivo === 'automatizado';
      const puedeIrEco = ECOSISTEMAS_HABILITADOS.includes(otroEco) && !(otroEco === 'Oficial' && soloInf);
      btnEco.textContent = (state.ecosistemaActivo || '') + (puedeIrEco ? ' ▾' : '');
      btnEco.disabled = !puedeIrEco;
      btnEco.title = puedeIrEco
        ? ('Pasar a "' + otroEco + '"')
        : (otroEco === 'Oficial' && soloInf ? (state.modoActivo === 'automatizado' ? 'Pedido Automatizado es solo canal Informativo' : LEYENDA_SOLO_INFORMATIVO) : (otroEco + ' todavía no está habilitado'));
    }
  }
}

// Quién puede "actuar como" otro: el superadmin, o alguien que ya está
// actuando como otro desde un superadmin (se recuerda en localStorage al
// cambiar — sin esto, al entrar como un perfil sin proyectos el selector
// desaparecía y no había forma de volver; visto 2026-09-15).
const CLAVE_SUPERADMIN = 'pautador_superadmin_id';
function puedeCambiarUsuario() {
  const u = usuarioActual();
  if (u && u.es_superadmin) return true;
  const origen = state.usuarios.find((x) => x.id === localStorage.getItem(CLAVE_SUPERADMIN));
  return !!(origen && origen.es_superadmin);
}

async function cambiarUsuario(id) {
  const anterior = usuarioActual();
  if (anterior && anterior.es_superadmin) localStorage.setItem(CLAVE_SUPERADMIN, anterior.id);
  const nuevo = state.usuarios.find((x) => x.id === id);
  if (nuevo && nuevo.es_superadmin) localStorage.removeItem(CLAVE_SUPERADMIN);
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
  if (pantalla === 'modo' || pantalla === 'ecosistema') return;
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
  if (pantalla === 'modo' || pantalla === 'ecosistema') return;
  if (pantalla === 'app') await entrarAlApp();
}

// ---------- Delegación de eventos ----------

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id;

  if (action === 'stop-prop') { e.stopPropagation(); return; }
  if (action === 'pedir-asignacion') { pedirAsignacionProyectos(); return; }
  if (action === 'crea-recargar') { cargarCreatividades(); return; }
  if (action === 'usu-uso-recargar') { cargarUsoPanel(); return; }
  if (action === 'usu-subtab') { cambiarSubtabUsuarios(id); return; }
  if (action === 'pd-csv-reintentar') { validarFilasCsv([Number(id)]); return; }
  if (action === 'elegir-usuario') { elegirUsuario(id); return; }
  if (action === 'elegir-proyecto') { elegirProyecto(id); return; }
  if (action === 'elegir-admin') { elegirAdminTodo(); return; }
  // Volver atrás en el onboarding (usuario, 2026-09-15): cada pantalla
  // vuelve a la anterior; Proyecto vuelve al Login (salir).
  if (action === 'volver-a-modo') {
    state.ecosistemaActivo = null; localStorage.removeItem('pautador_ecosistema_activo');
    state.modoActivo = null; localStorage.removeItem('pautador_modo_activo');
    render(); return;
  }
  if (action === 'volver-a-proyecto') {
    state.ecosistemaActivo = null; localStorage.removeItem('pautador_ecosistema_activo');
    state.modoActivo = null; localStorage.removeItem('pautador_modo_activo');
    state.proyectoActivo = null; localStorage.removeItem('pautador_proyecto_activo');
    render(); prepararPantallaProyecto(); return;
  }
  if (action === 'cerrar-sesion') {
    ['pautador_usuario_id', 'pautador_superadmin_id', 'pautador_proyecto_activo', 'pautador_modo_activo', 'pautador_ecosistema_activo'].forEach((k) => localStorage.removeItem(k));
    state.usuarioActualId = null; state.proyectoActivo = null; state.modoActivo = null; state.ecosistemaActivo = null;
    location.href = location.pathname; return;
  }
  if (action === 'elegir-modo') { elegirModo(id); return; }
  if (action === 'elegir-ecosistema') { elegirEcosistema(id); return; }
  if (action === 'cambiar-de-proyecto') { cambiarDeProyecto(); return; }
  if (action === 'toggle-modo') { toggleModo(); return; }
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
  if (action === 'marcar-todo-manual') { e.stopPropagation(); marcarTodoManualHecho(id); return; }
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
  if (action === 'pd2-resultado-corregir') { state.pd2BulkResultados = null; state.pd2ModoCarga = 'anuncios'; renderResultadoFinalV2(); renderTabPedido2(); return; }
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
  if (action === 'pd2-reparto-parejo') {
    // Reparte parejo lo que queda entre las celdas activas y NO bloqueadas:
    // las bloqueadas y las desactivadas se respetan (usuario, 2026-09-14).
    const filas = repartoResueltoPd2();
    const bloq = state.pd2RepartoBloqueados || {};
    const activas = filas.filter((f) => !f.excluida);
    const fijas = activas.filter((f) => bloq[f.clave]);
    const libres = activas.filter((f) => !bloq[f.clave]);
    const sumaFijas = fijas.reduce((a, f) => a + f.pct, 0);
    const nuevo = {};
    fijas.forEach((f) => { nuevo[f.clave] = f.pct; });
    if (libres.length) {
      const parejo = normalizar100({}, libres.map((f) => f.clave));
      const factor = Math.max(0, 100 - sumaFijas) / 100;
      libres.forEach((f) => { nuevo[f.clave] = +(parejo[f.clave] * factor).toFixed(2); });
    }
    state.pd2Reparto = nuevo;
    renderCrucesV2();
    return;
  }
  if (action === 'pd2-cruce-bloquear') {
    const clave = el.dataset.clave;
    const bloq = Object.assign({}, state.pd2RepartoBloqueados || {});
    if (bloq[clave]) delete bloq[clave]; else bloq[clave] = true;
    state.pd2RepartoBloqueados = bloq;
    renderCrucesV2();
    return;
  }
  if (action === 'pd2-cruce-todo') {
    const clave = el.dataset.clave;
    const filas = repartoResueltoPd2();
    const activas = filas.filter((f) => !f.excluida).map((f) => f.clave);
    const nuevo = {};
    activas.forEach((k) => { nuevo[k] = k === clave ? 100 : 0; });
    state.pd2Reparto = nuevo;
    state.pd2RepartoBloqueados = {};
    renderCrucesV2();
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
  if (action === 'hist-toggle') { toggleHistorialFila(id); return; }
  if (action === 'hist-marcar-pautado') { e.stopPropagation(); marcarPautadoHistorial(id); return; }
  if (action === 'pd2-plataforma-toggle') { togglePlataformaPd2(id); return; }
  if (action === 'pd2-plataforma-continuar') { confirmarPlataformasPd2(); return; }
  if (action === 'pd2-plataforma-cambiar') { state.pd2PlataformaElegida = false; renderTabPedido2(); return; }
  if (action === 'usu-proyecto-estado') { cambiarEstadoProyectoPanel(id, el.dataset.estado); return; }
  if (action === 'usu-crear') { crearUsuarioPanel(); return; }
  if (action === 'usu-seleccionar') { seleccionarUsuarioPanel(id); return; }
  if (action === 'usu-guardar') { guardarUsuarioPanel(); return; }
  if (action === 'usu-recargar') { cargarPanelUsuarios(true); return; }
});

document.addEventListener('change', (e) => {
  // Panel Usuarios: rol/habilitado/accesos del usuario seleccionado — se
  // acumulan en state.usuEdit y recién van al server con "Guardar".
  if (/^hist-(proyecto|activo|canal|plataforma|estado|eje|creador)$/.test(e.target.id || '')) { state.historial[e.target.id.slice(5)] = e.target.value; render(); return; }
  // Pestaña Creatividades: filtros.
  if (e.target.id === 'crea-proyecto') { state.creaFiltro.proyecto = e.target.value; state.creaFiltro.campana = ''; renderTabCreatividades(); return; }
  if (e.target.id === 'crea-campana') { state.creaFiltro.campana = e.target.value; renderTabCreatividades(); return; }
  if (e.target.id === 'crea-vencidas') { state.creaFiltro.vencidas = e.target.checked; cargarCreatividades(); return; }
  if (e.target.id === 'usu-proyectos-solo-visibles') { state.usuProyectosSoloVisibles = e.target.checked; renderProyectosPanel(); return; }
  if (e.target.id === 'usu-uso-dias') { cargarUsoPanel(); return; }
  if (e.target.id === 'usu-edit-rol') { if (state.usuEdit) { state.usuEdit.rol = e.target.value; renderTabUsuarios(); } return; }
  if (e.target.id === 'usu-edit-habilitado') { if (state.usuEdit) state.usuEdit.habilitado = e.target.checked; return; }
  if (e.target.id === 'usu-edit-nombre') { if (state.usuEdit) state.usuEdit.nombre = e.target.value; return; }
  if (e.target.dataset && e.target.dataset.usuProyecto !== undefined) {
    toggleAccesoPanel(e.target.dataset.usuProyecto, e.target.dataset.usuActivo || '', e.target.checked);
    return;
  }
  if (e.target.id === 'pd-csv-archivo') {
    const archivo = e.target.files && e.target.files[0];
    if (archivo) subirCsv(archivo);
    e.target.value = '';
    return;
  }
  if (e.target.id === 'pd-csv-proyecto') { cambiarProyectoCsv(e.target.value); return; }
  if (e.target.id === 'pd-csv-activo') { state.pdActivoKey = e.target.value; cargarAudienciasPorActivo(e.target.value); return; }
  if (e.target.id === 'pd2-proyecto') { cambiarProyectoPd2(e.target.value); return; }
  if (e.target.id === 'pd2-activo') { cambiarActivoPd2(e.target.value); return; }
  if (e.target.id === 'pd2-tipo') {
    state.pd2TipoCodigo = e.target.value;
    // Tipo "Pautas Army" (codigo 'Y') -> precargar como audiencia principal
    // la que esté marcada tamaño "Army" para este activo (pedido del
    // usuario, 2026-09-11) — no pisa si el activo no tiene ninguna Army.
    if (e.target.value === 'Y') {
      const army = (state.pdAudiencias || []).find((a) => a.tamano === 'Army');
      if (army) {
        state.pd2AudienciaCodigo = army.codigo;
        const selAud = document.getElementById('pd2-audiencia');
        if (selAud) selAud.value = army.codigo;
        document.getElementById('pd2-otra-audiencia-wrap').hidden = true;
        renderCrucesV2();
      }
    }
    actualizarPresupuestoPreviewPd2();
    return;
  }
  if (e.target.id === 'pd2-eje') { state.pd2EjeCodigo = e.target.value; return; }
  if (e.target.id === 'pd2-audiencia') {
    state.pd2AudienciaCodigo = e.target.value;
    document.getElementById('pd2-otra-audiencia-wrap').hidden = e.target.value !== 'Otra';
    actualizarPresupuestoPreviewPd2();
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
  if (e.target.id === 'pd2-formato') actualizarNombresContenidoV2();
  if (e.target.id === 'pd2-formato') {
    // Antes de verificar/subir nada no se sabe si el material de cada pieza
    // es imagen o video (son varias, no una) — Reels queda habilitado acá,
    // el servidor lo bloquea igual si corresponde (mismo criterio que
    // materialEsImagenConocida() en v1, que tampoco lo sabe hasta verificar).
    const formatoInfo = formatosPd2Disponibles().find((f) => f.appsheet_valor === e.target.value);
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
  // Reparto en dos niveles (ver repartoResueltoPd2): el slider de Objetivo
  // mueve el % del total, el de Audiencia mueve el % DENTRO de ese objetivo.
  // Se maneja en 'change' (o sea al soltar) a propósito: re-renderizar en
  // 'input' cortaría el arrastre del slider.
  if (e.target.dataset.action === 'pd2-cruce-slider') {
    const filas = repartoResueltoPd2();
    const activas = filas.filter((f) => !f.excluida).map((f) => f.clave);
    const actual = {}; filas.forEach((f) => { actual[f.clave] = f.pct; });
    state.pd2Reparto = moverPesoConBloqueos(actual, activas, state.pd2RepartoBloqueados || {}, e.target.dataset.clave, Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)));
    renderCrucesV2();
    return;
  }
  if (e.target.dataset.action === 'pd2-excluir-cruce') {
    const clave = e.target.dataset.clave;
    const excluidos = Object.assign({}, state.pd2CombosExcluidos);
    if (e.target.checked) delete excluidos[clave];
    else excluidos[clave] = true;
    // No se puede dejar el pedido sin ningún cruce: tiene que quedar al
    // menos uno para poder pedirlo.
    const quedaAlguno = combosRepartoPd2().some((c) => !excluidos[c.clave]);
    if (!quedaAlguno) { e.target.checked = true; return; }
    const previas = {}; repartoResueltoPd2().forEach((f) => { previas[f.clave] = f.pct; });
    state.pd2CombosExcluidos = excluidos;
    if (!e.target.checked) delete (state.pd2RepartoBloqueados || {})[clave];
    // Se vuelve a cerrar en 100 respetando las bloqueadas: lo que libera (o
    // pide) la celda va a las libres, proporcional a lo que tenían.
    const activas = combosRepartoPd2().map((c) => c.clave).filter((k) => !excluidos[k]);
    state.pd2Reparto = cerrarConBloqueos(previas, activas, state.pd2RepartoBloqueados || {});
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
    const combos = combosDePiezaV2(idx);
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
    item.reparto = repartoConExclusionesV2(item, combos);
    return;
  }
  if (e.target.dataset.action === 'pd-reparto-slider') {
    const idx = Number(e.target.closest('[data-pieza-index]').dataset.piezaIndex);
    const item = state.pd2BulkItems[idx];
    const combos = combosDePiezaV2(idx);
    const valor = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));
    item.reparto = repartoTrasMoverSliderV2(item, combos, e.target.dataset.clave, valor);
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
  if (e.target.id === 'hist-buscar') { state.historial.busqueda = e.target.value; renderHistorialSheet(state.items.map((it) => buildVM(it))); return; }
  if (e.target.id === 'pd2-campana') { renderCampanasDatalistPd2(); actualizarNombresContenidoV2(); return; }
  if (/^pd2bulk\d+-linea$/.test(e.target.id || '')) { actualizarNombresContenidoV2(); return; }
  if (e.target.id === 'crea-texto') { state.creaFiltro.texto = e.target.value; renderTabCreatividades(); return; }
  if (e.target.id === 'usu-proyectos-filtro') {
    state.usuProyectosFiltro = e.target.value;
    const pos = e.target.selectionStart;
    renderProyectosPanel();
    const el = document.getElementById('usu-proyectos-filtro');
    if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    return;
  }
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
