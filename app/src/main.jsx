import { createRoot } from 'react-dom/client';
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import App from './App.jsx';
import { setupBackButton } from './backButton.js';
import { isNative } from './api.js';
import './styles.css';

setupBackButton();

// The phone's status bar icons: light on the dark look, dark on the light one.
const dark = window.matchMedia?.('(prefers-color-scheme: dark)');
if (isNative && dark) {
  const setBars = () => SystemBars.setStyle({ style: dark.matches ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
  setBars();
  dark.addEventListener?.('change', setBars);
}
createRoot(document.getElementById('root')).render(<App />);
