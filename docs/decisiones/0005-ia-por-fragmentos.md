# 0005 · La IA corrige fragmentos, no el documento

- **Estado:** aceptada · **Fecha:** 2026-10-17 · Reemplaza la parte de la IA de la versión inicial (documento completo).

## Contexto
`POST /api/ia/corregir` recibía el HTML entero y los problemas, y Gemini devolvía cada corrección más el documento entero corregido.

Con páginas reales fallaba: casi todas superan 100 000 caracteres, el límite que impedía pasar el contexto y la salida de Gemini, y la persona veía "El HTML es demasiado largo para corregirlo con la IA". Además:

- cada intento gastaba muchos tokens;
- la respuesta podía tardar más de un minuto;
- Gemini podía cambiar partes del documento que no tenían problemas.

## Opciones
1. **Subir el límite.** No escala: una página de 2 MB no cabe en una respuesta de Gemini y la cuota gratuita se agota en pocas páginas.
2. **Recortar el documento** (por ejemplo, solo `<body>` sin scripts ni estilos). Sigue siendo grande en páginas reales y sigue pidiendo a la IA que copie el documento.
3. **Fragmentos.** La IA recibe solo los elementos con problemas, con contexto mínimo, y el navegador arma el documento.

## Decisión
Opción 3, con `POST /api/ia/fragmentos`.

- **Ubicación exacta.** El frontend ubica cada elemento con problemas en el texto del HTML original. Usa la ruta del nodo en el DOM, que envía el corredor dentro del iframe, y la recorre en un árbol de parse5 con posiciones de origen (ver la ADR 0010 del frontend). Así obtiene el fragmento **literal**: el elemento completo si mide ≤ 1500 caracteres y no contiene otro elemento con problemas, o si no, su etiqueta de apertura.
- **Contexto mínimo.** Cada fragmento va con la apertura del padre y el detalle de axe; el lote, con el idioma y el título.
- **Lotes y prioridad.** Por lote: 8 fragmentos y 12 000 caracteres. Por petición: 10 y 20 000 como tope del servidor. Primero los de mayor gravedad. Los elementos idénticos van una vez.
- **Caché por fragmento** en `ia_cache`. La clave no lleva el id, pero sí el lote entero: Gemini ve todo el lote, y así un lote armado a propósito no puede envenenar la corrección de un fragmento común para otra persona. El reintento pide solo lo que faltó, y lo que siga faltando vuelve en `sinRespuesta`, no como error del lote.
- **Sin código ejecutable.** Una corrección no puede agregar scripts, marcos, `on*`, `javascript:` ni meta refresh. Se comprueba en el servidor y en el navegador.
- **Verificación en el navegador.** Las correcciones se aplican como **reemplazos de texto** en el HTML original y el resultado se vuelve a auditar con axe. El documento corregido solo incluye las verificadas.

## Consecuencias
- Cualquier página que se pueda auditar (hasta 2 MB) se puede corregir. El límite de 100 000 caracteres desaparece.
- Cada petición es pequeña y barata. Una página con muchos problemas se corrige por rondas («Corregir más»), dentro del límite de 20 lotes cada 15 minutos.
- El diff solo muestra los fragmentos cambiados: el resto del documento queda byte a byte igual.
- La IA ve menos contexto. Para casos como contraste por una hoja de estilos externa, la corrección es un `style` en línea. Si no resuelve, la verificación lo dice.
- Algunos elementos no se pueden corregir con IA:
  - los implícitos, sin etiqueta en la fuente (por ejemplo, un `<html>` que no está escrito);
  - los que están dentro de shadow DOM o de iframes;
  - los problemas que aparecen después de corregir.

  Se muestran como no ubicables.
- La ruta anterior se elimina. Durante un redespliegue, un frontend viejo recibe `404` unos minutos.
