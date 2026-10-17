# 0001 · axe-core en el navegador, dentro de un iframe aislado

- **Estado:** aceptada · **Fecha:** 2026-10-17

## Contexto
La regla de contraste de axe-core necesita render real (layout y colores calculados). Se probaron tres caminos:
- **Servidor con jsdom**: no calcula layout ni colores; el contraste no funciona.
- **Servidor con Chromium sin cabeza (Puppeteer)**: en el plan gratuito de Render (512 MB) arranca lento, consume casi toda la memoria y se cae con páginas pesadas.
- **Navegador**: el usuario ya tiene un motor de render. Falta aislar el HTML, que puede ser hostil.

Prueba en Chrome real (2026-10-17): ejecutar axe desde la app sobre `iframe.contentDocument` **no funciona** (axe rechaza nodos de otro documento) y exigiría `allow-same-origin`. Ejecutar axe **dentro** de un iframe `sandbox="allow-scripts"` con CSP por nonce **sí**: detectó contraste, imagen sin alt y botón sin nombre, y el `<script>`, el `onclick` y el `javascript:` del HTML no corrieron.

## Decisión
La auditoría corre en el navegador: iframe con `sandbox="allow-scripts"` (sin `allow-same-origin`), HTML saneado, CSP con nonce que solo deja correr axe y el corredor de a11Lens, comunicación por `postMessage`. El backend solo descarga páginas por URL.

## Consecuencias
- El contraste se calcula con el render real del navegador, también con estilos externos por https.
- El servidor no gasta memoria en navegadores y no necesita variables ni dependencias nuevas en Render.
- Los scripts de la página nunca corren: las páginas que se arman con JavaScript se auditan casi vacías (la interfaz lo avisa).
- La auditoría funciona aunque el backend esté apagado (solo URL, IA e historial lo necesitan).
