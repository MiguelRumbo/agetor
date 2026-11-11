# 0001 — Adoptar el stack dev-stack y su método de trabajo

- Estado: aceptado
- Fecha: 2026-11-11
- Decisores: [MiguelRumbo], [Claude→MiguelRumbo]
- Afecta a: todo el fork

## Contexto y problema

El fork lo trabaja Claude Code en muchas sesiones. Hace falta el mismo método que en el resto de proyectos de MiguelRumbo (fases, bitácora, ADRs, convenciones de git), sin reorganizar un proyecto grande heredado del upstream.

## Opciones consideradas

1. Sin método: solo el `CLAUDE.md` del upstream.
2. dev-stack con arquitectura modular por contratos (reorganizar en `src/modules/*`).
3. dev-stack adaptado a la estructura existente de Agetor.

## Decisión

Opción 3. Se registra el marketplace y se activan `metodo`, `superpowers`, `ponytail` e `interface-design` en `.claude/settings.json`. Los "módulos" del método son los subsistemas ya documentados en `docs/architecture/` y los planes siguen en `docs/plans/`. No se reorganiza el código: el fork quiere poca divergencia con el upstream y el código ya está organizado por subsistemas.

## Consecuencias

### Positivas
- Mismo flujo que en el resto de proyectos: fases, bitácora y ADRs.
- No hay que mover código ni documentación existente.

### Negativas
- Los nombres no coinciden con la plantilla (`docs/architecture/` en vez de `docs/modulos/`, `docs/plans/` en vez de `docs/planes/`). El hook `stop-check` de `metodo` solo mira `docs/BITACORA.md` y `docs/modulos/`, así que un cambio documentado en `docs/architecture/` sin entrada de bitácora mostrará el aviso igualmente.
- El modo de comentarios es `completos`, heredado del estilo del upstream.

## Enlaces

- CLAUDE.md § "Fork personal: Linux y método de trabajo (dev-stack)"
- Entrada de bitácora: 2026-11-11
