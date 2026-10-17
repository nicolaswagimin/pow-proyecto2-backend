# a11Lens · IA por fragmentos y columna de recomendaciones · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (Native, elegido por el usuario en rondas anteriores). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir con IA páginas de cualquier tamaño enviando solo fragmentos, armar y verificar el documento en el navegador, y reemplazar la columna «Anotaciones» de /app por recomendaciones en vivo de la página auditada.

**Architecture:** El corredor envía por nodo su ruta en el DOM. La app la recorre sobre un parse5 del HTML original para obtener rangos de texto exactos. Los fragmentos van por lotes a `POST /api/ia/fragmentos`, que tiene caché por fragmento, y las correcciones se aplican como reemplazos de texto que se verifican con axe. La columna derecha escucha los elementos visibles en el iframe y muestra qué hacer con cada uno.

**Tech Stack:** Express 5 + Zod + Gemini (backend, `node --test`); Angular 22 con signals + Vitest + parse5 8 (frontend); axe-core 4.14 en un iframe aislado.

**Spec:** `backend/docs/superpowers/specs/2026-10-17-a11lens-ia-por-fragmentos-y-columna-design.md`

## Global Constraints

- NO tocar el diseño existente: estilos, tokens, colores, tipografía, animaciones, login, registro y auth-layout. Lo nuevo usa solo los tokens y componentes actuales.
- Commits pequeños y reales: Conventional Commits en español con scope. La app compila en cada commit.
- Nunca subir `.env`, `node_modules`, `dist` ni `.angular`. Sin push hasta que el usuario apruebe.
- Gemini simulado en las pruebas; el Gemini real solo en la verificación final.
- Sin variables de entorno nuevas.
- La app pasa axe (WCAG 2.2 A/AA) sin errores en todos sus estados.
- Lote: ≤ 8 fragmentos únicos y ≤ 12 000 caracteres. Ronda: ≤ 3 lotes.
- Backend: ≤ 10 fragmentos; `html` ≤ 4000; `padre` y `resumen` ≤ 1000; suma ≤ 20 000; `corregido` ≤ 8000; `explicacion` ≤ 600; `VERSION_PROMPT = 'fragmentos-v1'`.
- Fragmento completo si mide ≤ 1500, no contiene a otro nodo con problemas y no es `html`, `head` ni `body`; si no, solo la etiqueta de apertura.

## Review Focus

1. HTML con scripts, `noscript` o iframes antes del elemento: la ruta debe saltarlos igual que el saneador (pruebas en la tarea F2).
2. `<p>` y `<li>` sin etiqueta de cierre, y elementos implícitos (`<html>` sin etiqueta): el rango debe ser correcto o «no ubicable», nunca un rango equivocado (F2).
3. Corrección de apertura que cambia de elemento o se come el cierre: `quitaUOculta` o la validación de la apertura la rechazan (F3).
4. Respuesta de IA con ids repetidos, desconocidos o vacíos: se rechazan sin romper el lote (B1, B2).
5. Cambiar de página a mitad de una ronda: no se mezclan resultados (F5).

---

## Backend

### Task B1: Esquemas de fragmentos

**Files:** Modify `src/ia/esquema.js`; Test `test/esquema.test.js`.

**Interfaces:** Produces `MAX_FRAGMENTOS = 10`, `MAX_TOTAL_FRAGMENTOS = 20_000`, `esquemaEntradaFragmentos`, `validarRespuestaFragmentos(valor, pedidos) → { validos: {id, explicacion, corregido}[], errores: string[] }`. Elimina `MAX_HTML_IA`, `esquemaEntrada`, `esquemaCorreccion` y `validarCorreccion`.

- [ ] Pruebas:
  - entrada válida;
  - 11 fragmentos → "Se pueden corregir hasta 10 fragmentos a la vez.";
  - suma > 20 000 → "Los fragmentos superan 20 000 caracteres en total.";
  - ids repetidos → error;
  - respuesta con un id desconocido, con `corregido` igual a `html` o vacío → ese item va a `errores` y los demás quedan en `validos`.
- [ ] Verlas fallar, implementar y verlas pasar. Commit `feat(ia): esquemas de entrada y respuesta por fragmentos`.

### Task B2: `corregirFragmentos` con caché por fragmento

**Files:** Modify `src/ia/corregir.js`, `src/ia/prompt.js`; Test `test/corregir.test.js`.

**Interfaces:** Produces `corregirFragmentos(entrada, { llamar, cache }) → { fragmentos: {id, explicacion, corregido, desdeCache}[], sinRespuesta: string[] }`, `claveFragmento(fragmento, pagina)`, `construirPromptFragmentos({ pagina, fragmentos })` y `INSTRUCCIONES_FRAGMENTOS`.

