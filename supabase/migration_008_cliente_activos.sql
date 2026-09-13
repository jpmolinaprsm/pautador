-- PAUTADOR — migración 008: punto 7 del plan (activos reales por proyecto
-- desde AppSheet). Correr en el SQL Editor de Supabase (una vez).
--
-- cliente: el Cliente del proyecto (CSV "Base Proyectos PRSM - Proyectos
--   EXT"). Un cliente puede tener varios proyectos (ej. Gobierno del Chubut
--   tiene "Gobierno del Chubut" y "Nacho Torres").
-- ecosistema_historico: en qué ecosistema publicó ese activo en AppSheet
--   los últimos 2 meses — 'Oficial', 'Informativo' o 'Mixto'. El Pedido
--   Normal lo usa para filtrar el selector de Activo por el ecosistema
--   elegido (un Mixto aparece en los dos).
-- codigo_proyecto: prefijo de 6 letras del proyecto (mismo que la hoja
--   "Proyectos" de AppSheet, ej. GCHUBU) — de referencia, el generador de
--   códigos sigue leyendo el Excel.

alter table config_activos add column if not exists cliente               text;
alter table config_activos add column if not exists ecosistema_historico  text;
alter table config_activos add column if not exists codigo_proyecto       text;

-- Los 7 activos que ya estaban cargados a mano.
update config_activos set cliente = 'Gobierno del Chubut',   codigo_proyecto = 'GCHUBU' where proyecto = 'Gobierno del Chubut';
update config_activos set cliente = 'Gobierno del Chaco',    codigo_proyecto = 'GDCHAC' where proyecto = 'Gobierno del Chaco';
update config_activos set cliente = 'Gobierno de Santa Fe',  codigo_proyecto = 'GSFOFI' where proyecto = 'Gobierno de Santa Fe';
update config_activos set cliente = 'Catamarca Provincia',   codigo_proyecto = 'CTMPRV' where proyecto = 'Catamarca Provincia Oficial';
update config_activos set cliente = 'Test',                  codigo_proyecto = 'TEST'   where proyecto = 'Test Sandbox';
