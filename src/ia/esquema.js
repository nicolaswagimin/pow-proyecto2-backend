import { z } from 'zod';

// Forma de la respuesta de Gemini al pedir correcciones. Se valida antes de mostrar nada: una
// respuesta que no cumple se reintenta una vez (corregir.js) y si no, se informa el error.

export const MAX_PROBLEMAS = 30;
// Elementos (regla + selector) en total: la respuesta trae una entrada por cada uno.
export const MAX_NODOS = 30;
export const MAX_HTML_IA = 100_000;

const texto = (max, mensaje) => z.string().trim().min(1, mensaje).max(max);

export const esquemaCorreccion = z.object({
  problemas: z
    .array(
      z.object({
        regla: z.string().trim().min(1),
        selector: z.string().trim().min(1),
        explicacion: texto(600, 'Cada problema necesita una explicación.'),
        original: texto(4000, 'Cada corrección necesita el fragmento original.'),
        corregido: texto(4000, 'Cada corrección necesita el fragmento corregido.'),
      }).refine((p) => p.corregido !== p.original.trim(), {
        message: 'Cada corrección debe cambiar el fragmento original.',
        path: ['corregido'],
      }),
    )
    .max(MAX_NODOS),
  documento: texto(200_000, 'Falta el documento corregido completo.'),
});

// Lo que manda el frontend: el HTML y los problemas de axe con sus elementos.
export const esquemaEntrada = z
  .object({
    html: z.string().trim().min(1, 'No hay HTML para corregir.').max(MAX_HTML_IA, 'El HTML es demasiado largo para corregirlo con la IA (máximo 100 000 caracteres).'),
    problemas: z
      .array(
        z.object({
          regla: z.string().trim().min(1).max(100),
          ayuda: z.string().max(500).default(''),
          nodos: z
            .array(z.object({ selector: z.string().trim().min(1).max(1000), html: z.string().max(4000) }))
            .min(1),
        }),
      )
      .min(1, 'No hay problemas para corregir.')
      .max(MAX_PROBLEMAS, `Se pueden corregir hasta ${MAX_PROBLEMAS} problemas a la vez.`),
  })
  .refine((e) => e.problemas.reduce((t, p) => t + p.nodos.length, 0) <= MAX_NODOS, {
    message: `Se pueden corregir hasta ${MAX_NODOS} elementos a la vez.`,
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
