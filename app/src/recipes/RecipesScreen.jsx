import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '../lists/ui.jsx';
import {
  useRecipes, refreshRecipes, saveRecipe, deleteRecipe, setRecipePhoto, removeRecipePhoto, importFromPage, findInApp, importFromApp,
  photoUrl, timesText, totalTime, timeText, ingredientText, yieldText, matches, topTags, stepsToText, ingredientsToText
} from './data.js';

const blank = () => ({
  title: '', description: '', servings: '', yield: '', prepMin: '', cookMin: '', totalMin: '',
  ingredientsText: '', stepsText: '', notes: '', tagsText: '', sourceUrl: '', photo: null
});
const editable = (r) => ({
  ...r, servings: r.servings ?? '', prepMin: r.prepMin ?? '', cookMin: r.cookMin ?? '', totalMin: r.totalMin ?? '',
  ingredientsText: ingredientsToText(r.ingredients), stepsText: stepsToText(r.steps), tagsText: r.tags.join(', ')
});

// The family's recipes: find one, read it (scaled to how many are eating),
// and for grown-ups (canEdit) add, change and import them.
export default function RecipesScreen({ canEdit, onAuthLost }) {
  const { data, offline } = useRecipes();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState(null);
  const [open, setOpen] = useState(null); // recipe id
  const [editing, setEditing] = useState(null); // a recipe being made or changed
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const refresh = () => refreshRecipes().catch((e) => e.status === 401 && onAuthLost?.());
    refresh();
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  // A new recipe or screen starts at the top.
  useEffect(() => { window.scrollTo(0, 0); }, [open]);

  const tags = useMemo(() => (data ? topTags(data.recipes) : []), [data]);

  if (!data) {
    return offline
      ? <p className="sync-note">Can't reach the server, and recipes haven't been loaded on this device yet.</p>
      : <div className="spinner" />;
  }

  const opened = data.recipes.find((r) => r.id === open);
  const editor = editing && (
    <RecipeEditor start={editing} offline={offline} onClose={() => setEditing(null)}
      onSaved={(id) => { setEditing(null); setOpen(id); }}
      onDeleted={() => { setEditing(null); setOpen(null); }} />
  );

  if (opened) {
    return (
      <>
        <RecipeView key={opened.id} r={opened} canEdit={canEdit} offline={offline} onBack={() => setOpen(null)} onEdit={() => setEditing(editable(opened))} />
        {editor}
      </>
    );
  }

  const shown = data.recipes.filter((r) => matches(r, q.trim()) && (!tag || r.tags.includes(tag)));
  return (
    <div className="stack rec-screen">
      {offline && <p className="sync-note">📴 Can't reach the server: these are the recipes from last time.{canEdit ? ' Changes need the server.' : ''}</p>}

      <div className="row rec-top">
        <input className="rec-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Find a recipe or ingredient" />
        {canEdit && <button className="btn primary" disabled={offline} onClick={() => setEditing(blank())}>+ Add</button>}
      </div>
      {canEdit && (
        <div className="row wrap rec-bar">
          <button className="btn" disabled={offline} onClick={() => setImporting(true)}>📥 Import</button>
          <span className="muted small">from a recipe web page, Mealie or Tandoor</span>
        </div>
      )}
      {tags.length > 0 && (
        <div className="row wrap rec-tags">
          {tags.map((t) => (
            <button key={t} className={`cal-chip${tag === t ? ' on' : ''}`} onClick={() => setTag(tag === t ? null : t)}>{t}</button>
          ))}
        </div>
      )}

      <ul className="rec-grid">
        {shown.map((r) => (
          <li key={r.id}>
            <button className="rec-card" onClick={() => setOpen(r.id)}>
              <Photo src={r.thumb} className="rec-card-photo" />
              <span className="rec-card-text">
                <b>{r.title}</b>
                {totalTime(r) && <small className="muted">⏱ {timeText(totalTime(r))}</small>}
              </span>
            </button>
          </li>
        ))}
        {!shown.length && (
          <li className="rec-empty muted">
            {q.trim() || tag ? 'No recipes like that' : canEdit ? 'No recipes yet. + Add one, or 📥 Import them.' : 'No recipes yet.'}
          </li>
        )}
      </ul>

      {importing && <ImportSheet onClose={() => setImporting(false)} onOpen={(id) => { setImporting(false); setOpen(id); }} />}
      {editor}
    </div>
  );
}

// A recipe's photo, fetched with the sign-in (and kept on the device).
export function Photo({ src, className }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setUrl(null);
    setFailed(false);
    if (src) photoUrl(src).then((u) => live && setUrl(u), () => live && setFailed(true));
    return () => { live = false; };
  }, [src]);
  return (
    <span className={`rec-photo ${className || ''}`}>
      {url ? <img src={url} alt="" /> : <span className="rec-photo-none">{src && !failed ? '' : '🍽️'}</span>}
    </span>
  );
}

