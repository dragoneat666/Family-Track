import { useEffect, useState } from 'react';
import { api } from './api.js';
import Setup from './screens/Setup.jsx';
import ProfilePicker from './screens/ProfilePicker.jsx';
import KidHome from './screens/KidHome.jsx';
import Brush from './screens/Brush.jsx';
import Build from './screens/Build.jsx';
import ParentArea from './screens/parent/ParentArea.jsx';

// Screens: setup -> pick profile -> kid home (brush / build) or parent area.
export default function App() {
  const [screen, setScreen] = useState(api.token ? 'loading' : 'setup');
  const [profiles, setProfiles] = useState([]);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');

  async function loadProfiles() {
    setError('');
    try {
      const list = await api.get('/api/profiles');
      setProfiles(list);
      const last = list.find((p) => p.id === api.lastProfile && !p.isParent);
      if (last) {
        setProfile(last);
        setScreen('home');
      } else {
        setScreen('pick');
      }
    } catch (e) {
      if (e.status === 401) {
        api.setToken(null);
        setScreen('setup');
      } else {
        setError(e.message);
      }
    }
  }

  useEffect(() => {
    if (screen === 'loading') loadProfiles();
  }, [screen]);

  function pick(p) {
    setProfile(p);
    api.setLastProfile(p.id);
    setScreen('home');
  }

  if (error) {
    return (
      <div className="center-screen">
        <div className="card narrow">
          <h2>Hmm, something's off</h2>
          <p>{error}</p>
          <button className="btn primary" onClick={loadProfiles}>Try again</button>
          <button className="btn link" onClick={() => { api.setToken(null); setError(''); setScreen('setup'); }}>Set up this device again</button>
        </div>
      </div>
    );
  }

  switch (screen) {
    case 'setup':
      return <Setup onDone={() => setScreen('loading')} />;
    case 'loading':
      return <div className="center-screen"><div className="spinner" /></div>;
    case 'pick':
      return <ProfilePicker profiles={profiles} onPick={pick} onParent={() => setScreen('parent')} />;
    case 'home':
      return (
        <KidHome
          profile={profile}
          onBrush={() => setScreen('brush')}
          onBuild={() => setScreen('build')}
          onSwitch={() => { api.setLastProfile(null); setScreen('loading'); }}
        />
      );
    case 'brush':
      return <Brush profile={profile} onExit={(goBuild) => setScreen(goBuild ? 'build' : 'home')} />;
    case 'build':
      return <Build profile={profile} onExit={() => setScreen('home')} />;
    case 'parent':
      return <ParentArea onExit={() => { api.lockParent(); setScreen('loading'); }} />;
    default:
      return null;
  }
}
