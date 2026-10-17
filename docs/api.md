# API · a11Lens

URL base: `http://localhost:3002/api` en local y `https://pow-proyecto2-backend.onrender.com/api` en producción.

- Todas las peticiones y respuestas son JSON.
- Todos los errores tienen la forma `{ "error": "mensaje en español" }`. Los errores de validación del registro agregan `campo` (`nombre`, `email` o `password`) para que el frontend muestre el mensaje junto al campo.
- Las rutas protegidas exigen la cabecera `Authorization: Bearer <token>`.

## Errores comunes a todas las rutas

| Código | Cuándo | Cuerpo |
|---|---|---|
| `400` | El cuerpo no es un JSON válido | `{ "error": "El cuerpo de la petición no es un JSON válido." }` |
| `401` | Ruta protegida sin token o con el esquema equivocado | `{ "error": "Inicia sesión para continuar." }` |
| `401` | Token inválido, expirado o de un usuario que ya no existe | `{ "error": "Tu sesión expiró o no es válida. Inicia sesión de nuevo." }` |
| `404` | Ruta inexistente bajo `/api` | `{ "error": "Ruta no encontrada." }` |
| `500` | Error no previsto | `{ "error": "Error interno del servidor." }` |

## Estado

### `GET /api/health`

Pública. Dice si el servidor, la base de datos y la IA están disponibles. La usan los health checks de Render y `demo.sh`.

```json
{ "ok": true, "db": true, "ia": true }
```

- `db` es `false` si `SELECT 1` falla o falta `DATABASE_URL`.
- `ia` es `false` si falta `GEMINI_API_KEY` (no consulta a Gemini).
- Siempre responde `200` mientras el servidor esté arriba.

## Autenticación

### `POST /api/auth/registro`

Pública. Crea la cuenta e inicia la sesión.

Request:

```json
{ "nombre": "Ana Pérez", "email": "ana@ejemplo.com", "password": "secreta123" }
```

