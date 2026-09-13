-- PAUTADOR — migración 009: punto 4 del plan (Pedido Normal con otras
-- plataformas: Youtube / Tik Tok / X / Display). Correr en el SQL Editor de
-- Supabase (una vez).
--
-- cola_pautas.plataforma ya existía (siempre 'Meta'); ahora guarda la
-- elegida. Se suman los dos campos que AppSheet tenía y PAUTADOR no:
--   categoria_pieza: lista "Categoría Pieza" filtrada por Formato
--                    (ver src/config/plataformas.js).
--   gobernador:      "Sí"/"No" — si la pieza muestra al gobernador.
-- Van a la hoja "Tareas" (columnas Categoría Pieza y Gobernador).

alter table cola_pautas add column if not exists categoria_pieza text;
alter table cola_pautas add column if not exists gobernador      text;
