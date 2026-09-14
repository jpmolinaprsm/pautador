# PAUTADOR — Guía para Administradores

*Versión 12/9/2026. Una página. Los administradores ven todos los proyectos y dos pestañas más: **Agregar Activos / Audiencias** y **Panel Usuarios**.*

## Panel Usuarios

- **Dar de alta por mail** (solo `@prosumia.la`): mail, nombre (opcional) y rol — PM / Cuentas, Implementador o Administrador. Solo un **superadmin** puede crear o revocar administradores.
- **Accesos**: en la lista, tocá un usuario. Por cada proyecto podés tildar **todo el proyecto** (incluye activos que se sumen después) o activos sueltos. Un administrador ve todo, no hace falta asignarle nada.
- **Habilitado**: destildarlo bloquea el ingreso sin borrar el historial de esa persona.
- Mientras `AUTH_ALTA_LIBRE=1`, cualquier mail del dominio entra solo pero sin accesos hasta que se los asignes acá.

## Agregar Activos / Audiencias

- **+ Activo**: se cuelga de un proyecto existente. Necesita **Ad Account ID** (`act_…`), **Page ID** y, si está vinculada, **IG Actor ID** — al lado de cada campo hay un "¿Dónde lo encuentro?". Un activo recién creado queda **deshabilitado** hasta que tenga cuenta y página válidas.
- **+ Audiencia**: ligada a un activo. Código, nombre a mostrar, tamaño (chica / mediana / grande, o Army) y **Saved Audience ID** del público guardado en Ads Manager. Sin ID, la audiencia se trata como manual.
- Los nombres de audiencia se muestran ordenados alfabéticamente en el pedido; usá nombres cortos.

## Qué se configura por variables (no desde la app)

| Variable | Para qué |
|---|---|
| `INGESTA_ESTADO_INICIAL` | `PAUSED` o `ACTIVE` (hoy) para lo que llega de las hojas salida_manual_*. |
| `AUTOMATIZADO_ESTADO_INICIAL` | `PAUSED` (default) o `ACTIVE` para los pedidos automatizados hechos desde la pantalla. Lanzamiento 2026-09-16: `ACTIVE`. |
| `INGESTA_MINUTOS` | Cada cuántos minutos se revisan las hojas (0 = solo por webhook). |
| `TAREAS_SHEET_ID` | Planilla "Tareas" (Make → Asana). La de producción está bloqueada en código hasta que se autorice. |
| `CODIGOS_SHEET_ID` | Hoja CodigosContenido de AppSheet: secuencia de códigos y fila por pedido. |
| `PROYECTOS_ACTIVIDAD_DESDE` | Se ocultan proyectos sin códigos desde esa fecha. |
| `CLIENTES_OCULTOS` | Clientes apagados por ahora (ej. Gobierno de Córdoba). |
| `AUTH_ALTA_LIBRE` | 1 = entra cualquiera del dominio; 0 = solo dados de alta. |
| `CREATIVIDADES_DIAS` | Días que se conserva cada archivo subido (90). |

## Mantenimiento

- **Token de Meta**: es un token de usuario (Maximiliano) de 60 días; vence el **10/11/2026**. Renovarlo antes (instrucciones en `.env`).
- **Migraciones** de Supabase: se corren a mano en el SQL Editor (`pautador/supabase/migration_*.sql`) antes de desplegar código que las necesite.
- **Reiniciar el server** después de cambiar `.env` (local: parar y volver a arrancar; Railway: redeploy).
