-- PAUTADOR — esquema Supabase (Postgres)
-- Generado 2026-09-08 a partir de las columnas reales de Tablas/operaciones-
-- pauta-meta.xlsx y Tablas/tabla-audiencias-vacía.xlsx.
--
-- Cómo usarlo: pegar este archivo entero en el SQL Editor de Supabase
-- (proyecto → SQL Editor → New query) y correrlo una sola vez. Es
-- idempotente (todos los CREATE TABLE son IF NOT EXISTS), así que
-- reintentarlo no rompe nada si ya se corrió antes.
--
-- Qué NO incluye a propósito:
--   - Foreign keys duras (cola_pautas.activo -> config_activos.activo_key,
--     etc.): los datos de prueba de hoy tienen valores placeholder
--     ("BUSCAR EN BM") y activos sandbox que no siempre matchean prolijo —
--     agregarlas ahora bloquearía la migración. Queda para cuando los datos
--     reales estén cargados de verdad (ver PAUTADOR-producto.md sección 9).
--   - La tabla `registro` (bitácora) y `escala_presupuestos`: existen en el
--     diseño original pero el código todavía no las lee ni las escribe.
--   - La columna de documentación "DÓNDE ENCONTRAR ESTE DATO" de
--     config_activos: es una nota para humanos, no la usa la app.
--
-- Tipos: se mantuvo TEXT en casi todo (así es como Excel ya se lee/escribe
-- hoy — sheet_to_json entrega strings) y solo se tipó fuerte lo que el
-- código realmente trata como número/booleano/fecha, para no romper nada al
-- migrar los datos actuales.

-- ============================================================
-- cola_pautas — cada pieza pedida y su ciclo de vida completo
-- ============================================================
create table if not exists cola_pautas (
  correlation_id          text primary key,
  estado                  text,
  fecha                   date,
  proyecto                text,
  codigo                  text unique,
  activo                  text,
  objetivo                text,
  audiencia               text,
  otras_audiencias        text,
  formato                 text,
  plataforma              text,
  material                text,
  copy                    text,
  campana                 text,
  contenido               text,
  eje                     text,
  provincia               text,
  localidad               text,
  visibilidad             text,
  refuerzo_audiencia      text,
  otras_refuerzo          text,
  link_destino            text,
  placements              text,
  presupuesto             numeric,
  post_id                 text,
  fecha_inicio            date,
  fecha_fin               date,
  creador                 text,
  confirmado_por          text,
  confirmado_en           timestamptz,
  bulk_id                 text,
  row_id                  text,
  nomenclatura_preview    text,
  presupuesto_resuelto    numeric,
  audiencia_resuelta      text,
  plataformas_resueltas   text,
  optimization_goal       text,
  modo                    text,
  errores_preview         text,
  adset_id                text,
  creative_id             text,
  ad_id                   text,
  publicado_en            timestamptz,
  n8n_execution_id        text,
  error_publicacion       text,
  activo_solicitado       text,
  imagen_preview          text,
  desestimado_por         text,
  desestimado_en          timestamptz,
  motivo_desestimacion    text,
  redes                   text,
  material_stories        text, -- material específico para Stories cuando va junto con Feed/Reels con imágenes distintas (agregada en migration_003)
  comentarios             text, -- cuadro libre debajo de los módulos de "Pedido de Anuncios", lo ve el implementador al validar
  combos_excluidos        text, -- cruces Objetivo|Audiencia que el PM desactivó al pedir ("Interacción|AR-GENERAL,Alcance Normal|Otra") — nunca se generan, ver colaPautas.js getMatrizParaPauta
  reparto                 text, -- JSON {"Objetivo|codigo_audiencia": pct} elegido a mano con los sliders (agregada en migration_004) — si falta o no suma 100, cae al reparto parejo/70-30 de siempre
  origen                  text default 'pedido', -- 'pedido' | 'csv' | 'ingesta' (hojas salida_manual_*; único origen que puede crear ACTIVO en Meta) — migration_005
  tareas_replicado        boolean default false, -- ya se escribió en la hoja "Tareas" (Make → Asana) — migration_005
  tareas_error            text  -- motivo si la réplica a "Tareas" falló; el job periódico reintenta — migration_005
);

