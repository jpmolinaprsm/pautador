// Plataformas y Formatos del Pedido de Anuncios NORMAL (punto 4 del plan,
// lista de AppSheet/Plataformas y Formatos.xlsx). Meta es la única que
// PAUTADOR publica solo; el resto queda "manual_pendiente" para que el
// implementador lo cargue a mano en la plataforma y lo marque hecho — por
// eso acá no hay nada de API, solo qué se puede pedir y con qué campos.
//
// El modo "automatizado" NUNCA usa esto: es Meta siempre (ver
// pedidos.js — la plataforma solo se lee en modo normal).
//
// Meta: formatos = null → se usan los de equiv_formato (Imagen/Video/
// Carrusel) y los objetivos de equiv_objetivo, como siempre.

const PLATAFORMAS = [
  {
    nombre: 'Meta',
    formatos: null,
    objetivos: null,
    placements: true,
    // Con qué Formato de AppSheet se busca la Categoría de Pieza.
    categoriaPor: { Imagen: ['Placa Fija', 'Placa Animada'], Video: ['Video', 'Reel'], Carrusel: ['Carrusel'] },
  },
  {
    nombre: 'Youtube',
    formatos: ['Bumper', 'Shorts', 'Video'],
    objetivos: ['Views', 'Alcance', 'Tráfico'],
    soloVideo: true,
    // El material puede ser un link de YouTube (el video ya subido al canal):
    // no se verifica como archivo, se acepta tal cual (usuario, 2026-09-15).
    aceptaLinkYoutube: true,
    categoriaPor: { Bumper: ['Bumper'], Shorts: ['Video', 'Reel'], Video: ['Video'] },
    ayudaMaterial: 'Video (Bumper: 6 segundos máximo).',
  },
  {
    nombre: 'Tik Tok',
    formatos: ['Feed'],
    objetivos: ['Views', 'Alcance', 'Interacción'],
    soloVideo: true,
    categoriaPor: { Feed: ['Video', 'Reel'] },
    ayudaMaterial: 'Video vertical 9:16 (1080×1920).',
  },
  {
    nombre: 'X',
    formatos: ['Carrusel', 'Video', 'Placa'],
    objetivos: ['Alcance', 'Interacción', 'Tráfico'],
    categoriaPor: { Carrusel: ['Carrusel'], Video: ['Video'], Placa: ['Placa Fija', 'Placa Animada'] },
  },
  {
    nombre: 'Display',
    formatos: ['Banner'],
    objetivos: ['Impresiones', 'Tráfico'],
    requiereLink: true,
    medidas: ['300×250', '728×90', '320×50', '300×600', '160×600'],
    categoriaPor: { Banner: ['Banners'] },
    ayudaMaterial: 'Una pieza por medida: 300×250, 728×90, 320×50, 300×600, 160×600. Link de destino obligatorio.',
  },
];

// Categoría de Pieza por Formato de AppSheet (hoja "Categoría Pieza" de
// AppSheet Contenidos.xlsx, 2026-09-11).
const CATEGORIAS_PIEZA = {
  'Placa Fija': ['Identidad de medio', 'Informativa sin identidad de medio', 'Pantalla partida', 'Cronología', 'Opinión', 'Quote', 'Mapa', 'Gráfico', 'Hook (¿Sabías que?, Conocé, Qué es)', 'Solo Titular', 'Imagen en círculo', 'Meme'],
  'Placa Animada': ['Identidad de medio', 'Informativa sin identidad de medio', 'Pantalla partida', 'Cronología', 'Opinión', 'Quote', 'Mapa', 'Gráfico', 'Hook (¿Sabías que?, Conocé, Qué es)'],
  Carrusel: ['Identidad de medio', 'Informativa sin identidad de medio', 'Pantalla partida', 'Cronología', 'Opinión', 'Quote', 'Mapa', 'Gráfico', 'Hook (¿Sabías que?, Conocé, Qué es)'],
  Video: ['Entrevista TV', 'Nota radio', 'Informe', 'Animación IA', 'Conferencia oficial', 'Operativos Policiales', 'Periodista', 'Influencer', 'Especialista', 'Testimonio ciudadano'],
  Reel: ['Entrevista TV', 'Nota radio', 'Informe', 'Animación IA', 'Conferencia oficial'],
  Banners: ['Banners'],
  Bumper: ['Bumper'],
};

// Qué "modo" (imagen / video / carrusel) es cada Formato de cada plataforma
// — es lo que permite pedir VARIAS plataformas juntas: con más de una
// elegida, los formatos que se ofrecen son los genéricos (Imagen / Video /
// Carrusel) que TODAS soportan (ej. Meta + Youtube → solo Video).
const MODO_POR_FORMATO = {
  Meta: { Imagen: 'imagen', Video: 'video', Carrusel: 'carrusel' },
  Youtube: { Bumper: 'video', Shorts: 'video', Video: 'video' },
  'Tik Tok': { Feed: 'video' },
  X: { Carrusel: 'carrusel', Video: 'video', Placa: 'imagen' },
  Display: { Banner: 'imagen' },
};
const FORMATO_GENERICO = { imagen: 'Imagen', video: 'Video', carrusel: 'Carrusel' };

