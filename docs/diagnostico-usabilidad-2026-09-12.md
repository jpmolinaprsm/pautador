# PAUTADOR — Diagnóstico de usabilidad y flujos

Revisión del 12 de septiembre de 2026, recorriendo la app local como PM/Cuentas (Lucía), Implementador (Nico) y Administrador (Juan Pablo), con pedidos reales de punta a punta (creados y borrados después). El criterio: **¿la puede usar alguien sin conocimiento técnico, sin que nadie le explique?**

## 1. Resumen ejecutivo

- **Los flujos principales funcionan de punta a punta.** Login → Proyecto → Modo → Canal → Plataforma → Pedido (5 módulos) → preview → creación. Un pedido Automatizado en Gaceta Patagónica llegó a Meta en pausa con nomenclatura, código de secuencia y presupuesto correctos; un pedido Normal para Youtube quedó para carga manual y apareció en Historial con sus acciones (Marcar hecha / Editar / Desestimar / Cambiar presupuesto).
- **Se encontraron y corrigieron 4 bugs durante la revisión** (ver sección 3). El más grave: al arrancar el server desde otro directorio (panel, Railway) no encontraba la clave de Google → sin hoja de códigos ni réplica a Tareas, en silencio.
- **Para un usuario no técnico, hoy la app no está lista sin acompañamiento**, por 6 cosas concretas (sección 4, prioridad 1): el selector "entrá como" que permite hacerse pasar por cualquiera, el trabajo manual que queda escondido en Historial, filas viejas de prueba visibles, el Tipo "Automatización" elegible a mano, el Placement sin valor por defecto y la vista previa que no muestra la imagen cuando el material es un link.
- **La documentación está desactualizada respecto de lo construido** (sección 6): describe una app de 4 pestañas contra una cuenta sandbox, solo Informativo, sin ingesta, sin Tareas, sin Storage, sin Panel Usuarios ni otras plataformas. No existe una guía de uso por rol.

## 2. Qué se probó y qué pasó

| Flujo | Rol | Resultado |
|---|---|---|
| Login (pantalla) | todos | OK. Solo "Continuar con Google" — claro. |
| Elegir Proyecto (tarjetas por cliente, volumen 15 días, globos de pendientes) | todos | OK. Córdoba oculto, proyectos inactivos ocultos. |
| Elegir Modo (Automatizado / Normal) | todos | OK. Copy con jerga (ver 4.2). |
| Elegir Canal (Oficial / Informativo) | todos | OK. Tipos y activos se acotan bien (Chubut/Oficial → Noticia Franca; Informativo → 7 medios). |
| Cuadrícula de plataformas (multipick) | todos | OK. En Automatizado solo Meta; Meta+Youtube ofrece solo Video. |
| Pedido Automatizado Meta, imagen por link, 1 objetivo × 1 audiencia | PM | OK. Creado en Meta en pausa (`GCHUBUDOB00002`, borrado después). La vista previa no mostró la imagen (ver 4.1). |
| Pedido Normal Youtube con imagen | PM | OK — rechazado con mensaje claro: "Youtube solo acepta video, y esto es imagen". |
| Pedido Normal Youtube con video | PM | OK — creado manual (`GCHUBUDOB00003`, borrado). **El mensaje decía "publicada en Meta (en pausa)"** → corregido. |
| Validación de módulos vacíos | PM | Mensajes genéricos ("Completá Proyecto, Activo, Tipo y Eje" cuando solo faltaba Eje). |
| Historial: detalle de una pieza, acciones del implementador | Implementador | OK. Muestra IDs crudos de Meta y jerga ("celda", "carril"). |
| Agregar Activos / Audiencias | Admin | **Bug**: solo listaba 35 de 64 activos (el recorte por canal se aplicaba también acá) → corregido. Campos técnicos sin ayuda. |
| Panel Usuarios | Admin | OK (probado el 11/9: alta, accesos por proyecto y por activo, superadmin). |
| CSV | PM | Pantalla OK (no se subió archivo en esta pasada; probado en sesiones anteriores). |

No probado en esta pasada: "Subir archivo" desde el navegador (probado por API el 11/9), "Crear Anuncios" con publicación directa, Marcar hecha / Desestimar (botones presentes, probados en sesiones anteriores).

## 3. Bugs corregidos durante la revisión

