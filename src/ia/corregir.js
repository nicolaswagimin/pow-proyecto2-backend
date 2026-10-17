import { ErrorIA, llamarGeminiJson } from '../ia.js';
import * as cacheBD from './cache.js';
import { claveDe } from './cache.js';
import { MAX_PROBLEMAS, validarCorreccion } from './esquema.js';
import { INSTRUCCIONES_CORRECCION, VERSION_PROMPT, construirPrompt } from './prompt.js';

export const MAX_HTML_IA = 100_000;

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

function validarEntrada({ html, problemas }) {
  if (typeof html !== 'string' || !html.trim()) throw new ErrorIA('No hay HTML para corregir.', 400);
  if (html.length > MAX_HTML_IA) {
    throw new ErrorIA('El HTML es demasiado largo para corregirlo con la IA (máximo 100 000 caracteres).', 400);
  }
  if (!Array.isArray(problemas) || problemas.length === 0) {
    throw new ErrorIA('No hay problemas para corregir.', 400);
  }
  if (problemas.length > MAX_PROBLEMAS) {
    throw new ErrorIA(`Se pueden corregir hasta ${MAX_PROBLEMAS} problemas a la vez.`, 400);
  }
}

// Explica y corrige los problemas con Gemini. La misma entrada sale de la caché (no se vuelve a
// llamar); una respuesta inválida se reintenta una vez contándole a Gemini qué falló.
export async function corregir(entrada, { llamar = llamarGeminiJson, cache = cacheBD } = {}) {
  validarEntrada(entrada);
  const { html, problemas } = entrada;
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
