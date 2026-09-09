-- PAUTADOR — migración 002: Intensidad pasa a depender del Tipo de campaña,
-- ya no se elige a mano. Correr en el SQL Editor de Supabase (una vez).
--
-- Qué hace:
--   1. Agrega equiv_tipo.intensidad (Alta/Media/Baja) y la carga para los
--      6 tipos que dependen de Audiencia × Intensidad.
--   2. Agrega equiv_tipo.monto_fijo, para el único Tipo que NO depende de
--      Audiencia: "Pautas Army" (Y) siempre usa $75.000, sea cual sea el
--      tamaño de la audiencia.
--   3. Borra "Automatización" (0) de equiv_tipo — Tipo queda en A/B/C
--      (Oficial), D/E/F (Informativo: Baja/Media/Alta) y Y (Pautas Army,
--      monto fijo).
--   4. Crea escala_presupuestos (tamaño × intensidad -> monto) y la carga
--      con los 9 valores reales — usada por A-F, no por Y.

alter table equiv_tipo add column if not exists intensidad text;
alter table equiv_tipo add column if not exists monto_fijo numeric;

update equiv_tipo set intensidad = 'Alta' where codigo in ('A', 'F');
update equiv_tipo set intensidad = 'Media' where codigo in ('B', 'E');
update equiv_tipo set intensidad = 'Baja' where codigo in ('C', 'D');
update equiv_tipo set monto_fijo = 75000 where codigo = 'Y';

delete from equiv_tipo where codigo = '0';

create table if not exists escala_presupuestos (
  "tamaño"    text not null,
  intensidad  text not null,
  monto       numeric not null,
  primary key ("tamaño", intensidad)
);

insert into escala_presupuestos ("tamaño", intensidad, monto) values
  ('grande',  'Alta',  300000),
  ('grande',  'Media', 200000),
  ('grande',  'Baja',  100000),
  ('mediana', 'Alta',  200000),
  ('mediana', 'Media', 120000),
  ('mediana', 'Baja',  75000),
  ('chica',   'Alta',  150000),
  ('chica',   'Media', 75000),
  ('chica',   'Baja',  50000)
on conflict ("tamaño", intensidad) do update set monto = excluded.monto;
