# 0002 · Descarga de páginas con validación de DNS e IP fijada

- **Estado:** aceptada · **Fecha:** 2026-10-17

## Contexto
Auditar por URL obliga al servidor a pedir una dirección que escribe el usuario: es la puerta clásica del SSRF (red interna de Render, metadatos de la nube en `169.254.169.254`, `localhost`). Validar solo el texto de la URL no alcanza: un dominio público puede resolver a una IP interna, o cambiar de IP entre la validación y la conexión (DNS rebinding), o redirigir a una dirección interna.

## Decisión
- Validar forma (http/https, sin credenciales, puertos 80/443) y rechazar `localhost`.
- Resolver el DNS y rechazar si **cualquiera** de las IPs es privada, reservada o especial (IPv4 e IPv6, mapeadas y NAT64).
- Conectar **a la IP validada** con `undici` y un `lookup` propio, sin volver a resolver.
- Seguir las redirecciones a mano (máximo 3), revalidando cada una.
- 8 s, 2 MB y solo HTML.

## Consecuencias
- Una dependencia más (`undici`), que es el cliente HTTP de Node.
- Puertos distintos de 80/443 no se pueden auditar (páginas de desarrollo en `:8080`, por ejemplo).
- Probado con DNS y red simulados (13 casos) y contra la red real (`localtest.me`, que apunta a 127.0.0.1, queda bloqueado).
