-- PAUTADOR — migración 016: envío en cola (2026-09-17). Confirmar un pedido
-- ya no espera a Meta: la fila se guarda con envio='en_cola', un proceso de
-- fondo del servidor la manda (envio='creando') y la deja en 'listo' o
-- 'error' (envio_error). El cuadro "En proceso N/M" de la pantalla lee esto.
-- Correr en el SQL Editor de Supabase.

alter table cola_pautas add column if not exists envio text;
alter table cola_pautas add column if not exists envio_error text;
alter table cola_pautas add column if not exists envio_actualizado timestamptz;
