-- PAUTADOR — migración 003: material específico para Stories, cuando el
-- Placement incluye Stories junto con Feed/Reels y las dos imágenes no son
-- la misma. Correr en el SQL Editor de Supabase (una vez).

alter table cola_pautas add column if not exists material_stories text;
