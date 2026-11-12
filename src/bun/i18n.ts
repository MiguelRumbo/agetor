/**
 * Traducción de los mensajes del core que ve una persona (errores de la API y
 * líneas de estado del transcript). El idioma es la preferencia `locale`
 * (`"en"` por defecto) que el selector de Ajustes guarda en la tabla
 * `preferences`; el CLI la lee por la misma ruta, así que toda la app comparte
 * un idioma. Diccionario en `i18n-es.ts` (ver `docs/i18n.md`).
 *
 * Los eventos persistidos se guardan tal cual se emitieron: una línea de estado
 * ya escrita no cambia al cambiar de idioma, solo las nuevas.
 */
import { makeTranslator, parseLocale } from "../shared/i18n-core.ts";
import { preferences } from "./db.ts";
import { esCore } from "./i18n-es.ts";

export function coreLocale(): "en" | "es" {
  try {
    return parseLocale(preferences.get("locale"));
  } catch {
    return "en"; // sin base de datos (tests de módulos sueltos): inglés
  }
}

export const ct = makeTranslator(esCore, () => coreLocale() === "es");
