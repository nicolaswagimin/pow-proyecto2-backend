import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorDescarga, descargarPagina } from '../src/paginas/descargar.js';
import { ErrorSsrf } from '../src/paginas/direcciones.js';

const PUBLICA = [{ address: '93.184.216.34', family: 4 }];

// DNS y red simulados: cada respuesta es { statusCode, headers, cuerpo } o una función (url) => …
function red(respuestas, { dns = () => PUBLICA } = {}) {
  const pedidos = [];
  const resolver = async (host) => dns(host);
  const pedir = async (url, opciones) => {
    pedidos.push({ url: String(url), opciones });
    const r = respuestas[Math.min(pedidos.length - 1, respuestas.length - 1)];
    const datos = typeof r === 'function' ? await r(url, opciones) : r;
    const trozos = Array.isArray(datos.cuerpo) ? datos.cuerpo : [datos.cuerpo ?? ''];
    return {
      statusCode: datos.statusCode ?? 200,
      headers: { 'content-type': 'text/html; charset=utf-8', ...datos.headers },
      body: (async function* () {
        for (const t of trozos) yield Buffer.from(t);
      })(),
    };
  };
  return { resolver, pedir, pedidos };
}

async function rechazo(promesa, Clase, patron) {
  await assert.rejects(promesa, (err) => {
    assert.ok(err instanceof Clase, `${err?.constructor?.name}: ${err?.message}`);
    assert.match(err.message, patron);
    return true;
  });
}

test('descarga una página pública', async () => {
  const r = red([{ cuerpo: '<html><body>Hola</body></html>' }]);
  const { html, urlFinal } = await descargarPagina('https://ejemplo.org/', r);
  assert.equal(html, '<html><body>Hola</body></html>');
  assert.equal(urlFinal, 'https://ejemplo.org/');
});

test('la conexión usa la IP ya validada (sin volver a resolver)', async () => {
  const r = red([{ cuerpo: 'x' }]);
  await descargarPagina('https://ejemplo.org/', r);
  const direccion = await new Promise((ok) =>
    r.pedidos[0].opciones.lookup('ejemplo.org', {}, (err, address) => ok(address)),
  );
  assert.equal(direccion, '93.184.216.34');
});

test('un dominio que resuelve a una IP privada se rechaza', async () => {
  const r = red([{ cuerpo: 'x' }], { dns: () => [{ address: '10.0.0.5', family: 4 }] });
  await rechazo(descargarPagina('https://interno.ejemplo.org/', r), ErrorSsrf, /internas/);
  assert.equal(r.pedidos.length, 0);
});

test('si una de las IPs es privada, se rechaza', async () => {
  const r = red([{ cuerpo: 'x' }], { dns: () => [...PUBLICA, { address: '127.0.0.1', family: 4 }] });
  await rechazo(descargarPagina('https://ejemplo.org/', r), ErrorSsrf, /internas/);
});

test('una redirección a una dirección interna se rechaza', async () => {
  const r = red([{ statusCode: 302, headers: { location: 'http://127.0.0.1/admin' } }]);
  await rechazo(descargarPagina('https://ejemplo.org/', r), ErrorSsrf, /internas/);
});

test('una redirección a un dominio que resuelve a privada se rechaza', async () => {
  const r = red([{ statusCode: 301, headers: { location: 'https://trampa.ejemplo.org/' } }], {
    dns: (host) => (host === 'trampa.ejemplo.org' ? [{ address: '::1', family: 6 }] : PUBLICA),
  });
  await rechazo(descargarPagina('https://ejemplo.org/', r), ErrorSsrf, /internas/);
});

test('sigue redirecciones válidas y devuelve la URL final', async () => {
  const r = red([{ statusCode: 301, headers: { location: '/nueva' } }, { cuerpo: 'ok' }]);
  const { urlFinal } = await descargarPagina('https://ejemplo.org/vieja', r);
  assert.equal(urlFinal, 'https://ejemplo.org/nueva');
});

test('más de 3 redirecciones se rechaza', async () => {
  const r = red([{ statusCode: 302, headers: { location: '/otra' } }]);
  await rechazo(descargarPagina('https://ejemplo.org/', r), ErrorDescarga, /redirecciones/);
});

test('una página de más de 2 MB se corta', async () => {
  const trozo = 'a'.repeat(1024 * 1024);
  const r = red([{ cuerpo: [trozo, trozo, trozo] }]);
  await rechazo(descargarPagina('https://ejemplo.org/', r), ErrorDescarga, /2 MB/);
});

test('si tarda demasiado, se corta', async () => {
  const r = red([
    (url, { signal }) => new Promise((_, rechazar) => signal.addEventListener('abort', () => rechazar(signal.reason))),
  ]);
  await rechazo(descargarPagina('https://ejemplo.org/', { ...r, tiempoMs: 20 }), ErrorDescarga, /tardó demasiado/);
});

test('algo que no es HTML se rechaza', async () => {
  const r = red([{ headers: { 'content-type': 'image/png' }, cuerpo: 'x' }]);
  await rechazo(descargarPagina('https://ejemplo.org/a.png', r), ErrorDescarga, /no es una página HTML/);
});

test('un error HTTP se informa con su código', async () => {
  const r = red([{ statusCode: 404, cuerpo: 'no' }]);
  await rechazo(descargarPagina('https://ejemplo.org/', r), ErrorDescarga, /404/);
});

test('un dominio que no existe se informa', async () => {
  const r = red([{ cuerpo: 'x' }], {
    dns: () => {
      throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    },
  });
  await rechazo(descargarPagina('https://no-existe.ejemplo/', r), ErrorDescarga, /No encontramos/);
});
