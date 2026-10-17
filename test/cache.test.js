import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claveDe } from '../src/ia/cache.js';

const entrada = { html: '<img src="a.png">', problemas: [{ regla: 'image-alt', nodos: [{ selector: 'img' }] }] };

test('la misma entrada da la misma clave', () => {
  assert.equal(claveDe(entrada), claveDe(structuredClone(entrada)));
});

test('el orden de las propiedades no cambia la clave', () => {
  const reordenada = { problemas: [{ nodos: [{ selector: 'img' }], regla: 'image-alt' }], html: entrada.html };
  assert.equal(claveDe(entrada), claveDe(reordenada));
});

test('otra entrada da otra clave', () => {
  assert.notEqual(claveDe(entrada), claveDe({ ...entrada, html: '<img src="b.png">' }));
});

test('otra versión del prompt da otra clave', () => {
  assert.notEqual(claveDe(entrada, 'v1'), claveDe(entrada, 'v2'));
});

test('la clave es un SHA-256 en hexadecimal', () => {
  assert.match(claveDe(entrada), /^[0-9a-f]{64}$/);
});
