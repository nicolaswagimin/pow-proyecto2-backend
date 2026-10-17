# a11Lens: auditoría, corrección con IA y verificación — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (modo Native, elegido por el usuario). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La persona aporta HTML (pegado, archivo o URL), ve sus problemas de accesibilidad con puntaje y lente, recibe explicaciones y correcciones de Gemini verificadas con axe, compara antes/después, guarda el historial y exporta.

**Architecture:** axe-core corre en el navegador dentro de un iframe `sandbox="allow-scripts"` con CSP por nonce (los scripts del usuario nunca corren; comprobado). El backend Express descarga URLs con protección SSRF, llama a Gemini con caché y validación Zod, y guarda auditorías en Neon. Angular orquesta auditoría, lente, verificación, diff y exportación con funciones puras probadas.

**Tech Stack:** Backend: Node ≥ 20, Express 5 (JS ESM), `pg`, Zod, `undici` (conexión fijada a la IP validada), `node:test`. Frontend: Angular 22, `axe-core` (ya instalado), Vitest vía `@angular/build:unit-test`.

**Spec:** `backend/docs/superpowers/specs/2026-10-18-a11lens-funcionalidad-design.md` (rutas relativas a `Final_Proyect/a11Lens/`).

## Global Constraints

- No tocar estilos, tokens, colores, tipografía, animaciones, login, registro ni `auth-layout`. `/app` se reescribe (quitar items, IA genérica y panel de estado) conservando la barra y el margen de anotaciones. Pantallas nuevas solo con tokens (`--color-marcador`, `--color-error`, `--color-aviso`, `--color-exito`, `--color-borde`, `--color-regla`…) y componentes `ui/*`.
- Nunca ejecutar scripts del HTML del usuario (navegador ni servidor).
- Modelo por defecto `gemini-3.5-flash-lite`. Ninguna variable de entorno nueva.
- Límites: HTML hasta 2 MB para auditar; para la IA, 100 000 caracteres y 30 problemas; URL: 8 s, 2 MB, 3 redirecciones, puertos 80/443; IA 20 cada 15 min por usuario; descargas 30 cada 15 min por usuario.
- Gravedades en la interfaz: crítico, serio, moderado, menor. Pesos del puntaje: 15, 8, 4, 1 (+1 por nodo extra, máx. +5 por regla).
- Commits: Conventional Commits en español con alcance, uno por cambio mínimo; cada commit compila; nunca `.env`, `node_modules`, `dist`, `.angular`; sin push. Terminar cada mensaje con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Backend: no formatear con `npx prettier` (no está configurado). Frontend: Prettier del repo.
- Documentación en español, un archivo por commit `docs:`.
- La tabla `items` deja de crearse pero no se borra.

## Review Focus

1. **HTML hostil** (`<script>`, `onerror`, `javascript:`, `<meta refresh>`, `<iframe>`, `<base href>`) → nada se ejecuta ni navega; la auditoría igual corre (tests del saneador en Task 12 y prueba en navegador en Task 25).
2. **URL que resuelve a IP privada o redirige a una** (`http://localhost`, `http://169.254.169.254`, dominio que resuelve a `10.x`, redirección 302 a `127.0.0.1`, IPv6 `::1`, `::ffff:127.0.0.1`) → rechazada con mensaje claro (tests en Task 4).
3. **Gemini devuelve un `original` que no está en el HTML** → la corrección se marca "no aplicable" y no se presenta como solución (test en Task 15).
4. **Respuesta de la IA con forma inválida o 429** → mensaje claro, sin romper la interfaz; misma entrada no vuelve a llamar (tests en Tasks 6 y 7).
5. **HTML enorme o vacío** → error claro antes de auditar o de llamar a la IA (tests en Tasks 6 y 17).

---

## BACKEND (`backend/`)

### Task 1: Pruebas, modelo por defecto y dependencias

- [ ] `npm pkg set scripts.test='node --test "test/**/*.test.js"'` → commit `build: script de pruebas con node:test`.
- [ ] `npm install zod`, `npm install undici` (un commit cada uno).
- [ ] `src/ia.js` y `.env.example`: modelo por defecto `gemini-3.5-flash-lite` → `fix(ia): modelo por defecto gemini-3.5-flash-lite`.

### Task 2: Tabla `auditorias` y caché de IA

**Files:** `schema.sql`, `src/auditorias/repositorio.js`, `src/ia/cache.js`.

