import { describe, expect, test } from "bun:test";
import { es } from "./es";
import { t } from "./index";

describe("i18n", () => {
  test("sin idioma guardado devuelve el inglés tal cual", () => {
    expect(t("Settings")).toBe("Settings");
  });
  test("sustituye variables", () => {
    expect(t("Hello {name}", { name: "Ana" })).toBe("Hello Ana");
  });
  test("las traducciones conservan los marcadores {variable}", () => {
    for (const [en, tr] of Object.entries(es)) {
      const a = (en.match(/\{\w+\}/g) ?? []).sort().join();
      const b = (tr.match(/\{\w+\}/g) ?? []).sort().join();
      expect(b).toBe(a);
    }
  });
});

describe("i18n con idioma español guardado", () => {
  test("t() y tColumn() traducen y las claves sin traducción quedan en inglés", async () => {
    const store: Record<string, string> = { "agetor:locale": "es" };
    (globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: () => {} };
    try {
      // Query distinta para evaluar el módulo de nuevo con el idioma ya guardado.
      const m = await import("./index.ts?es");
      expect(m.getLocale()).toBe("es");
      expect(m.t("Settings")).toBe("Ajustes");
      expect(m.t("Not translated yet")).toBe("Not translated yet");
      expect(m.tColumn("Review")).toBe("En revisión");
    } finally {
      delete (globalThis as any).localStorage;
    }
  });
});
