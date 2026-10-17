import { z } from 'zod';

// Corrección por fragmentos (docs/ia.md): a Gemini solo van los fragmentos de los elementos con
// problemas, no el documento. Así cualquier página entra, y el frontend aplica cada corrección en
// su lugar del HTML original. La entrada y la respuesta se validan con Zod.

export const MAX_FRAGMENTOS = 10;
export const MAX_HTML_FRAGMENTO = 4000;
export const MAX_TOTAL_FRAGMENTOS = 20_000;

const largo = (f) => f.html.length + f.padre.length + f.resumen.length;

export const esquemaEntradaFragmentos = z.object({
  pagina: z
    .object({
      idioma: z.string().trim().max(35).default(''),
      titulo: z.string().trim().max(300).default(''),
    })
    .default({ idioma: '', titulo: '' }),
  fragmentos: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(20),
        regla: z.string().trim().min(1).max(100),
        ayuda: z.string().max(500).default(''),
        html: z
          .string()
          .trim()
          .min(1, 'Cada fragmento necesita su HTML.')
          .max(MAX_HTML_FRAGMENTO, `Cada fragmento puede tener hasta ${MAX_HTML_FRAGMENTO} caracteres.`),
        padre: z.string().max(1000).default(''),
        resumen: z.string().max(1000).default(''),
      }),
    )
    .min(1, 'No hay fragmentos para corregir.')
    .max(MAX_FRAGMENTOS, `Se pueden corregir hasta ${MAX_FRAGMENTOS} fragmentos a la vez.`)
    .refine((fs) => new Set(fs.map((f) => f.id)).size === fs.length, {
      message: 'Cada fragmento necesita un id distinto.',
    })
    .refine((fs) => fs.reduce((t, f) => t + largo(f), 0) <= MAX_TOTAL_FRAGMENTOS, {
      message: 'Los fragmentos superan 20 000 caracteres en total.',
    }),
});

const itemRespuesta = z.object({
  id: z.string().trim().min(1),
  explicacion: z.string().trim().min(1).max(600),
  corregido: z.string().trim().min(1).max(8000),
});

// Lo que el frontend quitaría al sanear: scripts, marcos, objetos, <base>, meta refresh, on*,
// srcdoc y javascript:. Una corrección no puede agregarlos (llega a la caché compartida y al HTML
// que la persona descarga). Contar de más solo rechaza correcciones, nunca deja pasar una.
const CODIGO_EJECUTABLE = [
  /<\s*(script|noscript|iframe|frame|frameset|object|embed|applet|base)\b/gi,
  /<\s*meta\b[^>]*http-equiv/gi,
  /\son[a-z]+\s*=/gi,
  /\ssrcdoc\s*=/gi,
  /javascript\s*:/gi,
];

function agregaCodigo(original, corregido) {
  return CODIGO_EJECUTABLE.some((patron) => (corregido.match(patron)?.length ?? 0) > (original.match(patron)?.length ?? 0));
}

// Valida cada item por separado: los válidos se usan aunque otros fallen (los que fallan se
// vuelven a pedir). Un item es válido si corresponde a un fragmento pedido y lo cambia.
export function validarRespuestaFragmentos(valor, pedidos) {
  const lista = valor && typeof valor === 'object' && !Array.isArray(valor) ? valor.fragmentos : null;
  if (!Array.isArray(lista)) return { validos: [], errores: ['La respuesta no tiene la lista "fragmentos".'] };

  const porId = new Map(pedidos.map((p) => [p.id, p]));
  const validos = new Map();
  const errores = [];
  for (const [i, crudo] of lista.entries()) {
    const r = itemRespuesta.safeParse(crudo);
    const id = r.success ? r.data.id : String(crudo?.id ?? `#${i + 1}`);
    if (!r.success) {
      errores.push(`El fragmento "${id}" necesita una explicación y una corrección (texto de hasta 600 y 8000 caracteres).`);
    } else if (!porId.has(id)) {
      errores.push(`El fragmento "${id}" no se pidió.`);
    } else if (r.data.corregido === porId.get(id).html.trim()) {
      errores.push(`La corrección del fragmento "${id}" debe cambiar el fragmento.`);
    } else if (agregaCodigo(porId.get(id).html, r.data.corregido)) {
      errores.push(`La corrección del fragmento "${id}" agrega código ejecutable (scripts, eventos o marcos): corrígelo sin eso.`);
    } else if (!validos.has(id)) {
      validos.set(id, r.data);
    }
  }
  return { validos: [...validos.values()], errores };
}
