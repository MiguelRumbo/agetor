# Agetor en Linux (fork personal)

Estado del port de Agetor a Linux en este fork. Prioridades: **1) que compile, 2) que tenga UI**.
La estrategia elegida y por qué está en [ADR 0002](adr/0002-linux-core-headless-navegador.md).

## Resumen

Agetor corre en Linux como **core compilado + UI en el navegador**:

- El binario `agetor` (CLI) lleva dentro el core: `agetor __daemon` arranca `src/bun/headless.ts`, que no importa Electrobun.
- La UI es la misma app React del escritorio, compilada con `vite build` y servida en `:5173`. Habla con el core por HTTP + SSE (y WebSocket para las terminales), igual que dentro de la ventana de Electrobun.
- Los agentes corren en `tmux` como en macOS, así que sobreviven a reiniciar el core y se reconectan.

No hay ventana nativa (Electrobun) en Linux todavía. Ver [Siguientes pasos](#siguientes-pasos).

## Requisitos

- Bun ≥ 1.3.5 (verificado con 1.4.4)
- Git
- `tmux` (verificado con 3.4)
- `curl`, `xdg-open` (para `scripts/linux.sh open`)
- Al menos un harness CLI (`claude`, `codex`, …) instalado y con sesión iniciada

## Uso

```bash
bun install
scripts/linux.sh build     # vite build + binario artifacts/agetor-linux-<arch>
scripts/linux.sh start     # arranca core + UI e imprime la URL (compila si falta algo)
scripts/linux.sh open      # abre la URL en el navegador
scripts/linux.sh status
scripts/linux.sh stop      # los agentes en tmux siguen vivos; el próximo start los reengancha
```

- Datos en `~/.agetor` (override: `AGETOR_DATA_DIR`). Para desarrollo usa otro directorio, p. ej. `AGETOR_DATA_DIR=~/.agetor-dev`.
- Puerto del core `4317` (override: `AGETOR_API_PORT`). La UI tiene que estar en `:5173`, porque es el origen que el core acepta (`ALLOWED_ORIGINS` en `src/bun/server.ts`).
- El navegador usa el **token maestro** (está en el hash de la URL, nunca en la query), así que la UI tiene acceso a las mismas rutas que la app de escritorio. Se guarda con permisos 0600 en `$AGETOR_DATA_DIR/linux-run/token`. Queda en el historial del navegador: es aceptable para uso personal en local.
- El CLI (`artifacts/agetor-linux-<arch> ls`, `add`, `attach`, …) se conecta al mismo core a través de `agetor-core.json`.
- Para desarrollo de la UI con HMR sigue sirviendo `scripts/dev-headless.sh` (core desde el código fuente + Vite dev).

## Qué se verificó (2026-11-11, Linux x86_64, Bun 1.4.4, tmux 3.4)

| Prueba | Resultado | Cómo |
|---|---|---|
| `bun run typecheck` | ✅ | `tsc --noEmit` sin errores |
| `vite build` | ✅ | `dist/` generado |
| `bun run build:cli` → `artifacts/agetor-linux-x64` | ✅ | ELF x86-64, 114 MB |
| El core compilado arranca | ✅ | 86 migraciones aplicadas, `api listening on http://127.0.0.1:…`, PATH rehidratado desde el shell de login |
| Autenticación | ✅ | `/tasks` sin token → 401; con token → 200 |
| La UI carga en Chromium contra el core | ✅ | Playwright: tablero, formulario de tarea, harnesses detectados |
| Tarea con worktree aislado | ✅ | Worktree en `$AGETOR_DATA_DIR/worktrees/<id>` y rama propia |
| Agente en tmux, salida en vivo y estado | ✅ (tras arreglo) | Harness codex con un stub: el mensaje del agente llega a la UI, `exit:0`, la tarjeta pasa a **Review** y el archivo creado por el agente aparece en el worktree |
| Reiniciar el core a mitad de turno | ✅ | La sesión tmux sobrevive, `reattached to 1 live tmux session(s)`, *"reconnected to live session after agetor restart"* y la tarea termina en Review |
| `scripts/linux.sh start/status/stop` | ✅ | El puerto de la UI queda libre tras `stop` |
| Tests unitarios (`src/bun` + `src/shared`, un proceso por archivo) | 324/339 archivos verdes; 9072 pass / 76 fail / 92 skip | Ver [Tests en Linux](#tests-en-linux) |

**No verificado todavía:** Claude Code real (solo se usó un stub de codex), la terminal interactiva en la UI (los tests de `terminals.ts` sí pasan), notificaciones, diálogos nativos y Electrobun en Linux.

## Arreglos hechos para Linux

### codex: el agente moría al empezar el turno (`src/bun/codex-tmux.ts`)

**Síntoma:** cada turno de codex terminaba en `blocked` con *"tmux session … ended unexpectedly"* y un log vacío.

**Causa raíz:** el driver lanzaba `sh -c 'exec <codex> < prompt > log 2>&1'` dentro de tmux. Con stdin, stdout y stderr redirigidos a archivos y `exec`, ningún proceso del panel conserva abierto el PTY esclavo. En Linux el maestro del PTY devuelve `EIO`, tmux da el panel por muerto y manda SIGHUP al agente. Los PTY de macOS no se cuelgan así, por eso no aparecía en el upstream. Lo reproduje fuera de Agetor con `tmux new-session -d -- sh -c 'exec sh -c "x=$(cat); …" < p.txt > out.txt 2>&1'`, que se corta en el primer `cat`/`sleep`.

**Arreglo:** `3<&0` antes de las redirecciones, para que el agente herede el PTY en el descriptor 3 y el panel siga vivo.

**Revisados y no afectados:**
- gemini: usa `exec`, pero stdin sigue siendo el PTY.
- cursor, antigravity, copilot y opencode 1.x: no usan `exec`; el `sh` padre mantiene el PTY.
- servidor opencode 2: stdin sigue en el PTY.
- claude: es un REPL interactivo en el PTY.

### CLI: todas las rutas se rechazaban (`src/bun/caller-fs.ts`)

**Síntoma:** `agetor projects add <dir>` (y cualquier ruta que el CLI pasa al core) respondía *"path does not exist"* / `403 path-not-accessible`.

**Causa raíz:** la sonda de rutas del caller CLI usaba sintaxis BSD. `stat -f %HT` en GNU significa "estado del sistema de archivos" y sale con 1. Además, en GNU `tar -L` es `--tape-length`, no "seguir symlinks".

**Arreglo:** según la plataforma, `stat -c %F` y `tar --dereference` en Linux. `caller-fs.test.ts` pasa de 21 fallos a 0, y `route-policy-endpoint` también queda en verde.

### UI: no se podían registrar proyectos (`ProjectPicker.tsx`)

**Síntoma:** "Browse for folder…" no hacía nada. Llama a `/projects/pick`, que necesita el diálogo nativo de Electrobun y responde 501 en headless; el picker se tragaba el error.

**Arreglo:** ante un 501, la UI pide la ruta absoluta con `window.prompt` y la registra con `POST /projects` (`api.addProject`). Verificado con Playwright: registra el proyecto y lo deja seleccionado en el formulario. En la app de escritorio el camino no cambia, porque allí nunca hay 501.

## Problemas conocidos en Linux (sin arreglar)

| Qué | Dónde | Efecto | Prioridad |
|---|---|---|---|
| Notificaciones del SO | `src/bun/headless-notifications.ts:271` | El core headless no notifica fuera de macOS | Baja |
| "Mostrar en el explorador" | `revealPath` solo existe en el escritorio (`src/bun/index.ts`) | La ruta responde 501 en headless | Baja |
| Botón «Open terminal» de un harness (`/harnesses/:id/open-terminal`) | `osascript` + Terminal.app en macOS | En **WSL** abre Windows Terminal (`wt.exe wsl.exe -d $WSL_DISTRO_NAME`) con el CLI del harness. En Linux nativo responde 501 con el comando `agetor harness shell <id>` | Baja |
| Abrir terminal externa / `open-tmux` | `osascript` + Terminal.app en `src/bun/server.ts` | No disponible. Alternativa: `artifacts/agetor-linux-x64 attach <id>` desde tu terminal | Baja |
| Arrastrar archivos con ruta real | `src/bun/drag-pasteboard.ts` (AppKit) | Devuelve `[]`. Usar los botones Files/Folder o `@ruta` | Baja |
| Actualizaciones | `/updates/status` → 501 en headless | Se actualiza con `git pull` + `scripts/linux.sh build` | n/a |
| Ejecutar en segundo plano al iniciar sesión | `src/bun/background-derive.ts:98` | Deshabilitado fuera de macOS. Alternativa futura: unidad systemd `--user` | Baja |
| Selector nativo de archivos para referencias (botones Files/Folder del prompt) | `/refs/pick` → 501 en headless | Hay que escribir `@ruta` en el prompt. Los proyectos sí tienen fallback (ver arriba) | Media |
| Discovery de capacidades en modo "disclaim" | `src/bun/discovery-fs.ts`, `task-dir-fs.ts`, `core-file-read.ts` | Usan `stat -f` y `tar -L` de BSD, pero solo con el disclaim activo, que nunca ocurre fuera de macOS | Ninguna |

## Tests en Linux

Ejecución archivo por archivo (`bun test <archivo>`, con socket tmux propio por archivo). Fallan 15 archivos:

- **Userland BSD:** `caller-fs` (21) y `route-policy-endpoint` (1), **arreglados**. Queda `tar-read` (1): el propio test crea el archivo con `tar -L` de BSD; es un fallo solo del test.
- **Modo "disclaim" de macOS forzado en tests:** `task-dir-fs` (22), `core-file-read` (19), `files-preview-endpoint` (3). En producción ese camino solo se usa en macOS.
- **Artefactos del entorno donde se midió (root, sin `node_modules`):** `ref-tree` (1), `bundle-endpoint` (1), `route-policy` (no cargaba: faltaba `typescript`, ya instalado).
- **Deterministas, causa sin aislar:** `reconcile` (cancelación con timeout de 5 s), `orchestrator-harness-swap` (1), `harness-stacks` (1, probablemente la rama de Keychain de darwin en `claudeKeychainEvidence`), `pipeline-human-step-resume-spike` (1), `fixtures/opencode/fake-serve` (1), `opencode-server` (1, parada en tmux SF7). Hay que reproducirlos como usuario no root antes de concluir. Alguno podría ser este mismo problema de PTY en otros caminos.

## Lo que se rompe o no aplica en macOS

Este fork no se usa en macOS, así que lo siguiente se documenta pero no se arregla:

- `scripts/linux.sh` es solo para Linux. En macOS se usa la app (`bun run build`).
- `src/bun/codex-tmux.ts`: el `3<&0` es inocuo según el razonamiento (codex hereda un descriptor más), pero **no está verificado en macOS**.
- `src/bun/caller-fs.ts`: en darwin conserva exactamente los flags anteriores (`-f %HT`, `-L`); el `case` solo añade alternativas en minúsculas. No verificado en macOS.
- `ProjectPicker.tsx`: el fallback solo se activa con un 501, que la app de escritorio no devuelve.
- No se ha cambiado nada más del camino de macOS (Electrobun, ayudantes nativos, firma y actualizaciones).

## Siguientes pasos

1. Probar con Claude Code real: crear una tarea, responder una pregunta, revisar el diff y hacer commit.
2. Reproducir como usuario no root los 6 tests deterministas que siguen fallando.
3. Ventana nativa: intentar `electrobun build` en Linux. Es probable que falle en `build.copy` (`vendor/login-item/agetor-login-item` y `LaunchAgents` no se generan fuera de darwin). Después: menú y título de ventana, `revealPath` con `xdg-open` y bandeja o salir al cerrar.
4. Windows: el mismo core bajo WSL2, con la UI desde el navegador de Windows por `localhost`.
