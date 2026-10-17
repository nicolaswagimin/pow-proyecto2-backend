# a11Lens · IA por fragmentos y columna de recomendaciones · Diseño

Fecha: 2026-10-17. Repos: `a11Lens/backend` y `a11Lens/frontend`.

## Por qué

1. Al auditar una página real, «Explicar y corregir» falla con "El HTML es demasiado largo para
   corregirlo con la IA (máximo 100 000 caracteres)". Las páginas reales casi siempre pasan ese
   límite, porque hoy se manda el documento entero a Gemini y Gemini devuelve el documento entero
   corregido.
2. En /app, la columna derecha muestra «Anotaciones», que describe la propia página de a11Lens
   y no la página auditada, y ocupa el mejor espacio de la pantalla.

## Metas

- Corregir con IA páginas de cualquier tamaño hasta el límite de descarga (2 MB). A Gemini solo
  van fragmentos.
- El documento corregido se arma **en el navegador** reemplazando cada fragmento en el HTML
  original, y se verifica con axe.
- Ir por gravedad (crítico → serio → moderado → menor), por lotes, mostrando el progreso, con
  «Corregir más».
- Caché por fragmento: el mismo fragmento con el mismo contexto no vuelve a llamar a Gemini.
- La columna derecha de /app muestra recomendaciones en vivo de lo que se ve en la vista previa.
  Antes de auditar, muestra un estado vacío útil.
- La autoauditoría de a11Lens pasa a una insignia discreta en el pie.

## No metas

- No se cambian login, registro, auth-layout, `/design` ni los tokens. El panel «Anotaciones»
  sigue en esas páginas.
- No se corrigen con IA los problemas que no tienen un elemento ubicable en el HTML original:
  elementos implícitos (sin etiqueta en la fuente), elementos dentro de shadow DOM o de un iframe,
  y problemas nuevos que aparecen tras corregir.
- No se ejecuta nada del HTML del usuario. El aislamiento (sandbox, CSP y nonce) no cambia.

## Anti-metas

- Presentar como solución una corrección que no se verificó.
- Reformatear el documento: el diff solo debe mostrar los fragmentos cambiados. Por eso se
  reemplaza texto y el DOM no se vuelve a serializar.
- Un estado vacío que solo diga "no hay nada".

## Parte 1 · IA por fragmentos

### Ubicar cada elemento en el HTML original

- axe devuelve `html` recortado (`<div class="…" ...>`) y con el formato del DOM, que no es el
  del archivo. No sirve para buscarlo en el texto.
- El corredor (dentro del iframe) usa `elementRef: true` y, por cada nodo, envía:
  - `ruta`: la ruta de índices de hijos-elemento desde `<html>`. No cuenta los nodos que agregó
    a11Lens (`script`, `base`, `meta[http-equiv]` y `[data-a11lens]`). Como el saneador quitó
    todos los de la página, los que quedan son nuestros.
  - `etiqueta`: el nombre del elemento.
  - `resumen`: el `failureSummary` de axe, que para contraste trae los colores y la razón.
    Hasta 500 caracteres.
  - En shadow DOM o iframes, `ruta` es `null`.
- La app parsea el HTML original con **parse5** (`sourceCodeLocationInfo`,
  `scriptingEnabled: false`, igual que `DOMParser`) y recorre la misma ruta. No cuenta los
  elementos que quita `sanear` (`script, noscript, iframe, frame, frameset, object, embed,
  applet, base, meta[http-equiv]`). Así obtiene el rango exacto del elemento en el texto.
- Si el nombre no coincide o falta la ubicación (elemento implícito), el nodo queda como **no
  ubicable** y no se envía.
- parse5 (^8.0.1, ya en el árbol) pasa a ser dependencia directa y se carga bajo demanda, en un
  chunk aparte que solo se pide al corregir.

### Qué se envía: el fragmento

- **Elemento completo** si su HTML fuente mide ≤ 1500 caracteres, no contiene a otro elemento
  con problemas y no es `html`, `head` ni `body`.
- **Solo la etiqueta de apertura** en los demás casos. La mayoría de las correcciones son
  atributos: `alt`, `aria-label`, `lang`, `style` o `role`.
  - Excepción: en `document-title` (nodo `html`) se envía la apertura de `<head>`, y la
    corrección puede agregar `<title>…</title>` justo después.
  - En general, una corrección de apertura debe empezar con una apertura del mismo elemento y
    puede agregar contenido después solo si la regla lo exige.
- Así, dos fragmentos nunca se pisan: las aperturas no se solapan con otros elementos, y un
  elemento completo no contiene otro con problemas.
- **Contexto mínimo** de cada fragmento:
  - `padre`: la etiqueta de apertura del padre en la fuente, hasta 300 caracteres;
  - `resumen`.
- Contexto de la página, una vez por lote: `idioma` (`lang` del `<html>`) y `titulo` (el texto
  de `<title>`).