- [ ] `schema.sql`: `auditorias` (columnas de la spec §6.8, `TIMESTAMPTZ`) → `feat(db): tabla auditorias`; índice `(usuario_id, pagina, creado_en DESC)` → `perf(db): …`; `ia_cache (clave CHAR(64) PRIMARY KEY, respuesta JSONB NOT NULL, creado_en TIMESTAMPTZ DEFAULT NOW())` → `feat(db): caché de respuestas de la IA`; deja de crear `items` (comentario con el `DROP` opcional) → `refactor(db): …`.
- [ ] `repositorio.js`: `guardar(usuarioId, datos)`, `listar(usuarioId)` (sin `html` ni `problemas`), `obtener(usuarioId, id)`, `eliminar(usuarioId, id)` — un commit por función.
- [ ] `cache.js`: `claveDe(entrada): string` (SHA-256 de JSON estable + `VERSION_PROMPT`), `leer(clave)`, `escribir(clave, respuesta)`; tests de `claveDe` (misma entrada → misma clave; distinto orden de propiedades → misma clave; distinta versión → distinta clave).

### Task 3: Validación de direcciones (SSRF, núcleo)

**Files:** `src/paginas/direcciones.js`; Test `test/direcciones.test.js`.
**Produces:** `esIpPrivada(ip: string): boolean`; `validarUrl(texto): URL` (lanza `ErrorSsrf` con mensaje en español).

- [ ] Tests primero: privadas/reservadas IPv4 (`127.0.0.1`, `10.1.2.3`, `172.16.0.1`, `192.168.1.1`, `169.254.169.254`, `100.64.0.1`, `0.0.0.0`, `224.0.0.1`, `255.255.255.255`), IPv6 (`::1`, `::`, `fc00::1`, `fe80::1`, `::ffff:127.0.0.1`, `::ffff:7f00:1`), públicas (`8.8.8.8`, `2606:4700::1111`); `validarUrl` rechaza `ftp:`, `file:`, `javascript:`, credenciales, puerto 8080, `localhost`, texto que no es URL; acepta `https://ejemplo.org/a?b`.
- [ ] Implementar con `node:net` (`isIP`) y rangos CIDR propios. Commits por función + tests.

### Task 4: Descarga segura de páginas

**Files:** `src/paginas/descargar.js`, `src/routes/paginas.js`; Test `test/descargar.test.js`.
**Produces:** `descargarPagina(url, { resolver = dns.lookup(all), pedir = undiciRequest, tiempoMs = 8000, maxBytes = 2_000_000, maxRedirecciones = 3 }): Promise<{ html, urlFinal }>`.

- [ ] Tests (resolver y `pedir` falsos): dominio que resuelve a `10.0.0.5` → rechazo; resuelve a una pública y otra privada → rechazo; 302 a `http://127.0.0.1/` → rechazo; más de 3 redirecciones → rechazo; respuesta de 3 MB → corta con "La página supera 2 MB"; tiempo agotado → "La página tardó demasiado"; `content-type: image/png` → "No es una página HTML"; caso feliz devuelve html y urlFinal; la conexión usa la IP validada (el `pedir` falso recibe el `lookup` fijado).
- [ ] Implementar con `undici.request` + `Agent({ connect: { lookup } })` que devuelve solo la IP ya validada; `redirect` manual.
- [ ] Ruta `POST /api/paginas/descargar` (`requireAuth` + límite 30/15 min) → `{ html, urlFinal }`; errores SSRF `400`, red `502`. Commits: función, ruta, límite, tests.

### Task 5: Esquema y prompt de corrección

**Files:** `src/ia/esquema.js`, `src/ia/prompt.js`; Test `test/esquema.test.js`.

- [ ] `esquemaCorreccion` (Zod): `{ problemas: [{ regla, selector, explicacion (≤ 600), original (≤ 4000), corregido (≤ 4000) }] (≤ 30), documento (≤ 200 000) }` + `validarCorreccion(valor, problemasPedidos)`: cada `regla`+`selector` debe ser uno de los pedidos; errores en español.
- [ ] `INSTRUCCIONES_CORRECCION` y `construirPrompt({ html, problemas })`: español simple sin jerga ("quien usa lector de pantalla…"), `original` copiado literal del HTML, cambios mínimos, no inventar contenido (alt describe lo que se ve o queda `alt=""` si es decorativa, explicándolo), devolver el documento completo.
- [ ] Tests: válido, falta `documento`, regla no pedida, `explicacion` vacía, demasiados problemas. Commits por pieza.

