-- PAUTADOR — migración 015: material por plataforma (2026-09-15). Un pedido
-- con varias plataformas (ej. Meta + Youtube) lleva un link por cada una:
-- JSON {"Meta": "...", "Youtube": "..."}. `material` sigue siendo el de Meta
-- (o el de la primera plataforma). La hoja Tareas usa el de cada fila.
-- Correr en el SQL Editor de Supabase.

alter table cola_pautas add column if not exists materiales text;
