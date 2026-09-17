// Carga audiencias_catalogo (migration_012) desde los dos Excel de
// "Audiencias y Proyectos":
//   - "IDs de Auds x Activos.xlsx": qué códigos de audiencia usa cada
//     Activo y Canal (una hoja por cliente, layouts distintos por hoja).
//   - "Audiencias.xlsx" / hoja "Audiencias": código -> nombre limpio (Refe).
// El Activo del Excel se traduce a activo_key de config_activos (mapeo
// manual de abajo, validado con el usuario el 2026-09-14); el Proyecto sale
// de config_activos, o del mapeo PROYECTO_SIN_ACTIVO cuando el activo del
// Excel no existe en la base. Se colapsa por (proyecto, canal, codigo).
//
//   node supabase/seed_audiencias_catalogo.js --dry   -> solo muestra el resumen
//   node supabase/seed_audiencias_catalogo.js         -> borra y recarga la tabla
//
// OJO (2026-09-17): los nombres de audiencias_catalogo y equiv_audiencia se
// normalizaron A MANO desde la pestaña "Audiencias nombres" de la planilla
// de insumos (MEDIA - AUTOMATIZACIONES). Volver a correr este seed PISA esos
// nombres con los del Excel: si hay que recargar, después hay que volver a
// aplicar la columna "Nombre normalizado" de esa pestaña.
const path = require('path');
const XLSX = require('xlsx');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const RAIZ = path.resolve(__dirname, '..', '..');
const XLSX_IDS = path.join(RAIZ, 'Audiencias y Proyectos', 'IDs de Auds x Activos.xlsx');
const XLSX_AUDIENCIAS = path.join(RAIZ, 'Audiencias y Proyectos', 'Audiencias.xlsx');
const DRY = process.argv.includes('--dry');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

// Activo del Excel -> activo_key (null = no existe en config_activos).
const MAPA_ACTIVOS = {
  'CHT+NT | Chubut': {
    'Gobierno ADS': 'gchubu--gobierno-del-chubut', 'Gobierno SMC': 'gchubu--gobierno-del-chubut',
    'Dino ADS': 'gchubu--dino', 'Dino SMC': 'gchubu--dino',
    'Nacho Torres ADS': 'gchnto--nacho-torres', 'Nacho Torres SMC': 'gchnto--nacho-torres',
    'Corresponsal Chubut': 'gchubu--corresponsal-chubut', 'Somos Chubut': 'gchubu--somos-chubut',
    'Tiempo Chubut': 'gchubu--tiempo-chubut', 'Gaceta Patagonica': 'gchubu--gaceta-patagonica',
    'Primera Plana': 'gchubu--primera-plana', 'Cadena Patagonica': null, 'Informe 2': null,
  },
  'SFE | Santa Fe': {
    'Contexto Santa Fe': 'gsfofi--contexto-santa-fe', 'La Calle hoy': 'gsfofi--la-calle-hoy',
    'Pulso del Interior': 'gsfofi--pulso-del-interior', 'La Invencible': 'gsfofi--la-invencible',
    'Gaceta Santafecina': 'gsfofi--gaceta-santafesina', 'Diario de Actualidad': 'gsfofi--diario-de-actualidad',
    'Gobierno de Santa Fe (Ads)': 'gsfofi--santa-fe-gobierno',
  },
  'CAT | Catamarca': {
    'Panorama Catamarca (INF)': 'ctmprv--panorama-catamarca',
    'Catamarca Provincia Oficial': 'ctmprv--catamarca-provincia-oficial',
    'Catamarca Ciudad Oficial': 'catcdd--catamarca-ciudad',
  },
  'CBA | Córdoba': {
    'CBACOR General 26 (CGM)': null, 'CBACOR Gob Córdoba 6 (CGM)': null,
    'Actualidad Cordobesa (INF)': 'cbacor--actualidad-cordobesa',
  },
  'CHAC | Chaco': {
    'Gobierno del Chaco': 'gdchac--gobierno-del-chaco', 'Nodo Chaco (INF)': 'gdchac--nodo-chaco',
    'Contexto Noreste (INF)': 'gdchac--contexto-noreste',
  },
  'CTES | Corrientes': {
    'Gobierno de Corrientes': 'gcorie--gobierno-de-corrientes', 'Juan Pablo Valdés': 'gcojpv--juan-pablo-valdes',
    'El Sol Informativo': 'gcorie--el-sol-informativo', 'Redacción Litoral': 'gcorie--redaccion-litoral',
    'La Voz Litoral': 'gcorie--la-voz-del-litoral', 'Corrientes Press': null, 'La Gaceta Correntina': null,
    'Argentinos Online': null,
  },
  'LOTSFE | Lotería de Santa Fe': { 'Lot Santa Fe Quiniela': null, 'Lot Santa Fe Quini 6': null },
  'ARGxISR | Argentinos por Israel': {
    'Argentinos por Israel': 'israpi--argentinos-por-israel', 'Nosotras por la paz': 'isrnpp--nosotras-por-la-paz',
  },
  'Chubut Patagonia': { 'GCHTUR Chubut Patagonia (SMC)': 'gchtur--chubut-patagonia' },
  'Ministerio de Turismo Chubut': { 'GCHTUR Min Tur Areas Protegidas': 'gchtur--chubut-turismo-ministerio' },
};
// Activos del Excel que no existen en config_activos: a qué Proyecto van.
const PROYECTO_SIN_ACTIVO = {
  'Cadena Patagonica': 'Gobierno del Chubut', 'Informe 2': 'Gobierno del Chubut',
  'CBACOR General 26 (CGM)': 'Gobierno de Córdoba', 'CBACOR Gob Córdoba 6 (CGM)': 'Gobierno de Córdoba',
  'Corrientes Press': 'Gobierno de Corrientes', 'La Gaceta Correntina': 'Gobierno de Corrientes',
  'Argentinos Online': 'Gobierno de Corrientes',
  'Lot Santa Fe Quiniela': 'Lotería Santa Fe', 'Lot Santa Fe Quini 6': 'Lotería Santa Fe',
};
const FILAS_RESUMEN = ['Ofi e Inf', 'Ofi'];
// El Sol Informativo trae en Referencia/ID una lista pegada de públicos de
// otras cuentas — se ignoran esos IDs (ver mapeo del 2026-09-14).
const IGNORAR_ID = ['El Sol Informativo'];