-- ============================================================
-- config_activos — ficha de cada medio (cuenta Meta, página, límites)
-- ============================================================
create table if not exists config_activos (
  proyecto                text,
  activo                  text,
  activo_key              text primary key,
  activo_habilitado       boolean,
  bm_id                   text,
  ad_account_id           text,
  page_id                 text,
  ig_actor_id             text,
  campaign_id             text,
  modo_default            text,
  plataformas_default     text,
  placements_fb           text,
  placements_ig           text,
  presupuesto_piso        numeric,
  presupuesto_techo       numeric,
  presupuesto_default     numeric,
  duracion_dias           integer,
  authorization_category  text,
  credential_key          text,
  colaborador_email       text,
  slack_channel           text,
  asana_project_gid       text,
  graph_api_version       text,
  provincia               text
);

-- ============================================================
-- equiv_audiencia — audiencias guardadas de Meta por activo
-- (vive en tabla-audiencias-vacía.xlsx, no en operaciones-pauta-meta.xlsx)
-- ============================================================
create table if not exists equiv_audiencia (
  activo_key              text,
  codigo_audiencia        text,
  nombre_display          text,
  "tamaño"                text,
  saved_audience_id       text,
  primary key (activo_key, codigo_audiencia)
);

-- ============================================================
-- equiv_objetivo — Objetivo AppSheet -> parámetros reales de Meta
-- ============================================================
create table if not exists equiv_objetivo (
  appsheet_valor           text primary key,
  meta_optimization_goal   text,
  meta_campaign_objective  text,
  meta_billing_event       text,
  meta_bid_strategy        text,
  meta_frequency_max       integer,
  meta_frequency_dias      integer,
  notas                    text
);

-- ============================================================
-- equiv_formato — Formato -> modo/proporción/placement por default
-- ============================================================
create table if not exists equiv_formato (
  appsheet_valor      text primary key,
  modo                text,
  aspecto             text,
  aspecto_label        text,
  placement           text,
  requiere_material    text,
  requiere_post_id     text,
  creative_type        text,
  notas                text
);

-- ============================================================
-- equiv_tipo — Tipo de campaña -> ecosistema (Oficial/Informativo)
-- ============================================================
create table if not exists equiv_tipo (
  codigo            text primary key,
  tipo_campana      text,
  ecosistema        text,
  modo_validacion   text,
  intensidad        text,     -- Alta/Media/Baja — cruza con escala_presupuestos según tamaño de Audiencia (agregada en migration_002)
  monto_fijo        numeric,  -- si está cargado, ES el presupuesto sin importar Audiencia (ej. "Pautas Army" = 75000 siempre) — agregada en migration_002
  notas             text
);

-- ============================================================
-- escala_presupuestos — tamaño de Audiencia × Intensidad -> monto.
-- Reemplaza el viejo tramo fijo de Intensidad (agregada en migration_002).
-- ============================================================
create table if not exists escala_presupuestos (
  "tamaño"    text not null,
  intensidad  text not null,
  monto       numeric not null,
  primary key ("tamaño", intensidad)
);

-- ============================================================
-- equiv_eje — Ejes temáticos
-- ============================================================
create table if not exists equiv_eje (
  codigo        text primary key,
  eje           text,
  descripcion   text
);

-- ============================================================
-- matriz_distribucion — una fila por celda (objetivo × audiencia)
-- publicada, con los IDs reales de Meta. El unique es EL antiduplicado
-- real que motivó la migración (ver PAUTADOR-producto.md sección 8/9).
-- ============================================================
create table if not exists matriz_distribucion (
  id                bigint generated always as identity primary key,
  correlation_id    text not null,
  objetivo          text not null,
  audiencia_key     text not null,
  audiencia_nombre  text,
  tipo_audiencia    text,
  porcentaje        numeric,
  monto_resuelto    numeric,
  campaign_id       text,
  adset_id          text,
  creative_id       text,
  ad_id             text,
  estado_celda      text,
  confirmado_en     timestamptz,
  nomenclatura      text,
  unique (correlation_id, objetivo, audiencia_key)
);

