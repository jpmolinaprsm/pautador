// Aviso diario por mail de cuánto presupuesto le queda a cada cuenta
// automatizada (pedido del usuario 2026-09-14): límite de gasto de la cuenta
// (spend_cap) menos lo gastado (amount_spent) menos lo ya asignado a
// conjuntos activos que todavía no se gastó. Se manda una vez por día a la
// hora ALERTAS_HORA (hora Argentina) a ALERTAS_MAIL_TO, por SMTP (nodemailer).
// Sin SMTP configurado solo se calcula (GET /api/admin/presupuestos).
const nodemailer = require('nodemailer');
const env = require('../config/env');
const metaApi = require('./metaApi');
const { getActivos } = require('./configActivos');

const centavos = (v) => Math.round(Number(v || 0)) / 100;
const pesos = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-AR');

// Presupuesto ya comprometido: conjuntos activos y vigentes, lo que les
// falta gastar (lifetime_budget - gasto).
async function comprometidoDeCuenta(adAccountId) {
  const ahora = Date.now();
  let comprometido = 0;
  let url = `/${adAccountId}/adsets`;
  // insights.date_preset(maximum): sin eso Meta devuelve solo los últimos
  // 30 días y un conjunto largo parece tener más plata sin gastar de la real.
  let params = { fields: 'lifetime_budget,end_time,effective_status,insights.date_preset(maximum){spend}', limit: 200, effective_status: JSON.stringify(['ACTIVE']) };
  for (let vueltas = 0; vueltas < 10 && url; vueltas += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await metaApi.graphGet(url, params);
    (r.data || []).forEach((a) => {
      if (a.end_time && Date.parse(a.end_time) < ahora) return;
      const presupuesto = centavos(a.lifetime_budget);
      const gastado = Number(((a.insights || {}).data || [{}])[0].spend || 0);
      comprometido += Math.max(0, presupuesto - gastado);
    });
    const next = r.paging && r.paging.cursors && r.paging.cursors.after && r.paging.next ? r.paging.cursors.after : null;
    if (!next) break;
    params = { ...params, after: next };
  }
  return comprometido;
}

async function estadoCuentas() {
  const activos = (await getActivos()).filter((a) => a.activo_habilitado === true && /^act_\d+$/.test(String(a.ad_account_id || '')));
  const filas = [];
  for (const a of activos) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const c = await metaApi.graphGet(`/${a.ad_account_id}`, { fields: 'name,currency,spend_cap,amount_spent,balance,account_status' });
      // eslint-disable-next-line no-await-in-loop
      const comprometido = await comprometidoDeCuenta(a.ad_account_id);
      const limite = centavos(c.spend_cap);
      const gastado = centavos(c.amount_spent);
      const restante = limite ? Math.max(0, limite - gastado - comprometido) : null;
      const porPauta = Number(a.presupuesto_default) || 0;
      filas.push({
        activo: a.activo || a.activo_key,
        proyecto: a.proyecto,
        cuenta: c.name || a.ad_account_id,
        ad_account_id: a.ad_account_id,
        moneda: c.currency || 'ARS',
        limite,
        gastado,
        comprometido: Math.round(comprometido),
        restante: restante === null ? null : Math.round(restante),
        porcentajeUsado: limite ? Math.round(((gastado + comprometido) / limite) * 100) : null,
        presupuestoPorPauta: porPauta,
        pautasRestantes: restante !== null && porPauta > 0 ? Math.floor(restante / porPauta) : null,
        sinLimite: !limite,
      });
    } catch (err) {
      filas.push({ activo: a.activo || a.activo_key, proyecto: a.proyecto, ad_account_id: a.ad_account_id, error: err.message });
    }
  }
  return filas;
}