### Task 6: Servicio de corrección (Gemini + caché + reintento)

**Files:** `src/ia/corregir.js`, `src/ia.js` (agregar `llamarGeminiJson` con 429 detectado); Test `test/corregir.test.js`.
**Produces:** `corregir({ html, problemas }, { llamar, cache }): Promise<{ problemas, documento, desdeCache: boolean }>`.

- [ ] Tests (Gemini falso): válido a la primera; inválido → reintenta con errores → válido; inválido dos veces → error 502 "La IA devolvió una corrección inválida dos veces"; Gemini 429 → error con `estado: 429` y mensaje de saturación; misma entrada dos veces → una sola llamada (`desdeCache: true`); HTML > 100 000 o > 30 problemas o 0 problemas → error 400 sin llamar.
- [ ] Implementar; `llamarGeminiJson` (modo JSON, timeout 60 s) distingue 429. Commits por parte.

### Task 7: Rutas de IA y auditorías

**Files:** `src/routes/ia.js` (reescrito), `src/routes/auditorias.js`, `src/index.js`, `src/middleware/limites.js`; Test `test/rutas.test.js` (supertest no: app Express con dependencias falsas y `fetch` a un puerto 0).

- [ ] `POST /api/ia/corregir` (`requireAuth`, `limiteIA` 20/15 min) → `{ problemas, documento, desdeCache }`; errores 400/429/502 con `{ error }`.
- [ ] `GET/POST /api/auditorias`, `GET/DELETE /api/auditorias/:id` con validación Zod del cuerpo (`pagina` 1–300, `origen` enum, `html` ≤ 2 MB, `puntaje` 0–100, …); ajeno → 404.
- [ ] Quitar `/api/items` y la `/api/ia` de texto libre (y `preguntarIA`). Express `json` sube a `limit: '3mb'` solo para estas rutas. Tests de rutas con repositorio y corrector falsos. Commits por ruta, por eliminación y tests.

### Task 8: Documentación del backend (cada archivo su commit)

`docs/api.md`, `base-de-datos.md`, `ia.md`, `analisis-accesibilidad.md` (motor en el navegador, reglas, puntaje, verificación), `seguridad.md` (incluido SSRF), `despliegue.md`, `arquitectura-backend.md`, `decisiones/0001-axe-en-iframe-aislado-del-navegador.md`, `0002-ssrf-con-ip-fijada.md`, `0003-cache-de-ia-en-la-base.md`, `0004-no-borrar-items.md`, `CHANGELOG.md`, `README.md`.

---

## FRONTEND (`frontend/`)

### Task 9: Vitest

- [ ] `npm i -D vitest jsdom` (commits separados), target `test` con `@angular/build:unit-test` + `vitest-base.config.mts` (`fsModuleCache: false`, `globals: true`), `tsconfig.spec.json`, exclusión de `*.spec-util.ts` en `tsconfig.app.json`; prueba humo de `core/fuerza.ts`.

### Task 10: Modelo y puntaje

**Files:** `src/app/auditor/modelo.ts`, `puntaje.ts`; Test `puntaje.spec.ts`.
**Produces:** tipos `Gravedad = 'critico' | 'serio' | 'moderado' | 'menor'`, `Problema { regla, gravedad, descripcion, ayudaUrl, criterios: CriterioWcag[], nodos: { selector, html }[] }`, `ResultadoAuditoria { problemas, reglasAprobadas, fecha }`; `calcularPuntaje(problemas): number`, `resumir(problemas): Record<Gravedad, number>`.

- [ ] Tests: sin problemas → 100; un crítico con 1 nodo → 85; serio con 4 nodos → 100 − (8+3) = 89; tope +5 por regla; nunca < 0; `resumir` cuenta reglas por gravedad.

### Task 11: Traducción de resultados de axe

**Files:** `src/app/auditor/axe-a-problemas.ts`, `criterios-wcag.ts`; Test spec.
**Produces:** `aProblemas(violations): Problema[]`, `criteriosDe(tags): CriterioWcag[]` (`wcag111` → `{ id: '1.1.1', nombre: 'Contenido no textual', nivel: 'A' }`, tabla de los criterios A/AA de WCAG 2.2), `descripcionEs(reglaId, ayudaAxe)` (tabla de las ~30 reglas más comunes).

