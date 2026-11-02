export default function ProfilePicker({ profiles, onPick, onParent }) {
  const kids = profiles.filter((p) => !p.isParent);
  return (
    <div className="center-screen">
      <h1 className="logo">Who's here?</h1>
      <div className="profile-grid">
        {kids.map((p) => (
          <button key={p.id} className="profile-tile" style={{ '--c': p.color }} onClick={() => onPick(p)}>
            <span className="profile-emoji">{p.emoji}</span>
            <span>{p.name}</span>
          </button>
        ))}
      </div>
      {!kids.length && <p className="muted">No kids added yet. A parent can add them below.</p>}
      <button className="btn link parent-link" onClick={onParent}>🔒 Parents</button>
    </div>
  );
}
