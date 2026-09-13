-- PAUTADOR — migración 007: Panel Usuarios (2026-09-11). Accesos por
-- Proyecto Y por Activo para cada usuario, superadmin, y habilitado/
-- deshabilitado. Correr en el SQL Editor de Supabase (una vez).
--
-- Reglas que pidió el usuario:
--  - Implementador y PM/Cuentas ven SOLO los proyectos/activos asignados.
--    Solo los administradores ven todo.
--  - Un superadmin (juan.pablo.molina@prosumia.la) es el único que puede
--    designar o revocar administradores.
--  - Hasta nuevo aviso, cualquier mail @prosumia.la entra solo (sin
--    accesos); después solo los dados de alta por un admin (AUTH_ALTA_LIBRE=0).

alter table usuarios add column if not exists es_superadmin boolean default false;
alter table usuarios add column if not exists habilitado    boolean default true;

-- Una fila por (usuario, proyecto, activo). activo_key NULL = TODOS los
-- activos de ese proyecto (incluidos los que se carguen después).
create table if not exists usuario_accesos (
  id          bigserial primary key,
  usuario_id  text not null references usuarios(id) on delete cascade,
  proyecto    text not null,
  activo_key  text,
  creado_en   timestamptz default now(),
  creado_por  text
);

create unique index if not exists idx_usuario_accesos_unico
  on usuario_accesos (usuario_id, proyecto, coalesce(activo_key, ''));
create index if not exists idx_usuario_accesos_usuario on usuario_accesos (usuario_id);

-- Superadmin inicial.
update usuarios
   set rol = 'administrador', es_superadmin = true, habilitado = true
 where id = 'juan.pablo.molina@prosumia.la';

-- Los administradores no necesitan filas de acceso (ven todo) — se
-- normaliza la columna vieja a "todos" para que quede claro.
update usuarios set proyectos = 'todos' where rol = 'administrador';

-- Migración de la columna vieja `proyectos` ("A,B,C") a filas de
-- usuario_accesos con acceso a todo el proyecto. Después se vacía la
-- columna: a partir de acá la fuente de verdad es usuario_accesos (si
-- quedara el texto, revocar un proyecto desde el panel no serviría).
insert into usuario_accesos (usuario_id, proyecto, activo_key, creado_por)
select u.id, trim(p), null, 'migración 007'
  from usuarios u, unnest(string_to_array(u.proyectos, ',')) as p
 where u.rol <> 'administrador'
   and coalesce(u.proyectos, '') not in ('', 'todos')
   and trim(p) <> ''
on conflict do nothing;

-- Usuario demo "impl-nico" tenía "todos" sin ser admin: se le dan todos
-- los proyectos que existen HOY, uno por uno (regla: solo admins ven todo).
insert into usuario_accesos (usuario_id, proyecto, activo_key, creado_por)
select u.id, c.proyecto, null, 'migración 007'
  from usuarios u
  cross join (select distinct proyecto from config_activos where proyecto is not null) c
 where u.rol <> 'administrador' and lower(coalesce(u.proyectos, '')) = 'todos'
on conflict do nothing;

update usuarios set proyectos = '' where rol <> 'administrador';
