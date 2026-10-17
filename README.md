# a11Lens · Backend

API de **a11Lens**, un autocorrector de accesibilidad web: la persona pega HTML, sube un archivo o escribe una URL; la app detecta los problemas con axe-core, los explica en lenguaje simple, la IA propone el código corregido y a11Lens **verifica cada corrección volviendo a auditar** antes de mostrarla.

Proyecto 2 de la materia Programación orientada a la web. Node.js + Express 5, PostgreSQL (Neon), Google Gemini por su API REST, Zod y undici.

Frontend: <https://github.com/nicolaswagimin/pow-proyecto2-frontend>

## Qué hace el backend

El análisis con axe-core **no corre aquí**: corre en el navegador, dentro de un iframe aislado (ver [docs/decisiones/0001](docs/decisiones/0001-axe-en-iframe-aislado-del-navegador.md)). El backend:

- **Descarga páginas por URL** sin exponer la red interna (protección contra SSRF).
- **Corrige con IA por fragmentos**: a Gemini solo van los elementos con problemas (con su contexto mínimo), nunca el documento, así que sirve para páginas de cualquier tamaño. Valida cada corrección con Zod y la guarda en caché por fragmento para no gastar cuota.
- **Guarda el historial** de auditorías de cada persona.
- Autenticación con correo y contraseña (bcrypt + JWT).

## Requisitos

- Node.js 20 o superior
- Una base de datos PostgreSQL (Neon, plan gratuito)
- Una API key de Gemini: <https://aistudio.google.com/apikey>

## Correr en local

```bash
npm install
cp .env.example .env     # rellena DATABASE_URL, GEMINI_API_KEY y JWT_SECRET
npm run dev              # http://localhost:3002, se reinicia al guardar
curl http://localhost:3002/api/health
# {"ok":true,"db":true,"ia":true}
```

Si `db` o `ia` salen en `false`, revisa `DATABASE_URL` / `DB_SSL` o `GEMINI_API_KEY`. Aunque falle la base de datos, el servidor arranca igual y muestra el error en la consola. Las tablas se crean solas a partir de `schema.sql`.

## Pruebas

```bash
npm test                 # 97 pruebas con node:test
```

Gemini, el DNS, la red y la base se reemplazan por dobles: las pruebas no gastan cuota ni tocan Neon.

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| `GET` | `/api/health` | Pública | Estado del servidor, la base y la IA |
| `POST` | `/api/auth/registro` | Pública | Crea la cuenta y devuelve `{ token, usuario }` |
| `POST` | `/api/auth/login` | Pública, 10 intentos / 15 min por IP | Devuelve `{ token, usuario }` |
| `GET` | `/api/auth/yo` | Token | Datos del usuario |
| `POST` | `/api/paginas/descargar` | Token, 30 / 15 min por usuario | Descarga el HTML de una URL pública: `{ html, urlFinal }` |
| `POST` | `/api/ia/fragmentos` | Token, 20 / 15 min por usuario | Explicación y corrección de hasta 10 fragmentos |
| `GET` | `/api/auditorias` | Token | Historial del usuario (sin el HTML) |
| `POST` | `/api/auditorias` | Token | Guarda una auditoría |
| `GET` | `/api/auditorias/:id` | Token | Una auditoría propia, completa |
| `DELETE` | `/api/auditorias/:id` | Token | Borra una auditoría propia |

El detalle de cada request, response y error está en [docs/api.md](docs/api.md).

## Documentación

| Documento | Contenido |
|---|---|
| [docs/api.md](docs/api.md) | Cada endpoint con request, response y errores |
| [docs/ia.md](docs/ia.md) | Prompt, formato de respuesta, validación con Zod, caché y cuota |
| [docs/analisis-accesibilidad.md](docs/analisis-accesibilidad.md) | Motor aislado, reglas, fórmula del puntaje, verificación y páginas SPA |
| [docs/base-de-datos.md](docs/base-de-datos.md) | Tablas `usuarios`, `auditorias` e `ia_cache`, relaciones y consultas |
| [docs/seguridad.md](docs/seguridad.md) | bcrypt, JWT, CORS, SSRF, límites y validación de entradas |
| [docs/despliegue.md](docs/despliegue.md) | Neon, Render, variables y comprobaciones |
| [docs/arquitectura-backend.md](docs/arquitectura-backend.md) | Carpetas, middleware y flujo de una auditoría |
| [docs/decisiones/](docs/decisiones/) | 0001 axe en el navegador · 0002 SSRF con IP fijada · 0003 caché de IA · 0004 no borrar `items` |
| [CHANGELOG.md](CHANGELOG.md) | Cambios |

## Variables de entorno

| Variable | Descripción | Por defecto |
|---|---|---|
| `PORT` | Puerto del servidor | `3002` |
| `DATABASE_URL` | Cadena de conexión de PostgreSQL | — |
| `DB_SSL` | `false` para un PostgreSQL local sin SSL | SSL activado |
| `GEMINI_API_KEY` | API key de Gemini (solo vive en el backend) | — |
| `GEMINI_MODEL` | Modelo de Gemini | `gemini-3.5-flash-lite` |
| `FRONTEND_URL` | Orígenes permitidos por CORS, separados por comas | `http://localhost:4200` |
| `JWT_SECRET` | Secreto de las sesiones. **Obligatorio** | — |
| `JWT_EXPIRES_IN` | Duración de la sesión | `7d` |

No hay variables nuevas respecto a la versión anterior.

## Próximos pasos

- Borrar a mano la tabla `items` en Neon cuando ya no haga falta (el `DROP` está comentado en `schema.sql`).
- Cubrir los pendientes de [docs/seguridad.md](docs/seguridad.md): límite en el registro, cabeceras de seguridad y revocación de tokens.
- Limpiar las entradas antiguas de `ia_cache` si la tabla crece demasiado.
