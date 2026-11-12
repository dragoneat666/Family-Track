import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import OverviewTab from './OverviewTab.jsx';
import CharactersTab from './CharactersTab.jsx';
import BrushingTab from './BrushingTab.jsx';
import TestTab from './TestTab.jsx';
import ExercisesTab from './ExercisesTab.jsx';
import UpdateBanner from '../../UpdateBanner.jsx';
import ListsTab from '../../lists/ListsTab.jsx';
import ListView from '../../lists/ListView.jsx';
import { SyncNote } from '../../lists/ui.jsx';
import { startLists, stopLists, useLists } from '../../lists/store.js';
import { notify } from '../../notify.js';
import RemindersScreen from '../../reminders/RemindersScreen.jsx';
import { useReminders, refreshReminders, todayNote } from '../../reminders/data.js';
import CalendarScreen from '../../calendar/CalendarScreen.jsx';
import { useCalendar, refreshCalendar, nextNote } from '../../calendar/data.js';
import ContactsScreen from '../../contacts/ContactsScreen.jsx';
import { useContacts, refreshContacts } from '../../contacts/data.js';

// Every screen a grown-up can open from a button. `under` is where its Back
// button goes: Home has the family's things, Kids Setup has what the kids'
// side needs (accounts and devices are in Settings, behind the gear).
const SCREENS = {
  lists: { emoji: '🛒', title: 'Lists', under: 'home' },
  reminders: { emoji: '⏰', title: 'Reminders', under: 'home' },
  contacts: { emoji: '📇', title: 'Contacts', under: 'home' },
  kids: { emoji: '🧒', title: 'Kids Setup', under: 'home' },
  characters: { emoji: '🤖', title: 'Characters', under: 'kids', note: 'What the kids build and dress up' },
  brushing: { emoji: '🪥', title: 'Brushing', under: 'kids', note: 'Rules, history and each kid’s setting' },
  exercises: { emoji: '🏃', title: 'Exercises', under: 'kids', note: 'Do an exercise with a kid' },
  test: { emoji: '🧪', title: 'Test', under: 'kids', note: 'Try brushing and building without saving' }
};
const UNDER_KIDS = ['characters', 'brushing', 'exercises', 'test'];

// Home for grown-up accounts, in the app and the web app alike.
export default function FamilyArea({ account, onSettings, onAuthLost }) {
  const [screen, setScreen] = useState('home');
  const [fullScreen, setFullScreen] = useState(null); // an open list, or a test brush/build, takes over the screen

  function openList(listId, itemId) {
    setScreen('lists');
    setFullScreen(<ListView key={`${listId}:${itemId || ''}`} listId={listId} focusItem={itemId} onExit={() => setFullScreen(null)} />);
  }
  // open: { event, occ } to show one date of an event.
  function openCalendar(open) {
    setFullScreen(
      <CalendarScreen key={open ? `${open.event}:${open.occ}` : 'calendar'} account={account} open={open} onAuthLost={onAuthLost} onExit={() => setFullScreen(null)} />
    );
  }

  // Lists are kept up to date the whole time a grown-up is signed in, so
  // they're ready offline and pins and reminders stay right.
  useEffect(() => {
    startLists(account, { onAuthLost });
    return stopLists;
  }, [account.id]);
  // Tapping a notification opens what it's about.
  useEffect(() => notify.onTap((tap) => {
    if (tap.screen === 'list') openList(tap.list, tap.item);
    else if (tap.screen === 'calendar') openCalendar({ event: tap.event, occ: tap.occ });
    else if (tap.screen === 'reminders') {
      setFullScreen(null);
      setScreen('reminders');
    }
  }), []);

  if (fullScreen) return fullScreen;

  const tile = (key) => {
    const s = SCREENS[key];
    return <Tile key={key} tone={key} emoji={s.emoji} title={s.title} note={s.note} onClick={() => setScreen(key)} />;
  };

  if (screen === 'home') {
    return (
      <div className="parent-area">
        <UpdateBanner />
        <header className="parent-header">
          <h1>Hi {account.name}</h1>
          <button className="btn gear" onClick={onSettings} title="Settings">⚙️</button>
        </header>
        <Home open={setScreen} openCalendar={() => openCalendar()} />
      </div>
    );
  }

  const s = SCREENS[screen];
  return (
    <div className="parent-area">
      <UpdateBanner />
      <header className="parent-header sub">
        <button data-back className="btn" onClick={() => setScreen(s.under)}>← {s.under === 'home' ? 'Home' : SCREENS[s.under].title}</button>
        <h1>{s.emoji} {s.title}</h1>
      </header>
      <main className="parent-main">
        {screen === 'lists' && <ListsTab openList={openList} />}
        {screen === 'reminders' && <RemindersScreen account={account} onAuthLost={onAuthLost} />}
        {screen === 'contacts' && <ContactsScreen canEdit onAuthLost={onAuthLost} />}
        {screen === 'kids' && (
          <div className="stack">
            <OverviewTab onAuthLost={onAuthLost} />
            <div className="home-grid small">{UNDER_KIDS.map(tile)}</div>
          </div>
        )}
        {screen === 'characters' && <CharactersTab onAuthLost={onAuthLost} />}
        {screen === 'brushing' && <BrushingTab onAuthLost={onAuthLost} />}
        {screen === 'exercises' && <ExercisesTab onAuthLost={onAuthLost} show={setFullScreen} />}
        {screen === 'test' && <TestTab onAuthLost={onAuthLost} show={setFullScreen} />}
      </main>
    </div>
  );
}

// The buttons a grown-up starts from. Each says a little about what's
// behind it when there's something to say.
function Home({ open, openCalendar }) {
  const v = useLists();
  const reminders = useReminders();
  const calendar = useCalendar();
  const contacts = useContacts();
  const [kids, setKids] = useState(null);
  useEffect(() => {
    api.get('/api/parent/overview').then(setKids).catch(() => { /* no server right now: the button still works */ });
    refreshReminders().catch(() => {});
    refreshCalendar().catch(() => {});
    refreshContacts().catch(() => {});
  }, []);

  const left = [...v.items.values()].filter((i) => !i.checked).length;
  const brushed = kids?.filter((k) => k.brushedToday).length;
  return (
    <main className="parent-main stack">
      <SyncNote v={v} />
      <div className="home-grid">
        <Tile tone="calendar" emoji="📅" title="Calendar" onClick={openCalendar} note={nextNote(calendar.data)} />
        <Tile tone="lists" emoji="🛒" title="Lists" onClick={() => open('lists')}
          note={v.ready ? (left ? `${left} ${left === 1 ? 'thing' : 'things'} left` : 'Nothing left') : ''} />
        <Tile tone="reminders" emoji="⏰" title="Reminders" onClick={() => open('reminders')} note={todayNote(reminders.data)} />
        <Tile tone="contacts" emoji="📇" title="Contacts" onClick={() => open('contacts')}
          note={contacts.data?.contacts.length ? `${contacts.data.contacts.length} ${contacts.data.contacts.length === 1 ? 'person' : 'people'}` : ''} />
        <Tile tone="kids" emoji="🧒" title="Kids Setup" onClick={() => open('kids')}
          note={kids?.length ? `🪥 ${brushed} of ${kids.length} brushed today` : ''} />
      </div>
    </main>
  );
}

function Tile({ tone, emoji, title, note, onClick }) {
  return (
    <button className={`home-tile ${tone}`} onClick={onClick}>
      <span className="home-tile-emoji">{emoji}</span>
      <span className="home-tile-title">{title}</span>
      {note && <span className="home-tile-note">{note}</span>}
    </button>
  );
}