-- ============================================================
-- campanas_meta — activo + eje + objetivo -> campaign_id (para reusar)
-- ============================================================
create table if not exists campanas_meta (
  id            bigint generated always as identity primary key,
  activo_key    text,
  eje           text,
  objetivo      text,
  campaign_id   text,
  creado_en     timestamptz
);

-- ============================================================
-- usuarios — roles y proyectos permitidos (reemplaza permisos_pautador)
-- ============================================================
create table if not exists usuarios (
  id            text primary key,
  nombre        text,
  rol           text,                    -- pm_cuentas | implementador | administrador
  proyectos     text,                    -- LEGACY: "todos" para admins, vacío para el resto (migración 007); la fuente de verdad es usuario_accesos
  email         text unique,
  es_superadmin boolean default false,   -- único que designa/revoca administradores (migración 007)
  habilitado    boolean default true     -- false = no entra, conserva historial (migración 007)
);

-- usuario_accesos — Panel Usuarios (migración 007): qué Proyectos y Activos
-- ve cada usuario no-admin. activo_key NULL = todos los activos del proyecto.
create table if not exists usuario_accesos (
  id          bigserial primary key,
  usuario_id  text not null references usuarios(id) on delete cascade,
  proyecto    text not null,
  activo_key  text,
  creado_en   timestamptz default now(),
  creado_por  text
);
create unique index if not exists idx_usuario_accesos_unico on usuario_accesos (usuario_id, proyecto, coalesce(activo_key, ''));

-- ============================================================
-- Índices de lectura frecuente (no son constraints, solo velocidad)
-- ============================================================
create index if not exists idx_cola_pautas_proyecto on cola_pautas (proyecto);
create index if not exists idx_cola_pautas_estado on cola_pautas (estado);
create index if not exists idx_matriz_correlation on matriz_distribucion (correlation_id);
create index if not exists idx_campanas_meta_busqueda on campanas_meta (activo_key, eje, objetivo);

-- ============================================================
-- creatividades — archivos en Supabase Storage, bucket privado (migration_006)
-- ============================================================
-- cola_pautas.material = "creatividad:<id>" apunta acá. 90 días y se borra
-- (job en server.js). Ver services/storage.js.
create table if not exists creatividades (
  id               text primary key,
  storage_path     text not null,
  nombre_original  text,
  content_type     text,
  bytes            bigint,
  width            integer,
  height           integer,
  origen           text default 'subida',     -- 'subida' | 'link'
  link_original    text,
  proyecto         text, activo_key text, codigo text, campana text, eje text, correlation_id text,
  subido_por       text,
  creado_en        timestamptz default now(),
  expira_en        timestamptz,
  borrado_en       timestamptz
);
create index if not exists idx_creatividades_expira on creatividades (expira_en) where borrado_en is null;
create index if not exists idx_creatividades_correlation on creatividades (correlation_id);

-- ============================================================
-- ingesta_sheets — filas de salida_manual_* ya procesadas (migration_005)
-- ============================================================
-- fila_id = columna "Codigo" del Sheet (ej. GDCHAC0AG00262), única por fila.
-- Garantiza que una misma fila nunca cree dos pautas aunque llegue por
-- webhook (Apps Script) y por polling a la vez. Ver services/ingestaSheets.js.
create table if not exists ingesta_sheets (
  hoja            text not null,
  fila_id         text not null,
  correlation_id  text,
  estado          text,        -- 'creada' | 'error' | 'ignorada'
  error           text,
  procesado_en    timestamptz default now(),
  primary key (hoja, fila_id)
);
