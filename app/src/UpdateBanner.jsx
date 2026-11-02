import { useEffect, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { api, isNative } from './api.js';

// Shows "update available" when the server has a newer app build than the
// one installed. Tapping it opens the download in the phone's browser.
export default function UpdateBanner() {
  const [latest, setLatest] = useState(null);

  useEffect(() => {
    if (!isNative) return;
    (async () => {
      try {
        const [info, server] = await Promise.all([CapApp.getInfo(), api.get('/api/app/latest')]);
        if (server.versionCode && server.versionCode > Number(info.build)) setLatest(server);
      } catch { /* offline or old server: no banner */ }
    })();
  }, []);

  if (!latest) return null;
  return (
    // A plain link to another host: the Android app hands it to the browser.
    <a className="update-banner" href={api.url('/download/family-track.apk')}>
      📲 A new version ({latest.versionName}) is ready. Tap to update.
    </a>
  );
}
