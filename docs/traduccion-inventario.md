# Inventario de textos para traducir (inglés → español)

Lista de lo que **lee una persona** en Agetor: interfaz, CLI, mensajes, notificaciones y documentación. No incluye código ni comentarios. Está pensada para que un modelo más económico traduzca archivo por archivo siguiendo las reglas de abajo.

Las cifras son aproximadas: cuentan las líneas con frases en inglés que encuentra un grep. Sirven para dimensionar el trabajo, no como lista exacta de cadenas.

## Reglas para quien traduzca

### No traducir nunca

- **Identificadores y nombres propios:** nombres de producto y harness (Agetor, Claude Code, Codex, Cursor, Gemini CLI, fx, Antigravity, GitHub Copilot, OpenCode), ids y etiquetas de modelos (`Opus 5.5`, `gpt-6.1-sol`…), flags de CLI, variables de entorno, rutas de la API, nombres de rama y archivo.
- **Cadenas que el código interpreta:**
  - `SESSION_DIED_STATUS_PREFIX = "session ended: "` (`src/shared/types.ts:20`) y el resto de constantes `*_PREFIX`/`*_MARKER`;
  - los centinelas `exit:<n>` de los eventos de estado;
  - las etiquetas `<handoff>`, `<agent_instructions_defined_by_the_user>` y `<harness-stack-continuation>`;
  - los `FAKE_*_PROMPT_MARKER`;
  - los valores de `id` (p. ej. `id: "backlog"`): solo se traduce `label`.
- **`data-testid`** y cualquier atributo que no se muestre.
- **Mensajes de error que vienen de herramientas externas** (git, tmux, el CLI del agente). Se muestran tal cual.

### Traducir con cuidado: texto que recibe el agente, no la persona

Estas cadenas forman parte del **prompt que se envía al agente**. Traducirlas cambia lo que el agente lee y puede cambiar su comportamiento; los marcadores de seguridad (`BEGIN untrusted handoff`…) los compara el código. Recomendación: **dejarlas en inglés**, o traducirlas en un cambio aparte y probar con un agente real.

| Archivo | Qué es |
|---|---|
| `src/shared/pipeline.ts` | Prompt de cada paso de pipeline, recordatorio de handoff y avisos de contenido no confiable |
| `src/shared/issue-task.ts` | Aviso de "texto no confiable" al crear una tarea desde un issue |
| `src/shared/clone-eli5.ts` | Tarea "explícamelo como a un niño" tras clonar un repo |
| `src/shared/agent-profile.ts` | Instrucciones de perfil inyectadas en el prompt ("Skills to use for this task…") |
| `src/shared/refs.ts` | Encabezado del bloque de referencias que se añade al prompt |
| `src/mainview/lib/resolve-conflicts-prompt.ts` | Prompt "Resolve the merge conflicts…" |
| `src/mainview/lib/commit-push.ts`, `src/mainview/lib/pipelines.ts` | Prompts generados desde la UI |
| `src/shared/compaction.ts`, `src/shared/cursor-ask.ts`, `src/shared/harness-stack.ts` | Mezcla: revisar cadena a cadena si va a la UI o al agente |

### Al cambiar un texto de la UI

- Los tests e2e buscan textos literales: hay unas **1150** llamadas `getByText`/`getByRole`/`getByLabel` en `e2e/*.spec.ts`. Hay que cambiar el texto en el spec en el mismo commit.
- Los tests unitarios de la UI (`src/mainview/**/*.test.ts(x)`, 103 archivos) y algunos de `src/shared` también comparan textos.
- Después de cada lote: `bun run typecheck`, `bun test <archivos tocados>` y `grep -rn "<texto en inglés>" e2e src` para no dejar referencias colgando.
- Mantener la puntuación y los marcadores de formato (`…`, `—`, `{variable}`, `${expresión}`, `\n`). No traducir lo que hay dentro de `${…}`.

### Glosario propuesto (para que todo quede consistente)

| Inglés | Español |
|---|---|
| Task / Bug / Spike | Tarea / Bug / Spike |
| Backlog / Ready / Running / Blocked / Review / Done | Pendientes / Lista / En ejecución / Bloqueada / En revisión / Hecha |
| Harness | Harness (no traducir; es el CLI del agente) |
| Agent (perfil) | Agente |
| Worktree | Worktree |
| Pipeline / Step / Handoff | Pipeline / Paso / Traspaso |
| Run | Ejecución |
| Project | Proyecto |
| Prompt | Prompt |
| Settings | Ajustes |
| Mode: Code / Plan / Auto / Full access | Modo: Código / Plan / Auto / Acceso total |
| Effort | Esfuerzo |
| Unread | Sin leer |
| Archive | Archivar |

## Prioridad 1 — Interfaz (lo que ves en el navegador)

### Componentes y lógica de la UI (`src/mainview/`, ~99 archivos, ~770 líneas con frases)

