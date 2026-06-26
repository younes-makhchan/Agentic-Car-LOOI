export function registerPwaServiceWorker({ logger = () => {} } = {}) {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((registration) => {
        logger(`PWA service worker ready: ${registration.scope}`, "debug");
      })
      .catch((error) => {
        logger(`PWA service worker failed: ${error.message}`, "warn");
      });
  });
}

export function createPwaInstallController({
  button,
  logger = () => {},
  fallbackMessage = "Install from your browser menu."
} = {}) {
  let deferredPrompt = null;
  const isStandalone = () =>
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.matchMedia?.("(display-mode: fullscreen)")?.matches ||
    window.navigator?.standalone === true;

  if (!button) {
    return {
      canInstall: false
    };
  }

  button.hidden = isStandalone();

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    button.hidden = false;
    button.disabled = false;
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    button.hidden = true;
    logger("App installed.");
  });

  button.addEventListener("click", async () => {
    if (isStandalone()) {
      button.hidden = true;
      return;
    }

    if (!deferredPrompt) {
      logger(fallbackMessage, "warn");
      return;
    }

    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    promptEvent.prompt();
    await promptEvent.userChoice.catch(() => null);
  });

  return {
    canInstall: Boolean(deferredPrompt)
  };
}
