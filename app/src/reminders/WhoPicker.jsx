// Who gets something, picked a step at a time: Everyone; untick that and it
// opens up into Adults and Kids; untick one of those and it opens up into
// its people, to tick just the ones you want. Groups are kept as groups, so
// someone added to the family later is included.
//
// value: { all: true } or { groups: ['adults'|'kids'], ids: [account ids] }.
// everyone={false} (for calendar events, later) starts at Adults and Kids.
export default function WhoPicker({ value, onChange, people, me, everyone = true }) {
  const all = !value || !!value.all;
  const groups = all ? ['adults', 'kids'] : value.groups || [];
  const ids = all ? [] : value.ids || [];
  const set = (g, i) => onChange({ groups: g, ids: i });

  const levels = [
    ['adults', 'Adults', people.filter((p) => p.isParent)],
    ['kids', 'Kids', people.filter((p) => !p.isParent)]
  ].filter(([, , members]) => members.length > 0);

  function toggleGroup(g, members) {
    if (groups.includes(g)) set(groups.filter((x) => x !== g), ids);
    else set([...groups, g], ids.filter((id) => !members.some((m) => m.id === id)));
  }
  const togglePerson = (id) => set(groups, ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  return (
    <div className="who-picker">
      {everyone && (
        <label className="inline check">
          <input type="checkbox" checked={all} onChange={(e) => onChange(e.target.checked ? { all: true } : { groups: ['adults', 'kids'], ids: [] })} />
          Everyone
        </label>
      )}
      {(!all || !everyone) && (
        <div className={everyone ? 'who-level' : undefined}>
          {levels.map(([g, label, members]) => (
            <div key={g}>
              <label className="inline check">
                <input type="checkbox" checked={groups.includes(g)} onChange={() => toggleGroup(g, members)} />
                {label}
              </label>
              {!groups.includes(g) && (
                <div className="who-level">
                  {members.map((p) => (
                    <label key={p.id} className="inline check">
                      <input type="checkbox" checked={ids.includes(p.id)} onChange={() => togglePerson(p.id)} />
                      {p.emoji} {p.name}{p.id === me ? ' (me)' : ''}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