- **Deduplicación**: dentro de un lote, los nodos con el mismo `regla + fragmento + padre +
  resumen` se envían una sola vez, y la corrección se aplica a todos.

### Lotes, prioridad y «Corregir más»

- **Pendientes**: los nodos de la auditoría original, ubicables, que aún no se intentaron y que
  siguen presentes en la auditoría del documento acumulado. Se ordenan por gravedad, luego por
  el orden de axe.
- **Lote**: hasta 8 fragmentos únicos y ≤ 12 000 caracteres sumando fragmento, padre y resumen.
- **Ronda**: un clic procesa hasta 3 lotes en serie, por la cuota de Gemini.
  - Progreso visible en `role="status"`: "Lote 2 de 3: pidiendo la corrección a la IA…",
    "Lote 2 de 3: verificando…".
  - Al terminar, «Corregir más (quedan N elementos)» procesa la siguiente ronda.
- Un cambio de página cancela todo (el contador `generacion` ya existe).

### Verificación

Por lote:

1. Aplica en el documento acumulado las correcciones que no `quitaUOculta`, y audita una vez.
2. Una corrección queda **resuelta** si:
   - su `regla|selector` desaparece, y
   - la cantidad de nodos de esa regla bajó al menos tanto como el número de correcciones de esa
     regla que desaparecieron.
   - Si no, queda **no resolvió**.
3. Si la auditoría combinada trae problemas nuevos, para atribuirlos se audita cada corrección
   por separado sobre el documento acumulado anterior. Es el método de hoy:
   `verificarPorProblema`.
4. El documento acumulado solo incorpora las correcciones **resueltas**. Si hubo descartes, se
   vuelve a auditar el documento final para la verificación del documento.

Además:

