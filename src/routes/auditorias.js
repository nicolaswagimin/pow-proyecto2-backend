import { Router } from 'express';
import { z } from 'zod';
import * as repositorio from '../auditorias/repositorio.js';

// Historial de auditorías del usuario: guardar, listar, abrir y eliminar.

const MAX_HTML = 2_000_000;

const esquemaAuditoria = z.object({
  pagina: z.string().trim().min(1, 'Falta el nombre de la página.').max(300, 'El nombre de la página es demasiado largo.'),
  origen: z.enum(['pegado', 'archivo', 'url'], { message: 'Origen desconocido.' }),
  html: z.string().min(1, 'Falta el HTML.').max(MAX_HTML, 'El HTML supera 2 MB.'),
  puntaje: z.number().int().min(0).max(100, 'El puntaje va de 0 a 100.'),
  resumen: z.object({
    critico: z.number().int().min(0),
    serio: z.number().int().min(0),
    moderado: z.number().int().min(0),
    menor: z.number().int().min(0),
  }),
  problemas: z.array(z.unknown()).max(500),
  htmlCorregido: z.string().max(MAX_HTML).nullish(),
  puntajeCorregido: z.number().int().min(0).max(100).nullish(),
});

function idDe(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'El id no es válido.' });
    return null;
  }
  return id;
}

const NO_EXISTE = { error: 'Esa auditoría no existe o no es tuya.' };

export function rutasAuditorias({ repo = repositorio } = {}) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await repo.listar(req.usuario.id));
  });

  router.post('/', async (req, res) => {
    const datos = esquemaAuditoria.safeParse(req.body);
    if (!datos.success) return res.status(400).json({ error: datos.error.issues[0].message });
    res.status(201).json(await repo.guardar(req.usuario.id, datos.data));
  });

  router.get('/:id', async (req, res) => {
    const id = idDe(req, res);
    if (id === null) return;
    const fila = await repo.obtener(req.usuario.id, id);
    if (!fila) return res.status(404).json(NO_EXISTE);
    res.json(fila);
  });

  router.delete('/:id', async (req, res) => {
    const id = idDe(req, res);
    if (id === null) return;
    if (!(await repo.eliminar(req.usuario.id, id))) return res.status(404).json(NO_EXISTE);
    res.status(204).end();
  });

  return router;
}
