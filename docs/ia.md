# IA · a11Lens

Gemini **no detecta** los problemas: eso lo hace axe-core en el navegador. Gemini recibe el HTML y la lista de problemas de axe, y devuelve, para cada uno, una explicación en español simple y una corrección, además del documento completo corregido. Después, el frontend **verifica** cada corrección volviendo a auditar con axe (ver [analisis-accesibilidad.md](analisis-accesibilidad.md)).

Código: `src/ia.js` (`llamarGeminiJson`), `src/ia/prompt.js`, `src/ia/esquema.js`, `src/ia/corregir.js`, `src/ia/cache.js`, ruta `src/routes/ia.js`.

## La llamada

- Modelo: `GEMINI_MODEL` o, si falta, **`gemini-3.5-flash-lite`** (`gemini-2.5-flash` respondió "high demand" en otro proyecto).
- `generationConfig`: `responseMimeType: "application/json"`, `temperature: 0.2`.
- Tiempo máximo 60 s. Si Gemini responde `429`, el cliente recibe `429` "La IA está saturada en este momento…".
- La API key solo vive en el backend (`GEMINI_API_KEY`).

## Prompt (`INSTRUCCIONES_CORRECCION`, `VERSION_PROMPT = correccion-v1`)

Pide responder solo con JSON y:

- una entrada por cada regla + selector recibidos, con esos mismos valores;
- **explicación en español simple**, sin jerga ni códigos de criterio: qué falla y a quién afecta ("quien usa lector de pantalla no sabe qué muestra la imagen");
- `original`: copia **literal** del fragmento del HTML recibido (lo más corto posible pero único), para que el frontend pueda aplicarla;
- `corregido`: el **cambio mínimo**;
- **no inventar** contenido: si una imagen no tiene contexto, alt genérico descriptivo o `alt=""` si es decorativa, y decirlo; en contraste, cambiar solo los colores necesarios;
- `documento`: el HTML completo con todas las correcciones y sin otros cambios.

El mensaje del usuario lleva cada problema (regla, ayuda, selector y fragmento) y el HTML completo.

## Formato y validación (Zod)

```json
{
  "problemas": [ { "regla": "…", "selector": "…", "explicacion": "…", "original": "…", "corregido": "…" } ],
  "documento": "…"
}
```

`esquemaCorreccion`: como mucho 30 problemas; `explicacion` 1–600 caracteres; `original` 1–4000; `corregido` hasta 4000; `documento` 1–200 000. Además, `validarCorreccion` exige que cada `regla` + `selector` sea uno de los pedidos. Si la respuesta no pasa, se reintenta **una vez** agregando al prompt la lista de errores; si vuelve a fallar, `502` "La IA devolvió una corrección inválida dos veces…".

## Cuota: caché y límites

- **Caché** (`ia_cache`): la clave es el SHA-256 de `{ html, problemas }` (JSON con las claves ordenadas) más `VERSION_PROMPT`. La misma entrada devuelve la respuesta guardada (`desdeCache: true`) sin llamar a Gemini, aunque la pida otra persona. Cambiar el prompt exige subir `VERSION_PROMPT`.
- El frontend tampoco repite la petición si nada cambió.
- Entrada: hasta 100 000 caracteres de HTML y 30 problemas (los más graves primero).
- Límite propio: 20 correcciones cada 15 minutos por usuario.

## Pruebas

`test/corregir.test.js` y `test/esquema.test.js` usan un Gemini y una caché simulados: nunca gastan cuota.
