const express = require('express');
const { google } = require('googleapis');
const env = require('../config/env');
const { loginPorEmail, resolverUsuarioValidado, serializarUsuario } = require('../services/usuarios');
const { registrar } = require('../services/eventosUso');

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
    registrar({ usuario_id: usuario.id, usuario_nombre: usuario.nombre, rol: usuario.rol, accion: 'Login con Google', ruta: 'GET /auth/google/callback', detalle: payload.email });
    res.redirect('/?uid=' + encodeURIComponent(usuario.id));
  } catch (err) {
    console.error('[auth/google/callback]', err.message);
    registrar({ accion: 'Login con Google', ruta: 'GET /auth/google/callback', resultado: 'error', error: err.message });
    volverConError(err.message || 'No se pudo iniciar sesión con Google.');
  }
});

// GET /auth/gmail — autorización ÚNICA de la casilla que manda los avisos
// (Gmail API, scope gmail.send). Se entra una vez con esa cuenta; el
// callback muestra el refresh token para pegar en GMAIL_REFRESH_TOKEN.
// Mismo cliente OAuth del login, con su propio Redirect URI (registrar
// /auth/gmail/callback en Google Cloud Console).
router.get('/auth/gmail', (req, res) => {
  if (!env.googleClientId) return res.status(503).send('Login con Google no está configurado en este server.');
  const cliente = new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, env.gmailRedirectUri);
  res.redirect(cliente.generateAuthUrl({
    scope: ['https://www.googleapis.com/auth/gmail.send', 'email'],
    access_type: 'offline',
    prompt: 'consent',
    hd: env.authDominio,
  }));
});

router.get('/auth/gmail/callback', async (req, res) => {
  const pagina = (titulo, cuerpo) => res.type('html').send(`<!doctype html><meta charset="utf-8"><title>PAUTADOR — Gmail</title><body style="font-family:system-ui;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.5"><h2>${titulo}</h2>${cuerpo}</body>`);
  try {
    if (req.query.error || !req.query.code) throw new Error('Cancelaste la autorización.');
    const cliente = new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, env.gmailRedirectUri);
    const { tokens } = await cliente.getToken(String(req.query.code));
    if (!tokens.refresh_token) throw new Error('Google no devolvió refresh token — volvé a entrar a /auth/gmail (pide el permiso de nuevo).');
    let cuenta = '';
    try {
      cliente.setCredentials(tokens);
      const info = await google.oauth2({ version: 'v2', auth: cliente }).userinfo.get();
      cuenta = info.data.email || '';
    } catch (e) { /* solo informativo */ }
    pagina('Casilla autorizada' + (cuenta ? `: ${cuenta}` : ''),
      '<p>Pegá esto en Railway → Variables como <code>GMAIL_REFRESH_TOKEN</code> y hacé Deploy:</p>'
      + `<pre style="background:#f4f4f4;padding:12px;border-radius:6px;word-break:break-all;white-space:pre-wrap">${tokens.refresh_token}</pre>`
      + '<p>Después probá con <code>GET /api/admin/diagnostico-smtp</code> (tiene que decir <code>ok: true</code>) y <code>POST /api/admin/presupuestos/enviar</code>.</p>'
      + '<p style="color:#666;font-size:13px">Este token no vence mientras no le saques el permiso a PAUTADOR en la cuenta de Google. No lo compartas.</p>');
  } catch (err) {
    console.error('[auth/gmail/callback]', err.message);
    pagina('No se pudo autorizar', `<p>${err.message}</p><p><a href="/auth/gmail">Probar de nuevo</a></p>`);
  }
});

// POST /api/auth/login — formulario de mail de respaldo, sin pasar por
// Google (ver GET /api/auth/config). Body: { email }
router.post('/api/auth/login', async (req, res) => {
  try {
    const usuario = await loginPorEmail(req.body.email);
    registrar({ usuario_id: usuario.id, usuario_nombre: usuario.nombre, rol: usuario.rol, accion: 'Login por mail', ruta: 'POST /api/auth/login', detalle: String(req.body.email || '') });
    res.json(serializarUsuario(usuario));
  } catch (err) {
    registrar({ accion: 'Login por mail', ruta: 'POST /api/auth/login', detalle: String((req.body || {}).email || ''), resultado: 'error', error: err.message });
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
