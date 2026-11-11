# Bitácora de Agetor (fork personal)

Cronológica, append-only. Nuevas entradas al final. Toda decisión lleva `[quién]`.
Cuando supere ~2000 líneas, archivar en `bitacora/<año>-Q<n>.md` y dejar aquí índice + últimas.

---

## 2026-11-11 — Port a Linux (core headless + UI en navegador) y adopción de dev-stack

**Contexto:** Agetor solo se distribuye para macOS arm64; el fork se usa en Linux sin Mac. Prioridades: 1) que compile, 2) que tenga UI. Primero se hizo una auditoría de portabilidad sin tocar archivos (mapa de arquitectura, dependencias de macOS, procesos, tmux/PTY y matriz macOS/Linux/Windows) y después el paso 1 del plan.

**Hecho:**
- build: `bun run typecheck`, `vite build` y `bun run build:cli` (target `bun-linux-x64`) compilan en Linux.
- scripts: `scripts/linux.sh` (build/start/stop/status/open). Arranca el core compilado (`agetor __daemon`) y sirve `dist/` en `:5173`.
- fix(codex): `3<&0` en el comando de tmux. Sin él, el PTY del panel se colgaba en Linux y tmux mataba a codex al empezar el turno.
- fix(caller-fs): sonda de rutas del CLI con `stat -c %F` / `tar --dereference` en Linux (antes sintaxis BSD → todo `denied`).
- fix(ui): `ProjectPicker` pide la ruta y usa `POST /projects` cuando `/projects/pick` responde 501 (headless sin diálogo nativo).
- Verificado en Linux:
  - core arranca y autentica;
  - la UI carga en Chromium;
  - tarea con worktree aislado y agente (stub de codex) en tmux, salida en vivo y paso a Review;
  - reinicio del core a mitad de turno con reconexión a la sesión tmux;
  - alta de proyecto desde la UI y desde el CLI.
- tests: 324/339 archivos verdes antes de los arreglos; `caller-fs` y `route-policy*` quedan en verde después.
- docs: `docs/linux-port.md`, `docs/README.md`, ADR 0001 y 0002, `docs/traduccion-inventario.md`; sección del fork en `CLAUDE.md`.
- chore: `.claude/settings.json` registra el marketplace `dev-stack` y activa `metodo`, `superpowers`, `ponytail` e `interface-design`.

**Decisiones:**
- [MiguelRumbo] El fork es personal y solo para Linux: no se envían PRs al upstream. Lo que se rompa en macOS se documenta y no se arregla salvo que afecte al trabajo en curso.
- [MiguelRumbo] Cada cambio va en una rama aparte (`<tipo>/<tema>`), no en la rama de la sesión, y desde ella se abre el PR.
- [MiguelRumbo] Inventariar los textos visibles para traducirlos después con un modelo más económico.
- [Claude→MiguelRumbo] Ruta para Linux: core headless compilado + UI en navegador → ADR 0002.
- [Claude→MiguelRumbo] dev-stack adaptado a la estructura existente (sin reorganizar en módulos; `docs/architecture/` hace de `docs/modulos/`) → ADR 0001.
- [Claude] Modo de comentarios: `completos`, el estilo heredado del upstream.

**Descartado:**
- Electrobun en Linux como primer paso (riesgo de build: `build.copy` de ayudantes macOS, soporte sin verificar). Queda como siguiente paso.
- Tauri: añade Rust y no resuelve nada que la vía headless no resuelva.
- Windows nativo: depende de tmux; la vía prevista es WSL2.

**Pendientes:**
- [ ] Probar con Claude Code real (tarea, pregunta del agente, diff, commit).
- [ ] Reproducir como usuario no root los 6 tests deterministas que siguen fallando (ver `docs/linux-port.md`).
- [ ] Ventana nativa con Electrobun en Linux.
- [ ] Windows con WSL2.
- [~] Traducción de textos según `docs/traduccion-inventario.md`: UI del webview hecha con selector en Ajustes (ver `docs/i18n.md`); faltan core (`src/bun`), CLI/TUI y documentación.

**Siguiente paso sugerido:** usar `scripts/linux.sh start` con un harness real y anotar aquí lo que falle.

## 2026-11-11 — Traducción de la UI al español

**Decisiones:**
- [Claude] Sistema propio mínimo `t("texto inglés")` con diccionario en `src/mainview/lib/i18n/es.ts`, en vez de una librería (i18next, etc.): no añade dependencias y mantiene el inglés como idioma por defecto.
- [Claude] La clave es el texto inglés: los tests y e2e existentes (≈1150 búsquedas por texto) siguen pasando sin tocarlos.
- [Claude] El idioma vive en `localStorage` y cambiarlo recarga la página (se evalúa también en constantes de módulo).
- [Claude] Glosario del inventario respetado (Pendientes/Lista/En ejecución/Bloqueada/En revisión/Hecha; Harness, Worktree, Pipeline, Prompt sin traducir).

**Hecho:** rama `feat/traduccion-es`; selector en Ajustes → General; ≈650 cadenas de `src/mainview` (cabecera, nueva tarea, tarjetas, filtros, ajustes, pipelines, worktrees, GitHub, onboarding, menús, modos/esfuerzos).

**Verificado:** `bun run typecheck`, `bun test src/mainview src/shared` (único fallo: `StackBadge`, depende de la fecha del día, anterior a este cambio) y `vite build`. No se comprobó visualmente en el navegador.

**Pendientes:** core (`src/bun`), CLI/TUI, `README.md`; revisar visualmente cada pantalla y cadenas con ternarias/plantillas que quedaron en inglés.
