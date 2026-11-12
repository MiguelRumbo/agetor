/**
 * Traductor puro compartido por el core (`src/bun/i18n.ts`) y el CLI
 * (`src/cli/i18n.ts`). Sin imports: `src/shared` no depende de ningún proceso.
 *
 * La clave del diccionario es el texto en inglés. Si contiene marcadores
 * `{nombre}` se trata como plantilla: el mensaje real, ya con los valores
 * interpolados ("task abc not found"), se compara con la plantilla
 * ("task {id} not found") y los valores capturados se insertan en la
 * traducción ("tarea abc no encontrada"). Así los errores dinámicos del core
 * se traducen en un solo punto sin tocar cada sitio donde se generan.
 */
export type Dict = Record<string, string>;

export interface Translator {
  /** Traduce `text`; sin entrada devuelve `text` tal cual. `vars` rellena `{x}` de la traducción. */
  (text: string, vars?: Record<string, string | number>): string;
}

const PLACEHOLDER = /\{(\w+)\}/g;

function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(PLACEHOLDER, (m, k) => (k in vars ? String(vars[k]) : m));
}

interface Pattern {
  re: RegExp;
  names: string[];
  out: string;
}

function compile(dict: Dict): { exact: Dict; patterns: Pattern[] } {
  const exact: Dict = {};
  const patterns: Pattern[] = [];
  for (const [en, tr] of Object.entries(dict)) {
    const names: string[] = [];
    if (!PLACEHOLDER.test(en)) {
      exact[en] = tr;
      PLACEHOLDER.lastIndex = 0;
      continue;
    }
    PLACEHOLDER.lastIndex = 0;
    let src = "";
    let last = 0;
    for (const m of en.matchAll(PLACEHOLDER)) {
      src += escapeRe(en.slice(last, m.index));
      src += "([\\s\\S]+?)";
      names.push(m[1]!);
      last = m.index! + m[0].length;
    }
    src += escapeRe(en.slice(last));
    patterns.push({ re: new RegExp(`^${src}$`), names, out: tr });
  }
  // Plantillas más específicas (más texto fijo) primero.
  patterns.sort((a, b) => b.re.source.length - a.re.source.length);
  return { exact, patterns };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Crea un traductor a partir de un diccionario y una función que dice si el idioma activo es español. */
export function makeTranslator(dict: Dict, active: () => boolean): Translator {
  let compiled: ReturnType<typeof compile> | null = null;
  return (text, vars) => {
    if (!active()) return vars ? fill(text, vars) : text;
    compiled ??= compile(dict);
    const hit = compiled.exact[text];
    if (hit !== undefined) return vars ? fill(hit, vars) : hit;
    for (const p of compiled.patterns) {
      const m = p.re.exec(text);
      if (!m) continue;
      const caught: Record<string, string> = {};
      p.names.forEach((n, i) => (caught[n] = m[i + 1]!));
      return fill(p.out, { ...caught, ...(vars ?? {}) });
    }
    return vars ? fill(text, vars) : text;
  };
}

/** Normaliza el valor guardado en la preferencia `locale`. */
export function parseLocale(v: string | null | undefined): "en" | "es" {
  return v === "es" ? "es" : "en";
}