// Índices de columna por hoja (los layouts difieren entre hojas).
const LAYOUT = {
  'CHT+NT | Chubut': { activo: 0, canal: 2, aud: 3, cod: 4, n: 5, idaud: 9, obs: 10, maxcol: 12 },
  'SFE | Santa Fe': { activo: 0, canal: 2, aud: 3, cod: 4, n: 5, idaud: 9, obs: 10, maxcol: 11 },
  'CAT | Catamarca': { activo: 0, canal: 2, aud: 3, cod: 4, n: 5, idaud: 9, obs: 10, maxcol: 11 },
  'CBA | Córdoba': { activo: 0, canal: 2, aud: 3, cod: 4, n: 5, idaud: 8, obs: 9, maxcol: 10 },
  'CHAC | Chaco': { activo: 0, canal: 2, aud: 3, cod: 4, n: 5, idaud: 9, obs: 10, maxcol: 11 },
  'CTES | Corrientes': { activo: 0, canal: 2, aud: 3, cod: 4, n: 5, idaud: 10, obs: 9, maxcol: 11, tipoPipe: true },
  'LOTSFE | Lotería de Santa Fe': { activo: 0, canal: 2, aud: 3, cod: 4, n: 5, idaud: 10, obs: 11, maxcol: 12, tipoPipe: true },
  'ARGxISR | Argentinos por Israel': { activo: 0, canal: 2, aud: 3, cod: 4, n: 5, idaud: 12, obs: 11, maxcol: 13 },
  'Chubut Patagonia': { activo: 0, canal: 2, aud: 3, cod: 5, n: 7, idaud: 4, obs: 6, maxcol: 8 },
  'Ministerio de Turismo Chubut': { activo: 0, canal: 2, aud: 3, cod: 5, n: 7, idaud: 4, obs: 6, maxcol: 8 },
};

const limpiar = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const numero = (s) => { const v = Number(String(s == null ? '' : s).replace(/[^0-9.]/g, '')); return isFinite(v) && v > 0 ? Math.round(v) : null; };
const tamanoDe = (n) => (!n ? '' : n < 100000 ? 'chica' : n <= 500000 ? 'mediana' : 'grande');
const esIdMeta = (s) => /^\d{10,}$/.test(limpiar(s));
const esCodigoCore = (s) => /^[A-Z]{3}\d{3}X{4}$/.test(limpiar(s));
const canalDe = (s) => (/^ofi/i.test(limpiar(s)) ? 'Oficial' : /^inf/i.test(limpiar(s)) ? 'Informativo' : '');

