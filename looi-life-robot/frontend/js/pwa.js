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
