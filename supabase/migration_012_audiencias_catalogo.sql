-- Catálogo de audiencias por Proyecto × Canal para Pedido Manual.
-- Fuente: Excel "IDs de Auds x Activos.xlsx" (qué códigos usa cada activo/
-- canal) + Excel "Audiencias.xlsx" (código -> nombre limpio). Se carga con
-- supabase/seed_audiencias_catalogo.js. Las piezas que usan estas
-- audiencias salen "a mano" (sin público guardado utilizable desde acá);
-- equiv_audiencia sigue siendo la fuente para lo automatizado.
create table if not exists audiencias_catalogo (
  id bigserial primary key,
  proyecto text not null,
  canal text not null,               -- 'Oficial' | 'Informativo'
  codigo text not null,              -- ej. SFEHNBCZNP
  nombre text not null,              -- nombre limpio (Refe del Excel Audiencias)
  tamano text,                       -- chica | mediana | grande (por N Potencial)
  n_potencial integer,
  saved_audience_id text,            -- referencia; no se usa para publicar
  activo_key text,                   -- activo de config_activos (si existe)
  activo_excel text,                 -- nombre del activo tal cual en el Excel
  hoja text,
  creado_en timestamptz not null default now(),
  unique (proyecto, canal, codigo)
);
create index if not exists audiencias_catalogo_proyecto_canal on audiencias_catalogo (proyecto, canal);
