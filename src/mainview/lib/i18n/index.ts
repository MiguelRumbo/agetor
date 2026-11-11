/**
 * Internacionalización mínima de la UI (fork Linux).
 *
 * Diseño: el inglés es el idioma por defecto y la CLAVE del diccionario es el
 * propio texto en inglés. `t("Settings")` devuelve "Ajustes" si el idioma es
 * español y la cadena entera si no hay traducción. Así:
 *  - los tests (unitarios y e2e) que buscan texto en inglés siguen pasando,
 *  - una cadena sin traducir se ve en inglés en vez de romperse,
 *  - no hace falta tocar `src/shared` ni el core: solo el webview traduce.
 *
 * El idioma vive en `localStorage` (estado de chrome de la UI, igual que
 * `panel-collapse.ts`): se lee de forma síncrona al cargar el módulo y cambiarlo
 * recarga la página. Recargar es deliberado: `t()` se llama también desde
 * constantes de módulo, que no se re-evalúan con un hook.
 */
import { es, esColumns } from "./es";

export type Locale = "en" | "es";

export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
];

const STORAGE_KEY = "agetor:locale";

function readLocale(): Locale {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (v === "en" || v === "es") return v;
  } catch {
    // El acceso a storage lanza con algunos ajustes de privacidad: inglés.
  }
  return "en";
}

let current: Locale = readLocale();

export function getLocale(): Locale {
  return current;
}

/** Guarda el idioma y recarga para que toda la UI se vuelva a renderizar. */
export function setLocale(next: Locale): void {
  if (next === current) return;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // Sin storage no se puede persistir; el cambio solo vale hasta recargar.
  }
  current = next;
  globalThis.location?.reload();
}

/**
 * Traduce `text`. `vars` sustituye `{nombre}` en la traducción; la clave en
 * inglés usa los mismos marcadores, p. ej. `t("Delete {name}?", { name })`.
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  const out = current === "es" ? (es[text] ?? text) : text;
  if (!vars) return out;
  return out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Traduce el nombre de una columna del tablero (`COLUMNS[i].label`). */
export function tColumn(label: string): string {
  return current === "es" ? (esColumns[label] ?? label) : label;
}
