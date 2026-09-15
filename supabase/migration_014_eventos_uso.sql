-- PAUTADOR — migración 014: registro de uso (2026-09-15). Una fila por
-- acción real que pasa por el servidor (login, entrar al app, pedidos,
-- Historial, administración) con quién, cuándo, sobre qué y cómo salió.
-- Lo ve solo el superadmin en Panel Usuarios → Uso. Correr en el SQL Editor.

create table if not exists eventos_uso (
  id              bigserial primary key,
  fecha           timestamptz not null default now(),
  usuario_id      text,
  usuario_nombre  text,
  rol             text,
  accion          text not null,      -- etiqueta legible (ej. "Pedido creado")
  ruta            text,               -- METHOD /api/... (para lo que no tiene etiqueta)
  proyecto        text,
  modo            text,               -- automatizado | normal
  canal           text,               -- Oficial | Informativo
  referencia      text,               -- código o id del pedido, id de usuario, proyecto...
  detalle         text,               -- resumen corto (campaña, plataforma, cantidad, motivo)
  resultado       text,               -- ok | error
  error           text,
  duracion_ms     integer
);
create index if not exists eventos_uso_fecha_idx on eventos_uso (fecha desc);
create index if not exists eventos_uso_usuario_idx on eventos_uso (usuario_id, fecha desc);
