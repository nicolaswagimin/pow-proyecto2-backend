import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, request } from 'undici';
import { ErrorSsrf, esIpPrivada, validarUrl } from './direcciones.js';

// Descarga una página para auditarla, sin abrir la puerta a SSRF:
// 1. Se resuelve el DNS y se rechaza si CUALQUIER dirección es interna.
// 2. La conexión se fija a la IP ya validada (no se vuelve a resolver: evita DNS rebinding).
// 3. Las redirecciones se siguen a mano, como mucho 3, revalidando cada destino.
// 4. Hay tiempo máximo, tamaño máximo y solo se acepta HTML.

export class ErrorDescarga extends Error {}

const REDIRECCIONES = new Set([301, 302, 303, 307, 308]);
const TIPOS_HTML = /^(text\/html|application\/xhtml\+xml)\b/i;
const MENSAJE_INTERNA = 'No se pueden auditar direcciones internas o locales.';

async function resolverDns(host) {
  return lookup(host, { all: true, verbatim: true });
}

// `lookup` para net.connect que siempre devuelve la dirección validada.
function fijar({ address, family }) {
  return (hostname, opciones, callback) => {
    if (opciones?.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

async function pedirConUndici(url, { lookup: fijado, signal }) {
  const dispatcher = new Agent({ connect: { lookup: fijado } });
  return request(url, {
    dispatcher,
    signal,
    headers: { 'user-agent': 'a11Lens/1.0 (auditor de accesibilidad)', accept: 'text/html,*/*;q=0.5' },
  });
}

async function direccionesDe(url, resolver) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return [{ address: host, family: isIP(host) }];
  try {
    return await resolver(host);
  } catch {
    throw new ErrorDescarga('No encontramos ese dominio. Revisa que la dirección esté bien escrita.');
  }
}

async function leerConLimite(body, maxBytes) {
  const trozos = [];
  let total = 0;
  for await (const trozo of body) {
    total += trozo.length;
    if (total > maxBytes) {
      body.destroy?.();
      throw new ErrorDescarga(`La página supera ${Math.round(maxBytes / 1_000_000)} MB, el máximo que se puede auditar.`);
    }
    trozos.push(trozo);
  }
  return Buffer.concat(trozos).toString('utf8');
}

async function descartar(body) {
  try {
    for await (const trozo of body) void trozo;
  } catch {
    // no importa: solo se libera la conexión
  }
}

export async function descargarPagina(
  texto,
  {
    resolver = resolverDns,
    pedir = pedirConUndici,
    tiempoMs = 8000,
    maxBytes = 2_000_000,
    maxRedirecciones = 3,
  } = {},
) {
  const signal = AbortSignal.timeout(tiempoMs);
  let url = validarUrl(texto);

  try {
    for (let saltos = 0; ; saltos++) {
      const direcciones = await direccionesDe(url, resolver);
      if (!direcciones.length || direcciones.some((d) => esIpPrivada(d.address))) {
        throw new ErrorSsrf(MENSAJE_INTERNA);
      }

      const respuesta = await pedir(url, { lookup: fijar(direcciones[0]), signal });

      if (REDIRECCIONES.has(respuesta.statusCode)) {
        await descartar(respuesta.body);
        if (saltos >= maxRedirecciones) {
          throw new ErrorDescarga(`La página hace más de ${maxRedirecciones} redirecciones.`);
        }
        const destino = respuesta.headers.location;
        if (!destino) throw new ErrorDescarga('La página redirige sin indicar a dónde.');
        url = validarUrl(new URL(destino, url).href);
        continue;
      }

      if (respuesta.statusCode >= 400) {
        await descartar(respuesta.body);
        throw new ErrorDescarga(`La página respondió con el código ${respuesta.statusCode}.`);
      }
      if (!TIPOS_HTML.test(String(respuesta.headers['content-type'] ?? ''))) {
        await descartar(respuesta.body);
        throw new ErrorDescarga('Esa dirección no es una página HTML.');
      }

      const html = await leerConLimite(respuesta.body, maxBytes);
      return { html, urlFinal: url.href };
    }
  } catch (err) {
    if (err instanceof ErrorSsrf || err instanceof ErrorDescarga) throw err;
    if (signal.aborted) throw new ErrorDescarga('La página tardó demasiado en responder.');
    throw new ErrorDescarga('No pudimos descargar la página.');
  }
}
