import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { ErrorIA } from '../src/ia.js';
import { rutasAuditorias } from '../src/routes/auditorias.js';
import { rutasIA } from '../src/routes/ia.js';

// App mínima con un usuario fijo y dependencias simuladas.
async function levantar({ corregir, repo }) {
  const app = express();
  app.use(express.json({ limit: '3mb' }));
  app.use((req, res, next) => {
    req.usuario = { id: 1 };
    next();
  });
  app.use('/api/ia', rutasIA({ corregir }));
  app.use('/api/auditorias', rutasAuditorias({ repo }));
  const servidor = await new Promise((ok) => {
    const s = app.listen(0, () => ok(s));
  });
  const base = `http://localhost:${servidor.address().port}/api`;
  const pedir = async (metodo, ruta, cuerpo) => {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { 'content-type': 'application/json' },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    return { estado: r.status, datos: r.status === 204 ? null : await r.json() };
  };
  return { pedir, cerrar: () => servidor.close() };
}

const auditoria = {
  pagina: 'https://ejemplo.org/',
  origen: 'url',
  html: '<main>x</main>',
  puntaje: 72,
  resumen: { critico: 1, serio: 0, moderado: 2, menor: 0 },
  problemas: [{ regla: 'image-alt' }],
};

function repoFalso() {
  const filas = [];
  return {
    filas,
    guardar: async (usuarioId, a) => {
      const fila = { id: filas.length + 1, usuario_id: usuarioId, ...a };
      filas.push(fila);
      return fila;
    },
    listar: async (u) => filas.filter((f) => f.usuario_id === u),
    obtener: async (u, id) => filas.find((f) => f.usuario_id === u && f.id === id) ?? null,
    eliminar: async (u, id) => {
      const i = filas.findIndex((f) => f.usuario_id === u && f.id === id);
      if (i === -1) return false;
      filas.splice(i, 1);
      return true;
    },
  };
}

test('POST /api/ia/corregir devuelve la corrección', async (t) => {
  const s = await levantar({ corregir: async () => ({ problemas: [], documento: 'x', desdeCache: false }), repo: repoFalso() });
  t.after(s.cerrar);
  const r = await s.pedir('POST', '/ia/corregir', { html: '<p>', problemas: [{}] });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.documento, 'x');
});

test('POST /api/ia/corregir traduce los errores de la IA a su código', async (t) => {
  const s = await levantar({
    corregir: async () => {
      throw new ErrorIA('La IA está saturada en este momento.', 429);
    },
    repo: repoFalso(),
  });
  t.after(s.cerrar);
  const r = await s.pedir('POST', '/ia/corregir', { html: '<p>', problemas: [{}] });
  assert.equal(r.estado, 429);
  assert.match(r.datos.error, /saturada/);
});

test('guardar, listar, obtener y eliminar auditorías', async (t) => {
  const repo = repoFalso();
  const s = await levantar({ corregir: async () => ({}), repo });
  t.after(s.cerrar);
  const creada = await s.pedir('POST', '/auditorias', auditoria);
  assert.equal(creada.estado, 201);
  assert.equal((await s.pedir('GET', '/auditorias')).datos.length, 1);
  assert.equal((await s.pedir('GET', `/auditorias/${creada.datos.id}`)).datos.pagina, 'https://ejemplo.org/');
  assert.equal((await s.pedir('DELETE', `/auditorias/${creada.datos.id}`)).estado, 204);
  assert.equal((await s.pedir('GET', `/auditorias/${creada.datos.id}`)).estado, 404);
});

test('rechaza una auditoría con datos inválidos', async (t) => {
  const s = await levantar({ corregir: async () => ({}), repo: repoFalso() });
  t.after(s.cerrar);
  for (const mala of [{ ...auditoria, puntaje: 140 }, { ...auditoria, origen: 'ftp' }, { ...auditoria, pagina: '' }]) {
    const r = await s.pedir('POST', '/auditorias', mala);
    assert.equal(r.estado, 400);
    assert.ok(r.datos.error);
  }
});

test('una auditoría ajena o inexistente responde 404', async (t) => {
  const repo = repoFalso();
  await repo.guardar(2, auditoria);
  const s = await levantar({ corregir: async () => ({}), repo });
  t.after(s.cerrar);
  assert.equal((await s.pedir('GET', '/auditorias/1')).estado, 404);
  assert.equal((await s.pedir('DELETE', '/auditorias/1')).estado, 404);
  assert.equal((await s.pedir('GET', '/auditorias/abc')).estado, 400);
});