- Estados: los de hoy y uno nuevo, **`sin-respuesta`** ("La IA no devolvió una corrección
  válida"). Los estados de hoy son resuelto, no resolvió, introdujo problemas, quitó u ocultó y
  no aplicable.
- El documento corregido que se muestra (diff, descarga e historial) es el acumulado: solo
  correcciones verificadas.
- `documentoEmpeora` se mantiene, ahora casi siempre falso.

### Backend: `POST /api/ia/fragmentos`

Reemplaza a `POST /api/ia/corregir`, que deja de existir (`404`).

Entrada (Zod):

```json
{
  "pagina": { "idioma": "es", "titulo": "Tienda" },
  "fragmentos": [
    { "id": "f1", "regla": "image-alt", "ayuda": "Las imágenes deben tener texto alternativo.",
      "html": "<img src=\"logo.png\">", "padre": "<a href=\"/\">", "resumen": "Fix any of…" }
  ]
}
```

Límites de entrada:

- `fragmentos`: 1 a 10.
- `id`: hasta 20 caracteres, único.
- `html`: 1 a 4000. `padre`: hasta 1000. `resumen`: hasta 1000.
- `titulo`: hasta 300. `idioma`: hasta 35.
- Suma de `html + padre + resumen`: ≤ 20 000.

Respuesta:

```json
{
  "fragmentos": [ { "id": "f1", "explicacion": "…", "corregido": "<img src=\"logo.png\" alt=\"…\">", "desdeCache": false } ],
  "sinRespuesta": []
}
```

Validación de la respuesta (Zod):

- `explicacion`: 1 a 600.
- `corregido`: 1 a 8000 y distinto del `html` enviado.
- Cada `id` debe ser uno de los pedidos.

Llamada y caché:

- Caché por fragmento en `ia_cache`. La clave es el SHA-256 de `VERSION_PROMPT` +
  `{ regla, ayuda, html, padre, resumen, idioma, titulo }`.
  - Se lee cada fragmento y solo los que faltan van a Gemini, en una sola llamada.
  - Si todos están en caché, no hay llamada.
- Si la respuesta no es válida, se reintenta una vez, enviando solo los que faltan y los errores.
  - Si aún faltan algunos, la respuesta es `200` con los válidos, y los demás van en
    `sinRespuesta`.
  - Si no hay ninguno válido, `502`.
- `VERSION_PROMPT = fragmentos-v1`. El límite propio sigue en 20 peticiones cada 15 minutos por
  usuario; una petición es un lote.
- Se elimina `MAX_HTML_IA` (100 000) y su mensaje.

### Límites que quedan

| Qué | Límite |
|---|---|
| Descarga por URL | 8 s, 2 MB, solo HTML (sin cambios) |
| Pegar o subir archivo | 2 MB, el mismo que la descarga y el historial |
| Auditoría | Sin límite propio |
| IA | 10 fragmentos por petición, 4000 caracteres por fragmento, 20 000 en total; 20 peticiones cada 15 minutos |

## Parte 2 · Columna derecha de /app

1. `app-margen` («Anotaciones») y `app-auditoria` salen de /app; siguen en login, registro y
   `/design`.
2. **Vista previa como ventana de navegador.** No encontré un rediseño anterior que defina el
   panel sincronizado con el scroll. Decisión mía:
   - la lente gana una barra de ventana: tres puntos decorativos y la dirección de la página
     auditada;
   - el corredor observa los elementos resaltados con `IntersectionObserver` y avisa cuáles
     están a la vista en el iframe (mensaje `visibles`, como mucho uno por cuadro de animación);
   - la columna derecha (`ui-recomendaciones`) muestra, para cada elemento a la vista, su
     gravedad, la descripción y **qué hacer** (texto fijo por regla, en español;
     `recomendaciones.ts`). Si ya hay una corrección verificada, muestra la explicación de la IA
     y su estado;
   - al desplazarse dentro de la vista previa, la lista cambia;
   - un clic en una recomendación la selecciona y la enfoca en la lente y en la lista;
   - aparte, «En toda la página» lista los problemas sin elemento visible (`html`, `head`,
     `body`);
   - no es una región `aria-live`, para no hablar en cada scroll. Lleva un encabezado y un
     contador.
3. **Estado vacío, antes de auditar.** Explica qué va a encontrar a11Lens: imágenes sin texto
   alternativo, contraste insuficiente, campos sin etiqueta, enlaces y botones sin nombre, y
   estructura (encabezados, regiones, idioma, título), con las reglas WCAG 2.2 A y AA de
   axe-core. Ofrece dos ejemplos de un clic, que se auditan directamente por URL:
   - «Página inaccesible de demostración del W3C»:
     `https://www.w3.org/WAI/demos/bad/before/home.html`;
   - «La misma página, corregida»: `https://www.w3.org/WAI/demos/bad/after/home.html`.

   Mientras audita, muestra "Auditando…".
4. **Insignia en el pie.** `<footer>` con un botón "Esta app: 0 problemas WCAG 2.2 AA".
   - El dato viene de la última verificación documentada en `docs/accesibilidad.md`.
   - Al hacer clic se despliega (`aria-expanded`) el detalle y se ejecuta la autoauditoría
     real. La insignia pasa a mostrar el número real.
   - `Auditoria` gana dos entradas opcionales, `auto` y `problemas`. Su comportamiento por
     defecto no cambia.
5. **Móvil (< 960 px).** La columna no existe: las recomendaciones van debajo de la vista previa
   y el estado vacío debajo de «Auditar».

## Pruebas

- **Backend:**
  - esquema de fragmentos;
  - caché por fragmento: aciertos parciales y totales;
  - reintento solo de los que faltan;
  - `sinRespuesta`;
  - `502`;
  - una página grande (> 300 000 caracteres) cuyos fragmentos sí entran;
  - `/api/ia/corregir` responde `404`.
- **Frontend:**
  - `ubicar` con parse5: elementos implícitos, scripts quitados, `noscript`, `<p>` sin cierre;
  - elegir el fragmento (completo o apertura);
  - lotes (8 y 12 000) y prioridad;
  - deduplicación;
  - aplicar reemplazos sin reformatear;
  - verificación combinada y la alternativa de auditar uno por uno;
  - estado: rondas y «Corregir más»;
  - una **página grande de ejemplo generada** (> 300 KB, más de 60 problemas) de punta a punta,
    con IA simulada;
  - mensaje `visibles` y panel de recomendaciones;
  - estado vacío e insignia.
- **App:**
  - axe sobre /app en sus estados (vacío, con resultado y con correcciones), claro y oscuro,
    móvil y escritorio: 0 problemas;
  - flujo real con Gemini sobre la página del W3C;
  - build de producción sin advertencias.

## Documentación

- **Backend:**
  - `ia.md`, `api.md`, `seguridad.md` (límites) y `arquitectura-backend.md`;
  - ADR `0005-ia-por-fragmentos.md`;
  - `CHANGELOG.md` y `README.md`.
- **Frontend:**
  - `funcionalidades.md`, `lente.md` (mensajes `visibles`, `ruta` y `resumen`),
    `accesibilidad.md`, `componentes.md` y `arquitectura-frontend.md`;
  - ADRs `0010-ubicar-fragmentos-con-parse5.md` y `0011-columna-de-recomendaciones-en-vivo.md`;
  - `CHANGELOG.md`, `README.md` y capturas de /app.

## Decisiones (mías)

1. El panel sincronizado con el scroll no existía. Lo definí como se describe en la parte 2,
   punto 2.
2. Ruta `/api/ia/fragmentos` nueva; la vieja se elimina. Mientras Render y Vercel despliegan,
   el frontend viejo recibe `404` unos minutos.
3. El documento corregido incluye solo las correcciones verificadas.
4. Rondas de 3 lotes de hasta 8 fragmentos, para no gastar la cuota de un clic.
5. Pegar y subir archivo siguen en 2 MB, igual que la descarga y el historial.
6. Los ejemplos son las páginas «before» y «after» de la demo BAD del W3C.
7. La insignia muestra el dato verificado y lo confirma en vivo al abrirla.
8. Sin variables de entorno nuevas.
