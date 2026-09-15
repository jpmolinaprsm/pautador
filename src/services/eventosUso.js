// Registro de uso (usuario, 2026-09-15: "medir su uso / trackear logs de
// usuarios", solo lo ve el superadmin en Panel Usuarios → Uso). Se escribe
// en Supabase (tabla eventos_uso, migración 014) desde el servidor, en dos
// vías:
//   - registrarRequests: middleware que anota toda request que CAMBIA algo
//     (POST/PUT/DELETE bajo /api) con usuario, etiqueta legible, proyecto/
//     modo/canal de la sesión, un resumen del body, el código o id que
//     devolvió, resultado y duración. No frena ni afecta la respuesta.
//   - registrar(): llamadas explícitas (login).
// Si la tabla no existe todavía, avisa una vez y sigue sin registrar.
const { insertarFila, readTable } = require('./dataSource');

// Etiquetas legibles por ruta (método + path sin ids). Lo que no está acá
// se guarda con la ruta cruda.
const ETIQUETAS = [
  [/^POST \/uso\/entrada$/, 'Entró al app'],
  [/^POST \/pedidos$/, 'Pedido creado'],
  [/^POST \/pedidos\/lote$/, 'Pedidos por CSV'],
  [/^POST \/material\/subir$/, 'Subió un archivo'],
  [/^POST \/pauta\/[^/]+\/confirmar$/, 'Confirmó en Historial'],
  [/^POST \/pauta\/[^/]+\/presupuesto$/, 'Cambió presupuesto'],
  [/^POST \/pauta\/[^/]+\/celda-hecha$/, 'Marcó conjunto hecho'],
  [/^POST \/pauta\/[^/]+\/marcar-manual$/, 'Marcó hecho a mano'],
  [/^POST \/pauta\/[^/]+\/desestimar$/, 'Desestimó'],
  [/^POST \/pauta\/[^/]+\/devolver$/, 'Devolvió al PM'],
  [/^POST \/pauta\/[^/]+\/editar$/, 'Corrigió un contenido'],
  [/^POST \/historial\/[^/]+\/pautado$/, 'Marcó pautado'],
  [/^POST \/admin\/usuarios$/, 'Alta de usuario'],
  [/^PUT \/admin\/usuarios\/[^/]+$/, 'Editó usuario/accesos'],
  [/^PUT \/admin\/proyectos\/[^/]+$/, 'Prendió/apagó proyecto'],
  [/^POST \/activos$/, 'Alta de activo'],
  [/^POST \/audiencias$/, 'Alta de audiencia'],
  [/^POST \/usuarios\/pedir-asignacion$/, 'Pidió asignación de proyectos'],
  [/^POST \/admin\/presupuestos\/enviar$/, 'Mandó el mail de presupuesto'],
  [/^POST \/admin\/insumos\/exportar$/, 'Volcó tablas a la planilla'],
  [/^POST \/ingesta\//, 'Ingesta'],
];
// Ruido que no vale la pena guardar (validaciones y previews).
// (el login lo registra auth.js con el usuario resuelto — acá no hay header)
const IGNORAR = [/^POST \/pedidos\/validar-lote$/, /^POST \/material\/verificar$/, /^POST \/publicaciones\/resolver$/, /^POST \/auth\/login$/];

let avisado = false;
async function registrar(evento) {
  try {
    await insertarFila('eventos_uso', {
      usuario_id: evento.usuario_id || '',
      usuario_nombre: evento.usuario_nombre || '',
      rol: evento.rol || '',
      accion: evento.accion || evento.ruta || '',
      ruta: evento.ruta || '',
      proyecto: evento.proyecto || '',
      modo: evento.modo || '',
      canal: evento.canal || '',
      referencia: String(evento.referencia || '').slice(0, 200),
      detalle: String(evento.detalle || '').slice(0, 500),
      resultado: evento.resultado || 'ok',
      error: String(evento.error || '').slice(0, 500),
      duracion_ms: Number.isFinite(evento.duracion_ms) ? Math.round(evento.duracion_ms) : null,
    });
  } catch (err) {
    if (!avisado) { avisado = true; console.warn('[uso] no pude registrar (¿falta correr supabase/migration_014_eventos_uso.sql?):', err.message); }
  }
}

function resumenBody(body) {
  if (!body || typeof body !== 'object') return '';
  const partes = [];
  const b = body;
  if (Array.isArray(b.filas)) partes.push(`${b.filas.length} contenido(s)`);
  if (b.campana) partes.push(`campaña "${String(b.campana).slice(0, 60)}"`);
  if (b.plataforma) partes.push(String(b.plataforma));
  if (b.objetivo) partes.push(Array.isArray(b.objetivo) ? b.objetivo.join('+') : String(b.objetivo));
  if (b.visibilidad) partes.push(b.visibilidad === 'PUBLICO' ? 'Público' : 'Dark');
  if (b.estado) partes.push(`estado ${b.estado}`);
  if (b.motivo) partes.push(`motivo "${String(b.motivo).slice(0, 80)}"`);
  if (b.presupuesto) partes.push(`$${b.presupuesto}`);
  if (b.email) partes.push(String(b.email));
  if (b.rol) partes.push(`rol ${b.rol}`);
  if (b.canal) partes.push(String(b.canal));
  return partes.join(' · ');
}

function etiqueta(clave) {
  const e = ETIQUETAS.find(([re]) => re.test(clave));
  return e ? e[1] : '';
}

// Middleware para app.use('/api', ...) DESPUÉS de usuarioActual.
function registrarRequests(req, res, next) {
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return next();
  const clave = `${req.method} ${req.path.split('?')[0]}`;
  if (IGNORAR.some((re) => re.test(clave))) return next();
  const t0 = Date.now();
  let cuerpoRespuesta = null;
  const jsonOriginal = res.json.bind(res);
  res.json = (data) => { cuerpoRespuesta = data; return jsonOriginal(data); };
  res.on('finish', () => {
    const u = req.usuario || {};
    const r = cuerpoRespuesta && typeof cuerpoRespuesta === 'object' ? cuerpoRespuesta : {};
    const esError = res.statusCode >= 400;
    const referencia = r.codigo || r.correlationId || (req.params && req.params.id) || (req.path.match(/\/pauta\/([^/]+)/) || [])[1] || (req.path.match(/\/admin\/(?:usuarios|proyectos)\/([^/]+)/) || [])[1] || '';
    const detalleExtra = Array.isArray(r.resultados) ? ` → ${r.resultados.filter((x) => x.ok).length} ok, ${r.resultados.filter((x) => !x.ok).length} con error` : (r.publicado === false && r.motivo ? ' → a mano' : '');
    registrar({
      usuario_id: u.id, usuario_nombre: u.nombre, rol: u.rol,
      accion: etiqueta(clave), ruta: clave,
      proyecto: (req.body && req.body.proyecto) || req.proyectoActivo || '',
      modo: req.modoActivo || '', canal: req.ecosistemaActivo || '',
      referencia: decodeURIComponent(String(referencia)),
      detalle: resumenBody(req.body) + detalleExtra,
      resultado: esError ? 'error' : 'ok',
      error: esError ? (r.detalle || r.error || `HTTP ${res.statusCode}`) : '',
      duracion_ms: Date.now() - t0,
    });
  });
  next();
}

// Resumen para Panel Usuarios → Uso (superadmin). dias: ventana.
async function resumenUso(dias = 30) {
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const hoy = new Date().toISOString().slice(0, 10);
  const hace7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const todos = (await readTable('eventos_uso')).filter((e) => e.fecha && e.fecha >= desde).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const porUsuario = new Map();
  todos.forEach((e) => {
    const k = e.usuario_id || '(sin usuario)';
    if (!porUsuario.has(k)) porUsuario.set(k, { usuario_id: k, nombre: e.usuario_nombre || k, rol: e.rol || '', ultimo: e.fecha, acciones: 0, acciones7: 0, pedidos: 0, pedidos7: 0, errores: 0, errores7: 0 });
    const u = porUsuario.get(k);
    u.acciones += 1;
    const es7 = e.fecha >= hace7;
    if (es7) u.acciones7 += 1;
    const esPedido = /Pedido/.test(e.accion || '') && e.resultado === 'ok';
    if (esPedido) { u.pedidos += 1; if (es7) u.pedidos7 += 1; }
    if (e.resultado === 'error') { u.errores += 1; if (es7) u.errores7 += 1; }
    if (e.fecha > u.ultimo) u.ultimo = e.fecha;
  });
  const usuariosDe = (desdeIso) => new Set(todos.filter((e) => e.fecha >= desdeIso && e.usuario_id).map((e) => e.usuario_id)).size;
  const porDia = {};
  todos.forEach((e) => { const d = String(e.fecha).slice(0, 10); if (!porDia[d]) porDia[d] = { dia: d, usuarios: new Set(), acciones: 0, pedidos: 0, errores: 0 }; porDia[d].acciones += 1; if (e.usuario_id) porDia[d].usuarios.add(e.usuario_id); if (/Pedido/.test(e.accion || '') && e.resultado === 'ok') porDia[d].pedidos += 1; if (e.resultado === 'error') porDia[d].errores += 1; });
  const porProyecto = {};
  todos.filter((e) => e.proyecto && /Pedido/.test(e.accion || '') && e.resultado === 'ok').forEach((e) => { porProyecto[e.proyecto] = (porProyecto[e.proyecto] || 0) + 1; });
  return {
    dias,
    totales: {
      usuariosHoy: usuariosDe(hoy), usuarios7: usuariosDe(hace7), usuarios30: usuariosDe(desde),
      acciones7: todos.filter((e) => e.fecha >= hace7).length,
      pedidos7: todos.filter((e) => e.fecha >= hace7 && /Pedido/.test(e.accion || '') && e.resultado === 'ok').length,
      errores7: todos.filter((e) => e.fecha >= hace7 && e.resultado === 'error').length,
    },
    porUsuario: [...porUsuario.values()].sort((a, b) => (b.ultimo > a.ultimo ? 1 : -1)),
    porDia: Object.values(porDia).map((d) => ({ ...d, usuarios: d.usuarios.size })).sort((a, b) => (a.dia < b.dia ? 1 : -1)).slice(0, 30),
    porProyecto: Object.entries(porProyecto).map(([proyecto, pedidos]) => ({ proyecto, pedidos })).sort((a, b) => b.pedidos - a.pedidos),
    ultimos: todos.slice(0, 200),
  };
}

module.exports = { registrar, registrarRequests, resumenUso };
