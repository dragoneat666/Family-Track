import { App as CapApp } from '@capacitor/app';
import { isNative } from './api.js';

// The phone's Back button (Android) presses whatever "back" button is on the
// screen: any visible, enabled element marked data-back. The last one in the
// page wins, so an overlay's Back beats the page under it. With none (a home
// screen), the app goes to the background like other apps do.
export function setupBackButton() {
  if (!isNative) return;
  CapApp.addListener('backButton', () => {
    const el = [...document.querySelectorAll('[data-back]')]
      .filter((e) => e.offsetParent !== null && !e.disabled)
      .at(-1);
    if (el) el.click();
    else CapApp.minimizeApp();
  });
}
