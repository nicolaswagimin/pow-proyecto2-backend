import { Router } from 'express';
import { ErrorIA } from '../ia.js';
import { corregir as corregirConIA } from '../ia/corregir.js';

// POST /api/ia/corregir { html, problemas } → { problemas, documento, desdeCache }
// Explicación en español simple y corrección por problema y del documento (ver docs/ia.md).
export function rutasIA({ corregir = corregirConIA } = {}) {
  const router = Router();
  router.post('/corregir', async (req, res) => {
    try {
      res.json(await corregir({ html: req.body?.html, problemas: req.body?.problemas }));
    } catch (err) {
      if (err instanceof ErrorIA) return res.status(err.estado).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'No se pudo corregir con la IA.' });
    }
  });
  return router;
}
