import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { notify } from '../notify.js';
import KidHome from './KidHome.jsx';
import Brush from './Brush.jsx';
import Build from './Build.jsx';
import { Characters, CharacterDetail } from './Characters.jsx';
import Exercises from '../exercises/Exercises.jsx';

// A kid's screens: home, brushing, building, exercises and the Characters
// screen. Used for real kids and for the test kid in the parent area (top =
// anything to show above the home screen).
export default function KidArea({ profile, onSettings, top }) {
  const [screen, setScreen] = useState({ name: 'home' });
  const go = (name, extra = {}) => setScreen({ name, ...extra });
  const home = () => go('home');
  const { characterId } = screen;

  // A grown-up made reminders for this kid: this tablet needs to be allowed
  // to show notifications (Android asks once).
  useEffect(() => {
    if (!notify.available || profile.isTest) return;
    api.get('/api/reminders/today')
      .then((r) => r.reminders.length && notify.allow())
      .catch(() => { /* no server right now: next time */ });
  }, [profile.id]);

  switch (screen.name) {
    case 'brush':
      return <Brush profile={profile} onExit={(goBuild) => (goBuild ? go('build') : home())} />;
    case 'build':
      return (
        <Build
          profile={profile}
          characterId={characterId}
          onExit={() => (screen.from === 'character' ? go('character', { characterId }) : home())}
        />
      );
    case 'exercises':
      return <Exercises profile={profile} onExit={home} />;
    case 'characters':
      return <Characters profile={profile} onExit={home} onOpen={(id) => go('character', { characterId: id })} />;
    case 'character':
      return (
        <CharacterDetail
          profile={profile}
          characterId={characterId}
          onExit={() => go('characters')}
          onBuild={() => go('build', { characterId, from: 'character' })}
        />
      );
    default:
      return (
        <>
          {top}
          <KidHome
            profile={profile}
            onBrush={() => go('brush')}
            onBuild={() => go('build')}
            onCharacters={() => go('characters')}
            onExercises={() => go('exercises')}
            onSettings={onSettings}
          />
        </>
      );
  }
}
