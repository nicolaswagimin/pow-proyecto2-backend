# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [Sin publicar] · Corrección por fragmentos

### Agregado
- `POST /api/ia/fragmentos`: corrige hasta 10 fragmentos por petición (4000 caracteres cada uno, 20 000 en total) con el contexto mínimo: padre, detalle de axe, idioma y título. El documento nunca viaja a la IA.
- Caché por fragmento en `ia_cache`: se piden a Gemini solo los fragmentos que faltan, y el mismo fragmento con el mismo contexto no vuelve a llamar.
- Respuesta parcial: cada item se valida por separado, el reintento pide solo lo que faltó y lo que siga faltando vuelve en `sinRespuesta`.
- Pruebas con una página grande generada (más de 300 000 caracteres). En total, 97 pruebas.

### Eliminado
- `POST /api/ia/corregir` (documento completo) y su límite de 100 000 caracteres.

### Documentación
- `ia.md`, `api.md`, `seguridad.md` (nueva tabla de límites de tamaño), `base-de-datos.md`, `arquitectura-backend.md` y [ADR 0005](docs/decisiones/0005-ia-por-fragmentos.md).

### Variables de entorno
- Ninguna nueva.

## 2026-10-17 · Funcionalidad completa

### Agregado
- `POST /api/paginas/descargar`: descarga una página por URL con protección contra SSRF (solo http/https en los puertos 80 y 443, DNS validado con todas sus IPs, conexión a la IP validada, hasta 3 redirecciones revisadas, 8 s, 2 MB y solo HTML). Límite de 30 descargas cada 15 min por usuario.
- `POST /api/ia/corregir`: explicación en lenguaje simple y corrección de cada problema, más el documento completo corregido. La respuesta de Gemini se valida con Zod y contra los problemas pedidos, con un reintento.
- Caché de la IA en la tabla `ia_cache`: la misma entrada nunca vuelve a llamar a Gemini.
- Historial: `GET`, `POST`, `GET /:id` y `DELETE /:id` en `/api/auditorias`, con validación Zod.
- Errores de la IA con su código: `429` (cuota agotada, con mensaje claro), `502` (respuesta inválida) y `503` (sin API key o Gemini caído).
- 89 pruebas con `node:test` (`npm test`): SSRF, descarga, caché, esquema, corrección y rutas. Gemini, DNS y red simulados.
- Dependencias: `zod` y `undici`.
- La entrada de la corrección se valida con Zod (hasta 30 elementos en total) y una corrección vacía o idéntica al original se rechaza.
- En IPv6 solo se aceptan unicast globales; se rechazan las formas que encapsulan una IPv4.

### Cambiado
- Modelo por defecto: `gemini-3.5-flash-lite`.
- El cuerpo JSON acepta hasta 3 MB (las auditorías traen el HTML).
- Límite de la IA: 20 correcciones cada 15 min por usuario.

### Eliminado
- El CRUD de ejemplo `/api/items` y la ruta genérica `POST /api/ia`. La tabla `items` deja de crearse pero **no se borra** (ver [ADR 0004](docs/decisiones/0004-no-borrar-items.md)).

### Documentación
- Actualizados `api.md`, `base-de-datos.md`, `seguridad.md`, `despliegue.md` y `arquitectura-backend.md`.
- Nuevos: `ia.md`, `analisis-accesibilidad.md` y las decisiones 0001 a 0004.

### Variables de entorno
- Ninguna nueva. `GEMINI_MODEL` es opcional.

## 2026-10-12 · Documentación

### Documentación
- El proyecto pasa a llamarse **a11Lens** en el README.
- `docs/api.md`: cada endpoint con request, response y errores.
- `docs/base-de-datos.md`: tablas, columnas, relaciones y consultas.
- `docs/seguridad.md`: bcrypt, JWT, CORS, límites de intentos, variables de entorno y pendientes conocidos.
- `docs/despliegue.md`: Neon, Render, variables y comprobaciones.
- `docs/arquitectura-backend.md`: carpetas, middleware en orden y flujo de una petición.

El código no cambió.

## 2026-10-06

### Agregado
- Autenticación con correo y contraseña: registro, login y `/yo`, con bcrypt y JWT.
- Límites de intentos: 10 logins cada 15 min por IP y 30 preguntas a la IA cada 15 min por usuario.
- Items filtrados por usuario (`usuario_id` con `ON DELETE CASCADE`).
- Tabla `usuarios` lista para un futuro login con Google (`google_id`, `avatar_url`, `proveedor`).

### Base inicial
- Express con CORS configurable, PostgreSQL (Neon o Supabase) con creación automática de tablas, Gemini por API REST y `/api/health`.
