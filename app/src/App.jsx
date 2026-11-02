import { useEffect, useState } from 'react';
import { api, isNative } from './api.js';
import { ServerAddress, FirstAccount } from './screens/Setup.jsx';
import WhoAreYou from './screens/WhoAreYou.jsx';
import Settings from './screens/Settings.jsx';
import KidHome from './screens/KidHome.jsx';
import Brush from './screens/Brush.jsx';
import Build from './screens/Build.jsx';
import FamilyArea from './screens/parent/ParentArea.jsx';

// server address (app only) -> first grown-up (new server) -> "Who are you?"
// -> the signed-in account's home. The device remembers who's signed in;
// switching happens in Settings.
export default function App() {
  const [screen, setScreen] = useState('loading');
  const [account, setAccount] = useState(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    setScreen('loading');
    if (isNative && !api.serverUrl) return setScreen('server');
    try {
      if (api.token) {
        try {
          const me = await api.get('/api/me');
          setAccount(me.account);
          setScreen('home');
          return;
        } catch (e) {
          if (e.status !== 401) throw e;
          if (!e.data?.deviceKnown) api.setToken(null);
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
          onChangeServer={() => { api.setToken(null); setScreen('server'); }}
        />
      );
    case 'home':
      return account.isParent
        ? <FamilyArea account={account} onSettings={() => setScreen('settings')} onAuthLost={load} />
        : <KidArea account={account} onSettings={() => setScreen('settings')} />;
    default:
      return null;
  }
}

function KidArea({ account, onSettings }) {
  const [screen, setScreen] = useState('home');
  if (screen === 'brush') return <Brush profile={account} onExit={(goBuild) => setScreen(goBuild ? 'build' : 'home')} />;
  if (screen === 'build') return <Build profile={account} onExit={() => setScreen('home')} />;
  return <KidHome profile={account} onBrush={() => setScreen('brush')} onBuild={() => setScreen('build')} onSettings={onSettings} />;
}
