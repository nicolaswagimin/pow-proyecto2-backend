import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorIA, llamarGeminiJson } from '../src/ia.js';

// La llamada a Gemini con un fetch simulado: nunca gasta cuota.

async function errorDe(promesa) {
  try {
    await promesa;
  } catch (err) {
    assert.ok(err instanceof ErrorIA, String(err));
    return err;
  }
  assert.fail('se esperaba un error');
}

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