// Nombre tal cual viene en el Excel de IDs (fallback cuando el código no
// está en el Excel "Audiencias"). En Corrientes/Lotería la celda es
// "Tipo | Nombre".
function nombreDelExcelIds(layout, celdaAud, cod, obs) {
  const aud = String(celdaAud == null ? '' : celdaAud).split('\n').map(limpiar).filter(Boolean).join(' — ');
  if (!layout.tipoPipe) return aud;
  const partes = aud.split('|').map(limpiar);
  const tipo = partes.length > 1 ? partes[0] : '';
  let nombre = partes.length > 1 ? partes.slice(1).join(' | ') : aud;
  const ref = limpiar(obs);
  if ((nombre === limpiar(cod) || esCodigoCore(nombre)) && ref && ref !== '-') nombre = ref;
  const t = tipo.toLowerCase();
  if (/^(departamento|municipio|geo )/i.test(nombre)) return nombre;
  if (t === 'depto') return `Depto. ${nombre}`;
  if (t === 'muni' || t === 'municipio') return `Muni. ${nombre}`;
  if (t === 'región' || t === 'region') return `Región ${nombre}`;
  if (t === 'int seguridad') return `Int Seguridad - ${nombre}`;
  if (t === 'norte' || t === 'sur' || t === 'pin') return `${nombre} (${tipo})`;
  return nombre;
}

// Algunos Refe vienen como "Tipo | Nombre" (Corrientes: "Depto | Goya",
// "Geo | Provincia Corrientes") — se muestran como "Depto. Goya" /
// "Provincia Corrientes".
function formatearTipoPipe(nombre) {
  const partes = String(nombre).split('|').map(limpiar);
  if (partes.length < 2) return nombre;
  const t = partes[0].toLowerCase();
  const resto = partes.slice(1).join(' | ');
  if (t === 'depto' || t === 'departamento') return `Depto. ${resto}`;
  if (t === 'muni' || t === 'municipio') return `Muni. ${resto}`;
  if (t === 'región' || t === 'region') return `Región ${resto}`;
  if (t === 'int seguridad') return `Int Seguridad - ${resto}`;
  if (t === 'norte' || t === 'sur' || t === 'pin') return `${resto} (${partes[0]})`;
  return resto; // Geo, Audiencia, Open
}

// Excel "Audiencias": código -> nombre limpio. Refe es el nombre; si viene
// vacío se arma con Departamentos/Localidad.
function leerDecodificador() {
  const wb = XLSX.readFile(XLSX_AUDIENCIAS);
  const filas = XLSX.utils.sheet_to_json(wb.Sheets['Audiencias'], { defval: '' });
  const deco = {};
  filas.forEach((f) => {
    const id = limpiar(f.ID).toUpperCase();
    if (!id) return;
    const nombre = formatearTipoPipe(limpiar(f.Refe)) || [limpiar(f.Departamentos), limpiar(f.Localidad)].filter(Boolean).join(' — ');
    if (nombre && !deco[id]) deco[id] = { nombre, nMeta: numero(f['N en META']) || numero(f['Tamaño GEO']) };
  });
  // Códigos "core" (AEN111XXXX, OCN183XXXX, MPN172XXXX…): están en la hoja
  // "Core" (Codigo → Descripción), no en "Audiencias".
  const core = wb.Sheets['Core'] ? XLSX.utils.sheet_to_json(wb.Sheets['Core'], { defval: '' }) : [];
  core.forEach((f) => {
    const id = limpiar(f.Codigo).toUpperCase();
    const nombre = limpiar(f['Descripción'] || f.Descripcion);
    if (id && nombre && !deco[id]) deco[id] = { nombre, nMeta: null };
  });
  // Un Refe que es a su vez un código core (SFEHNBCZNP -> "AEN130XXXX") se
  // resuelve una vez más contra la hoja Core.
  Object.values(deco).forEach((d) => {
    const ref = String(d.nombre).toUpperCase();
    if (esCodigoCore(ref) && deco[ref] && !esCodigoCore(deco[ref].nombre)) d.nombre = deco[ref].nombre;
  });
  return deco;
}

async function leerActivos() {
  const r = await fetch(`${url}/rest/v1/config_activos?select=activo_key,proyecto,activo`, { headers: H });
  const rows = await r.json();
  if (!Array.isArray(rows)) throw new Error(`config_activos: ${JSON.stringify(rows)}`);
  return Object.fromEntries(rows.map((a) => [a.activo_key, a]));
}