function armarMail(filas) {
  const fecha = new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' });
  const lineas = filas.map((f) => {
    if (f.error) return `- ${f.activo}: no se pudo leer la cuenta (${f.error})`;
    if (f.sinLimite) return `- ${f.activo}: sin límite de gasto configurado en la cuenta — gastado ${pesos(f.gastado)}, comprometido ${pesos(f.comprometido)}`;
    const pautas = f.pautasRestantes !== null ? ` (≈ ${f.pautasRestantes} pautas de ${pesos(f.presupuestoPorPauta)})` : '';
    const alerta = f.porcentajeUsado >= 85 ? ' ⚠️ QUEDA POCO' : '';
    return `- ${f.activo}: quedan ${pesos(f.restante)}${pautas} — límite ${pesos(f.limite)}, gastado ${pesos(f.gastado)}, ya asignado a pautas activas ${pesos(f.comprometido)} (${f.porcentajeUsado}% usado)${alerta}`;
  });
  const urgentes = filas.filter((f) => !f.error && !f.sinLimite && f.porcentajeUsado >= 85).map((f) => f.activo);
  const asunto = `PAUTADOR — presupuesto restante ${fecha}` + (urgentes.length ? ` — atención: ${urgentes.join(', ')}` : '');
  const texto = [
    `Presupuesto restante de las cuentas automatizadas al ${fecha} (límite de gasto de la cuenta, menos lo gastado, menos lo ya asignado a pautas activas):`,
    '',
    ...lineas,
    '',
    'Para ampliar el límite: Business Manager → Cuentas publicitarias → Límite de gasto de la cuenta.',
    'Este aviso lo manda PAUTADOR una vez por día.',
  ].join('\n');
  return { asunto, texto };
}

function smtpConfigurado() {
  return !!(env.smtpHost && env.smtpUser && env.smtpPass && env.alertasMailTo.length);
}

function transporteSmtp() {
  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    auth: { user: env.smtpUser, pass: env.smtpPass },
    // Sin esto, un puerto bloqueado (PaaS que cortan SMTP saliente) deja la
    // request colgada hasta el timeout del proxy en vez de fallar con motivo.
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
}

async function enviarMail(asunto, texto) {
  if (!smtpConfigurado()) throw new Error('Falta configurar SMTP_HOST/SMTP_USER/SMTP_PASS y ALERTAS_MAIL_TO.');
  await transporteSmtp().sendMail({ from: env.smtpFrom || env.smtpUser, to: env.alertasMailTo.join(', '), subject: asunto, text: texto });
}

// Prueba la conexión SMTP desde este servidor sin mandar nada.
async function verificarSmtp() {
  if (!smtpConfigurado()) return { ok: false, error: 'Falta configurar SMTP_HOST/SMTP_USER/SMTP_PASS y ALERTAS_MAIL_TO.' };
  const t0 = Date.now();
  try {
    await transporteSmtp().verify();
    return { ok: true, host: env.smtpHost, port: env.smtpPort, ms: Date.now() - t0 };
  } catch (err) {
    return { ok: false, host: env.smtpHost, port: env.smtpPort, ms: Date.now() - t0, error: err.message, code: err.code };
  }
}

async function enviarResumen() {
  const filas = await estadoCuentas();
  const { asunto, texto } = armarMail(filas);
  await enviarMail(asunto, texto);
  return { filas, asunto, destinatarios: env.alertasMailTo };
}

// Una vez por día a la hora ALERTAS_HORA (Argentina). Se chequea cada 10
// minutos; se recuerda en memoria el último día enviado.
let ultimoDiaEnviado = '';
function programarEnvioDiario() {
  if (!smtpConfigurado()) {
    console.log('[alertas] sin SMTP/ALERTAS_MAIL_TO: el resumen diario de presupuesto está apagado (GET /api/admin/presupuestos sigue andando)');
    return;
  }
  console.log(`[alertas] resumen diario de presupuesto a las ${env.alertasHora}:00 (AR) → ${env.alertasMailTo.join(', ')}`);
  setInterval(async () => {
    const ahoraAr = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
    const dia = ahoraAr.toISOString().slice(0, 10);
    if (ahoraAr.getHours() < env.alertasHora || ultimoDiaEnviado === dia) return;
    ultimoDiaEnviado = dia;
    try {
      const r = await enviarResumen();
      console.log(`[alertas] resumen enviado (${r.filas.length} cuentas)`);
    } catch (err) {
      ultimoDiaEnviado = '';
      console.warn('[alertas] no pude mandar el resumen:', err.message);
    }
  }, 10 * 60 * 1000);
}

module.exports = { estadoCuentas, armarMail, enviarResumen, programarEnvioDiario, smtpConfigurado, verificarSmtp };