- [ ] Pruebas, con Gemini y caché simulados:
  - todos en caché → 0 llamadas;
  - 2 de 3 en caché → la llamada lleva solo 1 fragmento;
  - la primera respuesta deja uno sin responder → el reintento pide solo ese y lleva los errores;
  - sigue faltando → `sinRespuesta: ['f3']`;
  - ninguno válido → `ErrorIA` 502;
  - una entrada inválida → 400 sin llamar a Gemini;
  - la clave no depende del `id`;
  - **página grande**: fragmentos extraídos de un HTML generado de 400 000 caracteres → se aceptan (antes fallaba por los 100 000).
- [ ] Implementar y hacer que pasen.
- [ ] Commits: `feat(ia): prompt por fragmentos`, `feat(ia): corrección por fragmentos con caché por fragmento` y `refactor(ia): quitar la corrección del documento completo`.

### Task B3: Ruta `POST /api/ia/fragmentos`

**Files:** Modify `src/routes/ia.js`; Test `test/rutas.test.js`.

- [ ] Pruebas:
  - `200` con `{ fragmentos, sinRespuesta }`;
  - `400` con un mensaje propio;
  - `POST /api/ia/corregir` → `404`.
- [ ] Implementar. Commit `feat(ia): ruta /api/ia/fragmentos`.

### Task B4: Docs del backend

- [ ] Un commit por archivo:
  - `docs/ia.md`: flujo, prompt, formato, caché por fragmento y límites;
  - `docs/api.md`;
  - `docs/seguridad.md` (tabla de límites);
  - `docs/arquitectura-backend.md`;
  - ADR `docs/decisiones/0005-ia-por-fragmentos.md`;
  - `CHANGELOG.md`;
  - `README.md` (número de pruebas).

## Frontend

### Task F1: El corredor envía la ruta, la etiqueta, el resumen y los visibles

**Files:**
- Modify: `public/auditor/corredor.js`, `src/app/auditor/axe-a-problemas.ts`, `src/app/auditor/modelo.ts`, `src/app/auditor/motor.service.ts`.
- Test: `axe-a-problemas.spec.ts`, `motor.spec.ts`, `src/app/auditor/corredor.spec.ts` (carga el script en jsdom con un `axe` simulado).

**Interfaces:**
- Produces: `NodoProblema` con los campos nuevos `ruta: number[] | null`, `etiqueta: string` y `resumen: string`.
- Produces: `SesionAislada.alVisibles(cb: (selectores: string[]) => void)`.

- [ ] Pruebas:
  - `rutaDe` salta los `script`, `base`, `meta[http-equiv]` y `[data-a11lens]`;
  - `aProblemas` conserva `ruta`, `etiqueta` y `resumen` (recortado a 500);
  - el mensaje `visibles` llega a `alVisibles` solo con el token de sesión.
- [ ] Implementar; el corredor usa `elementRef: true` y un `IntersectionObserver` sobre los marcados.
- [ ] Commits: `feat(auditor): ruta y resumen de cada nodo`, `feat(lente): aviso de los elementos visibles`.

### Task F2: Ubicar fragmentos con parse5

**Files:** Create `src/app/auditor/fragmentos.ts`; Test `fragmentos.spec.ts`; `package.json` (parse5 `^8.0.1`).

**Interfaces:** Produces:
- `interface Ubicacion { inicio: number; fin: number; tipo: 'elemento' | 'apertura'; etiqueta: string }`
- `interface FuenteHtml { ubicar(ruta: number[] | null, etiqueta: string): { elemento: Rango; apertura: Rango } | null; idioma: string; titulo: string; aperturaPadre(ruta): string; aperturaDeHead(): Rango | null }`
- `async function analizarFuente(html: string): Promise<FuenteHtml>` (parse5 por `import()` dinámico)
- `elegirFragmento(...)`

- [ ] Pruebas, cada una con `ubicar` y un `slice` que debe coincidir con el texto literal:
  - un `img` después de un `<script>` y un `<noscript>`;
  - un `<p>` sin cierre;
  - un `<html>` implícito → `null`;
  - una etiqueta que no coincide → `null`;
  - atributos con comillas simples y `>` dentro de un valor;
  - fragmento completo frente a apertura (1500, contiene otro nodo, `body`);
  - `document-title` → la apertura de `<head>`.
- [ ] Implementar. Commits: `build(deps): parse5 como dependencia directa`, `feat(auditor): ubicar los elementos en el HTML original`.

### Task F3: Lotes, reemplazos y verificación combinada

**Files:**
- Create: `src/app/auditor/lotes.ts`, `src/app/auditor/reemplazos.ts`.
- Modify: `src/app/auditor/verificar.ts`.
- Test: `lotes.spec.ts`, `reemplazos.spec.ts`, `verificar.spec.ts`.

**Interfaces:**
- Produces `pendientes(...)`, `armarLotes(pendientes, { maxFragmentos: 8, maxCaracteres: 12_000 }) → Lote[]` (deduplica por clave) y `aplicarReemplazos(html, Reemplazo[]) → string` (de atrás hacia adelante, rechaza solapes).
- Produces `verificarLote(base: {html, auditoria}, candidatas, auditar) → CorreccionVerificada[]` y el estado `'sin-respuesta'`.

