# Base de datos · a11Lens

PostgreSQL alojado en Neon (también funciona con Supabase o un PostgreSQL local con `DB_SSL=false`). El esquema está en `schema.sql` y se ejecuta solo al arrancar (`iniciarDB()` en `src/db.js`). Todas las sentencias son idempotentes: se pueden ejecutar muchas veces sin romper nada.

## Diagrama

```
usuarios                          auditorias                          ia_cache
┌───────────────────────────┐     ┌──────────────────────────────┐    ┌──────────────────────────┐
│ id            SERIAL  PK  │◄──┐ │ id                SERIAL PK  │    │ clave     CHAR(64) PK    │
│ nombre        VARCHAR(100)│   └─┤ usuario_id        INTEGER FK │    │ respuesta JSONB          │
│ email         VARCHAR(255)│     │ pagina            VARCHAR(300)│    │ creado_en TIMESTAMPTZ    │
│ password_hash TEXT        │     │ origen            VARCHAR(10)│    └──────────────────────────┘
│ google_id     VARCHAR(255)│     │ html              TEXT       │    (sin relación: la misma
│ avatar_url    TEXT        │     │ puntaje           SMALLINT   │     entrada sirve a cualquier
│ proveedor     VARCHAR(20) │     │ resumen           JSONB      │     usuario)
│ creado_en     TIMESTAMP   │     │ problemas         JSONB      │
└───────────────────────────┘     │ html_corregido    TEXT NULL  │
                                  │ puntaje_corregido SMALLINT NULL│
                                  │ creado_en         TIMESTAMPTZ│
                                  └──────────────────────────────┘
```

## `usuarios`

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | `PRIMARY KEY` | Identificador; es el `sub` del JWT |
| `nombre` | `VARCHAR(100)` | `NOT NULL` | Nombre para mostrar |
| `email` | `VARCHAR(255)` | `UNIQUE NOT NULL` | Siempre en minúsculas (lo normaliza la API) |
| `password_hash` | `TEXT` | `NULL` | Hash bcrypt. Nulo para cuentas que solo usen Google |
| `google_id` | `VARCHAR(255)` | `UNIQUE NULL` | Reservado para el login con Google |
| `avatar_url` | `TEXT` | `NULL` | Reservado para el login con Google |
| `proveedor` | `VARCHAR(20)` | `DEFAULT 'local'` | `local` o, en el futuro, `google` |
| `creado_en` | `TIMESTAMP` | `DEFAULT NOW()` | Fecha de registro |

`password_hash` y `google_id` nunca salen del backend: las consultas usan `COLUMNAS_PUBLICAS` (`id, nombre, email, avatar_url, proveedor, creado_en`).

## `auditorias`

El historial: cada vez que la persona pulsa **Guardar en el historial** se crea una fila.

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | `PRIMARY KEY` | |
| `usuario_id` | `INTEGER` | `NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE` | Dueño de la auditoría |
| `pagina` | `VARCHAR(300)` | `NOT NULL` | Agrupa las auditorías de una misma página: la URL final, el nombre del archivo o el nombre escrito para el HTML pegado |
| `origen` | `VARCHAR(10)` | `NOT NULL` | `pegado`, `archivo` o `url` |
| `html` | `TEXT` | `NOT NULL` | El HTML auditado (hasta 2 MB) |
| `puntaje` | `SMALLINT` | `NOT NULL` | 0 a 100 (fórmula en [analisis-accesibilidad.md](analisis-accesibilidad.md#puntaje)) |
| `resumen` | `JSONB` | `NOT NULL` | Reglas incumplidas por gravedad: `{ critico, serio, moderado, menor }` |
| `problemas` | `JSONB` | `NOT NULL` | Los problemas de axe ya traducidos (regla, gravedad, criterios, nodos) |
| `html_corregido` | `TEXT` | `NULL` | Documento corregido (el HTML original con las correcciones verificadas), si se pidió |
| `puntaje_corregido` | `SMALLINT` | `NULL` | Puntaje del documento corregido, verificado con axe |
| `creado_en` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Orden del historial y de la evolución |

Índice: `auditorias_usuario_pagina_idx` sobre `(usuario_id, pagina, creado_en DESC)`.

## `ia_cache`

Correcciones de Gemini ya validadas, **una fila por fragmento**. `clave` es el SHA-256 de la regla, el fragmento, su contexto (padre, detalle de axe, idioma y título), el lote en que se pidió y la versión del prompt (ver [ia.md](ia.md#cuota-caché-lotes-y-límites)); `respuesta`, `{ explicacion, corregido }`. Las filas del prompt anterior (`correccion-v1`, documento completo) quedan sin uso. Se escribe con `ON CONFLICT DO NOTHING`.

### La tabla `items`

Era el CRUD de ejemplo. La API ya no la usa y `schema.sql` ya no la crea, pero **no la borra** para no perder datos de bases existentes (mismo criterio que en CodeToDiagram). Para eliminarla: `DROP TABLE IF EXISTS items;`.

## Relaciones

- `usuarios 1 ── N auditorias` por `auditorias.usuario_id`.
- Borrar un usuario borra sus auditorías (`ON DELETE CASCADE`).
- `ia_cache` no se relaciona con nadie.

## Consultas que hace la API

| Operación | SQL |
|---|---|
| Registro | `INSERT INTO usuarios (nombre, email, password_hash, proveedor) VALUES ($1, $2, $3, 'local') RETURNING …` |
| Login | `SELECT …, password_hash FROM usuarios WHERE email = $1` |
| Validar token | `SELECT … FROM usuarios WHERE id = $1` (en cada petición protegida) |
| Guardar auditoría | `INSERT INTO auditorias (usuario_id, pagina, origen, html, puntaje, resumen, problemas, html_corregido, puntaje_corregido) VALUES (…) RETURNING …` |
| Historial | `SELECT id, pagina, origen, puntaje, resumen, puntaje_corregido, creado_en FROM auditorias WHERE usuario_id = $1 ORDER BY creado_en DESC, id DESC` |
| Abrir | `SELECT … FROM auditorias WHERE usuario_id = $1 AND id = $2` |
| Borrar | `DELETE FROM auditorias WHERE usuario_id = $1 AND id = $2` |
| Caché de IA | `SELECT respuesta FROM ia_cache WHERE clave = $1` · `INSERT … ON CONFLICT (clave) DO NOTHING` |
| Salud | `SELECT 1` |

Todas son consultas parametrizadas (`$1`, `$2`…), así que no hay inyección SQL.

## Conexión

`src/db.js` crea un `pg.Pool` con `DATABASE_URL`, SSL activado salvo que `DB_SSL=false` y un tiempo máximo de conexión de 5 s. Un error en una conexión inactiva se registra sin tumbar el servidor.
