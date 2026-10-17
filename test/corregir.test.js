import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorIA, llamarGeminiJson } from '../src/ia.js';
import { corregir } from '../src/ia/corregir.js';

// Gemini y la caché simulados: las pruebas nunca gastan cuota.

const problemas = [{ regla: 'image-alt', ayuda: 'Images must have alternate text', nodos: [{ selector: 'img', html: '<img src="a.png">' }] }];
const entrada = { html: '<main><img src="a.png"></main>', problemas };

const valida = JSON.stringify({
  problemas: [{ regla: 'image-alt', selector: 'img', explicacion: 'Falta el texto alternativo.', original: '<img src="a.png">', corregido: '<img src="a.png" alt="Logo">' }],
  documento: '<main><img src="a.png" alt="Logo"></main>',
});
const invalida = JSON.stringify({ problemas: [] });

function falsos(respuestas) {
  const llamadas = [];
  const llamar = async (pedido) => {
    llamadas.push(pedido);
    const r = respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  };
  const guardado = new Map();
  const cache = { leer: async (k) => guardado.get(k) ?? null, escribir: async (k, v) => guardado.set(k, v) };
  return { llamar, llamadas, cache };
}

async function errorDe(promesa) {
  try {
    await promesa;
  } catch (err) {
    assert.ok(err instanceof ErrorIA, String(err));
    return err;
  }
  assert.fail('se esperaba un error');
}

test('devuelve la corrección si la primera respuesta es válida', async () => {
  const f = falsos([valida]);
  const r = await corregir(entrada, f);
  assert.equal(f.llamadas.length, 1);
  assert.equal(r.desdeCache, false);
  assert.equal(r.problemas[0].corregido, '<img src="a.png" alt="Logo">');
});

test('reintenta una vez con los errores', async () => {
  const f = falsos([invalida, valida]);
  await corregir(entrada, f);
  assert.equal(f.llamadas.length, 2);
  assert.match(f.llamadas[1].usuario, /documento/);
});

test('dos respuestas inválidas → 502 con mensaje claro', async () => {
  const err = await errorDe(corregir(entrada, falsos([invalida, invalida])));
  assert.equal(err.estado, 502);
  assert.match(err.message, /inválida dos veces/);
});

test('Gemini saturado (429) → 429 con mensaje claro', async () => {
  const err = await errorDe(corregir(entrada, falsos([new ErrorIA('La IA está saturada', 429)])));
  assert.equal(err.estado, 429);
});

test('la misma entrada no vuelve a llamar a Gemini', async () => {
  const f = falsos([valida]);
  await corregir(entrada, f);
  const segunda = await corregir(structuredClone(entrada), f);
  assert.equal(f.llamadas.length, 1);
  assert.equal(segunda.desdeCache, true);
});

test('sin problemas, HTML vacío, demasiado HTML o demasiados problemas → 400 sin llamar', async () => {
  for (const mala of [
    { ...entrada, problemas: [] },
    { ...entrada, html: '   ' },
    { ...entrada, html: 'x'.repeat(100_001) },
    { ...entrada, problemas: Array.from({ length: 31 }, () => problemas[0]) },
  ]) {
    const f = falsos([valida]);
    const err = await errorDe(corregir(mala, f));
    assert.equal(err.estado, 400);
    assert.equal(f.llamadas.length, 0);
  }
});

test('llamarGeminiJson convierte un 429 de Gemini en ErrorIA 429', async () => {
  process.env.GEMINI_API_KEY = 'clave-de-prueba';
  const fetchImpl = async () => new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 });
  const err = await errorDe(llamarGeminiJson({ sistema: 'S', usuario: 'U', fetchImpl }));
  assert.equal(err.estado, 429);
  assert.match(err.message, /saturada/);
});

test('llamarGeminiJson pide JSON y devuelve el texto', async () => {
  process.env.GEMINI_API_KEY = 'clave-de-prueba';
  let cuerpo;
  const fetchImpl = async (url, opciones) => {
    cuerpo = JSON.parse(opciones.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }));
  };
  assert.equal(await llamarGeminiJson({ sistema: 'S', usuario: 'U', fetchImpl }), '{"a":1}');
  assert.equal(cuerpo.generationConfig.responseMimeType, 'application/json');
});
