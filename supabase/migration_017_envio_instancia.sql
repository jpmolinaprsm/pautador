-- PAUTADOR — migración 017: dueño de cada pedido en cola (2026-09-18).
-- Producción (Railway) publica ACTIVO y una PC local publica PAUSADO, pero
-- comparten esta base. Cada pedido en cola guarda qué proceso lo tomó
-- ('railway' o 'local:<equipo>') para que, al reiniciar, cada uno retome solo
-- lo suyo: Railway nunca publica activo una prueba local, ni al revés.
-- Correr en el SQL Editor de Supabase.

alter table cola_pautas add column if not exists envio_instancia text;