1. **Clave de Google con ruta relativa.** `GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./credentials/...` se resolvía contra el directorio desde donde arranca node. Desde el panel (y en Railway) no la encontraba: la hoja `CodigosContenido` no se leía ni escribía y la réplica a Tareas fallaba, sin que el usuario viera nada. Ahora se resuelve siempre contra la carpeta `pautador/`.
2. **"Agregar Activos / Audiencias" mostraba solo los activos del canal activo** (35 de 64). La pestaña de administración ahora pide todos (`?todos=1`).
3. **Mensaje de éxito falso**: un pedido Normal (todo manual, o para Youtube/Tik Tok/X/Display) decía "publicada en Meta (en pausa)". Ahora dice "creada — queda para cargar a mano en Youtube y marcar hecha desde Historial".
4. **El subtítulo del logo ("Meta Ads · Pauta política") se partía en 3 líneas** y desalineaba el nav. Fijado en una línea.

Ojo operativo: el server con `node --watch` **no recargó** los cambios de código en esta sesión; hubo que reiniciarlo a mano (parar y volver a arrancar). Para Railway no aplica (cada deploy reinicia).

## 4. Hallazgos de usabilidad

### 4.1 Prioridad 1 — bloquea el uso sin acompañamiento

| # | Qué pasa | Por qué importa | Propuesta |
|---|---|---|---|
| 1 | En la pantalla de Proyecto hay un selector "Mientras se terminan de asignar los accesos, entrá como…" y en el nav un desplegable de usuario. Cualquiera puede entrar como Administrador. | Anula el Panel Usuarios y los permisos. Un PM puede confirmar pautas o borrar cosas como admin. | Sacarlos de producción (dejarlos solo con una variable `DEMO_USUARIOS=1` para desarrollo). La identidad ya viene del login con Google. |
| 2 | El trabajo manual queda escondido: una pieza que hay que cargar a mano (Youtube, audiencia "Otra", modo Normal) va a **Historial** con la etiqueta "Falta celda manual", mientras arriba dice "No hay piezas esperando validación" y el nav dice "0 pendientes". La pantalla de Proyecto sí muestra "1" pendiente. | El implementador no ve qué tiene que hacer; los tres contadores se contradicen. | Una sección propia arriba de Historial: **"Para cargar a mano (N)"**, con el mismo conteo en el nav. Renombrar "Falta celda manual" → "Cargar a mano en Youtube/Meta". |
| 3 | 13 filas viejas de prueba (9 y 10/9, activo `test--tres-empanadas`, campañas "Test", "teeeeeee") se ven en el Historial real de Gobierno del Chubut y Santa Fe. | Ruido y confusión desde el primer día. | Borrarlas (pido confirmación: son las únicas que quedan con ese activo). |
| 4 | El Tipo "Automatización" (código 0) aparece en el desplegable de Tipo y se puede elegir a mano. | Es el tipo interno del flujo automático de las hojas; elegido a mano genera códigos que no corresponden. | Ocultarlo del desplegable (sigue disponible para la ingesta). |
| 5 | Placement arranca vacío: si no se tilda "Feed", el módulo no deja seguir ("Elegí al menos un Placement"). | Un paso obligatorio que el 90% de las veces es "Feed". | Preseleccionar Feed (Carrusel: solo Feed; Reel: Reels). |
| 6 | Vista previa con material por link: muestra un ícono de imagen rota y "No pude medir esta pieza desde acá". | Quien pide no confirma nunca cómo se ve su pieza; los avisos de medidas no corren. | Al verificar el link, guardar una copia en el bucket (ya existe la infraestructura del punto 5 del plan) y usar esa copia para el preview y las medidas. |

### 4.2 Prioridad 2 — confunde, pero se puede seguir

**Vocabulario técnico en pantallas de PM/Cuentas** (habría que reemplazarlo por lenguaje de la operación):

