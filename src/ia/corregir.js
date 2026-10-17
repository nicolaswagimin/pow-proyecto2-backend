import { ErrorIA, llamarGeminiJson } from '../ia.js';
import * as cacheBD from './cache.js';
import { claveDe } from './cache.js';
import { esquemaEntrada, esquemaEntradaFragmentos, validarCorreccion, validarRespuestaFragmentos } from './esquema.js';
import {
  INSTRUCCIONES_CORRECCION,
  INSTRUCCIONES_FRAGMENTOS,
  VERSION_FRAGMENTOS,
  VERSION_PROMPT,
  construirPrompt,
  construirPromptFragmentos,
} from './prompt.js';

export { MAX_HTML_IA } from './esquema.js';

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

const MENSAJES_PROPIOS = /^(No hay|El HTML|Se pueden)/;

function validarEntrada(entrada) {
  const r = esquemaEntrada.safeParse(entrada);
  if (r.success) return r.data;
  const propio = r.error.issues.find((i) => MENSAJES_PROPIOS.test(i.message));
  throw new ErrorIA(propio?.message ?? 'Los problemas enviados no tienen el formato esperado.', 400);
}

// Explica y corrige los problemas con Gemini. La misma entrada sale de la caché (no se vuelve a
// llamar); una respuesta inválida se reintenta una vez contándole a Gemini qué falló.
export async function corregir(entrada, { llamar = llamarGeminiJson, cache = cacheBD } = {}) {
  const { html, problemas } = validarEntrada(entrada);
  const clave = claveDe({ html, problemas }, VERSION_PROMPT);

  const guardada = await cache.leer(clave).catch(() => null);
  if (guardada) return { ...guardada, desdeCache: true };

  const usuario = construirPrompt({ html, problemas });
  let errores = [];
  for (let intento = 0; intento < 2; intento++) {
    const texto = await llamar({
      sistema: INSTRUCCIONES_CORRECCION,
      usuario: intento === 0
        ? usuario
        : `${usuario}\n\nTu respuesta anterior no era válida:\n${errores.map((e) => `- ${e}`).join('\n')}\nCorrígela y devuelve solo el JSON.`,
    });
    const valor = extraerJson(texto);
    const validacion = valor ? validarCorreccion(valor, problemas) : { ok: false, errores: ['La respuesta no era JSON.'] };
    if (validacion.ok) {
      await cache.escribir(clave, validacion.correccion).catch(() => {});
      return { ...validacion.correccion, desdeCache: false };
    }
    errores = validacion.errores;
  }
  throw new ErrorIA('La IA devolvió una corrección inválida dos veces. Inténtalo de nuevo en un momento.', 502);
}

// ---------- Corrección por fragmentos ----------

const MENSAJES_FRAGMENTOS = /^(No hay|Se pueden|Cada fragmento|Los fragmentos superan)/;

function validarEntradaFragmentos(entrada) {
  const r = esquemaEntradaFragmentos.safeParse(entrada);
  if (r.success) return r.data;
  const propio = r.error.issues.find((i) => MENSAJES_FRAGMENTOS.test(i.message));
  throw new ErrorIA(propio?.message ?? 'Los fragmentos enviados no tienen el formato esperado.', 400);
}

// La clave depende de lo que ve Gemini (regla, fragmento, contexto y versión del prompt), no del
// id: el mismo fragmento en otra página u otro lote sale de la caché.
export function claveFragmento(f, pagina) {
  const { regla, ayuda = '', html, padre = '', resumen = '' } = f;
  return claveDe({ regla, ayuda, html, padre, resumen, idioma: pagina.idioma, titulo: pagina.titulo }, VERSION_FRAGMENTOS);
}

// Corrige fragmentos sueltos: los que están en la caché no se piden; los demás van a Gemini en
// una sola llamada. Si faltan algunos, se reintenta una vez solo con esos; lo que aún falte vuelve
// en sinRespuesta (502 solo si no hay ninguno).
export async function corregirFragmentos(entrada, { llamar = llamarGeminiJson, cache = cacheBD } = {}) {
  const { pagina, fragmentos } = validarEntradaFragmentos(entrada);
  const resultado = new Map();
  let pendientes = [];
  for (const f of fragmentos) {
    const guardada = await cache.leer(claveFragmento(f, pagina)).catch(() => null);
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
      await cache.escribir(claveFragmento(f, pagina), respuesta).catch(() => {});
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
