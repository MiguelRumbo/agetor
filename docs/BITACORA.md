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

## 2026-11-11 — Traducción del core y del CLI/TUI

**Decisiones:**
- [Claude] Un único idioma para UI, core y CLI: preferencia `locale` en `preferences` (rutas existentes, sin endpoint nuevo).
- [Claude] Errores del core traducidos en `json()` (único punto de paso, ~534 respuestas) con un traductor de plantillas compartido en `src/shared/i18n-core.ts`; estados del transcript traducidos al escribirlos en `saveAndEmit`.
- [Claude] CLI: traducción por fragmentos de plantilla para no tocar colores ni valores; `AGETOR_LANG` fuerza el idioma.
- [Claude] Quedan en inglés los mensajes que el cliente compara por texto (ver `docs/i18n.md`).

**Verificado:** `bun run typecheck`; tests de `src/cli` (salvo los de daemon/remote, que terminan el proceso de bun también sin este cambio), `orchestrator.test.ts`, `route-policy.test.ts` y los nuevos `src/bun/i18n.test.ts`, `src/cli/i18n.test.ts`. No se probó a mano contra un core real en español.

**Pendientes:** prosa larga de `--help`, salida del CLI armada fuera de `out(\`…\`)`, revisar visualmente UI/CLI, README.

## 2026-11-15 — Uso (cuota) de GitHub Copilot y Antigravity

**Decisiones:**
- [Claude] Dos proveedores nuevos para el registro de uso existente (`src/bun/usage/poller.ts`), sin rutas ni UI nuevas: `copilot-usage.ts` (GitHub `copilot_internal/user`, token de `$COPILOT_HOME/config.json`) y `antigravity-usage.ts` (Cloud Code `fetchAvailableModels`, token de `~/.gemini/antigravity-cli/antigravity-oauth-token`).
- [Claude] Antigravity: un medidor por grupo de cuota compartido (Gemini, Claude / GPT-OSS) en vez de uno por modelo. No se refresca el token OAuth (no tenemos el cliente de agy): si caducó, se informa `unavailable` con el aviso de ejecutar agy.
- [Claude] Se usa el host `daily-cloudcode-pa` porque el de producción devuelve todo al 100 %. Ambos endpoints están sin documentar: si cambian, el proveedor devuelve `error` y no rompe nada más.

**Verificado:** `bun test src/bun/usage/`, `bun run typecheck` y una llamada real a los dos proveedores con las cuentas locales (Copilot 24/200 premium; agy Gemini 1 %).

**Investigado (UI caída):** el core lanzado por `scripts/linux.sh` usa `AGETOR_DAEMON_IDLE_MS=0` y no tiene modo idle. En `daemon.log` siguió vivo hasta el SIGTERM del restart. Los "idle timeout" del log son de cores que arrancó el CLI `agetor` por su cuenta (5 min por defecto). Los logs del script se sobrescribían en cada arranque y no quedó el de la caída; ahora se anexan con marca de tiempo.

## 2026-11-15 — El mensaje fijo del usuario se superponía al transcript

**Decisión:**
- [Claude] El contenedor fijo (sticky) del mensaje del usuario en el RunPanel pasa a tener el fondo del panel (`bg-card`) de borde a borde y a cubrir el padding superior del log. Antes era transparente y la burbuja solo ocupa el 85 % derecho, así que el texto que pasaba por debajo se veía a su lado. No se desactiva el modo sticky.

**Verificado:** `bun run typecheck` y tests de `sticky-sections` y `user-message-display`. Sin comprobación visual: el usuario pidió no compilar ni reiniciar mientras Agetor estaba en uso.
