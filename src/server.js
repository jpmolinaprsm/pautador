const express = require('express');
const path = require('path');
const env = require('./config/env');
const { usuarioActual } = require('./middleware/usuarioActual');
const configRoutes = require('./routes/config');
const pendientesRoutes = require('./routes/pendientes');
const pautaRoutes = require('./routes/pauta');
const itemsRoutes = require('./routes/items');
const publicacionesRoutes = require('./routes/publicaciones');
const pedidosRoutes = require('./routes/pedidos');
const usuariosRoutes = require('./routes/usuarios');
const authRoutes = require('./routes/auth');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
// Preview de los materiales subidos a mano (ver routes/pedidos.js —
// POST /api/material/subir). Viven al lado de Tablas/, no adentro de
// public/, así que necesitan su propio static — solo sirve para mostrar la
// miniatura en el navegador, Meta nunca los pide por acá (los lee del disco
// directo, ver services/material.js).
app.use('/uploads', express.static(path.join(__dirname, '..', '..', 'uploads')));
app.use('/api', usuarioActual);
app.use('/api', configRoutes);
app.use('/api', pendientesRoutes);
app.use('/api', pautaRoutes);
app.use('/api', itemsRoutes);
app.use('/api', publicacionesRoutes);
app.use('/api', pedidosRoutes);
app.use('/api', usuariosRoutes);
// Sin prefijo /api a propósito: auth.js mezcla navegaciones de página
// completa (/auth/google...) con endpoints JSON (que ya traen su propio
// /api/auth/... adentro) — ver el comentario al principio de ese archivo.
app.use(authRoutes);

app.listen(env.port, () => {
  console.log(`PAUTADOR corriendo en http://localhost:${env.port} (fuente de datos: ${env.dataSource})`);
});
