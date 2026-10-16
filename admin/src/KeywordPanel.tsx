import { useCallback, useEffect, useState } from 'react';
import { api, type Keyword, type Skill } from './api';
import { parseKeywords } from './keywords';

export function KeywordPanel({ skills, refresh, onChange }: { skills: Skill[]; refresh: number; onChange: () => void }) {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [settings, setSettings] = useState<Record<string,{ auto_publish: boolean }>>({});
  const [text, setText] = useState('');
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [autoPublish, setAutoPublish] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const [list, preferences] = await Promise.all([api<Keyword[]>('keywords'), api<Record<string,{ auto_publish: boolean }>>('search_settings')]);
      setKeywords(list); setSettings(preferences);
    } catch (e) {
      const message = (e as Error).message;
      setError(/Invalid operation|Unknown keyword|Could not find the function/.test(message)
        ? 'Skill search needs the optional-keywords backend update. See admin/README.md for the migration and function deployment.' : message);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load, refresh]);
  const lines = parseKeywords(text);
  const valid = lines.length <= 50 && lines.every(s => s.length <= 200) && topicIds.length > 0 && (!editId || lines.length === 1);
  async function search(ids?: string[], topics?: string[]) {
    const result = await api<{ already_running: boolean }>('collect_now', ids ? { keyword_ids: ids } : topics ? { topic_ids: topics } : {});
    setNotice(result.already_running
      ? 'This search is already queued or running. Watch the activity below for results.'
      : 'AI search started. It targets 15 videos per skill, or per optional keyword refinement. Watch the activity below for results.');
    onChange();
  }
  async function run(ids?: string[]) {
    setBusy(true); setError(''); setNotice('');
    try { await search(ids); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function save(andSearch: boolean) {
    setBusy(true); setError(''); setNotice('');
    try {
      let ids: string[] | undefined;
      if (lines.length) {
        ids = await api<string[]>('save_keywords', { entries: lines.map(keyword => ({ ...(editId ? { id: editId } : {}), keyword, topic_ids: topicIds, auto_publish: autoPublish, enabled: true })) });
      } else {
        await api('save_skill_settings', { topic_ids: topicIds, auto_publish: autoPublish });
      }
      setText(''); setEditId(null); await load();
      setNotice(lines.length ? 'Optional refinements saved. Other skills still search by their own names.' : 'Skill settings saved. No keywords are needed.');
      if (andSearch) await search(ids, ids ? undefined : topicIds);
      else onChange();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function toggle(keyword: Keyword, changes: Partial<Keyword>) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api('save_keywords', { entries: [{ ...keyword, ...changes }] });
      await load(); onChange();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel keyword-panel" id="keyword-search" aria-labelledby="keyword-title">
    <div className="section-heading"><div><span className="eyebrow">SKILLS FIRST. KEYWORDS OPTIONAL.</span><h2 id="keyword-title">Search skills with AI</h2><p>Search by skill name. Add keywords only when you want to focus a particular skill, now or every three days.</p></div><span className="badge green">15 videos / search</span></div>
    <div className="keyword-content">
      {error && <div className="alert" role="alert">{error}<button onClick={() => { setError(''); void load(); }} disabled={busy}>Retry</button></div>}
      {notice && <div className="notice" role="status">{notice}</div>}
      <form onSubmit={e => { e.preventDefault(); if (valid && !busy) void save(true); }} className="keyword-form">
        <div><span className="field-label" id="keyword-skills-label">Choose existing skills</span><div className="keyword-skills" role="group" aria-labelledby="keyword-skills-label">{skills.map(s => <label key={s.id}><input type="checkbox" checked={topicIds.includes(s.id)} disabled={busy} onChange={e => { setTopicIds(ids => e.target.checked ? [...ids,s.id] : ids.filter(id => id !== s.id)); if (e.target.checked && topicIds.length === 0) setAutoPublish(settings[s.id]?.auto_publish ?? true); }}/>{s.name}</label>)}</div><small>Without refinements, each skill targets 15 videos. Active refinements replace the general search for their assigned skill.</small></div>
        <div><label htmlFor="keyword-input">{editId ? 'Edit refinement' : 'Optional keywords · separated by commas or new lines'}</label><textarea id="keyword-input" value={text} onChange={e => setText(e.target.value)} placeholder="car, digital tech, aerodynamics" rows={4} disabled={busy}/><small>{lines.length ? `${lines.length} refinements · ${lines.length * 15} target videos` : 'Leave blank to search selected skills by their names.'}</small></div>
        <div className="keyword-mode"><label htmlFor="keyword-mode">Publishing</label><select id="keyword-mode" value={autoPublish ? 'auto' : 'review'} disabled={busy} onChange={e => setAutoPublish(e.target.value === 'auto')}><option value="auto">Publish automatically</option><option value="review">Save for human review</option></select><p>{autoPublish ? 'Matching videos go directly into the published catalog. Users receive only videos matching their selected skills.' : 'Matching videos stay in the review queue until an admin publishes them.'}</p></div>
        <div className="keyword-form-actions"><button className="primary" type="submit" disabled={busy || !valid}>{busy ? 'Working…' : editId ? 'Save & search now' : 'Search selected skills now'}</button><button className="secondary" type="button" disabled={busy || !valid} onClick={() => void save(false)}>Save only</button>{editId && <button className="text-button" type="button" disabled={busy} onClick={() => { setEditId(null); setText(''); }}>Cancel edit</button>}</div>
      </form>
      <div className="keyword-list-heading"><div><h3>Optional keyword refinements</h3><p>Skills without active refinements search by name. Pause all refinements for a skill to restore its general search.</p></div><button className="primary" disabled={busy || !skills.length} onClick={() => void run(selected.length ? selected : undefined)}>{selected.length ? `Search selected (${selected.length})` : 'Search all skills now'}</button></div>
      {loading ? <p role="status" className="empty">Loading saved keywords…</p> : !keywords.length ? <div className="empty">No keyword refinements. Skill searches work normally without them.</div> : <div className="table-wrap"><table><thead><tr><th><span className="sr-only">Select</span></th><th>OPTIONAL KEYWORD</th><th>USER SKILLS</th><th>PUBLISHING</th><th>SCHEDULE</th><th>ACTIONS</th></tr></thead><tbody>{keywords.map(k => <tr key={k.id} className="keyword-row"><td><input type="checkbox" aria-label={`Select ${k.keyword}`} checked={selected.includes(k.id)} disabled={busy || !k.enabled} onChange={e => setSelected(ids => e.target.checked ? [...ids,k.id] : ids.filter(id => id !== k.id))}/></td><td><strong>{k.keyword}</strong></td><td><div className="tags">{k.topic_ids.map(id => <span key={id}>{skills.find(s => s.id === id)?.name || 'Unknown skill'}</span>)}</div></td><td><select aria-label={`Publishing mode for ${k.keyword}`} value={k.auto_publish ? 'auto' : 'review'} disabled={busy} onChange={e => void toggle(k,{auto_publish:e.target.value === 'auto'})}><option value="auto">Automatic</option><option value="review">Human review</option></select></td><td><button className={`badge ${k.enabled ? 'green' : ''}`} aria-label={`${k.enabled ? 'Pause' : 'Enable'} ${k.keyword}`} disabled={busy} onClick={() => { setSelected(ids => ids.filter(id => id !== k.id)); void toggle(k,{enabled:!k.enabled}); }}>{k.enabled ? 'Every 3 days · pause' : 'Paused · enable'}</button></td><td><div className="keyword-row-actions"><button className="text-button" disabled={busy || !k.enabled} onClick={() => void run([k.id])}>Search now</button><button className="text-button" disabled={busy} onClick={() => { setEditId(k.id); setText(k.keyword); setTopicIds(k.topic_ids); setAutoPublish(k.auto_publish); document.getElementById('keyword-input')?.focus(); }}>Edit</button></div></td></tr>)}</tbody></table></div>}
    </div>
  </section>;
}
