-- PAUTADOR — migración 013: "Prender" un proyecto a mano lo deja visible
-- PROYECTOS_PRENDIDO_DIAS días (5) y después vuelve a la regla de actividad
-- (decisión del usuario, 2026-09-15). Correr en el SQL Editor de Supabase.

alter table proyectos_estado add column if not exists activado_hasta timestamptz;
