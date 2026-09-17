const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { imageSize } = require('image-size');
const { crearPedido } = require('../services/pedidos');
const { verificarMaterial, clasificar } = require('../services/material');
const storage = require('../services/storage');
const { requireRol } = require('../middleware/usuarioActual');

// Máximo por archivo del bucket "creatividades" (límite del plan de Supabase).
const STORAGE_MAX_BYTES = 50 * 1024 * 1024;

const router = express.Router();

// Los archivos subidos quedan en Automatizaciones/uploads/ — la MISMA carpeta
// raíz que ya usan los materiales locales (ver material.js: resolverBytes()
// resuelve una ruta que no es URL relativa a esa carpeta, no a pautador/).
// Así un material "subido" queda guardado con la misma convención que ya
// existía para archivos locales — no hizo falta tocar esa lógica.
const DIR_UPLOADS = path.resolve(__dirname, '..', '..', '..', 'uploads');
fs.mkdirSync(DIR_UPLOADS, { recursive: true });
const TAMANO_MAXIMO_MB = 250; // de sobra para un video vertical corto

const upload = multer({
  storage: multer.diskStorage({
    destination: DIR_UPLOADS,
    // Nombre propio, no el original: evita colisiones entre dos personas
    // subiendo "foto.jpg" a la vez, y de paso cierra cualquier intento de
    // path traversal por el nombre del archivo (solo se toma la extensión).
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: TAMANO_MAXIMO_MB * 1024 * 1024 },
});

// POST /api/pedidos — "Pedido de Anuncios". Publica en Meta en el mismo
// request (ver crearPedido) — no hay cola intermedia. El Implementador
// también entra por acá ahora (antes usaba /anuncios/crear-directo con
// presupuesto manual, "Crear Anuncios" quedó redundante — ver TABS_POR_ROL
// en app.js): mismo presupuesto automático por escala que PM/Cuentas.
router.post('/pedidos', requireRol('pm_cuentas', 'implementador', 'administrador'), async (req, res) => {
  try {
    // enCola (2026-09-17): valida y guarda, y devuelve sin esperar a Meta —
    // el envío sigue de fondo (services/colaEnvio.js) y se sigue por
    // GET /api/pedidos/envios.
    const resultado = await crearPedido(req.body, req.usuario, { modo: req.modoActivo, enCola: req.body.enCola === true });
    res.json(resultado);
  } catch (err) {
    console.error('[crear-pedido]', err.message);
    res.status(err.status || 500).json({ error: 'No se pudo crear el pedido', detalle: err.message });
  }
});

// GET /api/pedidos/envios — lo que este usuario mandó a la cola: en cola /
// creando / listo / error. Trae lo que sigue en proceso y lo terminado en
// la última hora (así el cuadro sobrevive a recargar la página).
router.get('/pedidos/envios', requireRol('pm_cuentas', 'implementador', 'administrador'), async (req, res) => {
  try {
    const { readTable } = require('../services/dataSource');
    const [pautas, matriz] = await Promise.all([readTable('cola_pautas'), readTable('matriz_distribucion')]);
    const hace1h = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const mios = new Set([req.usuario.email, req.usuario.nombre].filter(Boolean));
    const publicadas = new Set(matriz.filter((c) => c.adset_id || c.ad_id).map((c) => c.correlation_id));
    const manuales = new Set(matriz.filter((c) => c.estado_celda === 'manual_pendiente').map((c) => c.correlation_id));
    const salida = pautas
      .filter((p) => p.envio && mios.has(p.creador) && (p.envio === 'en_cola' || p.envio === 'creando' || (p.envio_actualizado || '') >= hace1h))
      .map((p) => ({
        correlation_id: p.correlation_id, codigo: p.codigo, contenido: p.contenido, campana: p.campana,
        proyecto: p.proyecto, activo: p.activo, plataforma: p.plataforma, modo: p.modo,
        envio: p.envio, envio_error: p.envio_error || '', envio_actualizado: p.envio_actualizado || '',
        creado: p.correlation_id.replace('PEDIDO-', ''),
        publicado: publicadas.has(p.correlation_id),
        manual: manuales.has(p.correlation_id) || (p.envio === 'listo' && !publicadas.has(p.correlation_id)),
      }))
      .sort((a, b) => (a.creado < b.creado ? -1 : 1));
    res.json(salida);
  } catch (err) {
    console.error('[pedidos/envios]', err.message);
    res.status(500).json({ error: 'No se pudo leer la cola de envío', detalle: err.message });
  }
});

// POST /api/pedidos/validar-lote — valida cada fila SIN crear nada (mismo
// crearPedido de siempre, en modo soloValidar: corre TODAS las
// validaciones — campos obligatorios, material real, reparto — y corta
// antes del primer write). Una fila mal armada no corta la validación de
// las demás. La usa la carga por CSV (publicar=false siempre) y el preview
// de "Pedido de Anuncios"/"Crear Anuncios" bulk (publicar según el modo),
// para que el aviso de "falta el Copy" salga al pedir el preview y no
// recién al confirmar, con el formulario ya bloqueado.
router.post('/pedidos/validar-lote', requireRol('pm_cuentas', 'implementador', 'administrador'), async (req, res) => {
  const filas = Array.isArray(req.body.filas) ? req.body.filas : [];
  const publicar = !!req.body.publicar;
  const resultados = [];
  for (let i = 0; i < filas.length; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await crearPedido(filas[i], req.usuario, { soloValidar: true, publicar, modo: req.modoActivo });
      resultados.push({ index: i, ok: true });
    } catch (err) {
      resultados.push({ index: i, ok: false, error: err.message });
    }
  }
  res.json({ resultados });
});

