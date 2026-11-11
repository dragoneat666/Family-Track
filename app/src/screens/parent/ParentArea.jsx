import { useEffect, useState } from 'react';
import OverviewTab from './OverviewTab.jsx';
import AccountsTab from './AccountsTab.jsx';
import CharactersTab from './CharactersTab.jsx';
import BrushingTab from './BrushingTab.jsx';
import TestTab from './TestTab.jsx';
import ExercisesTab from './ExercisesTab.jsx';
import DevicesTab from './DevicesTab.jsx';
import UpdateBanner from '../../UpdateBanner.jsx';
import ListsTab from '../../lists/ListsTab.jsx';
import ListView from '../../lists/ListView.jsx';
import { startLists, stopLists } from '../../lists/store.js';
import { notify } from '../../notify.js';

const TABS = [
  ['home', 'Home'],
  ['lists', 'Lists'],
  ['accounts', 'Accounts'],
  ['characters', 'Characters'],
  ['brushing', 'Brushing'],
  ['exercises', 'Exercises'],
  ['test', 'Test'],
  ['devices', 'Devices']
];

// Home for grown-up accounts, in the app and the web app alike.
export default function FamilyArea({ account, offline, onSettings, onAuthLost }) {
  // Opens on the tab used last time.
  const [tab, setTab] = useState(() => {
    try { return TABS.some(([key]) => key === localStorage.getItem('ft.tab')) ? localStorage.getItem('ft.tab') : 'home'; } catch { return 'home'; }
  });
  const [picked, setPicked] = useState(false);
  const [fullScreen, setFullScreen] = useState(null); // an open list, or a test brush/build, takes over the screen

  function pick(key) {
    setPicked(true);
    setTab(key);
    try { localStorage.setItem('ft.tab', key); } catch { /* private mode */ }
  }
  // With no server in reach, Lists is the part that still works: start there.
  useEffect(() => {
    if (offline && !picked) setTab('lists');
  }, [offline]);

  function openList(listId, itemId) {
    pick('lists');
    setFullScreen(<ListView key={`${listId}:${itemId || ''}`} listId={listId} focusItem={itemId} onExit={() => setFullScreen(null)} />);
  }

  // Lists are kept up to date the whole time a grown-up is signed in, so
  // they're ready offline and pins and reminders stay right.
  useEffect(() => {
    startLists(account, { onAuthLost });
    return stopLists;
  }, [account.id]);
  // Tapping a list's notification opens that list.
  useEffect(() => notify.onTap((tap) => tap.screen === 'list' && openList(tap.list, tap.item)), []);

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
          <button key={key} className={tab === key ? 'tab active' : 'tab'} onClick={() => pick(key)}>{label}</button>
        ))}
      </nav>
      <main className="parent-main">
        {tab === 'home' && <OverviewTab onAuthLost={onAuthLost} />}
        {tab === 'lists' && <ListsTab openList={openList} />}
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
