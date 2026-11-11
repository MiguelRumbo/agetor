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
