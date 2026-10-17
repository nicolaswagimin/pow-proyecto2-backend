# 0004 · La tabla items deja de crearse pero no se borra

- **Estado:** aceptada · **Fecha:** 2026-10-17

## Contexto
El CRUD de ejemplo (`items`) se reemplaza por las auditorías. `schema.sql` se ejecuta en cada arranque, así que un `DROP TABLE items` borraría los datos de forma permanente en Neon al primer despliegue.

## Decisión
`schema.sql` deja de crear `items` y documenta el `DROP` opcional, sin ejecutarlo. Es el mismo criterio que eligió el usuario en CodeToDiagram.

## Consecuencias
- Ningún dato se pierde sin que la persona lo decida.
- Queda una tabla sin uso en las bases existentes hasta que alguien la borre a mano.
