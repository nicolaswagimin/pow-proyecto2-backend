import { z } from 'zod';

// Forma de la respuesta de Gemini al pedir correcciones. Se valida antes de mostrar nada: una
// respuesta que no cumple se reintenta una vez (corregir.js) y si no, se informa el error.

export const MAX_PROBLEMAS = 30;

const texto = (max, mensaje) => z.string().trim().min(1, mensaje).max(max);

export const esquemaCorreccion = z.object({
  problemas: z
    .array(
      z.object({
        regla: z.string().trim().min(1),
        selector: z.string().trim().min(1),
        explicacion: texto(600, 'Cada problema necesita una explicación.'),
        original: texto(4000, 'Cada corrección necesita el fragmento original.'),
        corregido: z.string().max(4000),
      }),
    )
    .max(MAX_PROBLEMAS),
  documento: texto(200_000, 'Falta el documento corregido completo.'),
});

function describir(problema) {
  const ruta = problema.path.join('.');
  if (problema.message.startsWith('Falta') || problema.message.startsWith('Cada')) return problema.message;
  if (ruta === 'documento') return 'Falta el documento corregido completo.';
  return `El campo "${ruta}" no tiene un valor válido.`;
}

// Valida la forma y que cada corrección corresponda a un problema pedido (regla + selector).
export function validarCorreccion(valor, pedidos) {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
    return { ok: false, errores: ['La respuesta no es un objeto JSON.'] };
  }
  const forma = esquemaCorreccion.safeParse(valor);
  if (!forma.success) return { ok: false, errores: forma.error.issues.map(describir) };

  const validos = new Set(pedidos.flatMap((p) => p.nodos.map((n) => `${p.regla}|${n.selector}`)));
  const errores = forma.data.problemas
    .filter((p) => !validos.has(`${p.regla}|${p.selector}`))
    .map((p) => `La corrección de "${p.regla}" en "${p.selector}" no corresponde a ningún problema pedido.`);
  return errores.length ? { ok: false, errores } : { ok: true, correccion: forma.data };
}