// POST /api/pedidos/lote — crea de verdad las filas del CSV (mismo
// crearPedido real, una por una) — cada fila reporta su propio resultado,
// si una falla no aborta las demás (puede haber cambiado algo entre el
// preview y la confirmación).
router.post('/pedidos/lote', requireRol('pm_cuentas', 'administrador'), async (req, res) => {
  const filas = Array.isArray(req.body.filas) ? req.body.filas : [];
  const resultados = [];
  for (let i = 0; i < filas.length; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const resultado = await crearPedido(filas[i], req.usuario, { modo: req.modoActivo });
      resultados.push({ index: i, ok: true, correlationId: resultado.correlationId, codigo: resultado.codigo });
    } catch (err) {
      resultados.push({ index: i, ok: false, error: err.message });
    }
  }
  res.json({ resultados });
});

// (2026-09-12) Se sacó POST /api/anuncios/crear-directo — la pestaña "Crear
// Anuncios" (publicar directo con presupuesto a mano) era redundante con el
// Pedido Automatizado. Todo entra por POST /api/pedidos.

// POST /api/material/verificar — chequea el link del material antes de
// crear nada: que se pueda abrir, que sea público y que sea imagen o video.
// Alimenta el preview que confirma quien pide la pauta. No sube nada a Meta
// ni baja el archivo entero (corta apenas lee los headers).
router.post('/material/verificar', requireRol('pm_cuentas', 'implementador', 'administrador'), async (req, res) => {
  try {
    const datos = await verificarMaterial(req.body.material);
    res.json(datos);
  } catch (err) {
    res.status(400).json({ error: 'El material no sirve', detalle: err.message });
  }
});

// POST /api/material/subir — sube un archivo local (imagen o video) como
// material de la pieza, alternativa a pegar un link de Drive/Dropbox. Queda
// en uploads/ y se referencia como archivo local — mismo camino que ya usa
// resolverBytes() en material.js para material que no es una URL, así que
// no hizo falta tocar esa lógica: el resto del pipeline (subir a Meta,
// crear el creative) no distingue "subido" de "ya estaba en el server".
router.post('/material/subir', requireRol('pm_cuentas', 'implementador', 'administrador'), (req, res) => {
  upload.single('archivo')(req, res, (err) => {
    if (err) {
      const detalle = err.code === 'LIMIT_FILE_SIZE'
        ? `El archivo pesa más de ${TAMANO_MAXIMO_MB} MB.`
        : err.message;
      return res.status(400).json({ error: 'No se pudo subir el archivo', detalle });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No se pudo subir el archivo', detalle: 'Elegí un archivo.' });
    }
    const tipo = clasificar(req.file.mimetype);
    if (!tipo) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({
        error: 'El material no sirve',
        detalle: `El archivo no es una imagen ni un video (es "${req.file.mimetype}").`,
      });
    }
    // Medidas de la imagen (el front las usa para avisar/bloquear según las
    // specs de Placement ANTES de confirmar — hasta ahora eso se descubría
    // recién al subir a Meta). Si el parser no reconoce el formato, se sigue
    // sin medidas: el front avisa que no pudo medir, no frena nada.
    let width = null;
    let height = null;
    if (tipo === 'imagen') {
      try {
        const dim = imageSize(fs.readFileSync(req.file.path));
        width = dim.width;
        height = dim.height;
      } catch (e) { /* sin medidas */ }
    }

    // CREATIVIDADES_STORAGE=1: el archivo va al bucket privado de Supabase
    // (90 días, etiquetado al crear el pedido) y se referencia como
    // "creatividad:<id>"; el disco solo se usa de paso. Con 0, sigue el
    // camino viejo (../uploads) tal cual.
    if (storage.habilitado()) {
      if (req.file.size > STORAGE_MAX_BYTES) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: 'No se pudo subir el archivo', detalle: `El archivo pesa más de ${STORAGE_MAX_BYTES / 1024 / 1024} MB (máximo del storage).` });
      }
      return storage.subirCreatividad({
        buffer: fs.readFileSync(req.file.path),
        nombreOriginal: req.file.originalname,
        contentType: req.file.mimetype,
        width,
        height,
        origen: 'subida',
        subidoPor: req.usuario ? req.usuario.nombre : '',
      }).then((c) => {
        fs.unlink(req.file.path, () => {});
        res.json({ material: `creatividad:${c.id}`, tipo, contentType: req.file.mimetype, bytes: req.file.size, previewUrl: c.previewUrl, width, height, expira_en: c.expira_en });
      }).catch((e) => {
        fs.unlink(req.file.path, () => {});
        res.status(500).json({ error: 'No se pudo guardar el archivo en el storage', detalle: e.message });
      });
    }

    res.json({
      material: `uploads/${req.file.filename}`,
      tipo,
      contentType: req.file.mimetype,
      bytes: req.file.size,
      // El video también tiene preview: el mock lo muestra con <video> y el
      // front le lee videoWidth/videoHeight para las specs.
      previewUrl: `/uploads/${req.file.filename}`,
      width,
      height,
    });
  });
});

module.exports = router;
