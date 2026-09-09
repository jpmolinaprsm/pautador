const express = require('express');
const { google } = require('googleapis');
const env = require('../config/env');
const { loginPorEmail, resolverUsuarioValidado } = require('../services/usuarios');

const router = express.Router();

// Creado una sola vez: generateAuthUrl/getToken/verifyIdToken no dependen
// de nada por-request.
const oauth2Client = env.googleClientId
  ? new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, env.googleRedirectUri)
  : null;

// Este router se monta en la RAÍZ (no bajo /api, ver server.js): /auth/google
// y /auth/google/callback son navegaciones de página completa (Google
// redirige el browser, no un fetch), y el Redirect URI de ese callback está
// registrado tal cual en Google Cloud Console — moverlo bajo /api rompería
// el login. Los otros dos endpoints (JSON, consumidos por fetch desde el
// front) escriben su propio prefijo /api acá adentro.

// GET /api/auth/config — la pantalla de Login la consulta al arrancar para
// decidir si mostrar "Continuar con Google" o el formulario de mail de
// respaldo (ver env.js: sin GOOGLE_CLIENT_ID no hay login con Google).
router.get('/api/auth/config', (req, res) => {
  res.json({ googleHabilitado: !!oauth2Client, dominio: env.authDominio });
});

// GET /auth/google — arranca el login (fuera de /api a propósito: es una
// navegación de página completa, no un fetch — Google redirige acá y de
// acá se redirige de vuelta al browser, no tiene sentido bajo /api).
router.get('/auth/google', (req, res) => {
  if (!oauth2Client) return res.status(503).send('Login con Google no está configurado en este server.');
  const url = oauth2Client.generateAuthUrl({
    scope: ['openid', 'email', 'profile'],
    hd: env.authDominio, // filtra la lista de cuentas que Google muestra — no es seguridad (se revalida abajo)
    prompt: 'select_account',
  });
  res.redirect(url);
});

// GET /auth/google/callback — Google vuelve acá con ?code=. Se cambia por
// tokens, se verifica el id_token (firma + audiencia) y recién ahí se
// confía el email — el mismo resolverUsuarioValidado que usa el formulario
// de respaldo decide si ese email puede entrar.
router.get('/auth/google/callback', async (req, res) => {
  const volverConError = (msg) => res.redirect('/?loginError=' + encodeURIComponent(msg));
  if (!oauth2Client) return volverConError('Login con Google no está configurado en este server.');
  try {
    if (req.query.error || !req.query.code) {
      throw new Error('Cancelaste el login con Google.');
    }
    const { tokens } = await oauth2Client.getToken(String(req.query.code));
    const ticket = await oauth2Client.verifyIdToken({ idToken: tokens.id_token, audience: env.googleClientId });
    const payload = ticket.getPayload();
    if (!payload.email_verified) throw new Error('Tu mail de Google todavía no está verificado.');
    const usuario = await resolverUsuarioValidado(payload.email, payload.name);
    res.redirect('/?uid=' + encodeURIComponent(usuario.id));
  } catch (err) {
    console.error('[auth/google/callback]', err.message);
    volverConError(err.message || 'No se pudo iniciar sesión con Google.');
  }
});

// POST /api/auth/login — formulario de mail de respaldo, sin pasar por
// Google (ver GET /api/auth/config). Body: { email }
router.post('/api/auth/login', async (req, res) => {
  try {
    const usuario = await loginPorEmail(req.body.email);
    res.json(usuario);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
