// dotenv busca ".env" en process.cwd() por default — pero este server se
// puede lanzar desde otro directorio (ver .claude/launch.json, que no fija
// cwd), así que apuntamos siempre al .env DENTRO de pautador/, sin importar
// desde dónde se arrancó node.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const env = {
  port: process.env.PORT || 3000,
  dataSource: process.env.DATA_SOURCE || 'mock', // 'mock' (Excel local), 'google' (Sheets real) o 'supabase' (Postgres real)
  mockDataDir: process.env.MOCK_DATA_DIR || '../Tablas',
  sheetId: process.env.GOOGLE_SHEET_ID || '',
  credentialsPath:
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './credentials/service-account.json',

  // DATA_SOURCE=supabase — service_role (NUNCA la anon key: este server
  // necesita saltarse Row Level Security para leer/escribir todas las
  // tablas, es un backend de confianza, no un cliente de browser).
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // 'mock' (default) = confirmar simula, genera IDs MOCK- y no toca Meta.
  // 'real' = llama de verdad a la Graph API (todo en PAUSED, nunca activa).
  metaMode: process.env.META_MODE || 'mock',
  metaAccessToken: process.env.META_ACCESS_TOKEN || '',
  metaGraphApiVersion: process.env.META_GRAPH_API_VERSION || 'v24.0',

  // Solo entran mails de este dominio (login con Google, ver routes/auth.js
  // y services/usuarios.js resolverUsuarioValidado).
  authDominio: (process.env.AUTH_DOMINIO || 'prosumia.la').toLowerCase(),

  // OAuth Client "web" de Google Cloud Console. Si GOOGLE_CLIENT_ID no está
  // seteado, el login con Google queda deshabilitado y la pantalla de Login
  // cae al formulario de mail (útil para levantar el server local sin
  // depender de Google) — ver GET /api/auth/config.
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',
};

if (env.dataSource === 'google' && !env.sheetId) {
  console.warn(
    '[env] DATA_SOURCE=google pero GOOGLE_SHEET_ID no está definido — las lecturas van a fallar.'
  );
}

if (env.dataSource === 'mock') {
  console.log(`[env] Modo mock activo — leyendo Excel desde: ${env.mockDataDir}`);
}

if (env.dataSource === 'supabase' && (!env.supabaseUrl || !env.supabaseServiceRoleKey)) {
  console.warn(
    '[env] DATA_SOURCE=supabase pero falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY — las lecturas van a fallar.'
  );
}
if (env.dataSource === 'supabase') {
  console.log('[env] Modo Supabase activo — leyendo/escribiendo Postgres real.');
}

if (env.metaMode === 'real' && !env.metaAccessToken) {
  console.warn('[env] META_MODE=real pero META_ACCESS_TOKEN no está definido — las llamadas a Meta van a fallar.');
}
console.log(`[env] Meta: modo ${env.metaMode}${env.metaMode === 'real' ? ' (¡esto toca la cuenta de verdad, aunque siempre en PAUSED!)' : ''}`);

module.exports = env;
