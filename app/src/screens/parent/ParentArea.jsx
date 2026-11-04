import { useState } from 'react';
import OverviewTab from './OverviewTab.jsx';
import AccountsTab from './AccountsTab.jsx';
import CharactersTab from './CharactersTab.jsx';
import BrushingTab from './BrushingTab.jsx';
import TestTab from './TestTab.jsx';
import ExercisesTab from './ExercisesTab.jsx';
import DevicesTab from './DevicesTab.jsx';
import UpdateBanner from '../../UpdateBanner.jsx';

const TABS = [
  ['home', 'Home'],
  ['accounts', 'Accounts'],
  ['characters', 'Characters'],
  ['brushing', 'Brushing'],
  ['exercises', 'Exercises'],
  ['test', 'Test'],
  ['devices', 'Devices']
];

// Home for grown-up accounts, in the app and the web app alike.
export default function FamilyArea({ account, onSettings, onAuthLost }) {
  const [tab, setTab] = useState('home');
  const [fullScreen, setFullScreen] = useState(null); // a test brush/build takes over the screen

  if (fullScreen) return fullScreen;

  return (
    <div className="parent-area">
      <UpdateBanner />
      <header className="parent-header">
        <h1>Hi {account.name}</h1>
        <button className="btn gear" onClick={onSettings} title="Settings">⚙️</button>
      </header>
      <nav className="tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? 'tab active' : 'tab'} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>
      <main className="parent-main">
        {tab === 'home' && <OverviewTab onAuthLost={onAuthLost} />}
        {tab === 'accounts' && <AccountsTab onAuthLost={onAuthLost} />}
        {tab === 'characters' && <CharactersTab onAuthLost={onAuthLost} />}
        {tab === 'brushing' && <BrushingTab onAuthLost={onAuthLost} />}
        {tab === 'exercises' && <ExercisesTab onAuthLost={onAuthLost} show={setFullScreen} />}
        {tab === 'test' && <TestTab onAuthLost={onAuthLost} show={setFullScreen} />}
        {tab === 'devices' && <DevicesTab onAuthLost={onAuthLost} />}
      </main>
    </div>
  );
}
