const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { crearPedido } = require('../services/pedidos');
const { verificarMaterial, clasificar } = require('../services/material');
const { requireRol } = require('../middleware/usuarioActual');

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

// POST /api/pedidos — "Pedido de Pauta" (PM/Cuentas). Entra directo a
// "Validación de Anuncios" — no hay cola intermedia de pedidos sin procesar.
router.post('/pedidos', requireRol('pm_cuentas', 'administrador'), async (req, res) => {
  try {
    const resultado = await crearPedido(req.body, req.usuario);
    res.json(resultado);
  } catch (err) {
    console.error('[crear-pedido]', err.message);
    res.status(err.status || 500).json({ error: 'No se pudo crear el pedido', detalle: err.message });
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
      await crearPedido(filas[i], req.usuario, { soloValidar: true, publicar });
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
      const resultado = await crearPedido(filas[i], req.usuario);
      resultados.push({ index: i, ok: true, correlationId: resultado.correlationId, codigo: resultado.codigo });
    } catch (err) {
      resultados.push({ index: i, ok: false, error: err.message });
    }
  }
  res.json({ resultados });
});

// POST /api/anuncios/crear-directo — "Crear Anuncios" (Implementadores):
// el camino alternativo. Arranca desde cero (sin pedido previo) y PUBLICA EN
// META en el mismo request, sin pasar por Validación de Anuncios: quien carga
// acá ya es quien valida. Por Validación solo pasan los pedidos de PM/Cuentas.
router.post('/anuncios/crear-directo', requireRol('implementador', 'administrador'), async (req, res) => {
  try {
    const resultado = await crearPedido(req.body, req.usuario, { publicar: true });
    res.json(resultado);
  } catch (err) {
    console.error('[crear-directo]', err.message);
    res.status(err.status || 500).json({ error: 'No se pudo crear el anuncio', detalle: err.message });
  }
});

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
    res.json({
      material: `uploads/${req.file.filename}`,
      tipo,
      contentType: req.file.mimetype,
      bytes: req.file.size,
      previewUrl: tipo === 'imagen' ? `/uploads/${req.file.filename}` : '',
    });
  });
});

module.exports = router;
