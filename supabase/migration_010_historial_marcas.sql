-- PAUTADOR — migración 010: marcas del Historial (2026-09-12). El Historial
-- sale de la hoja CodigosContenido de AppSheet; una fila que no publicó
-- PAUTADOR (o que se cargó a mano) se muestra "Ver en Asana" hasta que
-- alguien la marca "Pautado" desde la app. Esa marca se guarda acá (no en la
-- hoja, que es de AppSheet). Correr en el SQL Editor de Supabase (una vez).

create table if not exists historial_marcas (
  codigo       text primary key,     -- código de contenido (ej. GCHUBUDOB00012)
  estado       text not null,        -- 'pautado'
  marcado_por  text,
  marcado_en   timestamptz default now()
);
