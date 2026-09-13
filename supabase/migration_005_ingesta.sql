-- PAUTADOR — migración 005: ingesta automática desde las hojas
-- salida_manual_{chaco,catamarca,chubut} y réplica a la hoja "Tareas"
-- (Make → Asana). Correr en el SQL Editor de Supabase (una vez).

-- De dónde salió el pedido: 'pedido' (pantalla), 'csv' (carga masiva) o
-- 'ingesta' (hojas salida_manual_*). Solo 'ingesta' puede crear ACTIVO en
-- Meta (INGESTA_ESTADO_INICIAL) — el resto siempre PAUSED.
alter table cola_pautas add column if not exists origen text default 'pedido';

-- Réplica a la hoja "Tareas": false hasta que se escribió; si falló, el
-- motivo queda en tareas_error y el job periódico lo reintenta.
alter table cola_pautas add column if not exists tareas_replicado boolean default false;
alter table cola_pautas add column if not exists tareas_error text;

-- Filas de salida_manual_* ya vistas: una fila por (hoja, fila_id) — el
-- fila_id es la columna "Codigo" del Sheet (ej. GDCHAC0AG00262), única por
-- fila. Así una misma fila nunca crea dos pautas aunque llegue por webhook
-- y por polling a la vez.
create table if not exists ingesta_sheets (
  hoja            text not null,
  fila_id         text not null,
  correlation_id  text,
  estado          text,        -- 'creada' | 'error' | 'ignorada'
  error           text,
  procesado_en    timestamptz default now(),
  primary key (hoja, fila_id)
);
