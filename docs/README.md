# Documentación de Agetor (fork personal)

Índice. Agetor es un orquestador local de agentes CLI de programación (Claude Code, Codex, …) con un tablero kanban. Este fork se usa en **Linux**.

## Mapa

- [CLAUDE.md](../CLAUDE.md) — reglas que aplican a todo cambio y la sección del fork (método de trabajo)
- [Agetor en Linux](linux-port.md) — cómo se ejecuta, qué se verificó, arreglos, problemas conocidos y lo que se rompe en macOS
- [Arquitectura](architecture/README.md) — un documento por subsistema (equivale a `docs/modulos/` del método)
- [Bitácora](BITACORA.md) — historial de trabajo y decisiones del fork
- [ADRs](adr/) — decisiones estructurales del fork
- [Planes](plans/) — planes de implementación (heredados del upstream y nuevos)
- [Seguridad](architecture/security.md) — tokens, política de rutas, spawn, lecturas sin seguir symlinks
- [Inventario de textos para traducir](traduccion-inventario.md) — UI, CLI, mensajes y documentación visibles para el usuario
- [QA](qa/) y [specs](specs/) — heredados del upstream

## Subsistemas

La tabla completa, con qué archivo toca cada uno, es la [Topic map de CLAUDE.md](../CLAUDE.md#topic-map).

| Subsistema | Estado en Linux | Doc |
|---|---|---|
| Core headless + API + SSE | activo, verificado | [security.md](architecture/security.md), [core-responsiveness.md](architecture/core-responsiveness.md) |
| Tareas y worktrees | activo, verificado | [task-lifecycle.md](architecture/task-lifecycle.md) |
| Harness Codex (tmux) | activo, verificado con stub | [harness-codex.md](architecture/harness-codex.md) |
| Harness Claude Code (tmux) | activo, sin probar con el CLI real | [harness-claude-code.md](architecture/harness-claude-code.md) |
| UI en navegador | activo, verificado | [linux-port.md](linux-port.md) |
| Ventana de escritorio (Electrobun) | planeado | [linux-port.md](linux-port.md#siguientes-pasos) |
| Host en segundo plano (login item) | apagado (solo macOS) | [always-on-host.md](architecture/always-on-host.md) |
| Notificaciones nativas | apagado (solo macOS) | [notifications.md](architecture/notifications.md) |

Estados: `planeado` · `activo` · `apagado` · `deprecado`