function getPlataforma(nombre) {
  return PLATAFORMAS.find((p) => p.nombre === nombre) || null;
}

// "Meta, Youtube" | ["Meta","Youtube"] -> ["Meta","Youtube"] (sin repetidos)
function parsearPlataformas(valor) {
  const lista = Array.isArray(valor) ? valor : String(valor || '').split(',');
  return [...new Set(lista.map((s) => String(s || '').trim()).filter(Boolean))];
}

// Combina 1..n plataformas en una sola "vista": qué formatos/objetivos
// valen para el conjunto y qué exige alguna de ellas. Devuelve null si
// alguna no existe.
function combinarPlataformas(nombres) {
  const infos = nombres.map(getPlataforma);
  if (!nombres.length || infos.some((p) => !p)) return null;
  const esMeta = nombres.length === 1 && nombres[0] === 'Meta';
  let formatos;
  if (nombres.length === 1) {
    formatos = infos[0].formatos ? infos[0].formatos.map((f) => ({ nombre: f, modo: MODO_POR_FORMATO[nombres[0]][f] })) : null;
  } else {
    const modosDe = (n) => new Set(Object.values(MODO_POR_FORMATO[n] || {}));
    formatos = ['imagen', 'video', 'carrusel']
      .filter((m) => nombres.every((n) => modosDe(n).has(m)))
      .map((m) => ({ nombre: FORMATO_GENERICO[m], modo: m }));
  }
  const conObjetivos = infos.filter((p) => p.objetivos);
  const objetivos = conObjetivos.length
    ? conObjetivos[0].objetivos.filter((o) => conObjetivos.every((p) => p.objetivos.includes(o)))
    : null;
  return {
    nombres,
    nombre: nombres.join(', '),
    esMeta,
    formatos, // null = los de equiv_formato (solo Meta sola)
    objetivos, // null = los de equiv_objetivo
    requiereLink: infos.some((p) => p.requiereLink),
    soloVideo: infos.some((p) => p.soloVideo),
    // Solo si TODAS aceptan link de YouTube (hoy: Youtube sola) — un link de
    // YouTube no sirve como material para Meta.
    aceptaLinkYoutube: infos.every((p) => p.aceptaLinkYoutube),
    placements: esMeta,
    medidas: infos.flatMap((p) => p.medidas || []),
    ayudaMaterial: infos.map((p) => p.ayudaMaterial).filter(Boolean).join(' '),
  };
}

// Modo del formato pedido para ese conjunto (carrusel/imagen/video) — o ''.
function modoDelFormato(comb, formato) {
  if (!comb || !formato) return '';
  if (comb.esMeta) return (MODO_POR_FORMATO.Meta[formato] || '');
  const f = (comb.formatos || []).find((x) => x.nombre === formato);
  return f ? f.modo : '';
}

function categoriasPara(plataforma, formato) {
  const p = getPlataforma(plataforma);
  const fuentes = (p && p.categoriaPor && p.categoriaPor[formato]) || [];
  return [...new Set(fuentes.flatMap((f) => CATEGORIAS_PIEZA[f] || []))];
}

// youtube.com/watch?v=…, youtu.be/…, youtube.com/shorts/… (misma regla en el front).
function esLinkYoutube(url) {
  return /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/|live\/)|youtu\.be\/)/i.test(String(url || '').trim());
}

// "Público" por plataforma (usuario, 2026-09-15): promocionar una publicación
// que ya existe en esa red. Display no tiene (los banners siempre son un
// anuncio nuevo). El link tiene que ser de la red correspondiente.
const LINK_PUBLICO = {
  Meta: /^https?:\/\/(www\.|m\.|business\.)?(facebook\.com|fb\.com|fb\.watch|instagram\.com)\//i,
  Youtube: /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/|live\/)|youtu\.be\/)/i,
  'Tik Tok': /^https?:\/\/(www\.|vm\.|vt\.)?tiktok\.com\//i,
  X: /^https?:\/\/(www\.|mobile\.)?(x\.com|twitter\.com)\//i,
};
function tienePublico(nombre) { return !!LINK_PUBLICO[nombre]; }
function esLinkPublicacion(nombre, url) {
  const re = LINK_PUBLICO[nombre];
  return !!re && re.test(String(url || '').trim());
}

// Link a una CARPETA de Drive o Dropbox (Display: el implementador baja las
// piezas de ahí) — no es un archivo, no se verifica como tal.
function esLinkCarpeta(url) {
  return /^https?:\/\/(drive\.google\.com\/drive\/(u\/\d+\/)?folders\/|(www\.)?dropbox\.com\/(scl\/fo\/|sh\/|home\/))/i.test(String(url || '').trim());
}

module.exports = { PLATAFORMAS, CATEGORIAS_PIEZA, MODO_POR_FORMATO, getPlataforma, parsearPlataformas, combinarPlataformas, modoDelFormato, categoriasPara, esLinkYoutube, tienePublico, esLinkPublicacion, esLinkCarpeta, LINK_PUBLICO };
