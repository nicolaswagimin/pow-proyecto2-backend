# Análisis de accesibilidad · a11Lens

## Dónde corre axe-core: en el navegador, aislado

El análisis **no** corre en el servidor: lo hace el frontend con axe-core dentro de un iframe aislado (ver [decisiones/0001](decisiones/0001-axe-en-iframe-aislado-del-navegador.md)). El backend solo descarga páginas por URL (con protección SSRF), corrige con IA y guarda el historial.

- `<iframe sandbox="allow-scripts">`, **sin** `allow-same-origin`, `allow-forms`, `allow-popups` ni `allow-top-navigation`: el documento tiene un origen opaco y no puede leer la app, sus cookies ni su sesión; tampoco enviar formularios, abrir ventanas ni navegar la pestaña.
- El HTML del usuario se sanea (se quitan `<script>`, `<noscript>`, marcos, `<object>`, `<embed>`, `<base>`, `<meta http-equiv>` —incluido `refresh`—, atributos `on*`, `srcdoc` y URLs `javascript:`).
- Se agrega una CSP con nonce: `default-src 'none'; script-src 'nonce-…'; style-src https: 'unsafe-inline'; font-src https: data:; img-src https: data:; media-src https: data:`. Solo corren axe y el corredor de a11Lens; estilos, fuentes e imágenes externas por https sí cargan, para que el contraste se calcule con los estilos reales.
- En páginas por URL se agrega `<base href="URL final">`, así las rutas relativas (CSS, imágenes) cargan como en la página real.
- Por qué no en el servidor: jsdom no calcula layout ni colores, así que la regla de contraste no funciona; un Chromium sin cabeza en el plan gratuito de Render (512 MB) es lento y frágil.

Comprobado en Chrome real: axe detecta `color-contrast`, `image-alt` y `button-name`, y un `<script>`, un `onclick` y un `javascript:` del HTML no se ejecutan.

## Reglas

axe-core con las etiquetas `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` y `wcag22aa` (WCAG 2.2 niveles A y AA). Si lo pegado es un fragmento (sin `<html>`), se desactivan las reglas de documento completo (`html-has-lang`, `html-lang-valid`, `document-title`, `landmark-one-main`, `page-has-heading-one`, `region`, `bypass`): no tiene sentido exigirlas a un trozo de página.

Cada problema muestra su gravedad (crítico, serio, moderado, menor, desde el `impact` de axe), una descripción en español (traducción propia de las reglas más comunes), el criterio WCAG con su nombre (desde las etiquetas `wcag111` → 1.1.1 Contenido no textual) y, por cada elemento, su fragmento y su ubicación (el selector de axe).

## Puntaje

```
puntaje = max(0, 100 − Σ penalización por regla incumplida)
penalización = peso de la gravedad + min(5, elementos afectados − 1)
pesos: crítico 15 · serio 8 · moderado 4 · menor 1
```

Ejemplos: sin problemas, 100. Un problema crítico en 1 elemento, 85. Uno serio en 4 elementos, 100 − (8 + 3) = 89. Un moderado en 40 elementos, 100 − (4 + 5) = 91. Calificación en palabras: 95 o más "Excelente", 80–94 "Bueno", 50–79 "Necesita mejoras", menos de 50 "Deficiente".

La fórmula se muestra en la interfaz con un "¿Cómo se calcula?" junto al puntaje y en el reporte exportado. Código: `frontend/src/app/auditor/puntaje.ts`.

## Verificación de las correcciones

Las correcciones llegan por fragmentos (ver [ia.md](ia.md)) y el frontend las aplica como **reemplazos de texto** en su lugar exacto del HTML. Se verifican por lote:

1. **Todas juntas.** Se aplican las correcciones del lote y se audita una vez.
   - *Resuelto*: el par regla + selector ya no aparece, la regla bajó al menos en tantos elementos como correcciones suyas desaparecieron (si la corrección cambió el selector pero el problema sigue, no cuenta) y no aparecieron problemas nuevos.
   - Una corrección que quita u oculta el elemento no se aplica: queda como *Quitó u ocultó el elemento*.
2. **Una por una, si hace falta.** Si la auditoría combinada trae problemas nuevos, se audita cada corrección por separado para saber cuál los causó (*Resolvió pero introdujo otros*).
3. **Documento corregido.** Es el HTML original con **solo las resueltas**. Se compara con la auditoría original: resueltos, sin resolver, nuevos y puntaje antes → después.

*No resolvió el problema*, *Resolvió pero introdujo otros*, *No se pudo aplicar* y *La IA no devolvió una corrección válida* nunca se presentan como solución.

## Limitación: páginas que necesitan JavaScript

a11Lens no ejecuta los scripts de la página. Si el contenido se arma con JavaScript (una SPA), se audita una página casi vacía. `pareceSpa()` lo detecta (body con menos de 80 caracteres de texto y un contenedor raíz como `#root`, `#app`, `#__next`, `app-root`, o casi solo scripts) y la interfaz lo avisa, sugiriendo pegar el HTML ya renderizado.
