import { ErrorIA, llamarGeminiJson } from '../ia.js';
import * as cacheBD from './cache.js';
import { claveDe } from './cache.js';
import { esquemaEntrada, validarCorreccion } from './esquema.js';
import { INSTRUCCIONES_CORRECCION, VERSION_PROMPT, construirPrompt } from './prompt.js';

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
