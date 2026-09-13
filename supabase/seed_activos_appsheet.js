// Punto 7 del plan: carga en config_activos los Activos reales por Proyecto
// que AppSheet usó en los últimos 2 meses, para proyectos "Activo" en el
// CSV de Base Proyectos. Todos entran con activo_habilitado=false (sin
// credenciales de Meta — se completan a mano en "Agregar Activos").
//
//   node supabase/seed_activos_appsheet.js            -> solo muestra la lista (no toca nada)
//   node supabase/seed_activos_appsheet.js --aplicar  -> inserta los que faltan y completa cliente en los que ya están
//
// Requiere migration_008 corrida. Es seguro repetirlo: un activo que ya
// existe (mismo proyecto + nombre, sin distinguir mayúsculas/acentos) se
// saltea; solo se le completa cliente/ecosistema/codigo_proyecto si están vacíos.
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const APLICAR = process.argv.includes('--aplicar');
const MESES = 2;
const RAIZ = path.join(__dirname, '..', '..');
const XLSX_APPSHEET = path.join(RAIZ, 'AppSheet', 'AppSheet Contenidos.xlsx');
const CSV_PROYECTOS = path.join(RAIZ, 'Audiencias y Proyectos', 'Base Proyectos PRSM - Proyectos EXT.csv');

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}
function slug(s) {
  return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function serialAFecha(n) {
  return new Date(Math.round((Number(n) - 25569) * 86400000));
}
// Por la LETRA del código (7ª posición), misma tabla que equiv_tipo:
// A/B/C = Oficial; D/E/F, Y (Pautas Army) y 0 (Automatización) =
// Informativo. (La primera versión miraba el nombre del Tipo y mandaba
// "Pautas Army" a Oficial — error real que el usuario detectó en Santa Fe.)
const ECO_POR_LETRA = { A: 'Oficial', B: 'Oficial', C: 'Oficial', D: 'Informativo', E: 'Informativo', F: 'Informativo', Y: 'Informativo', 0: 'Informativo' };
function ecosistemaDeFila(fila) {
  const porLetra = ECO_POR_LETRA[String(fila.Codigo || '').charAt(6)];
  if (porLetra) return porLetra;
  if (/informativo|army/i.test(String(fila.Tipo))) return 'Informativo';
  if (/^[ABC]$/.test(String(fila.Tipo).trim())) return 'Oficial';
  return null;
}
// "Mixto" solo si la minoría pesa de verdad (>= 3 filas y >= 10%) — una
// fila suelta cargada con el Tipo equivocado no cambia el ecosistema.
function clasificar(oficial, informativo) {
  const total = oficial + informativo;
  if (!total) return null;
  const min = Math.min(oficial, informativo);
  if (min >= 3 && min / total >= 0.10) return 'Mixto';
  return oficial >= informativo ? 'Oficial' : 'Informativo';
}

// CSV en UTF-8 con encabezado "Proyecto,Código,Estado,,Cliente"
function leerBaseProyectos() {
  const texto = fs.readFileSync(CSV_PROYECTOS, 'utf8').replace(/^﻿/, '');
  const filas = texto.split(/\r?\n/).filter((l) => l.trim());
  const cab = filas[0].split(',');
  const iP = cab.findIndex((c) => norm(c) === 'proyecto');
  const iC = cab.findIndex((c) => norm(c) === 'codigo');
  const iE = cab.findIndex((c) => norm(c) === 'estado');
  const iCl = cab.findIndex((c) => norm(c) === 'cliente');
  return filas.slice(1).map((l) => l.split(',')).map((c) => ({
    proyecto: (c[iP] || '').trim(), codigo: (c[iC] || '').trim(), estado: (c[iE] || '').trim(), cliente: (c[iCl] || '').trim(),
  })).filter((r) => r.proyecto);
}

function calcular() {
  const wb = XLSX.readFile(XLSX_APPSHEET);
  const proyectosAS = XLSX.utils.sheet_to_json(wb.Sheets['Proyectos'], { defval: '' });
  const contenidos = XLSX.utils.sheet_to_json(wb.Sheets['CodigosContenido'], { defval: '' });
  const base = leerBaseProyectos();
  const activosCSV = new Map(base.filter((r) => r.estado === 'Activo').map((r) => [norm(r.proyecto), r]));

  const desde = new Date();
  desde.setMonth(desde.getMonth() - MESES);
  const recientes = contenidos.filter((r) => r.Proyecto && r.Activo && Number(r.Fecha) && serialAFecha(r.Fecha) >= desde);

  // proyecto -> activo(normalizado) -> {nombre (la grafía más usada), oficial, informativo}
  const porProyecto = new Map();
  recientes.forEach((r) => {
    const infoCSV = activosCSV.get(norm(r.Proyecto));
    if (!infoCSV) return; // proyecto inactivo o no listado en el CSV
    if (!porProyecto.has(r.Proyecto)) porProyecto.set(r.Proyecto, new Map());
    const acts = porProyecto.get(r.Proyecto);
    const k = norm(r.Activo);
    if (!acts.has(k)) acts.set(k, { grafias: {}, oficial: 0, informativo: 0 });
    const a = acts.get(k);
    a.grafias[r.Activo.trim()] = (a.grafias[r.Activo.trim()] || 0) + 1;
    const eco = ecosistemaDeFila(r);
    if (eco === 'Informativo') a.informativo += 1; else if (eco === 'Oficial') a.oficial += 1;
  });

  const filas = [];
  [...porProyecto.keys()].sort((a, b) => a.localeCompare(b, 'es')).forEach((proyecto) => {
    const infoCSV = activosCSV.get(norm(proyecto));
    const infoAS = proyectosAS.find((p) => p.Proyecto === proyecto) || {};
    const codigo = infoAS.Codigo || infoCSV.codigo;
    [...porProyecto.get(proyecto).values()].forEach((a) => {
      const activo = Object.entries(a.grafias).sort((x, y) => y[1] - x[1])[0][0];
      const eco = clasificar(a.oficial, a.informativo) || 'Informativo';
      filas.push({
        proyecto, activo, cliente: infoCSV.cliente, codigo_proyecto: codigo, provincia: infoAS.Provincia || '',
        ecosistema_historico: eco, oficial: a.oficial, informativo: a.informativo,
        activo_key: `${codigo.toLowerCase()}--${slug(activo)}`,
      });
    });
  });
  return filas;
}

(async () => {
  const filas = calcular();
  const proyectos = [...new Set(filas.map((f) => f.proyecto))];
  console.log(`${proyectos.length} proyectos / ${filas.length} activos (contenidos de los últimos ${MESES} meses, proyectos "Activo" en el CSV)\n`);
  proyectos.forEach((p) => {
    const f = filas.filter((x) => x.proyecto === p);
    console.log(`${p} [${f[0].codigo_proyecto}] — cliente: ${f[0].cliente} — ${f[0].provincia}`);
    f.forEach((x) => console.log(`   - ${x.activo}  (${x.ecosistema_historico}${x.ecosistema_historico === 'Mixto' ? ` ${x.oficial}/${x.informativo}` : ''})`));
  });
  if (!APLICAR) { console.log('\n(simulación — correr con --aplicar para insertar)'); return; }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: existentes, error } = await sb.from('config_activos').select('proyecto,activo,activo_key,cliente,ecosistema_historico,codigo_proyecto');
  if (error) throw new Error(error.message + ' (¿corriste migration_008?)');
  let insertados = 0, completados = 0, salteados = 0;
  for (const f of filas) {
    const ya = existentes.find((e) => norm(e.proyecto) === norm(f.proyecto) && norm(e.activo) === norm(f.activo));
    if (ya) {
      const cambios = {};
      if (!ya.cliente) cambios.cliente = f.cliente;
      if (!ya.ecosistema_historico) cambios.ecosistema_historico = f.ecosistema_historico;
      if (!ya.codigo_proyecto) cambios.codigo_proyecto = f.codigo_proyecto;
      if (Object.keys(cambios).length) {
        // eslint-disable-next-line no-await-in-loop
        const { error: e2 } = await sb.from('config_activos').update(cambios).eq('activo_key', ya.activo_key);
        if (e2) throw new Error(e2.message);
        completados += 1;
      } else salteados += 1;
      continue;
    }
    if (existentes.find((e) => e.activo_key === f.activo_key)) { console.log('clave repetida, salteo:', f.activo_key); salteados += 1; continue; }
    // eslint-disable-next-line no-await-in-loop
    const { error: e3 } = await sb.from('config_activos').insert({
      proyecto: f.proyecto, activo: f.activo, activo_key: f.activo_key, activo_habilitado: false,
      cliente: f.cliente, ecosistema_historico: f.ecosistema_historico, codigo_proyecto: f.codigo_proyecto,
      provincia: f.provincia, placements_fb: 'feed', duracion_dias: 7, authorization_category: 'POLITICAL', graph_api_version: 'v24.0',
    });
    if (e3) throw new Error(`${f.activo_key}: ${e3.message}`);
    insertados += 1;
  }
  console.log(`\ninsertados ${insertados}, completados ${completados}, ya estaban ${salteados}`);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
