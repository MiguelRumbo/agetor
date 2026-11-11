# 0002 — Linux: core headless compilado + UI en el navegador

- Estado: aceptado
- Fecha: 2026-11-11
- Decisores: [MiguelRumbo] (prioridades: 1º que compile, 2º que tenga UI), [Claude→MiguelRumbo] (ruta)
- Afecta a: build, arranque, UI en Linux

## Contexto y problema

Agetor solo se distribuye para macOS arm64. Los targets de Linux y Windows de `electrobun.config.ts` nunca se han construido. El usuario no tiene Mac y quiere usarlo en Linux. La auditoría de portabilidad encontró que el core (`src/bun/headless.ts`) no depende de Electrobun y que la UI ya funciona en un navegador contra él (así corren los e2e).

## Opciones consideradas

1. Electrobun en Linux (ventana nativa): `build.copy` mapea ayudantes de macOS, el menú usa `Cmd` y hay que verificar el soporte real de Electrobun en Linux.
2. Core headless compilado (`bun build --compile --target=bun-linux-x64`) + UI (`vite build`) en el navegador.
3. Otro wrapper de escritorio (Tauri): añade Rust y no resuelve nada que la opción 2 no resuelva ya.
4. Windows nativo: todo el modelo de ejecución depende de tmux.

## Decisión

Opción 2. Es la única cuya compilación usa herramientas que ya soportan Linux. Hace falta muy poco código propio y la UI es la misma de la app. La opción 1 queda como paso siguiente si se quiere una ventana nativa. Para Windows, la vía prevista es este mismo core dentro de WSL2.

## Consecuencias

### Positivas
- Compila y funciona con muy pocos cambios: `scripts/linux.sh` y tres arreglos puntuales (PTY de codex, sonda de rutas del CLI y alta de proyectos en la UI).
- Los agentes siguen en tmux: sobreviven a reiniciar el core y se reconectan.

### Negativas
- Sin ventana nativa, menús, diálogos de archivo, notificaciones ni autoactualización.
- El token maestro va en el hash de la URL y queda en el historial del navegador (aceptado para uso personal en local).
- La UI tiene que servirse en `:5173`, el origen permitido por el core.

## Enlaces

- docs/linux-port.md
- Entrada de bitácora: 2026-11-11
