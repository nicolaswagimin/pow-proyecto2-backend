# IA · a11Lens

Gemini **no detecta** los problemas: eso lo hace axe-core en el navegador. Gemini recibe **fragmentos** de los elementos con problemas y devuelve, por cada uno, una explicación en español simple y el fragmento corregido.

El documento completo nunca viaja a la IA. El frontend:

1. aplica cada corrección en su lugar del HTML original;
2. arma el documento corregido;
3. lo **verifica** volviendo a auditar con axe (ver [analisis-accesibilidad.md](analisis-accesibilidad.md)).

La decisión está en [decisiones/0005-ia-por-fragmentos.md](decisiones/0005-ia-por-fragmentos.md).

Código: `src/ia.js` (`llamarGeminiJson`), `src/ia/prompt.js`, `src/ia/esquema.js`, `src/ia/corregir.js` (`corregirFragmentos`) y `src/ia/cache.js`. Ruta: `src/routes/ia.js` (`POST /api/ia/fragmentos`).

## Por qué fragmentos

Antes se mandaban el HTML entero y los problemas, y Gemini devolvía el documento entero corregido. Eso tenía tres problemas:

- Las páginas reales pasan casi siempre de 100 000 caracteres, el límite que había. La IA respondía "El HTML es demasiado largo…".
- Era caro en cuota.
- Gemini podía cambiar cosas fuera de los problemas.

Con fragmentos, cada petición es pequeña aunque la página pese 2 MB, y lo que no tiene problemas no pasa por la IA.

## Qué es un fragmento (lo arma el frontend)

| Campo | Qué lleva |
|---|---|
| `id` | Identificador dentro del lote (`f1`, `f2`…) |
| `regla`, `ayuda` | La regla de axe y su descripción en español |
| `html` | El texto **literal** del elemento en el HTML original. Si mide ≤ 1500 caracteres y no contiene a otro elemento con problemas, va el elemento completo; si no, solo su **etiqueta de apertura** |
| `padre` | La etiqueta de apertura del elemento padre (contexto mínimo) |
| `resumen` | El detalle de axe (`failureSummary`). Para contraste trae los colores y la razón pedida |

Una vez por lote van el `idioma` (`lang` de `<html>`) y el `titulo` de la página.

## La llamada

- Modelo: `GEMINI_MODEL` o, si falta, **`gemini-3.5-flash-lite`**. `gemini-2.5-flash` respondió "high demand" en otro proyecto.
- `generationConfig`: `responseMimeType: "application/json"`, `temperature: 0.2`.
- Tiempo máximo: 60 s. Si Gemini responde `429`, el cliente recibe `429` "La IA está saturada en este momento…".
- La API key solo vive en el backend (`GEMINI_API_KEY`).

## Prompt (`INSTRUCCIONES_FRAGMENTOS`, `VERSION_PROMPT = fragmentos-v1`)

Pide responder solo con JSON y:

- una entrada por fragmento recibido, con el mismo `id`;
- **explicación en español simple**, sin jerga ni códigos de criterio: qué falla y a quién afecta;
- `corregido`: el mismo fragmento con el **cambio mínimo**, sin quitar ni ocultar el elemento;
- si el fragmento es solo una etiqueta de apertura, devolver solo la apertura corregida. Solo si la regla lo exige se puede agregar contenido justo después, como un `<title>` tras `<head>`;
- **no inventar** contenido: alt genérico y descriptivo, o `alt=""` si la imagen es decorativa, en el idioma de la página;
- en contraste, usar los colores del detalle de axe con un `style` en línea que alcance la razón pedida.

El mensaje del usuario lleva el idioma y el título, y por cada fragmento su id, regla, padre, detalle y fragmento.

## Formato y validación (Zod)

```json
{ "fragmentos": [ { "id": "f1", "explicacion": "…", "corregido": "…" } ] }
```

`validarRespuestaFragmentos` revisa **cada item por separado**:

- `explicacion`: 1 a 600 caracteres;
- `corregido`: 1 a 8000 y **distinto** del fragmento enviado;
- el `id` debe ser uno de los pedidos (un id repetido cuenta una vez).

Los items válidos se aceptan aunque otros fallen.

**Reintento:** se pide una vez más **solo lo que falta**, con la lista de errores.

- Lo que siga faltando vuelve en `sinRespuesta` y el frontend lo muestra como "La IA no devolvió una corrección válida".
- Solo si no hay ningún item válido la respuesta es `502` "La IA devolvió una corrección inválida dos veces…".

## Cuota: caché, lotes y límites

- **Caché por fragmento** (`ia_cache`):
  - La clave es el SHA-256 de `VERSION_PROMPT` más `{ regla, ayuda, html, padre, resumen, idioma, titulo }` (JSON con las claves ordenadas). No depende del `id` ni de la página.
  - Antes de llamar se lee cada fragmento. Solo los que faltan van a Gemini, en una sola llamada, y si están todos no hay llamada.
  - Cada corrección válida se guarda por separado.
  - Cambiar el prompt exige subir `VERSION_PROMPT`.
- **Lotes del frontend:**
  - Hasta 8 fragmentos únicos y 12 000 caracteres por lote, de mayor a menor gravedad.
  - Un clic procesa hasta 3 lotes, uno detrás de otro; «Corregir más» sigue con los siguientes.
  - Los elementos idénticos (misma regla, fragmento, padre y detalle) se envían una vez y la corrección se aplica a todos.
- **Entrada** (`esquemaEntradaFragmentos`):
  - 1 a 10 fragmentos con ids distintos;
  - `html` de hasta 4000 caracteres; `padre` y `resumen` de hasta 1000;
  - suma de los tres ≤ 20 000;
  - `titulo` de hasta 300 e `idioma` de hasta 35.

  Una entrada mal formada responde `400` sin llamar a Gemini.
- **Límite propio:** 20 peticiones (lotes) cada 15 minutos por usuario.
- **Ya no hay límite de tamaño de la página para la IA.** El único es el de la página misma: 2 MB al descargarla, pegarla o subirla.

## Pruebas

`test/corregir.test.js`, `test/esquema.test.js` y `test/gemini.test.js` usan un Gemini y una caché simulados: nunca gastan cuota.

Incluyen una **página grande** generada de más de 300 000 caracteres: sus fragmentos se aceptan y lo que viaja a Gemini mide menos de 5000 caracteres.
