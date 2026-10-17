import { Router } from 'express';
import { ErrorIA } from '../ia.js';
import { corregirFragmentos } from '../ia/corregir.js';

// POST /api/ia/fragmentos { pagina, fragmentos } → { fragmentos, sinRespuesta }
// Explicación en español simple y corrección de cada fragmento con problemas (ver docs/ia.md).
// El documento nunca viaja: el frontend aplica cada corrección en su lugar y la verifica.
export function rutasIA({ corregir = corregirFragmentos } = {}) {
  const router = Router();
  router.post('/fragmentos', async (req, res) => {
    try {
      res.json(await corregir({ pagina: req.body?.pagina, fragmentos: req.body?.fragmentos }));
    } catch (err) {
      if (err instanceof ErrorIA) return res.status(err.estado).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'No se pudo corregir con la IA.' });
    }
  });
  return router;
}