| Archivo | Líneas aprox. | Qué contiene |
|---|---|---|
| `src/mainview/components/kanban/GitHubDialog.tsx` | 104 | Diálogo de GitHub/GitLab/Bitbucket: PRs, issues, mergeabilidad |
| `src/mainview/components/kanban/RunPanel.tsx` | 101 | Panel de ejecución: transcript, botones, avisos, estados |
| `src/mainview/App.tsx` | 40 | Cabecera, banners, toasts globales, diálogos de confirmación |
| `src/mainview/lib/github-setup-guide.ts` | 36 | Guía de configuración de tokens de Git |
| `src/mainview/components/settings/SettingsDialog.tsx` | 32 | Ajustes: General, Harnesses, tema, segundo plano |
| `src/mainview/components/kanban/NewTaskForm.tsx` | 25 | Formulario "New task" |
| `src/mainview/lib/bundle.ts` | 20 | Mensajes de exportar/importar Agentes y Pipelines |
| `src/mainview/components/settings/GitHubSetupDialog.tsx` | 19 | Asistente de configuración de GitHub |
| `src/mainview/components/bundle/ImportBundleDialog.tsx` | 18 | Importar bundle |
| `src/mainview/lib/background.ts` | 16 | Textos de "Keep Agetor running in the background" |
| `src/mainview/components/pipelines/StepPanel.tsx` | 15 | Panel de paso de pipeline |
| `src/mainview/components/pipelines/PipelineRunView.tsx` | 15 | Vista de una ejecución de pipeline |
| `src/mainview/lib/task-context-menu.ts` | 10 | Menú contextual de tarjeta |
| `src/mainview/components/worktrees/WorktreesDialog.tsx` | 10 | Diálogo de worktrees |
| `src/mainview/components/kanban/DiffDialog.tsx` | 10 | Diálogo de diff |
| `src/mainview/components/kanban/CloneProjectDialog.tsx` | 10 | Clonar repositorio |
| `src/mainview/lib/toasts.ts` | 9 | Toasts (notificaciones dentro de la app) |
| `src/mainview/components/settings/HarnessStacksSection.tsx` | 9 | Stacks de cuentas |
| `src/mainview/components/pipelines/PipelineEditor.tsx` | 9 | Editor de pipelines |
| `src/mainview/components/pipelines/HumanStepPanel.tsx` | 9 | Paso humano de pipeline |
| `src/mainview/lib/api.ts` | 8 | Mensajes de error de red mostrados en la UI |
| `src/mainview/components/kanban/TaskCard.tsx` | 8 | Tarjeta de tarea |
| `src/mainview/components/kanban/CreateTaskFromIssueDialog.tsx` | 8 | Crear tarea desde un issue |
| `src/mainview/lib/stack-editor.ts`, `lib/mergeability.ts` | 7 + 7 | Validaciones y estados de merge |
| `src/mainview/components/kanban/WorktreeOptions.tsx`, `StackBadge.tsx`, `BinaryFilePreview.tsx` | 7 c/u | Opciones de worktree, insignia de stack, vista previa binaria |
| `src/mainview/components/pipelines/StepNode.tsx`, `kanban/ImportSessionsDialog.tsx`, `kanban/BranchPicker.tsx`, `kanban/AgentProfileFormDialog.tsx` | 6 c/u | Nodos de pipeline, importar sesiones, ramas, formulario de Agente |
| `src/mainview/components/updater/UpdateBanner.tsx`, `tmux/TmuxInstallDialog.tsx`, `settings/BackgroundSection.tsx`, `onboarding/OnboardingChecklist.tsx`, `kanban/SentFilesCard.tsx`, `kanban/ReferencesPicker.tsx` | 5 c/u | Actualizaciones, instalar tmux, segundo plano, onboarding, archivos enviados, referencias |
| Resto de `src/mainview/components/**` y `src/mainview/lib/**` | 1–4 c/u | Etiquetas sueltas, `placeholder`, `title`, `aria-label` |

Para listar todos los archivos con su recuento:

```bash
find src/mainview \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.*' -print0 \
  | xargs -0 grep -cE "[\"'\`>][A-Z][a-z]+( [a-zA-Z'’,.:—-]+){2,}" | awk -F: '$2>0' | sort -t: -k2 -rn
```

Atributos que también se ven y hay que traducir: `placeholder=`, `title=` (tooltips), `aria-label=` (lectores de pantalla), `label:` en arrays de opciones, `description:` y el texto de `toast(...)`.

### Textos compartidos que muestra la UI (`src/shared/`)

