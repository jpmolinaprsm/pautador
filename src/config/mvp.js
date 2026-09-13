// Recorte a MVP — ver plan "MVP: sacar Validación". Una sola fuente de
// verdad para las rutas GET (selects del front) y pedidos.js (validación
// real, defensa en profundidad) — cambiar el alcance el día de mañana es
// tocar un solo archivo.
const INTENSIDADES_PERMITIDAS = ['Media', 'Baja'];
const OBJETIVOS_PERMITIDOS = ['Alcance', 'Interacción'];

// Tipo "Pautas Army" (codigo 'Y', monto_fijo en vez de Intensidad) — pedido
// explícito del usuario (2026-09-11): también entra en Automatizadas, aparte
// del filtro normal de Intensidad Media/Baja (que no le aplica, no tiene
// Intensidad). Único Tipo de monto fijo habilitado hoy.
// '0' = "Automatización": el Tipo con el que vienen codificadas las pautas
// de las hojas salida_manual_* (ej. GDCHAC0AG00262) — entra en Automatizado
// porque ES el flujo automático, no lo elige nadie a mano.
function esTipoPermitidoAutomatizado(tipo) {
  if (!tipo) return false;
  if (tipo.codigo === 'Y' || String(tipo.codigo) === '0') return true;
  return !tipo.monto_fijo && INTENSIDADES_PERMITIDAS.includes(tipo.intensidad);
}

module.exports = { INTENSIDADES_PERMITIDAS, OBJETIVOS_PERMITIDOS, esTipoPermitidoAutomatizado };
