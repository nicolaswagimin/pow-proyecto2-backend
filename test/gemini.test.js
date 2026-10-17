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


const ok = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }));
const ocupado = () =>
  new Response(JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }), { status: 503 });

test('llamarGeminiJson reintenta una vez si Gemini está ocupado (503)', async () => {
  process.env.GEMINI_API_KEY = 'clave-de-prueba';
  const respuestas = [ocupado(), ok()];
  let llamadas = 0;
  const fetchImpl = async () => respuestas[llamadas++];
  assert.equal(await llamarGeminiJson({ sistema: 'S', usuario: 'U', fetchImpl, esperaReintentoMs: 0 }), '{"a":1}');
  assert.equal(llamadas, 2);
});

test('llamarGeminiJson: si sigue ocupado, 503 con un mensaje claro', async () => {
  process.env.GEMINI_API_KEY = 'clave-de-prueba';
  let llamadas = 0;
  const fetchImpl = async () => {
    llamadas++;
    return ocupado();
  };
  const err = await errorDe(llamarGeminiJson({ sistema: 'S', usuario: 'U', fetchImpl, esperaReintentoMs: 0 }));
  assert.equal(llamadas, 2);
  assert.equal(err.estado, 503);
  assert.equal(err.message, 'La IA está muy solicitada en este momento. Espera unos segundos y pulsa «Corregir más».');
});
