# a11Lens: auditoría, explicación y corrección verificada de accesibilidad (diseño)

Fecha: 2026-10-18 · Repos: `a11Lens/backend` (remoto `pow-proyecto2-backend`) y `a11Lens/frontend`
(remoto `pow-proyecto2-frontend`). Puertos locales: backend 3002, frontend 4202.

El usuario pidió saltar las preguntas resolubles y anotar las decisiones: las marcadas
**(decisión de Claude)** son esas. Solo se detiene para aprobar el plan y antes del push.

## 1. Intención

a11Lens es un autocorrector de accesibilidad web. La persona aporta HTML (pegado, archivo o URL);
la app detecta los problemas con axe-core (con render real, para que el contraste funcione), los
explica en español simple, propone el código corregido con Gemini y **verifica** la corrección
volviendo a auditar. Una corrección que no resuelve nada no se presenta como solución.

## 2. Objetivos

1. Entrada: pegar HTML, subir un `.html` o escribir una URL (el backend descarga con protección
   contra SSRF).
2. Análisis con axe-core (WCAG 2.0/2.1/2.2 A y AA), contraste incluido, sin ejecutar nunca
   scripts del HTML del usuario.
3. Resultados: puntaje, problemas por gravedad (crítico, serio, moderado, menor), criterio WCAG,
   fragmento del elemento y su ubicación (selector).
4. Lente: vista previa con los elementos con problemas resaltados; clic en un problema enfoca su
   elemento y clic en un elemento selecciona su problema.
5. IA: explicación en español simple y corrección por problema y del documento completo,
   validadas con Zod.
6. Verificación: re-auditar el HTML corregido y mostrar qué se resolvió y qué no.
7. Antes/después: diff de código lado a lado y puntaje.
8. Historial por usuario con la evolución del puntaje de una misma página.
9. Exportar el reporte en Markdown o PDF y descargar el HTML corregido.
10. La propia app pasa axe sin errores y cumple WCAG 2.2 AA.

## 3. No objetivos

- gRPC (ya está en CodeToDiagram).
- Auditar páginas que requieren JavaScript para renderizar (SPA): se audita el HTML tal como llega,
  sin ejecutar sus scripts. Se documenta como limitación.
- Rastrear varios niveles de un sitio (solo la URL dada).
- Corregir CSS externo: la corrección es del HTML (incluidos `<style>` y atributos).

## 4. Antiobjetivos

- Tocar el diseño existente (estilos, tokens, colores, tipografía, animaciones, login, registro,
  `auth-layout`). Pantallas nuevas solo con tokens y componentes actuales.
- Ejecutar cualquier script del HTML del usuario, en el navegador o en el servidor.
- Un backend que se pueda usar para escanear la red interna de Render (SSRF).
- Mostrar como "solución" una corrección que axe no confirma.
- Llamar a Gemini dos veces con la misma entrada.
- Push sin aprobación; variables de entorno nuevas sin avisar.

## 5. Punto de partida

- Backend: Express 5, JS ESM, `pg`/Neon, Gemini por REST (`src/ia.js`, modelo por defecto
  `gemini-2.5-flash` → pasa a `gemini-3.5-flash-lite`), JWT, `items` y `/api/ia` a eliminar.
- Frontend: Angular 22 standalone, design system "cuaderno con marcador" (Atkinson Hyperlegible,
  `--color-marcador`), `axe-core` ya instalado y cargado bajo demanda (ADR 0004), carpeta `lente/`
  con las anotaciones de la propia app (el margen del login y de `/app`), sin pruebas unitarias.

## 6. Diseño

### 6.1 Motor de análisis: axe dentro de un iframe aislado (ADR 0001 del backend, 0006 del frontend)

Comprobado con una prueba en Chrome real (2026-10-18):

- Ejecutar axe desde la app sobre `iframe.contentDocument` **no funciona** (axe rechaza nodos de
  otro documento) y requeriría `allow-same-origin`.
- **Sí funciona**: `<iframe sandbox="allow-scripts">` (origen opaco: no puede leer la app, sus
  cookies ni su `localStorage`, y la app tampoco puede leerlo) con `srcdoc` = HTML del usuario +
  `<meta http-equiv="Content-Security-Policy">` con `script-src 'nonce-…'` + el script de axe y un
  "corredor" con ese nonce. Los `<script>`, `onclick` y `javascript:` del usuario quedan
  bloqueados por la CSP (comprobado: no se ejecutaron), y axe detectó `color-contrast`,
  `image-alt` y `button-name`. Los resultados vuelven por `postMessage`.
- Defensa en profundidad **(decisión de Claude)**: además de la CSP, un saneador quita `<script>`,
  `<noscript>`, `<iframe>`/`<object>`/`<embed>`, atributos `on*`, URLs `javascript:` y
  `<meta http-equiv="refresh">` antes de armar el `srcdoc`. CSP: `default-src 'none'; img-src *
  data:; style-src 'unsafe-inline' *; font-src * data:; media-src * data:; script-src 'nonce-X'`.
- El corredor escucha mensajes de la app (`auditar`, `resaltar`, `enfocar`) y avisa `listo`,
  `resultado`, `clic` (selector del elemento clicado). Valida que los mensajes vengan del padre.
- Por qué no en el servidor: Puppeteer/Chromium en el plan gratuito de Render (512 MB) es lento y
  frágil; jsdom no hace layout, así que el contraste no funciona.

### 6.2 Puntaje (función pura, con pruebas)

