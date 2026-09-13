-- PAUTADOR — migración 006: creatividades en Supabase Storage (punto 5 del
-- plan). El archivo vive en el bucket privado "creatividades" (ya creado por
-- API el 2026-09-11, 50 MB por archivo — máximo del plan); esta tabla guarda
-- dónde está y con qué etiquetas, y cuándo vence (90 días). Correr en el SQL
-- Editor de Supabase (una vez).

create table if not exists creatividades (
  id               text primary key,          -- "cre_<timestamp>_<rand>", es lo que va en cola_pautas.material como "creatividad:<id>"
  storage_path     text not null,             -- ruta dentro del bucket (proyecto/activo/año-mes/id.ext)
  nombre_original  text,
  content_type     text,
  bytes            bigint,
  width            integer,
  height           integer,
  origen           text default 'subida',     -- 'subida' (archivo desde la pantalla) | 'link' (copia bajada de un link, ej. Drive)
  link_original    text,                      -- si origen='link', el link de donde se bajó
  -- Etiquetas (lo que pidió el usuario: "vinculadas a las etiquetas puestas").
  -- Se completan al crear el pedido; al subir todavía no se conocen todas.
  proyecto         text,
  activo_key       text,
  codigo           text,
  campana          text,
  eje              text,
  correlation_id   text,
  subido_por       text,
  creado_en        timestamptz default now(),
  expira_en        timestamptz,               -- creado_en + CREATIVIDADES_DIAS (90)
  borrado_en       timestamptz                -- cuando el job de expiración lo sacó del bucket
);

create index if not exists idx_creatividades_expira on creatividades (expira_en) where borrado_en is null;
create index if not exists idx_creatividades_correlation on creatividades (correlation_id);
