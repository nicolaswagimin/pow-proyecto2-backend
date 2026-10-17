import { pool } from '../db.js';

// Acceso a la tabla auditorias. Todas las consultas filtran por usuario_id: nadie puede leer ni
// borrar auditorías de otra persona.

const COLUMNAS =
  'id, pagina, origen, html, puntaje, resumen, problemas, html_corregido, puntaje_corregido, creado_en';

export async function guardar(usuarioId, a) {
  const { rows } = await pool.query(
    `INSERT INTO auditorias
       (usuario_id, pagina, origen, html, puntaje, resumen, problemas, html_corregido, puntaje_corregido)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLUMNAS}`,
    [
      usuarioId,
      a.pagina,
      a.origen,
      a.html,
      a.puntaje,
      JSON.stringify(a.resumen),
      JSON.stringify(a.problemas),
      a.htmlCorregido ?? null,
      a.puntajeCorregido ?? null,
    ],
  );
  return rows[0];
}
