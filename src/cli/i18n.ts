/**
 * Idioma del CLI y la TUI. Prioridad: `AGETOR_LANG` (`en`/`es`), luego la
 * preferencia `locale` del core si hay uno en marcha (la misma que fija el
 * selector de Ajustes; no se arranca un core solo para leerla), y por último
 * inglés. Los errores que llegan del core ya vienen traducidos por él.
 * Diccionario en `i18n-es.ts` (ver `docs/i18n.md`).
 */
import { makeTranslator, parseLocale } from "../shared/i18n-core.ts";
import { esCli } from "./i18n-es.ts";

let locale: "en" | "es" = parseLocale(process.env.AGETOR_LANG);

export function cliLocale(): "en" | "es" {
  return locale;
}

export function setCliLocale(l: "en" | "es"): void {
  locale = l;
}

/** Fija el idioma desde las preferencias del core, salvo que `AGETOR_LANG` mande. */
export async function initCliLocale(prefs: () => Promise<Record<string, string> | null>): Promise<void> {
  if (process.env.AGETOR_LANG) return;
  try {
    locale = parseLocale((await prefs())?.locale);
  } catch {
    // Sin core o sin respuesta: inglés.
  }
}

export const ct = makeTranslator(esCli, () => locale === "es");

/**
 * Traduce un bloque de ayuda línea a línea: la línea entera si está en el
 * diccionario; si no, la descripción que sigue al comando (separada por 2 o más
 * espacios). Los comandos y flags no se tocan.
 */
export function ctHelp(block: string): string {
  if (locale !== "es") return block;
  return block
    .split("\n")
    .map((line) => {
      const whole = ct(line.trim());
      if (whole !== line.trim()) return line.slice(0, line.length - line.trimStart().length) + whole;
      const m = /^(\s*\S.*?\S {2,})(\S.*)$/.exec(line);
      if (m) {
        const tr = ct(m[2]!);
        if (tr !== m[2]) return m[1] + tr;
      }
      return line;
    })
    .join("\n");
}
