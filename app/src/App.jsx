import { useEffect, useState } from 'react';
import { api, isNative } from './api.js';
import { notify } from './notify.js';
import { ServerAddress, FirstAccount } from './screens/Setup.jsx';
import WhoAreYou from './screens/WhoAreYou.jsx';
import Settings from './screens/Settings.jsx';
import KidArea from './screens/KidArea.jsx';
import FamilyArea from './screens/parent/ParentArea.jsx';

// server address (app only) -> first grown-up (new server) -> "Who are you?"
// -> the signed-in account's home. The device remembers who's signed in;
// switching happens in Settings.
export default function App() {
  const [screen, setScreen] = useState('loading');
  const [account, setAccount] = useState(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');

  // Tell the notification side who is signed in. A grown-up's lists keep it
  // up to date from there (lists/store.js); for anyone else, fetch what the
  // server has for them, which also clears the last person's.
  function notifyAs(a) {
    notify.configure().then(() => !a.isParent && notify.sync());
  }

  async function load() {
    setError('');
    if (isNative && !api.serverUrl) return setScreen('server');
    // A grown-up gets straight in as whoever was signed in here last time,
    // server or no server (NetBird off, no signal): their lists are kept on
    // the device. The server is asked behind the scenes.
    const known = api.token ? api.knownAccount : null;
    if (known?.isParent) {
      setAccount(known);
      setScreen('home');
      notify.configure();
    } else {
      setScreen('loading');
    }
    try {
      if (api.token) {
        try {
          const me = await api.get('/api/me', { timeout: known ? 6000 : 20000 });
          api.rememberAccount(me.account);
          notifyAs(me.account);
          setAccount(me.account);
          if (!known?.isParent) setScreen('home'); // (already there, maybe on to Settings by now)
          return;
        } catch (e) {
          // No server in reach (or it's having trouble): they stay in.
          if (known?.isParent && e.status !== 401) return;
          if (e.status !== 401) throw e;
          api.rememberAccount(null);
          if (!e.data?.deviceKnown) api.setToken(null);
          notify.configure();
        }
      }
      const status = await api.get('/api/status');
      setAccount(null);
      setScreen(status.setUp ? 'who' : 'first');
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  function signedIn(a) {
    api.rememberAccount(a);
    notifyAs(a);
    setAccount(a);
    setSwitching(false);
    setScreen('home');
  }

  if (error) {
    return (
      <div className="center-screen">
        <div className="card narrow">
          <h2>Hmm, something's off</h2>
          <p>{error}</p>
          <button className="btn primary" onClick={load}>Try again</button>
          {isNative && <button className="btn link" onClick={() => { setError(''); setScreen('server'); }}>Change server address</button>}
        </div>
      </div>
    );
  }

  switch (screen) {
    case 'loading':
      return <div className="center-screen"><div className="spinner" /></div>;
    case 'server':
      return <ServerAddress onDone={load} />;
    case 'first':
      return <FirstAccount onDone={signedIn} />;
    case 'who':
      return (
        <WhoAreYou
          current={switching ? account : null}
          onSignedIn={signedIn}
          onBack={switching ? () => { setSwitching(false); setScreen('settings'); } : null}
        />
      );
    case 'settings':
      return (
        <Settings
          account={account}
          onBack={() => setScreen('home')}
          onSwitch={() => { setSwitching(true); setScreen('who'); }}
          onChangeServer={() => { api.setToken(null); api.rememberAccount(null); notify.configure(); setScreen('server'); }}
          onAuthLost={load}
        />
      );
    case 'home':
      return account.isParent
        ? <FamilyArea account={account} onSettings={() => setScreen('settings')} onAuthLost={load} />
        : <KidArea profile={account} onSettings={() => setScreen('settings')} />;
    default:
      return null;
  }
}
