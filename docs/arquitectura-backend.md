# Arquitectura del backend · a11Lens

Node.js 20+ con Express 5 y módulos ES, PostgreSQL con `pg`, Gemini por su API REST, Zod y `undici`. **El análisis de accesibilidad no corre aquí**: lo hace el navegador con axe-core en un iframe aislado (ver [analisis-accesibilidad.md](analisis-accesibilidad.md)). El backend descarga páginas por URL de forma segura, corrige con IA y guarda el historial.

## Carpetas

```
schema.sql                 tablas usuarios, auditorias e ia_cache (idempotente, se ejecuta al arrancar)
.env.example               variables de entorno sin valores
src/
  index.js                 arranque: JWT_SECRET, CORS, JSON (hasta 3 MB), rutas y errores
  db.js                    pool de PostgreSQL, iniciarDB() y dbDisponible()
  ia.js                    llamarGeminiJson() y ErrorIA (con el código HTTP para el cliente)
  ia/
    prompt.js              instrucciones y prompt de corrección (VERSION_PROMPT)
    esquema.js             esquema Zod de la respuesta y validación contra lo pedido
    corregir.js            caché → Gemini → validación → un reintento
    cache.js               clave SHA-256 estable y lectura/escritura en ia_cache
  paginas/
    direcciones.js         validarUrl() y esIpPrivada(): núcleo anti-SSRF
    descargar.js           descarga con DNS validado, IP fijada, redirecciones, tiempo y tamaño
  auditorias/
    repositorio.js         consultas a la tabla auditorias
  middleware/
    auth.js                requireAuth, firmarToken y COLUMNAS_PUBLICAS
    limites.js             limiteLogin (IP), limiteIA (20/15 min) y limiteDescargas (30/15 min)
  routes/
    auth.js                /registro, /login y /yo
    paginas.js             POST /descargar
    ia.js                  POST /corregir
    auditorias.js          CRUD del historial, con validación Zod
test/                      node:test: SSRF, descarga, caché, esquema, corrección y rutas (Gemini, DNS y red simulados)
```

## Middleware, en orden

| # | Middleware | Alcance | Qué hace |
|---|---|---|---|
| 1 | `trust proxy` (1) | Todo | `req.ip` es la IP real detrás del proxy de Render |
| 2 | `cors` | Todo | Solo los orígenes de `FRONTEND_URL` |
| 3 | `express.json({ limit: '3mb' })` | Todo | Las auditorías traen el HTML (hasta 2 MB) |
| 4 | `limiteLogin` | `POST /api/auth/login` | 10 intentos cada 15 min por IP |
| 5 | `requireAuth` | `/api/paginas`, `/api/ia`, `/api/auditorias`, `/api/auth/yo` | JWT y usuario desde la base |
| 6 | `limiteDescargas` / `limiteIA` | `/api/paginas` / `/api/ia` | 30 / 20 cada 15 min por usuario |
| 7 | 404 de `/api` | Rutas no encontradas | `{ "error": "Ruta no encontrada." }` |
| 8 | Manejador de errores | Todo | JSON mal formado → `400`; otro → `500` |

## Flujo de una auditoría por URL con corrección

```
Navegador ── POST /api/paginas/descargar ──► validarUrl → DNS (todas las IPs públicas) → undici con IP fijada
   │                                          → redirecciones revisadas → ≤ 8 s, ≤ 2 MB, text/html
   │◄──────────────── { html, urlFinal } ───────┘
   │
   ├─ axe-core en un iframe sandbox="allow-scripts" con CSP por nonce y <base href="urlFinal">  (en el navegador)
   │
   ├─ POST /api/ia/corregir { html, problemas } ──► claveDe → ia_cache? ── sí ──► respuesta (desdeCache)
   │                                                     │ no
   │                                                     ▼
   │                                    Gemini (JSON) → Zod + regla/selector pedidos → 1 reintento → ia_cache
   │◄───────────── { problemas, documento } ─────────────┘
   │
   ├─ verificación con axe de cada corrección y del documento  (en el navegador)
   │
   └─ POST /api/auditorias { pagina, origen, html, puntaje, resumen, problemas, htmlCorregido, puntajeCorregido }
```

## Arranque

1. `dotenv` carga el `.env`; sin `JWT_SECRET` el proceso termina.
2. El servidor escucha **antes** de conectar la base: si Neon falla, sigue arriba y `/api/health` responde `db: false`.
3. `iniciarDB()` ejecuta `schema.sql`.

## Pruebas

`npm test` (89 pruebas). Gemini, el DNS, la red y la base se reemplazan por dobles: no gastan cuota ni tocan Neon. Las rutas se prueban levantando una app Express en un puerto libre.
