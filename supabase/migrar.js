// Migración de una sola vez: Excel (Tablas/) -> Supabase.
//
// Uso:
//   1. Correr supabase/schema.sql en el SQL Editor de Supabase (una vez).
//   2. Cargar SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en pautador/.env.
//   3. node supabase/migrar.js
//
// Es seguro correrlo más de una vez: cada tabla se vacía (DELETE de todo)
// antes de volver a insertar — así se puede reintentar sin duplicar ni
// pelearse con los unique constraints mientras se prueba el flujo. Lee los
// Excel con la MISMA lógica que ya usa la app en modo mock (sheetsMock.js:
// mismos archivos, mismas filas de ayuda salteadas), así que lo que se migra
// es exactamente lo que la app ve hoy.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');
const mock = require('../src/services/sheetsMock');
const { COLUMNAS } = require('../src/services/db');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en pautador/.env — no se puede migrar.');
  process.exit(1);
}

const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// tabla -> una columna que nunca es null, para poder vaciarla entera antes
// de reinsertar ("DELETE WHERE columna IS NOT NULL" = todas las filas).
const TABLAS = {
  cola_pautas: 'correlation_id',
  config_activos: 'activo_key',
  equiv_audiencia: 'activo_key',
  equiv_objetivo: 'appsheet_valor',
  equiv_formato: 'appsheet_valor',
  equiv_tipo: 'codigo',
  equiv_eje: 'codigo',
  matriz_distribucion: 'correlation_id',
  campanas_meta: 'activo_key',
  usuarios: 'id',
  escala_presupuestos: 'tamaño',
};

// Clave real de unicidad de cada tabla (mismo unique constraint que
// schema.sql) — el Excel viejo de pruebas trae algunas filas repetidas
// (reintentos de confirmar que no se limpiaron a mano: exactamente el
// problema que el unique constraint de Supabase existe para evitar de acá
// en más, ver PAUTADOR-producto.md sección 8). Se de-duplica ANTES de
// insertar, quedándose con la última ocurrencia de cada clave, en vez de
// que la migración entera se corte por un choque de constraint.
const CLAVES_NATURALES = {
  cola_pautas: ['correlation_id'],
  config_activos: ['activo_key'],
  equiv_audiencia: ['activo_key', 'codigo_audiencia'],
  equiv_objetivo: ['appsheet_valor'],
  equiv_formato: ['appsheet_valor'],
  equiv_tipo: ['codigo'],
  equiv_eje: ['codigo'],
  matriz_distribucion: ['correlation_id', 'objetivo', 'audiencia_key'],
  campanas_meta: [], // sin unique real (id autogenerado) — no hay nada que de-duplicar
  usuarios: ['id'],
  escala_presupuestos: ['tamaño', 'intensidad'],
};

// Se queda solo con las columnas que existen de verdad en el esquema de
// Postgres (el Excel trae de más — ej. la nota "DÓNDE ENCONTRAR ESTE DATO"
// de config_activos, que es para humanos, no una columna real) y manda ''
// como null: Postgres rechaza '' en columnas numeric/date/timestamptz.
function sanear(fila, columnasValidas) {
  const out = {};
  columnasValidas.forEach((col) => {
    const v = fila[col];
    out[col] = v === '' || v === undefined ? null : v;
  });
  return out;
}

function deduplicar(filas, clave) {
  if (!clave || !clave.length) return { filas, descartadas: 0 };
  const mapa = new Map();
  filas.forEach((f) => {
    const k = clave.map((c) => f[c]).join('|');
    mapa.set(k, f); // la última ocurrencia pisa a la anterior
  });
  return { filas: [...mapa.values()], descartadas: filas.length - mapa.size };
}

async function migrarTabla(nombre, pkColumna) {
  const columnasValidas = COLUMNAS[nombre];
  const crudas = mock.readTable(nombre).map((f) => sanear(f, columnasValidas));
  const { filas, descartadas } = deduplicar(crudas, CLAVES_NATURALES[nombre]);
  process.stdout.write(`${nombre}: ${crudas.length} filas en Excel${descartadas ? ` (${descartadas} duplicadas, se descartan)` : ''}... `);

  const { error: errorDelete } = await client.from(nombre).delete().not(pkColumna, 'is', null);
  if (errorDelete) {
    console.log('FALLÓ AL VACIAR');
    throw new Error(`No pude vaciar "${nombre}" antes de migrar: ${errorDelete.message}`);
  }

  if (!filas.length) {
    console.log('nada que insertar.');
    return;
  }

  const { error: errorInsert } = await client.from(nombre).insert(filas);
  if (errorInsert) {
    console.log('FALLÓ AL INSERTAR');
    throw new Error(`No pude insertar en "${nombre}": ${errorInsert.message}`);
  }
  console.log(`${filas.length} filas migradas.`);
}

async function main() {
  for (const [nombre, pkColumna] of Object.entries(TABLAS)) {
    // eslint-disable-next-line no-await-in-loop
    await migrarTabla(nombre, pkColumna);
  }
  console.log('\nListo. Para que la app use Supabase: DATA_SOURCE=supabase en pautador/.env y reiniciar el server.');
}

main().catch((err) => {
  console.error('\nMigración cortada:', err.message);
  process.exit(1);
});