- [ ] Tests: impacto `critical` → `critico`; criterio desde tags; regla sin traducción usa la ayuda de axe; `html` del nodo recortado a 300 caracteres.

### Task 12: Saneador y documento aislado

**Files:** `src/app/auditor/aislar.ts`; Test spec.
**Produces:** `sanear(html): string` (DOMParser: quita `script`, `noscript`, `iframe`, `object`, `embed`, `base`, `meta[http-equiv=refresh]`, atributos `on*`, `javascript:` en `href/src/action/formaction`), `documentoAislado(html, { nonce, urlAxe, urlCorredor }): string` (inserta la CSP y los scripts con nonce; envuelve fragmentos en `<html lang><body>` si hace falta).

- [ ] Tests: cada vector de Review Focus 1 desaparece; el contenido visible y los `<style>` se conservan; la CSP incluye `script-src 'nonce-…'` y `default-src 'none'`; un fragmento sin `<html>` queda envuelto.

### Task 13: Corredor dentro del iframe y servicio de auditoría

**Files:** `public/auditor/corredor.js` (script estático servido como asset; corre dentro del iframe), copia de `axe.min.js` a `public/auditor/` por configuración de `angular.json` (assets desde `node_modules/axe-core`), `src/app/auditor/motor.service.ts`; Test `motor.spec.ts` (mensajería con un iframe falso).
**Produces:** `MotorService.auditar(html): Promise<ResultadoAuditoria>` (iframe oculto, timeout 20 s, errores claros); protocolo de mensajes `{ tipo: 'auditar' | 'resaltar' | 'enfocar' | 'resultado' | 'clic' | 'listo', … }` documentado en `lente.md`.

