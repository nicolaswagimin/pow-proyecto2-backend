import { createHash } from 'node:crypto';
import { pool } from '../db.js';

// Caché de respuestas de la IA en la tabla ia_cache: la misma entrada (HTML + problemas + versión
// del prompt) no vuelve a llamar a Gemini, aunque la pida otra persona.

// JSON con las claves ordenadas: dos objetos iguales dan el mismo texto sin importar el orden.
function estable(valor) {
  if (Array.isArray(valor)) return `[${valor.map(estable).join(',')}]`;
  if (valor && typeof valor === 'object') {
    return `{${Object.keys(valor)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${estable(valor[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(valor);
}

export function claveDe(entrada, version = '') {
  return createHash('sha256').update(`${version}\n${estable(entrada)}`).digest('hex');
}

export async function leer(clave) {
  const { rows } = await pool.query('SELECT respuesta FROM ia_cache WHERE clave = $1', [clave]);
  return rows[0]?.respuesta ?? null;
}

export async function escribir(clave, respuesta) {
  await pool.query(
    'INSERT INTO ia_cache (clave, respuesta) VALUES ($1, $2) ON CONFLICT (clave) DO NOTHING',
    [clave, JSON.stringify(respuesta)],
  );
}