function RecipeView({ r, canEdit, offline, onBack, onEdit }) {
  // How many it's for (when the recipe says), or how many times over.
  const [serves, setServes] = useState(r.servings || null);
  const [times, setTimes] = useState(1);
  const by = r.servings ? serves / r.servings : times;
  const [crossed, setCrossed] = useState(new Set()); // ingredients tapped as got out
  const cross = (k) => setCrossed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  let step = 0;

  return (
    <div className="stack rec-view">
      <div className="row spread">
        <button data-back className="btn" onClick={onBack}>← Recipes</button>
        {canEdit && <button className="btn" disabled={offline} onClick={onEdit}>✏️ Change</button>}
      </div>
      {r.photo && <Photo src={r.photo} className="rec-hero" />}
      <h2 className="rec-title">{r.title}</h2>
      {r.description && <p className="rec-desc">{r.description}</p>}
      {(timesText(r).length > 0 || r.yield) && (
        <div className="row wrap rec-facts">
          {timesText(r).map((t) => <span key={t} className="rec-fact">⏱ {t}</span>)}
          {r.yield && <span className="rec-fact">🍽️ {yieldText(r.yield, by)}</span>}
        </div>
      )}

      {r.ingredients.length > 0 && (
        <section className="card stack rec-section">
          <div className="row spread wrap">
            <h3>Ingredients</h3>
            {r.servings ? (
              <div className="row rec-scale">
                <button className="btn small" disabled={serves <= 1} onClick={() => setServes(serves - 1)} aria-label="Fewer">−</button>
                <span>Serves <b>{serves}</b></span>
                <button className="btn small" disabled={serves >= 100} onClick={() => setServes(serves + 1)} aria-label="More">+</button>
              </div>
            ) : (
              <div className="row rec-scale">
                {[0.5, 1, 2, 3].map((t) => (
                  <button key={t} className={`cal-chip${times === t ? ' on' : ''}`} onClick={() => setTimes(t)}>{t === 0.5 ? '½' : t}×</button>
                ))}
              </div>
            )}
          </div>
          {by !== 1 && <p className="muted small">Amounts changed for {r.servings ? `${serves} (it's written for ${r.servings})` : `${times === 0.5 ? 'half' : `${times} times`} the recipe`}. Times and pan sizes aren't.</p>}
          <ul className="rec-ingredients">
            {r.ingredients.map((i, k) => (i.section
              ? <li key={k} className="rec-sub">{i.section}</li>
              : (
                <li key={k} className={crossed.has(k) ? 'got' : ''} onClick={() => cross(k)}>
                  {ingredientText(i, by)}
                </li>
              )))}
          </ul>
        </section>
      )}

      {r.steps.length > 0 && (
        <section className="card stack rec-section">
          <h3>Steps</h3>
          <ol className="rec-steps">
            {r.steps.map((s, k) => (s.section
              ? <li key={k} className="rec-sub">{s.section}</li>
              : <li key={k}><span className="rec-step-n">{++step}</span><span className="pre">{s.text}</span></li>))}
          </ol>
        </section>
      )}

      {r.notes && <p className="con-note pre">{r.notes}</p>}
      {(r.tags.length > 0 || r.sourceUrl) && (
        <div className="row wrap rec-foot">
          {r.tags.map((t) => <span key={t} className="rec-tag">{t}</span>)}
          {r.sourceUrl && <a className="rec-source" href={r.sourceUrl} target="_blank" rel="noreferrer">🔗 Where it's from</a>}
        </div>
      )}
    </div>
  );
}

function RecipeEditor({ start, offline, onClose, onSaved, onDeleted }) {
  const [r, setR] = useState(start);
  const [photo, setPhoto] = useState(null); // { file, preview } picked, not uploaded yet
  const [dropPhoto, setDropPhoto] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const set = (patch) => setR((x) => ({ ...x, ...patch }));
  useEffect(() => () => photo && URL.revokeObjectURL(photo.preview), [photo]);

  function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhoto({ file, preview: URL.createObjectURL(file) });
    setDropPhoto(false);
  }

  async function save() {
    setError('');
    setBusy('Saving…');
    try {
      const id = await saveRecipe(r);
      if (photo) {
        await setRecipePhoto(id, photo.file, (p) => setBusy(`Sending the photo… ${Math.round(p * 100)}%`));
      } else if (dropPhoto && r.photo) await removeRecipePhoto(id);
      onSaved(id);
    } catch (e) {
      setError(e.message);
      setBusy('');
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${r.title}"? It can't be brought back.`)) return;
    setBusy('Deleting…');
    try {
      await deleteRecipe(r.id);
      onDeleted();
    } catch (e) {
      setError(e.message);
      setBusy('');
    }
  }

  const num = (k) => (
    <input type="number" inputMode="numeric" min="0" value={r[k]} onChange={(e) => set({ [k]: e.target.value })} />
  );
  const showingPhoto = photo ? 'new' : r.photo && !dropPhoto ? 'old' : null;
  return (
    <Sheet title={r.id ? 'Change recipe' : 'New recipe'} onClose={onClose} closeLabel="Cancel" wide>
      <label>Name<input value={r.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} placeholder="Taco night" /></label>

      <div className="stack tight">
        <b>Photo</b>
        <div className="row wrap rec-edit-photo">
          {showingPhoto === 'new' && <span className="rec-photo rec-edit-thumb"><img src={photo.preview} alt="" /></span>}
          {showingPhoto === 'old' && <Photo src={r.thumb} className="rec-edit-thumb" />}
          <label className="btn">
            📷 {showingPhoto ? 'Change photo' : 'Add a photo'}
            <input type="file" accept="image/*" hidden onChange={pick} />
          </label>
          {showingPhoto && <button className="btn" onClick={() => { setPhoto(null); setDropPhoto(true); }}>Take it away</button>}
        </div>
      </div>

      <label>About it <span className="muted small">(optional)</span>
        <textarea rows={2} value={r.description} onChange={(e) => set({ description: e.target.value })} maxLength={1000} />
      </label>
      <div className="rec-edit-nums">
        <label>Serves{num('servings')}</label>
        <label>Prep (min){num('prepMin')}</label>
        <label>Cook (min){num('cookMin')}</label>
        <label>Total (min){num('totalMin')}</label>
      </div>
      <label>Makes <span className="muted small">(optional, like "24 cookies")</span>
        <input value={r.yield} onChange={(e) => set({ yield: e.target.value })} maxLength={60} />
      </label>

      <label>Ingredients <span className="muted small">(one per line; a line ending in : is a heading, like "Sauce:")</span>
        <textarea rows={8} value={r.ingredientsText} onChange={(e) => set({ ingredientsText: e.target.value })}
          placeholder={'1 lb ground beef\n1 packet taco seasoning\n\nToppings:\n1 cup cheese, shredded'} />
      </label>
      <label>Steps <span className="muted small">(one per line, or a blank line between steps that run over more than one line)</span>
        <textarea rows={8} value={r.stepsText} onChange={(e) => set({ stepsText: e.target.value })}
          placeholder={'Brown the beef.\nAdd the seasoning and 2/3 cup water. Simmer 5 minutes.\nFill the shells.'} />
      </label>
      <label>Notes <span className="muted small">(optional)</span>
        <textarea rows={2} value={r.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={4000} />
      </label>
      <label>Tags <span className="muted small">(with commas between, like "Dinner, Easy")</span>
        <input value={r.tagsText} onChange={(e) => set({ tagsText: e.target.value })} />
      </label>
      <label>Where it's from <span className="muted small">(a web address, optional)</span>
        <input type="url" value={r.sourceUrl} onChange={(e) => set({ sourceUrl: e.target.value })} maxLength={500} />
      </label>

      {error && <p className="error">{error}</p>}
      {busy && <p className="muted">{busy}</p>}
      <button className="btn primary" disabled={!!busy || offline || !r.title.trim()} onClick={save}>Save</button>
      {r.id && <button className="btn danger" disabled={!!busy || offline} onClick={remove}>🗑 Delete recipe</button>}
    </Sheet>
  );
}

const APPS = {
  mealie: { name: 'Mealie', token: "In Mealie: your profile picture → API Tokens → give it a name → Generate, then copy it." },
  tandoor: { name: 'Tandoor', token: 'In Tandoor: your name (top right) → Settings → API → New token (scope read is enough), then copy it.' }
};
const keptAddress = (source) => { try { return localStorage.getItem(`ft.recipes.import.${source}`) || ''; } catch { return ''; } };
const keepAddress = (source, url) => { try { localStorage.setItem(`ft.recipes.import.${source}`, url); } catch { /* fine */ } };

// Bring recipes in: from a web page's address, or all at once from the
// family's Mealie or Tandoor (with an API token used just for this).
function ImportSheet({ onClose, onOpen }) {
  const [from, setFrom] = useState('page');
  return (
    <Sheet title="Import recipes" onClose={onClose} closeLabel="Close" wide>
      <div className="row wrap">
        {[['page', '🌐 Web page'], ['mealie', 'Mealie'], ['tandoor', 'Tandoor']].map(([k, label]) => (
          <button key={k} className={`cal-chip${from === k ? ' on' : ''}`} onClick={() => setFrom(k)}>{label}</button>
        ))}
      </div>
      {from === 'page' ? <FromPage onOpen={onOpen} /> : <FromApp key={from} source={from} onDone={onClose} />}
    </Sheet>
  );
}

function FromPage({ onOpen }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function go() {
    setBusy(true);
    setError('');
    try {
      const r = await importFromPage(url.trim());
      onOpen(r.id);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <label>The recipe's web address
        <input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
      </label>
      <p className="muted small">Copy the address from the browser (Share → Copy link) and paste it here. Most recipe sites work; a few won't let
        Family Track read them, and those can be added by hand.</p>
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy || !/^https?:\/\/\S+\.\S+/i.test(url.trim())} onClick={go}>
        {busy ? 'Reading the page…' : '📥 Import it'}
      </button>
    </div>
  );
}

function FromApp({ source, onDone }) {
  const app = APPS[source];
  const [url, setUrl] = useState(keptAddress(source));
  const [token, setToken] = useState('');
  const [found, setFound] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [results, setResults] = useState(null);

  async function find() {
    setBusy('Looking…');
    setError('');
    try {
      const r = await findInApp(source, url.trim(), token.trim());
      keepAddress(source, url.trim());
      setFound(r.recipes);
      setPicked(new Set(r.recipes.filter((x) => !x.have).map((x) => x.id)));
    } catch (e) {
      setError(e.message);
    }
    setBusy('');
  }

  async function bring() {
    setBusy(`Bringing over ${picked.size} ${picked.size === 1 ? 'recipe' : 'recipes'} and their photos…`);
    setError('');
    try {
      const r = await importFromApp(source, url.trim(), token.trim(), [...picked]);
      setResults(r.results);
      setToken('');
    } catch (e) {
      setError(e.message);
    }
    setBusy('');
  }

  if (results) {
    const good = results.filter((x) => x.recipe && !x.already);
    const bad = results.filter((x) => x.error);
    const noPhoto = good.filter((x) => !x.photo);
    return (
      <div className="stack">
        <p>✓ Brought over {good.length} {good.length === 1 ? 'recipe' : 'recipes'} from {app.name}.</p>
        {noPhoto.length > 0 && <p className="muted small">No photo came with: {noPhoto.map((x) => x.title).join(', ')}.</p>}
        {bad.length > 0 && (
          <div className="stack tight">
            <b>Couldn't bring over</b>
            {bad.map((x) => <p key={x.id} className="con-check-line">{found.find((f) => f.id === x.id)?.title || x.id}: {x.error}</p>)}
          </div>
        )}
        <p className="muted small">Family Track didn't keep the token. You can delete it in {app.name} now.</p>
        <button className="btn primary" onClick={onDone}>Done</button>
      </div>
    );
  }

  return (
    <div className="stack">
      {!found && (
        <>
          <label>{app.name}'s address <span className="muted small">(as the server reaches it)</span>
            <input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://…:port" />
          </label>
          <label>API token
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
          </label>
          <p className="muted small">{app.token} It's only used for this import and isn't kept.</p>
          {error && <p className="error">{error}</p>}
          <button className="btn primary" disabled={!!busy || !url.trim() || !token.trim()} onClick={find}>{busy || `Find ${app.name}'s recipes`}</button>
        </>
      )}
      {found && (
        <>
          <div className="row spread wrap">
            <b>{found.length} {found.length === 1 ? 'recipe' : 'recipes'} in {app.name}</b>
            <button className="btn small" onClick={() => setPicked(new Set(picked.size ? [] : found.filter((x) => !x.have).map((x) => x.id)))}>
              {picked.size ? 'Pick none' : 'Pick all'}
            </button>
          </div>
          <ul className="rec-pick">
            {found.map((x) => (
              <li key={x.id}>
                <label className="inline check">
                  <input type="checkbox" disabled={x.have} checked={picked.has(x.id)}
                    onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(x.id); else n.delete(x.id); return n; })} />
                  <span>{x.title}{x.have && <span className="muted small"> · already here</span>}</span>
                </label>
              </li>
            ))}
          </ul>
          {error && <p className="error">{error}</p>}
          <button className="btn primary" disabled={!!busy || !picked.size} onClick={bring}>
            {busy || `📥 Bring over ${picked.size} ${picked.size === 1 ? 'recipe' : 'recipes'}`}
          </button>
        </>
      )}
    </div>
  );
}
