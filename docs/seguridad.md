# Seguridad · a11Lens

## Contraseñas (bcrypt)

- Se guardan con `bcryptjs`, 10 rondas de sal. Nunca se guarda ni se registra la contraseña en texto.
- Mínimo 8 caracteres y máximo 72 **bytes**: bcrypt ignora lo que pasa de 72, así que se rechaza en lugar de dar una falsa sensación de seguridad.
- **Tiempo de respuesta parejo:** si el correo no existe, el login compara igual contra un hash de relleno (`HASH_FALSO`). Así no se puede saber qué correos tienen cuenta midiendo cuánto tarda la respuesta.
- **Mensaje genérico:** correo inexistente, contraseña equivocada o cuenta sin contraseña responden lo mismo: "El correo o la contraseña no coinciden."
- El registro sí responde `409` si el correo ya existe, para que la persona sepa que debe iniciar sesión. Es una concesión de usabilidad: revela que el correo está registrado.

## Sesiones (JWT)

- Firmados con `HS256` y `JWT_SECRET`. El payload solo lleva `sub` (el id del usuario) y la expiración.
- Duran `JWT_EXPIRES_IN` (7 días por defecto).
- `requireAuth` exige `Authorization: Bearer <token>`, verifica la firma aceptando solo `HS256` y **consulta la base de datos** en cada petición: un usuario borrado no puede seguir usando su token.
- Sin `JWT_SECRET` el servidor no arranca.
- El token vive en el `localStorage` del frontend. Es simple y funciona entre dominios (Vercel y Render), pero un XSS en el frontend podría leerlo. Angular escapa las plantillas por defecto, lo que reduce ese riesgo.

## CORS

- Solo se permiten los orígenes listados en `FRONTEND_URL` (separados por comas, sin `/` final; el código quita la barra si viene).
- Un origen no permitido no recibe cabeceras CORS y el navegador bloquea la respuesta.
- Las peticiones sin cabecera `Origin` (curl, Postman, health checks de Render) se permiten: CORS protege al navegador, no reemplaza la autenticación.
- No se usan cookies, así que no hay credenciales que CORS deba proteger.

## Límites de intentos

| Ruta | Límite | Clave |
|---|---|---|
| `POST /api/auth/login` | 10 cada 15 min | IP (`trust proxy` en 1 para leer la IP real detrás del proxy de Render) |
| `POST /api/ia/fragmentos` | 20 lotes cada 15 min | id del usuario |
| `POST /api/paginas/descargar` | 30 cada 15 min | id del usuario |

Al pasarlo responden `429` con un mensaje en español y las cabeceras estándar `RateLimit` (borrador 8). El contador vive en memoria: se reinicia al reiniciar el servidor y no se comparte entre instancias.

## Límites de tamaño

| Qué | Límite | Dónde |
|---|---|---|
| Cuerpo JSON | 3 MB | `express.json` |
| Página descargada por URL | 2 MB, 8 s, solo HTML | `descargar.js` |
| HTML de una auditoría guardada | 2 MB (y otro tanto el corregido) | `routes/auditorias.js` |
| Corrección con IA | 10 fragmentos por petición, 4000 caracteres por fragmento, 20 000 en total | `ia/esquema.js` |

La IA ya no tiene un límite por tamaño de página (antes, 100 000 caracteres): solo recibe fragmentos, nunca el documento.

## Datos y consultas

- Todas las consultas SQL son parametrizadas.
- Las columnas sensibles (`password_hash`, `google_id`) nunca se devuelven: se usa `COLUMNAS_PUBLICAS`.
- Las auditorías se filtran siempre por `usuario_id`; una ajena responde `404`, igual que una inexistente, para no revelar que existe.
- Lo que devuelve Gemini es dato no confiable: se valida con Zod antes de usarlo, y las entradas de las rutas (auditorías) también.
- La API key de Gemini solo vive en el backend y viaja en la cabecera `x-goog-api-key`, no en la URL.

## SSRF

`POST /api/paginas/descargar` hace que el servidor pida una URL que escribe el usuario. Sin protección, alguien podría usarlo para escanear la red interna de Render o leer el servicio de metadatos de la nube (`169.254.169.254`). Defensas (`src/paginas/direcciones.js` y `descargar.js`):

1. **Forma de la URL**: solo `http:` y `https:`; sin usuario ni contraseña; solo puertos 80 y 443; `localhost` y `*.localhost` rechazados.
2. **IPs prohibidas**: privadas (10/8, 172.16/12, 192.168/16), loopback (127/8, ::1), link-local (169.254/16, fe80::/10), CGNAT (100.64/10), "esta red" (0/8), multicast, reservadas, de documentación y de pruebas, únicas locales IPv6 (fc00::/7) y `::`. Las IPv4 mapeadas (`::ffff:127.0.0.1`, `::ffff:7f00:1`) y las de NAT64 (`64:ff9b::/96`) se revisan como IPv4. Del resto de IPv6 solo se aceptan las **unicast globales** (`2000::/3`), sin 6to4 (`2002::/16`), Teredo (`2001::/32`) ni documentación (`2001:db8::/32`, `3fff::/20`): así quedan fuera las formas que encapsulan una IPv4 (`::127.0.0.1`, `::ffff:0:10.0.0.1`), `fec0::/10`, la NAT64 local y cualquier rango futuro.
3. **DNS**: se resuelven **todas** las direcciones del dominio y se rechaza si **cualquiera** es prohibida (un dominio público que apunta a `127.0.0.1`, como `localtest.me`, queda bloqueado; comprobado).
4. **IP fijada**: la conexión se hace a la IP ya validada (`undici` con un `lookup` propio), sin volver a resolver: evita el DNS rebinding.
5. **Redirecciones manuales**: como mucho 3, y cada destino pasa de nuevo por 1–4.
6. **Límites**: 8 s en total, 2 MB (se corta la lectura), solo `text/html` o `application/xhtml+xml`.
7. **Sin ejecución**: el servidor nunca interpreta el HTML; la auditoría corre en el navegador, en un iframe aislado sin acceso a la app.

Errores de forma o de dirección responden `400`; de red, `502`; todos con mensaje en español. Pruebas: `test/direcciones.test.js` y `test/descargar.test.js` (DNS y red simulados).

## Variables de entorno

| Variable | Sensible | Descripción |
|---|---|---|
| `DATABASE_URL` | Sí | Cadena de conexión de PostgreSQL (incluye la contraseña) |
| `JWT_SECRET` | Sí | Secreto de firma. Largo, aleatorio y **distinto en cada proyecto y en cada entorno** |
| `GEMINI_API_KEY` | Sí | API key de Google AI Studio |
| `DB_SSL` | No | `false` solo para un PostgreSQL local |
| `FRONTEND_URL` | No | Orígenes permitidos por CORS |
| `JWT_EXPIRES_IN` | No | Duración de la sesión |
| `GEMINI_MODEL` | No | Modelo de Gemini |
| `PORT` | No | Puerto (Render lo asigna) |

- `.env` está en `.gitignore`; el repositorio solo tiene `.env.example` sin valores.
- Genera el secreto con `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.

## Pendientes conocidos

- `POST /api/auth/registro` no tiene límite de intentos.
- No hay cabeceras de seguridad HTTP (por ejemplo con `helmet`).
- No hay revocación de tokens: cerrar sesión borra el token del navegador, pero el token sigue siendo válido hasta que expira.
