import { ErrorIA, llamarGeminiJson } from '../ia.js';
import * as cacheBD from './cache.js';
import { claveDe } from './cache.js';
import { esquemaEntradaFragmentos, validarRespuestaFragmentos } from './esquema.js';
import { INSTRUCCIONES_FRAGMENTOS, VERSION_PROMPT, construirPromptFragmentos } from './prompt.js';

function extraerJson(texto) {
  const inicio = texto.indexOf('{');
  const fin = texto.lastIndexOf('}');
  if (inicio === -1 || fin <= inicio) return null;
  try {
    return JSON.parse(texto.slice(inicio, fin + 1));
  } catch {
    return null;
  }
}

const MENSAJES_FRAGMENTOS = /^(No hay|Se pueden|Cada fragmento|Los fragmentos superan)/;

function validarEntradaFragmentos(entrada) {
  const r = esquemaEntradaFragmentos.safeParse(entrada);
  if (r.success) return r.data;
  const propio = r.error.issues.find((i) => MENSAJES_FRAGMENTOS.test(i.message));
  throw new ErrorIA(propio?.message ?? 'Los fragmentos enviados no tienen el formato esperado.', 400);
}

const contenido = ({ regla, ayuda = '', html, padre = '', resumen = '' }) => ({ regla, ayuda, html, padre, resumen });

// La clave depende de lo que ve Gemini: el fragmento, su contexto, la versión del prompt y el lote
// entero en que se pidió (sin ids). Gemini ve todo el lote en un prompt, así que otro fragmento
// podría influir en la respuesta; con el lote en la clave, nadie puede envenenar la corrección de
// un fragmento común para otra persona. El mismo lote (la misma página) sí sale de la caché.
export function claveFragmento(f, pagina, lote) {
  return claveDe(
    { ...contenido(f), idioma: pagina.idioma, titulo: pagina.titulo, lote: lote.map(contenido) },
    VERSION_PROMPT,
  );
}

// Corrige fragmentos sueltos: los que están en la caché no se piden; los demás van a Gemini en
// una sola llamada. Si faltan algunos, se reintenta una vez solo con esos; lo que aún falte vuelve
// en sinRespuesta (502 solo si no hay ninguno).
export async function corregirFragmentos(entrada, { llamar = llamarGeminiJson, cache = cacheBD } = {}) {
  const { pagina, fragmentos } = validarEntradaFragmentos(entrada);
  const resultado = new Map();
  let pendientes = [];
  for (const f of fragmentos) {
    const guardada = await cache.leer(claveFragmento(f, pagina, fragmentos)).catch(() => null);
    if (guardada) resultado.set(f.id, { id: f.id, ...guardada, desdeCache: true });
    else pendientes.push(f);
  }

  let errores = [];
  for (let intento = 0; intento < 2 && pendientes.length; intento++) {
    const usuario = construirPromptFragmentos({ pagina, fragmentos: pendientes });
    const texto = await llamar({
      sistema: INSTRUCCIONES_FRAGMENTOS,
      usuario: intento === 0
        ? usuario
        : `${usuario}\n\nTu respuesta anterior no era válida o faltó alguno de estos fragmentos:\n${errores.map((e) => `- ${e}`).join('\n')}\nDevuelve solo el JSON con estos fragmentos.`,
    });
    const valor = extraerJson(texto);
    const { validos, errores: nuevos } = valor
      ? validarRespuestaFragmentos(valor, pendientes)
      : { validos: [], errores: ['La respuesta no era JSON.'] };
    for (const v of validos) {
      const f = pendientes.find((p) => p.id === v.id);
      const respuesta = { explicacion: v.explicacion, corregido: v.corregido };
      await cache.escribir(claveFragmento(f, pagina, fragmentos), respuesta).catch(() => {});
      resultado.set(v.id, { id: v.id, ...respuesta, desdeCache: false });
    }
    pendientes = pendientes.filter((p) => !resultado.has(p.id));
    errores = [...nuevos, ...pendientes.map((p) => `Falta el fragmento "${p.id}".`)];
  }

  if (!resultado.size) {
    throw new ErrorIA('La IA devolvió una corrección inválida dos veces. Inténtalo de nuevo en un momento.', 502);
  }
  return {
    fragmentos: fragmentos.filter((f) => resultado.has(f.id)).map((f) => resultado.get(f.id)),
    sinRespuesta: pendientes.map((p) => p.id),
  };
}