| Hoy | Propuesta |
|---|---|
| "Oculto (crear anuncio nuevo)" / "Público (publicar contenido existente)" | "Anuncio nuevo (subo una pieza)" / "Posteo ya publicado" |
| "Placement" | "Ubicación" (Feed / Historias / Reels) |
| "Red" | "Dónde se muestra" o "Facebook / Instagram" |
| "Copy" | "Texto del anuncio" |
| "Link de destino" | "¿A dónde lleva el click?" |
| "Intensidad" (no se ve pero está en el copy de Modo) | "Nivel de inversión" |
| "Falta celda manual", "celda", "carril", "conjunto" | "Cargar a mano", "combinación objetivo × audiencia" |
| "Pautas Army" | dejar, pero con ayuda: "audiencia propia del proyecto" |
| IDs crudos de Meta en el detalle (`120251309309400544 · …`) | esconderlos detrás de "Ver en Ads Manager" (link) |
| "35 activo(s) ya cargados: catcdd--catamarca-noticias, …" (admin) | lista con nombres, no claves |
| "Saved Audience ID", "IG Actor ID", "Ad Account ID" (admin) | mantener, con un "¿Dónde lo encuentro?" al lado |

**Estructura y copy de los módulos**

- Módulo 4 se llama "Tipo y Cantidad de Piezas" pero contiene Visibilidad, Formato, Red y Placement; "Tipo" choca con el Tipo de campaña del Módulo 1. Propuesta: "4. Formato y ubicación" y llevar "Cantidad de piezas" al Módulo 5.
- Las tarjetas iniciales dicen "se elige la cantidad en el Módulo 4": el usuario no sabe qué es un módulo. Mejor "Una pieza o varias juntas".
- Los nombres de modo no son consistentes: "Pedido Anuncios Automatizados" vs "Pedido de Anuncios Normal". Y los chips del nav son larguísimos ("Pedido Anuncios Automatizados — pasar a 'Pedido de Anuncios Normal'"). Propuesta: chips cortos "Automatizado ▾" / "Normal ▾" / "Informativo ▾".
- Mensajes de validación genéricos: "Completá Proyecto, Activo, Tipo y Eje" cuando solo falta Eje → nombrar solo lo que falta.
- La caja "Comentarios" aparece flotando entre módulos (siempre visible abajo del último módulo abierto); mejor fija al final, antes de "Confirmar pedido".
- La "Audiencia principal" se pide dos veces: en el Módulo 2 y de nuevo en cada Pieza del Módulo 5 (con la misma lista larga). Para una sola pieza es redundante; mostrarla por pieza solo cuando hay 2+ piezas, y como "distinta a la general (opcional)".
- Título del detalle en Historial repite: "PRUEBA USABILIDAD - borrar - PRUEBA USABILIDAD - borrar (Imagen)" (campaña + contenido, que ya incluye la campaña).
- Después de crear, el cuadro "Último pedido" no ofrece siguiente paso: link a Historial y, si salió a Meta, a Ads Manager.

**Datos que se ven feos** (no es código, es la tabla de audiencias): nombres muy largos y sin orden ("Cordillera Esquel, Trevelin, Lago Puelo, …"), errores de tipeo ("rubro de la saludo"), palabras repetidas ("Puerto Madryn Puerto Madryn y Puerto Pirámides"), puntos finales. Propuesta: ordenar alfabéticamente en el desplegable y una pasada de limpieza de `nombre_display` (te paso la lista).

**Onboarding largo**: 4 pantallas antes de ver algo (Proyecto → Modo → Canal → Plataforma). Está bien para la primera vez; para el uso diario conviene recordar la última elección y ofrecer "Seguir con Gobierno del Chubut · Automatizado · Informativo" en un solo click, con "Cambiar" al lado.

### 4.3 Prioridad 3 — detalles

- El botón "Confirmar pedido" queda con el texto "Creando…" (oculto) después de crear; se ve al volver a entrar hasta que se renderiza de nuevo.
- Historial muestra `test--tres-empanadas DARK` (clave y visibilidad crudas) para activos que ya no existen.
- "Tamaño audiencia: grande" en minúscula en el detalle.
- Chips del nav en MAYÚSCULAS con letter-spacing (se sienten como alertas).
- A 800px de ancho el nav desborda (scroll horizontal). Por debajo de ~1100px conviene que los chips pasen a una segunda línea.

## 5. Relación con lo pedido

