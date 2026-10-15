import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AccountProvider } from "./contexts/AccountContext";
import { I18nProvider } from "./i18n/I18nProvider";
import { migrateLegacyStorage } from "./utils/storageMigration";
import "./styles.css";

migrateLegacyStorage();

createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <AccountProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AccountProvider>
  </I18nProvider>,
);
