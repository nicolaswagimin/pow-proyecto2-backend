import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esquemaEntradaFragmentos, validarRespuestaFragmentos } from '../src/ia/esquema.js';

const fragmento = (id, extra = {}) => ({
  id,
  regla: 'image-alt',
  ayuda: 'Las imágenes deben tener texto alternativo.',
  html: `<img src="${id}.png">`,
  padre: '<a href="/">',
  resumen: 'Fix any of the following: Element does not have an alt attribute',
  ...extra,
});
const entrada = (fragmentos) => ({ pagina: { idioma: 'es', titulo: 'Tienda' }, fragmentos });
const errorDe = (valor) => esquemaEntradaFragmentos.safeParse(valor).error?.issues.map((i) => i.message) ?? [];

test('acepta una entrada de fragmentos válida', () => {
  const r = esquemaEntradaFragmentos.safeParse(entrada([fragmento('f1'), fragmento('f2')]));
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
});

test('padre, resumen y el contexto de la página son opcionales', () => {
  const r = esquemaEntradaFragmentos.safeParse({ fragmentos: [{ id: 'f1', regla: 'label', html: '<input>' }] });
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.deepEqual(r.data.pagina, { idioma: '', titulo: '' });
});

test('como mucho 10 fragmentos por petición', () => {
  const muchos = Array.from({ length: 11 }, (_, i) => fragmento(`f${i}`));
  assert.ok(errorDe(entrada(muchos)).includes('Se pueden corregir hasta 10 fragmentos a la vez.'));
});

test('sin fragmentos: mensaje propio', () => {
  assert.ok(errorDe(entrada([])).includes('No hay fragmentos para corregir.'));
});

test('un fragmento de más de 4000 caracteres se rechaza', () => {
  const largo = fragmento('f1', { html: `<p>${'x'.repeat(4000)}</p>` });
  assert.ok(errorDe(entrada([largo])).includes('Cada fragmento puede tener hasta 4000 caracteres.'));
});

test('la suma de los fragmentos no puede pasar de 20 000 caracteres', () => {
  const grandes = Array.from({ length: 6 }, (_, i) => fragmento(`f${i}`, { html: `<p>${'x'.repeat(3500)}</p>` }));
  assert.ok(errorDe(entrada(grandes)).includes('Los fragmentos superan 20 000 caracteres en total.'));
});

test('los ids deben ser únicos', () => {
  assert.ok(errorDe(entrada([fragmento('f1'), fragmento('f1')])).includes('Cada fragmento necesita un id distinto.'));
});

const pedidos = [fragmento('f1'), fragmento('f2'), fragmento('f3')];
const item = (id, extra = {}) => ({ id, explicacion: 'Falta el texto alternativo.', corregido: `<img src="${id}.png" alt="Logo">`, ...extra });

test('respuesta válida: todos los fragmentos quedan en validos', () => {
  const r = validarRespuestaFragmentos({ fragmentos: [item('f1'), item('f2'), item('f3')] }, pedidos);
  assert.deepEqual(r.validos.map((v) => v.id), ['f1', 'f2', 'f3']);
  assert.deepEqual(r.errores, []);
});

test('un item inválido no invalida a los demás', () => {
  const r = validarRespuestaFragmentos(
    {
      fragmentos: [
        item('f1'),
        item('f2', { corregido: '<img src="f2.png">' }), // igual al original
        item('f3', { explicacion: ' ' }),
        item('zz'), // no pedido
      ],
    },
    pedidos,
  );
  assert.deepEqual(r.validos.map((v) => v.id), ['f1']);
  assert.equal(r.errores.length, 3, r.errores.join('\n'));
  assert.ok(r.errores.some((e) => /f2.*cambiar/.test(e)), r.errores.join('\n'));
  assert.ok(r.errores.some((e) => /zz.*no se pidió/.test(e)), r.errores.join('\n'));
});

test('un id repetido en la respuesta cuenta una sola vez', () => {
  const r = validarRespuestaFragmentos({ fragmentos: [item('f1'), item('f1', { corregido: '<img src="f1.png" alt="Otro">' })] }, pedidos);
  assert.equal(r.validos.length, 1);
  assert.equal(r.validos[0].corregido, '<img src="f1.png" alt="Logo">');
});

test('una corrección que agrega scripts, on*, javascript: o marcos no es válida', () => {
  const r = validarRespuestaFragmentos(
    { fragmentos: [item('f1', { corregido: '<img src="f1.png" alt="x" onload="x()">' }), item('f2')] },
    pedidos,
  );
  assert.deepEqual(r.validos.map((v) => v.id), ['f2']);
  assert.ok(r.errores.some((e) => /f1.*ejecut/.test(e)), r.errores.join('\n'));
});

test('lo que ya traía el fragmento original no cuenta como agregado', () => {
  const conOn = [fragmento('f1', { html: '<button onclick="comprar()"></button>' })];
  const r = validarRespuestaFragmentos({ fragmentos: [item('f1', { corregido: '<button onclick="comprar()">Comprar</button>' })] }, conOn);
  assert.equal(r.validos.length, 1, r.errores.join('\n'));
});

test('algo que no tiene la forma esperada no tiene válidos', () => {
  for (const malo of ['hola', null, [], { fragmentos: 'x' }]) {
    const r = validarRespuestaFragmentos(malo, pedidos);
    assert.deepEqual(r.validos, []);
    assert.ok(r.errores.length > 0);
  }
});