Response `201`:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs…",
  "usuario": {
    "id": 7,
    "nombre": "Ana Pérez",
    "email": "ana@ejemplo.com",
    "avatar_url": null,
    "proveedor": "local",
    "creado_en": "2026-10-12T22:41:03.512Z"
  }
}
```

Errores:

| Código | `campo` | Mensaje |
|---|---|---|
| `400` | `nombre` | "Escribe tu nombre." / "El nombre no puede superar los 100 caracteres." |
| `400` | `email` | "Escribe un correo válido, como nombre@dominio.com." (también si supera 255 caracteres) |
| `400` | `password` | "La contraseña necesita al menos 8 caracteres." / "La contraseña no puede superar los 72 caracteres." (72 bytes en UTF-8) |
| `409` | `email` | "Ese correo ya tiene una cuenta. Inicia sesión." |
| `500` | — | "No se pudo crear la cuenta. Revisa la base de datos." |

El nombre y el correo se recortan; el correo se guarda en minúsculas.

### `POST /api/auth/login`

Pública, con límite de 10 intentos cada 15 minutos por IP.

Request:

```json
{ "email": "ana@ejemplo.com", "password": "secreta123" }
```

Response `200`: igual que el registro, `{ token, usuario }`.

Errores:

| Código | Mensaje |
|---|---|
| `400` | "Escribe tu correo y tu contraseña." |
| `401` | "El correo o la contraseña no coinciden." (mismo mensaje si el correo no existe, para no revelar qué cuentas hay) |
| `429` | "Demasiados intentos de inicio de sesión. Espera unos minutos y vuelve a intentarlo." |
| `500` | "No se pudo iniciar sesión. Revisa la base de datos." |

### `GET /api/auth/yo`

Protegida. Devuelve los datos actuales del usuario del token.

Response `200`:

```json
{ "usuario": { "id": 7, "nombre": "Ana Pérez", "email": "ana@ejemplo.com", "avatar_url": null, "proveedor": "local", "creado_en": "…" } }
```

Errores: los `401` comunes y `500` "No se pudo verificar la sesión. Revisa la base de datos."

## Descargar una página (auditoría por URL)

### `POST /api/paginas/descargar`

Protegida, 30 cada 15 min por usuario. Descarga la página **con protección contra SSRF** (ver [seguridad.md](seguridad.md#ssrf)); la auditoría se hace después en el navegador.

Request: `{ "url": "https://ejemplo.org/contacto" }`

Response `200`: `{ "html": "<!DOCTYPE html>…", "urlFinal": "https://ejemplo.org/contacto" }` (`urlFinal` es la dirección después de seguir las redirecciones; el frontend la usa como `<base>`).

| Código | Mensaje |
|---|---|
| `400` | "Escribe la dirección de la página." · "Eso no es una URL válida…" · "Solo se pueden auditar páginas con http o https." · "La URL no puede incluir usuario ni contraseña." · "Solo se admiten los puertos 80 y 443." · "No se pueden auditar direcciones internas o locales." |
| `429` | "Descargaste muchas páginas seguidas…" |
| `502` | "No encontramos ese dominio…" · "La página tardó demasiado en responder." · "La página supera 2 MB…" · "Esa dirección no es una página HTML." · "La página respondió con el código 404." · "La página hace más de 3 redirecciones." |

## Corregir con IA

### `POST /api/ia/corregir`

Protegida, 20 cada 15 min por usuario. Explica cada problema en español simple y propone la corrección por problema y del documento completo (ver [ia.md](ia.md)). La misma entrada sale de la caché sin volver a llamar a Gemini.

Request:

```json
{
  "html": "<main><img src=\"a.png\"></main>",
  "problemas": [
    { "regla": "image-alt", "ayuda": "Las imágenes deben tener texto alternativo.",
      "nodos": [{ "selector": "img", "html": "<img src=\"a.png\">" }] }
  ]
}
```

Response `200`:

```json
{
  "problemas": [
    { "regla": "image-alt", "selector": "img",
      "explicacion": "La imagen no tiene texto alternativo: quien usa lector de pantalla no sabe qué muestra.",
      "original": "<img src=\"a.png\">", "corregido": "<img src=\"a.png\" alt=\"Logo de la tienda\">" }
  ],
  "documento": "<main><img src=\"a.png\" alt=\"Logo de la tienda\"></main>",
  "desdeCache": false
}
```

| Código | Mensaje |
|---|---|
| `400` | "No hay HTML para corregir." · "El HTML es demasiado largo para corregirlo con la IA (máximo 100 000 caracteres)." · "No hay problemas para corregir." · "Se pueden corregir hasta 30 problemas a la vez." |
| `429` | "La IA está saturada en este momento. Espera un minuto y vuelve a intentarlo." (Gemini) · "Pediste muchas correcciones seguidas…" (límite propio) |
| `502` | "La IA devolvió una corrección inválida dos veces…" · "La IA tardó demasiado en responder…" · "No se pudo consultar a la IA: …" |
| `503` | "La IA no está configurada en el servidor." |

## Auditorías (historial)

Todas protegidas y filtradas por el usuario del token.

| Método | Ruta | Qué hace | Respuesta |
|---|---|---|---|
| `GET` | `/api/auditorias` | Historial, del más reciente al más antiguo (sin `html` ni `problemas`) | `200` `[{ id, pagina, origen, puntaje, resumen, puntaje_corregido, creado_en }]` |
| `POST` | `/api/auditorias` | Guarda una auditoría | `201` con la fila |
| `GET` | `/api/auditorias/:id` | Una auditoría completa | `200` · `404` "Esa auditoría no existe o no es tuya." |
| `DELETE` | `/api/auditorias/:id` | Borra una auditoría propia | `204` · `404` |

Cuerpo de `POST` (validado con Zod; el primer error vuelve como `400`):

```json
{
  "pagina": "https://ejemplo.org/",  "origen": "url",
  "html": "…", "puntaje": 62,
  "resumen": { "critico": 2, "serio": 1, "moderado": 0, "menor": 0 },
  "problemas": [ … ],
  "htmlCorregido": "…", "puntajeCorregido": 100
}
```

`origen` es `pegado`, `archivo` o `url`; `html` y `htmlCorregido` hasta 2 MB; `puntaje` de 0 a 100. Un id que no es un entero positivo responde `400`.

Las rutas `/api/items` y la `/api/ia` de texto libre se eliminaron: responden `404`.

## Probar con curl

```bash
TOKEN=$(curl -s -X POST http://localhost:3002/api/auth/registro -H "Content-Type: application/json" \
  -d '{"nombre":"Ana","email":"ana@ejemplo.com","password":"secreta123"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

curl http://localhost:3002/api/auth/yo -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:3002/api/paginas/descargar -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"url":"https://example.org"}'
curl -X POST http://localhost:3002/api/paginas/descargar -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"url":"http://169.254.169.254/"}'   # 400: dirección interna
curl http://localhost:3002/api/auditorias -H "Authorization: Bearer $TOKEN"
```