| Archivo | Qué contiene |
|---|---|
| `src/shared/types.ts` (~121 líneas) | Nombres de columnas (`COLUMNS`), etiquetas de modos, esfuerzo y velocidad, descripciones de opciones de los harnesses. **Solo `label`/`description`; los `id` no** |
| `src/shared/harness-stack.ts` | Avisos de stacks de cuentas |
| `src/shared/cursor-ask.ts`, `src/shared/fx-recovery.ts`, `src/shared/claude-permissions.ts` | Tarjetas de pregunta, recuperación y permisos |
| `src/shared/speed.ts`, `model-options.ts`, `harness-limits.ts`, `compaction.ts`, `user-message.ts`, `claude-session-meta.ts`, `task-stream-resume.ts`, `sent-files.ts`, `opencode.ts` | Etiquetas y mensajes sueltos |

### Mensajes del core que acaban en la UI (`src/bun/`)

| Archivo | Qué contiene |
|---|---|
| `src/bun/server.ts` (~480 respuestas `{ error: … }`) | Errores que la UI muestra en toasts y diálogos. Muchos son técnicos; priorizar los que ve el usuario normal (validaciones de formularios, "task not found", permisos) |
| `src/bun/orchestrator.ts` (~32 mensajes de estado) | Líneas de estado del transcript ("started — created worktree…", "reconnected to live session…"). **El prefijo `session ended: ` y `exit:` no se traducen** |
| `src/bun/agent-status.ts` | Pistas de instalación y login de cada harness (Settings → Harnesses, onboarding) |
| `src/bun/*-tmux.ts`, `src/bun/fx-acp.ts`, `src/bun/cursor-acp.ts`, `src/bun/opencode-*.ts` | Mensajes de error de arranque de cada harness |
| `src/bun/clone.ts`, `src/bun/github.ts`, `src/bun/gitlab.ts`, `src/bun/bitbucket.ts`, `src/bun/git-host.ts` | Errores de clonado y de los proveedores Git |

### Solo app de escritorio (no se ven en Linux todavía; prioridad baja)

- `src/bun/index.ts`: menú de la aplicación ("Quit Agetor Completely", "Remote Access…") y diálogos nativos.
- `src/bun/quit-guard.ts`: diálogo de confirmación al salir.
- `src/bun/login-daemon.ts`, `src/bun/remote-access-box.ts`: diálogos del modo en segundo plano y del acceso remoto.
- `src/mainview/index.html`: título de la ventana ("Agetor", no se traduce).
- Notificaciones del SO: `src/shared/os-notification.ts`, `src/bun/task-notifier.ts`.

## Prioridad 2 — CLI y TUI (`src/cli/`, 52 archivos)

| Archivo | Líneas aprox. | Qué contiene |
|---|---|---|
| `src/cli/commands/pipeline.ts` | 62 | `agetor pipeline …` |
| `src/cli/tui/Dashboard.tsx` | 57 | Panel interactivo (TUI) |
| `src/cli/api-client.ts` | 57 | Errores de conexión con el core |
| `src/cli/commands/bundle.ts` | 49 | Exportar/importar |
| `src/cli/commands/add.ts` | 49 | `agetor add` |
| `src/cli/usage.ts` y la ayuda de `src/cli/index.ts` | 34 + | Texto de ayuda (`agetor --help`) |
| `src/cli/commands/answer.ts`, `src/cli/answer-logic.ts`, `src/cli/tui/AnswerOverlay.tsx` | 28 + 19 + 18 | Responder preguntas del agente |
| `src/cli/commands/lifecycle.ts`, `harness.ts`, `daemon.ts`, `sessions.ts`, `show.ts`, `logs.ts` | 16–26 c/u | Resto de comandos |
| `src/cli/notify.ts` | 7 | Notificaciones del CLI |

En el CLI no traducir nombres de subcomandos ni de flags (`agetor add --issue`): forman la interfaz.

## Prioridad 3 — Documentación

| Documento | Tamaño | Recomendación |
|---|---|---|
| `README.md` | ~8 600 palabras | Traducir (es la guía de usuario) |
| `docs/architecture/*.md` (33 archivos) | ~100 000 palabras | Opcional: es documentación para desarrollar, muy técnica y con muchas referencias a símbolos |
| `docs/plans/*.md` (238 archivos) | ~656 000 palabras | **No traducir**: historial de diseño del upstream; su coste no compensa |
| `docs/qa/*.md`, `docs/specs/*.md` | 4 archivos | Opcional |
| `CLAUDE.md` | — | No traducir: es para el agente y sus reglas citan símbolos en inglés |
| `docs/linux-port.md`, `docs/BITACORA.md`, `docs/adr/*`, `docs/README.md`, este archivo | — | Ya en español |

## Orden sugerido

1. `src/shared/types.ts` (columnas y opciones) y el glosario, para fijar los términos.
2. Componentes de prioridad 1 de más a menos líneas, actualizando en cada commit los e2e y los tests unitarios que los citan.
3. Mensajes de estado y errores frecuentes de `src/bun/`.
4. `README.md`.
5. CLI/TUI.
