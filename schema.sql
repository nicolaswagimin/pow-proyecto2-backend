-- Esquema de la base de datos. Se ejecuta automáticamente al arrancar el backend
-- (iniciarDB en src/db.js), pero también puedes pegarlo en el editor SQL de Neon o Supabase.
-- Todas las sentencias son idempotentes: se pueden ejecutar varias veces sin romper nada.

-- Usuarios. google_id, avatar_url y proveedor quedan listos para el login con Google futuro.
CREATE TABLE IF NOT EXISTS usuarios (
  id            SERIAL PRIMARY KEY,
  nombre        VARCHAR(100) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NULL,
  google_id     VARCHAR(255) UNIQUE NULL,
  avatar_url    TEXT NULL,
  proveedor     VARCHAR(20) DEFAULT 'local',
  creado_en     TIMESTAMP DEFAULT NOW()
);

-- La tabla items del CRUD de ejemplo ya no se usa. No se borra aquí para no perder datos de
-- bases existentes; si quieres eliminarla: DROP TABLE IF EXISTS items;

-- Auditorías guardadas por cada usuario (el historial). "pagina" agrupa las auditorías de una
-- misma página para ver la evolución del puntaje: la URL normalizada, el nombre del archivo o el
-- nombre que la persona escribe para el HTML pegado.
CREATE TABLE IF NOT EXISTS auditorias (
  id                SERIAL PRIMARY KEY,
  usuario_id        INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  pagina            VARCHAR(300) NOT NULL,
  origen            VARCHAR(10) NOT NULL,
  html              TEXT NOT NULL,
  puntaje           SMALLINT NOT NULL,
  resumen           JSONB NOT NULL,
  problemas         JSONB NOT NULL,
  html_corregido    TEXT NULL,
  puntaje_corregido SMALLINT NULL,
  creado_en         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS auditorias_usuario_pagina_idx ON auditorias (usuario_id, pagina, creado_en DESC);

-- Respuestas de la IA ya calculadas: la misma entrada no vuelve a llamar a Gemini. La clave es el
-- SHA-256 del HTML, los problemas y la versión del prompt (src/ia/cache.js).
CREATE TABLE IF NOT EXISTS ia_cache (
  clave     CHAR(64) PRIMARY KEY,
  respuesta JSONB NOT NULL,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);
