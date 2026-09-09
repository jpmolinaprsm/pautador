// Cómo se arman los nombres de campaña y de conjunto/anuncio.
// (ver flujo-pauta-meta.md, sección 7 — concatenación directa, sin IA).
//
// Vive acá y no en cada adapter porque lo necesitan dos lugares distintos:
// metaAdapterReal, para nombrar lo que crea en Meta, y confirmar.js, para
// registrar la nomenclatura en matriz_distribucion. Estaba duplicado y se
// desincronizó apenas apareció Reels: Meta decía "FB/IG Reels" y el registro
// local seguía diciendo "FB/IG Feed".

// {Código, 9 primeros} - {Eje} - {Tipo} - {Objetivo} - C/D
// El Tipo es el 7º carácter del código, resuelto contra equiv_tipo.
function nomenclaturaCampania(pauta, objetivo, equivTipo) {
  const tipoChar = pauta.codigo[6];
  const tipo = equivTipo.find((t) => String(t.codigo) === tipoChar);
  const tipoNombre = tipo ? tipo.tipo_campana : `Tipo ${tipoChar}`;
  return `${pauta.codigo.slice(0, 9)} - ${pauta.eje} - ${tipoNombre} - ${objetivo} - C/D`;
}

// AppSheet separa multipicks con "," — mismo parser que usa
// metaAdapterReal.js para Red/Placement (duplicado a propósito acá: este
// archivo tiene que poder armar el nombre sin importar nada de los
// adapters, ni el mock ni el real).
function parseListaSimple(valor) {
  if (!valor) return [];
  if (Array.isArray(valor)) return valor;
  return String(valor).split(',').map((v) => v.trim()).filter(Boolean);
}

// "FB", "IG" o "FB/IG" según la Red elegida a mano (pauta.redes) o, sin
// elección explícita, el mismo fallback que usa el targeting real: Facebook
// siempre, Instagram solo si el activo tiene la cuenta conectada.
function etiquetaRed(pauta, activo) {
  const redesElegidas = parseListaSimple(pauta.redes);
  const tieneFb = redesElegidas.length ? redesElegidas.includes('facebook') : true;
  const tieneIg = redesElegidas.length ? redesElegidas.includes('instagram') : !!(activo && activo.ig_actor_id);
  if (tieneFb && tieneIg) return 'FB/IG';
  if (tieneIg) return 'IG';
  return 'FB';
}

const NOMBRE_PLACEMENT = { feed: 'Feed', stories: 'Stories', reels: 'Reels' };

// Placement elegido a mano (pauta.placements, multipick) o, sin elección
// explícita, Feed — mismo criterio que placementsEfectivos() en
// metaAdapterReal.js (el Formato ya no tiene un Placement por defecto).
function etiquetaPlacement(pauta) {
  const elegidos = parseListaSimple(pauta.placements);
  const placements = elegidos.length ? elegidos : ['feed'];
  return placements.map((p) => NOMBRE_PLACEMENT[p] || p).join('/');
}

// {Código} - {Audiencia} - {Eje} - {Contenido} - {Ubicación} - {Objetivo} - C/D
// El "Contenido" ya viene con el "(Formato)" al final desde AppSheet — no hay
// que agregarlo de nuevo. La ubicación refleja la Red y el Placement reales
// de la pieza — antes decía "FB/IG" siempre, sin importar si el activo tenía
// Instagram conectado o si se había elegido explícitamente Facebook o
// Instagram solo.
function nomenclaturaAdset(pauta, celda, activo) {
  const contenido = pauta.contenido || `${pauta.campana} (${pauta.formato})`;
  const ubicacion = `${etiquetaRed(pauta, activo)} ${etiquetaPlacement(pauta)}`;
  return `${pauta.codigo} - ${celda.audiencia.nombre} - ${pauta.eje} - ${contenido} - ${ubicacion} - ${celda.objetivo} - C/D`;
}

// {Código} - {Contenido} - Creative
// El creative se comparte entre TODOS los conjuntos de la pieza (ver
// metaAdapterReal.js: crearCreative) — a diferencia del adset, no lleva
// audiencia ni objetivo, porque no varía por celda.
function nomenclaturaCreative(pauta) {
  const contenido = pauta.contenido || `${pauta.campana} (${pauta.formato})`;
  return `${pauta.codigo} - ${contenido}`;
}

module.exports = { nomenclaturaCampania, nomenclaturaAdset, nomenclaturaCreative };
