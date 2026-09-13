-- PAUTADOR — migración 004: reparto custom por Objetivo×Audiencia (sliders
-- en "Se van a crear estos cruces" y en "Crear Anuncios" bulk). Formato:
-- JSON {"Objetivo|codigo_audiencia": porcentaje, ...} — si falta, o no suma
-- 100 entre las celdas no excluidas, colaPautas.js cae al reparto parejo/
-- 70-30 de siempre (no rompe nada de lo que ya funciona). Correr en el SQL
-- Editor de Supabase (una vez).

alter table cola_pautas add column if not exists reparto text;