- [ ] El corredor: corre axe con tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`, responde `resultado`; `resaltar(selectores)` dibuja contornos con un `<style nonce>` propio (marcador del design system copiado como valores, sin depender de la app); `enfocar(selector)` hace scroll y contorno grueso; clic en elemento resaltado → `clic(selector)`; solo acepta mensajes de `parent`.
- [ ] Commits: asset de axe, corredor, servicio, tests.

### Task 14: Cliente de API y descarga de URL

**Files:** `src/app/services/auditorias.service.ts`, `ia.service.ts`, `paginas.service.ts`; `core/errores.ts` (casos 413, 429 y 502 de la IA).

- [ ] Un servicio por archivo, cada uno en su commit; quitar `api.service.ts` cuando ya no se use (Task 20).

### Task 15: Verificación de correcciones

**Files:** `src/app/auditor/verificar.ts`; Test spec.
**Produces:** `aplicarCorreccion(html, original, corregido): string | null` (null si `original` no aparece), `compararAuditorias(antes, despues): { resueltos, sinResolver, nuevos }` (por regla + selector), `verificarPorProblema(...)` y `verificarDocumento(...)` (usan `MotorService` inyectable).

- [ ] Tests: aplicar reemplaza la primera aparición exacta; `original` ausente → null → estado `no-aplicable`; comparar detecta resuelto, sin resolver y nuevo; una corrección cuyo problema sigue → `no-resolvio`, nunca `resuelto`.

### Task 16: Diff y exportación

**Files:** `src/app/auditor/diff.ts`, `exportar.ts`; Tests.
**Produces:** `diffLineas(a, b): { tipo: 'igual' | 'quitada' | 'agregada'; texto; numA?; numB? }[]` (LCS), `reporteMarkdown(auditoria, verificacion?): string`, `descargarTexto(texto, nombre, tipo)`.

- [ ] Tests: diff de iguales, agregadas, quitadas y mezcla; Markdown contiene puntaje, cada gravedad, criterio, selector, explicación y "Resuelto"/"No resolvió".

### Task 17: Estado de la página de auditoría

**Files:** `src/app/pages/inicio/auditoria-estado.ts`; Test spec (servicios falsos).
**Produces:** `AuditoriaEstado` con signals `entrada`, `origen`, `pagina`, `estado`, `resultado`, `seleccionado`, `correccion`, `verificacion`, `error`; métodos `auditarPegado`, `auditarArchivo(file)`, `auditarUrl(url)`, `corregir()`, `guardar()`, `cargar(id)`.

- [ ] Tests: HTML vacío → error sin auditar; archivo no `.html` o > 2 MB → error; URL descargada se audita; error 429 de la IA → mensaje; corregir con la misma entrada dos veces → una sola llamada al servicio (además de la caché del servidor); `guardar` envía puntajes antes/después.

### Task 18: Componentes de la página

Cada componente con sus estilos (solo tokens) y su prueba de render; un commit por componente y otro por sus estilos:
`entrada-html` (pestañas Pegar/Archivo/URL con `role="tablist"`), `puntaje` (número + texto + barra, no solo color), `lista-problemas` (por gravedad, `aria-expanded`, criterio, fragmento, selector, botón "Ver en la lente"), `lente` (el iframe visible, título accesible, sincronizado con la lista), `correccion` (explicación, original/corregido, estado verificado), `diff-codigo` (lado a lado con +/− en texto), `exportar` (Markdown, PDF, HTML corregido).

### Task 19: Página `/app`

- [ ] Reescribir `inicio.*`: quitar items, IA genérica y estado del sistema (un commit `refactor:` por cada uno, como en el proyecto 1); armar el flujo Entrada → Resultados + Lente → Corregir con IA → Verificación → Antes/después → Guardar/Exportar; conservar barra y margen de anotaciones. Vista de impresión (`@media print`) para el PDF.

### Task 20: Historial

- [ ] Ruta `/historial` (`authGuard`), página con auditorías agrupadas por página, evolución del puntaje (SVG + lista en texto), abrir (`/app?auditoria=<id>`) y eliminar con confirmación; enlace en la barra.

### Task 21: Documentación del frontend (cada archivo su commit)

`docs/funcionalidades.md`, `lente.md`, `reporte.md` (puntaje y exportación), `accesibilidad.md` (resultado de axe de la propia app), `arquitectura-frontend.md`, `decisiones/0006-axe-en-iframe-con-csp-y-nonce.md`, `0007-verificar-antes-de-mostrar.md`, `0008-pdf-con-impresion-del-navegador.md`, `CHANGELOG.md`, `README.md` con capturas.

## Cierre

### Task 22: Verificación final

- [ ] `npm test` en backend; `ng test` y `ng build` de producción sin advertencias en frontend.
- [ ] Playwright: auditar HTML pegado, archivo y URL (`https://example.org` y una página con problemas conocidos); corregir con IA (Gemini real, `gemini-3.5-flash-lite`); verificar; guardar; historial; exportar Markdown, PDF (vista de impresión) y HTML; backend apagado → error claro.
- [ ] Review Focus 1 en navegador real: HTML hostil no ejecuta nada.
- [ ] axe (Playwright + axe-core) sobre `/login`, `/app` y `/historial`, claro/oscuro, escritorio/móvil: 0 violaciones → `accesibilidad.md`.
- [ ] `demo.sh`; capturas móvil/escritorio, claro/oscuro.
- [ ] Revisión final del branch (subagente) y corrección de lo importante.
- [ ] Resumen por repo: commits, `git log --oneline`, docs, verificación, variables nuevas (ninguna) y comandos para probar. **Esperar aprobación para el push.**

---

## Ajustes aprobados por el usuario (2026-10-17)

1. **Páginas por URL con estilos reales:** la CSP del iframe permite hojas de estilo, fuentes e imágenes externas por `https:` (e imágenes `data:`), y ningún script salvo axe y el corredor (nonce): `default-src 'none'; style-src 'unsafe-inline' https:; font-src https: data:; img-src https: data:; script-src 'nonce-X'`. El saneador quita cualquier `<base>` del usuario y `documentoAislado` agrega `<base href="URL original">` para que las rutas relativas carguen; los scripts propios usan URL absoluta. ADR del frontend `0009-csp-y-base-para-paginas-por-url.md`. (Task 12 y 13.)
2. **Sandbox mínimo:** test de que el iframe tiene exactamente `sandbox="allow-scripts"` (sin `allow-same-origin`, `allow-forms`, `allow-popups` ni `allow-top-navigation`) y de que `<meta http-equiv="refresh">` se elimina. (Task 12 y 13.)
3. **Aviso de SPA:** `pareceSpa(html)` (función pura con tests: body con poco texto y un contenedor raíz como `#root`, `#app`, `#__next`, `app-root`, o casi todo scripts) → aviso en la interfaz explicando que la página necesita JavaScript para mostrarse y que se audita lo que llega sin ejecutarlo. (Task 11 y 19.)
4. **Fórmula del puntaje visible:** en `docs/analisis-accesibilidad.md` y en la interfaz con un "¿Cómo se calcula?" (`<details>`) junto al puntaje. (Task 8, 18.)
