/**
 * @typedef {{
 * ready: () => void;
 * expand: () => void;
 * themeParams: Record<string, string | undefined>;
 * onEvent?: (event: string, cb: () => void) => void;
 * }} TelegramWebApp
 */

/**
 * @returns {TelegramWebApp | undefined}
 */
function getTelegramWebApp() {
  return window.Telegram?.WebApp;
}

function syncTheme() {
  const webApp = getTelegramWebApp();
  if (!webApp) {
    return;
  }

  const params = webApp.themeParams ?? {};
  const style = document.documentElement.style;

  if (params.bg_color) style.setProperty('--tg-theme-bg-color', params.bg_color);
  if (params.text_color)
    style.setProperty('--tg-theme-text-color', params.text_color);
  if (params.hint_color)
    style.setProperty('--tg-theme-hint-color', params.hint_color);
  if (params.button_color)
    style.setProperty('--tg-theme-button-color', params.button_color);
  if (params.button_text_color) {
    style.setProperty('--tg-theme-button-text-color', params.button_text_color);
  }
}

export function initTelegramBridge() {
  const webApp = getTelegramWebApp();
  if (!webApp) {
    return;
  }

  webApp.ready();
  webApp.expand();
  syncTheme();
  webApp.onEvent?.('themeChanged', syncTheme);
}
