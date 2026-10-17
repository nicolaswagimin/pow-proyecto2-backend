import { Router } from 'express';
import { ErrorDescarga, descargarPagina } from '../paginas/descargar.js';
import { ErrorSsrf } from '../paginas/direcciones.js';

// POST /api/paginas/descargar { url } → { html, urlFinal }. La auditoría se hace en el navegador.
export function rutasPaginas({ descargar = descargarPagina } = {}) {
  const router = Router();
  router.post('/descargar', async (req, res) => {
    const url = req.body?.url;
    if (typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: 'Escribe la dirección de la página.' });
    }
    try {
      res.json(await descargar(url));
    } catch (err) {
      if (err instanceof ErrorSsrf) return res.status(400).json({ error: err.message });
      if (err instanceof ErrorDescarga) return res.status(502).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'No pudimos descargar la página.' });
    }
  });
  return router;
}
