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
  // Ruta de la clave de la Service Account. Si viene relativa, se resuelve
  // contra la carpeta pautador/ (no contra process.cwd()): el server puede
  // arrancar desde otro directorio (launch.json del panel, Railway) y con
  // la ruta relativa no encontraba la clave — sin hoja de códigos ni Tareas.
  credentialsPath: require('path').resolve(
    __dirname, '..', '..',
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './credentials/service-account.json',
  ),
  // Alternativa a credentialsPath para plataformas sin filesystem persistente
  // (Railway): pegar el JSON entero de la Service Account en esta variable.
  // Si está seteada, gana sobre credentialsPath (ver services/sheets.js).
  credentialsJson: (() => {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON || '';
    if (!raw.trim()) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      console.warn('[env] GOOGLE_SERVICE_ACCOUNT_KEY_JSON no es JSON válido:', err.message);
      return null;
    }
  })(),

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
  // 1 (default, "por ahora" — pedido del usuario 2026-09-11): cualquier mail
  // del dominio entra solo, sin accesos, hasta que un admin se los asigne
  // en Panel Usuarios. 0: solo entra quien un admin dio de alta antes.
  authAltaLibre: process.env.AUTH_ALTA_LIBRE !== '0',

  // OAuth Client "web" de Google Cloud Console. Si GOOGLE_CLIENT_ID no está
  // seteado, el login con Google queda deshabilitado y la pantalla de Login
  // cae al formulario de mail (útil para levantar el server local sin
  // depender de Google) — ver GET /api/auth/config.
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',

  // --- Ingesta de las hojas salida_manual_* (punto 3 del plan) ---
  // Spreadsheet con las 3 hojas (chaco/catamarca/chubut). Lo lee el polling
  // (si hay Service Account) y lo cruza el webhook para no aceptar filas de
  // cualquier planilla.
  ingestaSheetId: process.env.INGESTA_SHEET_ID || '',
  // Secreto que tiene que mandar el Apps Script en el header x-ingesta-secret.
  ingestaSecret: process.env.INGESTA_SECRET || '',
  // Cada cuántos minutos revisa las hojas solo. 0 = apagado (solo webhook /
  // botón). Necesita la Service Account (GOOGLE_SERVICE_ACCOUNT_KEY_PATH).
  ingestaMinutos: Number(process.env.INGESTA_MINUTOS || 0),
  // Una fila con Fecha más vieja que esto no se pauta (freno para la primera
  // pasada / historial del Sheet). 0 = sin freno.
  ingestaMaxDias: Number(process.env.INGESTA_MAX_DIAS === undefined ? 2 : process.env.INGESTA_MAX_DIAS),
  // Estado con el que la ingesta crea campaña/adset/ad en Meta. PAUSED por
  // defecto; ACTIVE = gasto real inmediato — se cambia solo a pedido del
  // usuario. Ningún otro origen (pedido/csv) lo usa.
  ingestaEstadoInicial: (process.env.INGESTA_ESTADO_INICIAL || 'PAUSED').toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',

  // --- Creatividades en Supabase Storage (punto 5 del plan) ---
  // Apagado hasta correr migration_006 (tabla creatividades): con 0 los
  // archivos siguen yendo a ../uploads como siempre.
  creatividadesStorage: String(process.env.CREATIVIDADES_STORAGE || '0') === '1',
  creatividadesBucket: process.env.CREATIVIDADES_BUCKET || 'creatividades',
  creatividadesDias: Number(process.env.CREATIVIDADES_DIAS || 90),

  // --- Hoja "Tareas" (Make → Asana), reemplazo del script de AppSheet ---
  tareasSheetId: process.env.TAREAS_SHEET_ID || '',
  tareasHoja: process.env.TAREAS_HOJA || 'Tareas',

  // --- Hoja "CodigosContenido" de AppSheet (se mezcla con el histórico en
  // BigQuery). Mientras la lista de contenidos no esté migrada a Supabase:
  // el generador de códigos sigue la secuencia de lo que hay ahí, y cada
  // pedido nuevo se inserta como una fila más (ver services/codigosSheet.js).
  codigosSheetId: process.env.CODIGOS_SHEET_ID || '',
  codigosHoja: process.env.CODIGOS_HOJA || 'CodigosContenido',
  // Un proyecto sin ningún código en esa hoja desde esta fecha (ISO) no se
  // muestra para elegir (pedido del usuario 2026-09-11: "desde el 15 de
  // agosto"). Vacío = se muestran todos.
  proyectosActividadDesde: process.env.PROYECTOS_ACTIVIDAD_DESDE || '',
  // Ventana móvil (días): un proyecto sin códigos en ese lapso no se ofrece
  // salvo que un admin lo active ("un mes y medio", usuario 2026-09-12).
  // Si está seteado, pisa a PROYECTOS_ACTIVIDAD_DESDE. 0 = sin regla.
  proyectosInactividadDias: Number(process.env.PROYECTOS_INACTIVIDAD_DIAS || 0),
  // Clientes que por ahora no se ofrecen (todos sus proyectos), separados
  // por coma. "Córdoba por ahora afuera, va a tener un módulo especial la
  // semana que viene" (usuario, 2026-09-11). Vacío = ninguno oculto.
  clientesOcultos: String(process.env.CLIENTES_OCULTOS || '').split(',').map((s) => s.trim()).filter(Boolean),
  // Clientes habilitados SOLO para el canal Informativo (todos sus
  // proyectos): "Córdoba solo habilitado para informativo con leyenda que
  // lo avise" (usuario, 2026-09-12) — Oficial va a tener su módulo aparte.
  clientesSoloInformativo: String(process.env.CLIENTES_SOLO_INFORMATIVO || '').split(',').map((s) => s.trim()).filter(Boolean),
  // Desde qué fecha (ISO) se muestra el Historial que sale de la hoja
  // CodigosContenido. "Empecemos con solo septiembre y después con BQ
  // ponemos todo" (usuario, 2026-09-12).
  historialDesde: process.env.HISTORIAL_DESDE || '2026-09-01',

  // --- Aviso diario por mail del presupuesto restante de las cuentas
  // automatizadas (ver services/alertasPresupuesto.js). Sin SMTP_* o sin
  // ALERTAS_MAIL_TO no se manda nada (el cálculo sigue disponible por API).
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM || '',
  alertasMailTo: String(process.env.ALERTAS_MAIL_TO || '').split(',').map((s) => s.trim()).filter(Boolean),
  // Hora (0-23, Argentina) a la que sale el resumen diario.
  alertasHora: Number(process.env.ALERTAS_HORA || 9),
  // Envío por Gmail API (HTTPS, para hostings que bloquean SMTP como
  // Railway): refresh token de la casilla que manda, obtenido una vez en
  // /auth/gmail (mismo cliente OAuth del login). Si está, gana sobre SMTP.
  gmailRefreshToken: process.env.GMAIL_REFRESH_TOKEN || '',
  gmailRedirectUri: process.env.GMAIL_REDIRECT_URI
    || String(process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback').replace('/auth/google/callback', '/auth/gmail/callback'),
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
