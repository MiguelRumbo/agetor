import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// db.ts abre la base al cargarse: el directorio de datos va primero (ver CLAUDE.md).
process.env.AGETOR_DATA_DIR = mkdtempSync(join(tmpdir(), "agetor-i18n-"));
const { rmTestDataDir } = await import("./test-data-dir.ts");
const { preferences } = await import("./db.ts");
const { ct, coreLocale } = await import("./i18n.ts");
const { esCore } = await import("./i18n-es.ts");

afterAll(() => {
  preferences.set("locale", "en");
  rmTestDataDir(process.env.AGETOR_DATA_DIR!);
});

describe("core i18n", () => {
  test("inglés por defecto: el mensaje no cambia", () => {
    preferences.set("locale", "en");
    expect(coreLocale()).toBe("en");
    expect(ct("task not found")).toBe("task not found");
  });
  test("en español traduce exactos y plantillas con valores", () => {
    preferences.set("locale", "es");
    expect(ct("task not found")).toBe("tarea no encontrada");
    expect(ct('unknown harness "foo"')).toBe('harness desconocido "foo"');
    expect(ct("path does not exist: /a/b")).toBe("la ruta no existe: /a/b");
    expect(ct("3 tasks running — stop or wait for them first")).toBe("3 tareas en ejecución: deténlas o espera a que terminen");
    expect(ct("started — created worktree x — y — agent=claude-code, model=opus, mode=auto")).toBe(
      "iniciada — created worktree x — y — agente=claude-code, modelo=opus, modo=auto",
    );
  });
  test("sin entrada o con prefijo parseado por el cliente queda en inglés", () => {
    preferences.set("locale", "es");
    expect(ct("something unknown")).toBe("something unknown");
    expect(ct("session ended: killed")).toBe("session ended: killed");
    expect(ct("tmux binary not found — install tmux (brew install tmux) or enable the bundled tmux in Settings")).toContain("tmux binary not found");
  });
  test("las traducciones conservan los marcadores", () => {
    for (const [en, tr] of Object.entries(esCore)) {
      expect((tr.match(/\{\w+\}/g) ?? []).sort().join()).toBe((en.match(/\{\w+\}/g) ?? []).sort().join());
    }
  });
});
