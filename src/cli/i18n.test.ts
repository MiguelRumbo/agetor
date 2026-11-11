import { afterEach, describe, expect, test } from "bun:test";
import { ct, ctHelp, initCliLocale, setCliLocale } from "./i18n.ts";

afterEach(() => setCliLocale("en"));

describe("cli i18n", () => {
  test("inglés por defecto", () => {
    expect(ct("task is not running")).toBe("task is not running");
    expect(ctHelp("  show <id>           task details, runs, pending interactions")).toContain("task details");
  });
  test("español: frase completa, fragmento y ayuda por línea", () => {
    setCliLocale("es");
    expect(ct("task is not running")).toBe("la tarea no está en ejecución");
    expect(ct("created harness")).toBe("harness creado");
    expect(ctHelp("  show <id>           task details, runs, pending interactions")).toBe(
      "  show <id>           detalles de la tarea, ejecuciones e interacciones pendientes",
    );
    // La línea sin traducción y los flags quedan intactos.
    expect(ctHelp("  --flag-raro <x>     something untranslated")).toBe("  --flag-raro <x>     something untranslated");
  });
  test("initCliLocale lee la preferencia del core y se rinde sin core", async () => {
    const saved = process.env.AGETOR_LANG;
    delete process.env.AGETOR_LANG;
    try {
      await initCliLocale(async () => ({ locale: "es" }));
      expect(ct("task is not running")).toBe("la tarea no está en ejecución");
      await initCliLocale(async () => null);
      expect(ct("task is not running")).toBe("task is not running");
      await initCliLocale(async () => { throw new Error("sin core"); });
      expect(ct("task is not running")).toBe("task is not running");
    } finally {
      if (saved !== undefined) process.env.AGETOR_LANG = saved;
    }
  });
});
