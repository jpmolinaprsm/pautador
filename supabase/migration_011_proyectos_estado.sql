-- PAUTADOR — migración 011: Activar / Desactivar proyectos desde el panel de
-- administración (2026-09-12). Regla del usuario: un proyecto sin pedidos
-- (códigos en CodigosContenido) en el último mes y medio no aparece, salvo
-- que un admin lo active; y un admin puede desactivar cualquiera.
-- Sin fila = "automático" (manda la actividad). Correr en el SQL Editor.

create table if not exists proyectos_estado (
  proyecto        text primary key,   -- nombre exacto del proyecto (config_activos.proyecto)
  estado          text not null,      -- 'activado' | 'desactivado'
  modificado_por  text,
  modificado_en   timestamptz default now()
);