| Pedido | Estado | Observación |
|---|---|---|
| Ingesta automática de las 3 hojas (Chaco/Catamarca/Chubut) + réplica a Tareas | Hecho y probado (11/9) | Polling apagado; webhook solo llega a Railway; Tareas apunta a la planilla de prueba (la real está bloqueada). El bug de la clave (3.1) hubiera dejado esto mudo en Railway. |
| Avisos de specs + preview con link | Hecho | El preview no funciona con materiales por link (4.1 #6); con archivo subido sí. |
| Creatividades en Storage (90 días) | Hecho | Falta la copia de materiales que llegan por link. |
| Otras plataformas en Pedido Normal + cuadrícula multipick | Hecho y probado | Pieza queda manual; mensaje de éxito corregido hoy. |
| Activos por proyecto desde AppSheet + Oficial/Informativo | Hecho | Clasificación corregida el 11/9 por letra del código. Noticia Franca / El Norte Ahora / Valle 24 sin dato (se ven en los dos canales). |
| Panel Usuarios (alta por mail, accesos por proyecto y activo, superadmin) | Hecho y probado | El selector "entrá como" lo anula (4.1 #1). |
| Códigos desde la hoja CodigosContenido + insertar fila | Hecho | Todavía no se escribió ninguna fila real. Requiere la clave (3.1). |
| Proyectos ocultos sin códigos desde 15/8, orden por volumen 15 días, Córdoba afuera | Hecho | Configurable por `.env`. |
| Globos de pendientes en todas las pantallas | Hecho | Pero el conteo del nav dentro de la app no coincide (4.1 #2). |
| Pendiente de vos | — | Railway (push + variables), Tareas de producción, Apps Script en las hojas, Make/Asana, App Review de Meta, token 10/11, `AUTH_ALTA_LIBRE=0`, borrar usuarios demo. |

## 6. Documentación: estado y qué falta

| Documento | Qué es | Estado |
|---|---|---|
| `pautador/README.md` | Setup técnico | **Desactualizado**: habla de modo mock con Excel, Google Sheets como fuente, 4 pestañas con nombres viejos ("Pedido de Pauta", "Validación de Anuncios"). No menciona Supabase, Railway, ingesta, Storage, Tareas, Panel Usuarios ni las variables nuevas (`INGESTA_*`, `TAREAS_*`, `CREATIVIDADES_*`, `CODIGOS_*`, `PROYECTOS_ACTIVIDAD_DESDE`, `CLIENTES_OCULTOS`, `AUTH_ALTA_LIBRE`). |
| `PAUTADOR-producto.md` (9/9) | Documento de producto | **Desactualizado en lo esencial**: dice que corre contra la sandbox, solo Informativo, 9 formatos (hoy 3), Intensidad hardcodeada, sin Tareas/ingesta/Storage/plataformas/Canal/cliente/accesos por activo. Las secciones de reglas de Meta (3) y escalabilidad (10) siguen válidas y valen mucho. |
| `flujo-pauta-meta.md` | Diseño original (4/9) | Histórico. Varias cosas no se construyeron así (permisos_pautador → usuarios/usuario_accesos; tabla `registro`; modos Lote/Auto). Sirve de contexto, no de referencia. |
| `Pauta Automática — Documentación.md` | Piloto de Toni | Otro producto; referencia de reglas de Meta. |
| Guía de uso por rol | — | **No existe.** Es lo que le falta a un usuario no técnico: 1 página para PM/Cuentas ("cómo pido una pauta"), 1 para Implementador ("qué hago con lo pendiente y lo manual"), 1 para Admin (usuarios, activos, audiencias). |

Propuesta: (1) escribir las 3 guías cortas con capturas de la app real; (2) reescribir la sección 1–2 y 6 de `PAUTADOR-producto.md` al estado del 12/9 y agregar una sección "Operación" (ingesta, Tareas, códigos, Storage, variables); (3) README solo técnico: cómo correr local, variables, Railway, migraciones.

## 7. Qué haría primero (orden sugerido)

1. Sacar el selector "entrá como" de producción (4.1 #1) — 15 min.
2. Sección "Para cargar a mano" + contador unificado (4.1 #2) — 2 h.
3. Borrar las 13 filas viejas de prueba (4.1 #3) — con tu OK.
4. Ocultar Tipo "Automatización" y preseleccionar Placement Feed (4.1 #4 y #5) — 30 min.
5. Preview real para materiales por link (4.1 #6) — 2 h (reusa Storage).
6. Renombrar términos y módulos (4.2) — 2 h, sin tocar lógica.
7. Guías por rol + actualizar docs (6) — medio día.
