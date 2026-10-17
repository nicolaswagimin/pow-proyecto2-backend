# 0003 · Caché de la IA en la base de datos

- **Estado:** aceptada · **Fecha:** 2026-10-17

## Contexto
La cuota gratuita de Gemini es baja y una misma página se audita y corrige varias veces (al probar, al volver desde el historial, entre personas del mismo curso). Una caché en memoria se pierde en cada redespliegue o cuando Render duerme el servicio.

## Decisión
Tabla `ia_cache` con clave SHA-256 del HTML + problemas (JSON con claves ordenadas) + `VERSION_PROMPT`. Antes de llamar a Gemini se busca la clave; las respuestas válidas se guardan. La caché es compartida entre usuarios: la entrada no tiene datos personales más allá del HTML.

## Consecuencias
- La misma entrada nunca vuelve a llamar a Gemini; la respuesta llega al instante (`desdeCache: true`).
- Cambiar el prompt exige subir `VERSION_PROMPT`, o se seguirían sirviendo respuestas del prompt anterior.
- La tabla crece sin límite; si hiciera falta, se puede borrar lo antiguo por `creado_en` sin efectos en la app.