- [ ] Pruebas:
  - prioridad por gravedad;
  - corte por cantidad y por caracteres;
  - deduplicación (3 nodos iguales → 1 fragmento con 3 ubicaciones);
  - los reemplazos no tocan el resto del texto (byte a byte);
  - un solape lanza un error;
  - verificación combinada: todo resuelto con 1 auditoría;
  - un problema nuevo → se audita uno por uno y se atribuye;
  - una corrección de apertura que cambia de etiqueta → `quita-elemento`.
- [ ] Commits: `feat(auditor): lotes por gravedad con deduplicación`, `feat(auditor): aplicar correcciones como reemplazos de texto`, `feat(auditor): verificación combinada por lote`.

### Task F4: Servicio de IA

**Files:** Modify `src/app/services/ia.service.ts`; Test `ia.service.spec.ts`.

- [ ] `corregirFragmentos(pagina, fragmentos)` → `POST /ia/fragmentos`. Prueba con `HttpTestingController`. Commit `feat(ia): cliente de /ia/fragmentos`.

### Task F5: Estado: rondas, progreso y «Corregir más»

**Files:**
- Modify: `src/app/pages/inicio/auditoria-estado.ts`, `inicio.html`, `src/app/auditor/exportar.ts`, `componentes/correcciones/*`.
- Test: `auditoria-estado.spec.ts`, `src/testing/pagina-grande.ts` (generador).

**Interfaces:** Produces:
- `corregir()`: procesa una ronda de 3 lotes;
- `quedan: Signal<number>`;
- `documentoCorregido` = el documento acumulado;
- `progresoIA`: "Lote i de n: …".

- [ ] Pruebas:
  - **página grande generada** (> 300 KB, ≥ 60 problemas): la primera ronda envía 3 peticiones de ≤ 8 fragmentos, los críticos primero; no se envía el HTML entero; el documento corregido solo difiere en los fragmentos; `quedan` baja;
  - «Corregir más» envía los siguientes;
  - cambiar de auditoría a mitad descarta todo;
  - `sinRespuesta` → estado `sin-respuesta`;
  - la etiqueta de exportación del estado nuevo.
- [ ] Commits:
  - `feat(inicio): corrección por lotes con progreso`;
  - `feat(inicio): corregir más`;
  - `feat(correcciones): estado sin respuesta de la IA`;
  - `test(inicio): página grande de ejemplo`.

### Task F6: Columna de recomendaciones en vivo

**Files:**
- Create: `src/app/auditor/recomendaciones.ts`, `src/app/auditor/componentes/recomendaciones/{ts,html,css,spec}`.
- Modify: `componentes/lente/*` (barra de ventana y salida `visibles`), `inicio.html`, `inicio.ts`, `inicio.css`.

- [ ] Pruebas:
  - texto de qué hacer para las reglas comunes, con una alternativa;
  - el panel muestra solo los visibles y «En toda la página»;
  - un clic emite `seleccionar`;
  - con corrección, muestra la explicación y el estado;
  - estado vacío con los dos ejemplos, que emiten la URL;
  - en /app ya no está `app-margen`.
- [ ] Commits:
  - `feat(auditor): qué hacer con cada regla`;
  - `feat(lente): barra de ventana y elementos visibles`;
  - `feat(recomendaciones): panel en vivo`;
  - `feat(recomendaciones): estado vacío con ejemplos`;
  - `feat(inicio): columna de recomendaciones en lugar de anotaciones`.

### Task F7: Insignia de autoauditoría en el pie

**Files:** Modify `src/app/lente/auditoria.ts` (entradas `auto` y `problemas`, sin cambiar el comportamiento por defecto); Create `src/app/layouts/insignia-auditoria/*`; Modify `inicio.html` y `inicio.css`.

- [ ] Pruebas:
  - la insignia dice "Esta app: 0 problemas WCAG 2.2 AA";
  - `aria-expanded` cambia al hacer clic;
  - el detalle ejecuta la auditoría y el texto refleja el número real.
- [ ] Commits: `feat(auditoria): ejecución automática y conteo`, `feat(inicio): insignia de autoauditoría en el pie`.

### Task F8: Verificación y documentación

- [ ] Suite completa y build de producción sin advertencias.
- [ ] axe sobre /app con Playwright: estados vacío, resultado y corrección; claro y oscuro; 390 y 1280 px.
- [ ] Flujo real con Gemini sobre la página W3C «before».
- [ ] `demo.sh`, luego `stop.sh`.
- [ ] Docs, un commit cada uno:
  - `funcionalidades.md`, `lente.md`, `accesibilidad.md`, `componentes.md` y `arquitectura-frontend.md`;
  - ADR `0010` y ADR `0011`;
  - `CHANGELOG.md`, `README.md` y capturas.
- [ ] Revisión final de toda la rama; corregir lo crítico e importante con TDD.