function parsearExcelIds(activos, deco) {
  const wb = XLSX.readFile(XLSX_IDS);
  const salida = new Map(); // proyecto|canal|codigo -> fila
  const stats = {};
  const problemas = [];
  for (const [hoja, mapa] of Object.entries(MAPA_ACTIVOS)) {
    const L = LAYOUT[hoja];
    const ws = wb.Sheets[hoja];
    if (!ws) { problemas.push(`hoja "${hoja}" no existe en el Excel`); continue; }
    const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const st = (stats[hoja] = { leidas: 0, cargadas: 0, saltadas: 0, sinDecodificar: 0 });
    for (let i = 1; i < filas.length; i += 1) {
      const r = filas[i];
      if (r.slice(0, L.maxcol).every((c) => c === '')) continue;
      st.leidas += 1;
      const activoExcel = limpiar(r[L.activo]);
      const codigo = limpiar(r[L.cod]).toUpperCase();
      if (!activoExcel || !codigo || FILAS_RESUMEN.includes(activoExcel)) { st.saltadas += 1; continue; }
      if (!(activoExcel in mapa)) { problemas.push(`[${hoja}] fila ${i + 1}: activo "${activoExcel}" no está en MAPA_ACTIVOS`); st.saltadas += 1; continue; }
      const canal = canalDe(r[L.canal]);
      if (!canal) { problemas.push(`[${hoja}] fila ${i + 1}: canal "${limpiar(r[L.canal])}" no reconocido`); st.saltadas += 1; continue; }
      const activoKey = mapa[activoExcel];
      const proyecto = activoKey ? (activos[activoKey] || {}).proyecto : PROYECTO_SIN_ACTIVO[activoExcel];
      if (!proyecto) { problemas.push(`[${hoja}] fila ${i + 1}: sin proyecto para "${activoExcel}" (${activoKey || 'sin activo'})`); st.saltadas += 1; continue; }
      const idRaw = IGNORAR_ID.includes(activoExcel) ? '' : limpiar(r[L.idaud]);
      const obs = IGNORAR_ID.includes(activoExcel) ? '' : r[L.obs];
      const nPotencial = numero(r[L.n]);
      const decod = deco[codigo];
      if (!decod) st.sinDecodificar += 1;
      const nombre = decod ? decod.nombre : nombreDelExcelIds(L, r[L.aud], codigo, obs);
      const n = nPotencial || (decod && decod.nMeta) || null;
      const fila = {
        proyecto, canal, codigo, nombre, tamano: tamanoDe(n), n_potencial: n,
        saved_audience_id: esIdMeta(idRaw) ? idRaw : null,
        activo_key: activoKey || null, activo_excel: activoExcel, hoja,
      };
      const k = `${proyecto}|${canal}|${codigo}`;
      const previa = salida.get(k);
      if (previa) {
        if (!previa.saved_audience_id && fila.saved_audience_id) previa.saved_audience_id = fila.saved_audience_id;
        if (!previa.n_potencial && fila.n_potencial) { previa.n_potencial = fila.n_potencial; previa.tamano = fila.tamano; }
        continue;
      }
      salida.set(k, fila);
      st.cargadas += 1;
    }
  }
  return { filas: [...salida.values()], stats, problemas };
}

async function reemplazarTabla(filas) {
  const del = await fetch(`${url}/rest/v1/audiencias_catalogo?id=gt.0`, { method: 'DELETE', headers: { ...H, Prefer: 'return=minimal' } });
  if (!del.ok) throw new Error(`DELETE audiencias_catalogo: ${del.status} ${await del.text()}`);
  for (let i = 0; i < filas.length; i += 200) {
    const lote = filas.slice(i, i + 200);
    const r = await fetch(`${url}/rest/v1/audiencias_catalogo`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(lote) });
    if (!r.ok) throw new Error(`INSERT lote ${i / 200 + 1}: ${r.status} ${await r.text()}`);
  }
}

(async () => {
  if (!url || !key) throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env');
  const deco = leerDecodificador();
  const activos = await leerActivos();
  const { filas, stats, problemas } = parsearExcelIds(activos, deco);
  console.log(`Códigos decodificables (Excel Audiencias): ${Object.keys(deco).length}`);
  Object.entries(stats).forEach(([h, s]) => console.log(`  ${h}: leídas ${s.leidas}, cargadas ${s.cargadas}, saltadas ${s.saltadas}, sin nombre en Audiencias.xlsx ${s.sinDecodificar}`));
  const porPC = {};
  filas.forEach((f) => { const k = `${f.proyecto} | ${f.canal}`; porPC[k] = (porPC[k] || 0) + 1; });
  console.log('Por Proyecto × Canal:');
  Object.entries(porPC).sort().forEach(([k, n]) => console.log(`  ${k}: ${n}`));
  console.log(`Total filas: ${filas.length} (con saved_audience_id: ${filas.filter((f) => f.saved_audience_id).length})`);
  if (problemas.length) { console.log('Problemas:'); problemas.forEach((p) => console.log('  -', p)); }
  if (DRY) { console.log('--dry: no se escribió nada'); return; }
  await reemplazarTabla(filas);
  console.log('audiencias_catalogo recargada.');
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
