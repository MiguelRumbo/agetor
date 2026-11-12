import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "./index.css";
import App from "./App";
import { ConfirmProvider } from "@/components/ui/confirm";
import { getLocale } from "@/lib/i18n";

// Atributo lang de <html> según el idioma elegido (lectores de pantalla, hyphenation).
document.documentElement.lang = getLocale();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </StrictMode>,
);