`puntaje = max(0, 100 − Σ penalización por regla violada)`, con penalización = peso de la
gravedad (crítico 15, serio 8, moderado 4, menor 1) + 1 por cada nodo afectado más allá del
primero, como mucho +5 por regla **(decisión de Claude)**. Sin violaciones = 100. Determinista y
explicado en `reporte.md`.

### 6.3 Resultados

Agrupados por gravedad. Cada problema: regla (`id`), descripción en español (traducción propia de
la ayuda de axe para las reglas más comunes, si no, la de axe), criterio WCAG (de las etiquetas
`wcag111` → "1.1.1 Contenido no textual" con una tabla de nombres), y por cada nodo: fragmento
(`html` de axe, recortado) y ubicación (selector `target`).

### 6.4 Lente

La vista previa es el mismo iframe aislado, visible. El corredor dibuja dentro del iframe un
contorno (estilo propio inyectado con el nonce… vía elemento `<style nonce>`) alrededor de cada
elemento con problemas y uno más grueso en el seleccionado; al clic en un elemento resaltado envía
su selector. La lista de problemas y la lente están sincronizadas por selector. Accesible por
teclado desde la lista (el iframe no es necesario para operar la app).

### 6.5 IA

- `POST /api/ia/corregir` con `{ html, problemas: [{ regla, ayuda, nodos: [{ selector, html }] }] }`
  (como mucho 30 problemas y 100 000 caracteres de HTML **(decisión de Claude)**).
- Gemini (modo JSON) devuelve `{ problemas: [{ regla, selector, explicacion, original, corregido }],
  documento }` (`documento` = HTML completo corregido). Validado con Zod; si no pasa, 1 reintento
  con los errores; si vuelve a fallar, `502` con mensaje claro.
- **Caché**: tabla `ia_cache` con clave SHA-256 del HTML + problemas + versión del prompt. Misma
  entrada → misma respuesta sin llamar a Gemini, aunque sea otro usuario **(decisión de Claude)**.
- Gemini 429 → `429` con "La IA está saturada en este momento. Espera un minuto y vuelve a
  intentarlo."; límite propio: 20 correcciones cada 15 min por usuario.

### 6.6 Verificación (frontend)

- **Por problema**: se reemplaza en el HTML original el fragmento `original` por `corregido` (si el
  fragmento no está, la corrección es "no aplicable") y se re-audita: resuelto si ya no hay
  violación de esa regla en ese selector y no aparecen violaciones nuevas.
- **Documento completo**: se re-audita `documento` y se compara con la auditoría original por
  regla + selector: resueltos, sin resolver y nuevos.
- Una corrección que no resuelve su problema queda en "No resolvió el problema" (con la
  explicación), nunca en "Correcciones".

### 6.7 Antes/después

Diff por líneas (LCS, función pura con pruebas) del HTML original y el corregido, lado a lado, con
líneas agregadas/quitadas marcadas con texto y color; puntaje antes → después.

### 6.8 Historial

- Tabla `auditorias`: `id`, `usuario_id` (FK, cascade), `pagina` (URL normalizada o nombre del
  archivo, o el que escriba la persona para lo pegado), `origen` (`pegado`/`archivo`/`url`),
  `html`, `puntaje`, `resumen` JSONB (conteo por gravedad), `problemas` JSONB, `html_corregido`,
  `puntaje_corregido`, `creado_en` TIMESTAMPTZ. Índice `(usuario_id, pagina, creado_en)`.
- Página `/historial`: auditorías agrupadas por página con la evolución del puntaje (línea SVG
  simple con tokens y la lista de valores en texto, para lectores de pantalla). Abrir y eliminar.
- `items`: deja de crearse pero **no se borra** (mismo criterio que decidió el usuario en
  CodeToDiagram).

### 6.9 Exportar

- Markdown: función pura (con pruebas) con puntaje, problemas por gravedad, criterio, ubicación,
  explicación y resultado de la verificación.
- PDF: vista de reporte con estilos de impresión y `window.print()` ("Guardar como PDF") **(decisión
  de Claude: sin dependencias)**.
- HTML corregido: descarga del documento verificado.

### 6.10 SSRF (`POST /api/paginas/descargar`)

Solo `http`/`https`, sin usuario:contraseña en la URL, puertos 80/443 **(decisión de Claude)**.
Se resuelve el DNS y se rechaza si **cualquier** dirección es privada, loopback, link-local,
CGNAT, multicast, reservada o sin especificar (IPv4 e IPv6, incluidas IPv4 mapeadas en IPv6); la
conexión se fija a la IP validada (evita DNS rebinding, con `undici`). Redirecciones manuales
(máximo 3), cada una revalidada. Tiempo máximo 8 s, tamaño máximo 2 MB (se corta el stream),
`content-type` HTML. Límite: 30 descargas cada 15 min por usuario.

### 6.11 La propia app

Pantallas nuevas con los tokens actuales, foco visible, `aria-live` donde corresponde, sin
depender solo del color. Prueba con axe (Playwright) de `/login`, `/app`, `/historial` en claro y
oscuro, escritorio y móvil: cero violaciones. Resultado en `frontend/docs/accesibilidad.md`.

## 7. Variables de entorno

Ninguna nueva. `GEMINI_MODEL` ya existe; el valor por defecto en el código pasa a
`gemini-3.5-flash-lite`.

## 8. Queda a criterio del constructor

Textos exactos, traducciones de reglas de axe, orden de los commits, detalles de layout dentro de
los tokens.
