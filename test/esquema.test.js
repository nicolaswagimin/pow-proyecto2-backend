import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarCorreccion } from '../src/ia/esquema.js';
import { INSTRUCCIONES_CORRECCION, construirPrompt } from '../src/ia/prompt.js';

const pedidos = [
  { regla: 'image-alt', ayuda: 'Images must have alternate text', nodos: [{ selector: 'img', html: '<img src="a.png">' }] },
  { regla: 'button-name', ayuda: 'Buttons must have discernible text', nodos: [{ selector: '#enviar', html: '<button id="enviar"></button>' }] },
];

const valida = () => ({
  problemas: [
    {
      regla: 'image-alt',
      selector: 'img',
      explicacion: 'La imagen no tiene texto alternativo: quien usa lector de pantalla no sabe qué muestra.',
      original: '<img src="a.png">',
      corregido: '<img src="a.png" alt="Logo de la tienda">',
    },
  ],
  documento: '<html><body><img src="a.png" alt="Logo de la tienda"><button id="enviar">Enviar</button></body></html>',
});

test('acepta una corrección válida', () => {
  const r = validarCorreccion(valida(), pedidos);
  assert.equal(r.ok, true);
  assert.equal(r.correccion.problemas.length, 1);
});

test('rechaza si falta el documento corregido', () => {
  const v = valida();
  delete v.documento;
  const r = validarCorreccion(v, pedidos);
  assert.equal(r.ok, false);
  assert.ok(r.errores.some((e) => /documento/.test(e)), r.errores.join('\n'));
});

test('rechaza una corrección de un problema que no se pidió', () => {
  const v = valida();
  v.problemas[0].regla = 'color-contrast';
  const r = validarCorreccion(v, pedidos);
  assert.ok(r.errores.includes('La corrección de "color-contrast" en "img" no corresponde a ningún problema pedido.'));
});

test('rechaza una explicación vacía', () => {
  const v = valida();
  v.problemas[0].explicacion = '  ';
  assert.equal(validarCorreccion(v, pedidos).ok, false);
});

test('rechaza más de 30 problemas', () => {
  const v = valida();
  v.problemas = Array.from({ length: 31 }, () => valida().problemas[0]);
  assert.equal(validarCorreccion(v, pedidos).ok, false);
});

test('rechaza algo que no es un objeto', () => {
  assert.deepEqual(validarCorreccion('hola', pedidos), { ok: false, errores: ['La respuesta no es un objeto JSON.'] });
});

test('las instrucciones piden español simple, original literal y cambios mínimos', () => {
  assert.match(INSTRUCCIONES_CORRECCION, /español/);
  assert.match(INSTRUCCIONES_CORRECCION, /literal/i);
  assert.match(INSTRUCCIONES_CORRECCION, /mínim/i);
  assert.match(INSTRUCCIONES_CORRECCION, /no inventes/i);
});

test('el prompt incluye el HTML y cada problema con su selector', () => {
  const prompt = construirPrompt({ html: '<main>x</main>', problemas: pedidos });
  assert.match(prompt, /<main>x<\/main>/);
  assert.match(prompt, /image-alt/);
  assert.match(prompt, /#enviar/);
});
