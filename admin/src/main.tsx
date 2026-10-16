import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session } from '@supabase/supabase-js';
import { api, callbackError, configured, googleLoginUrl, supabase, type Overview, type Video, type Skill } from './api';
import './style.css';
import { KeywordPanel } from './KeywordPanel';

type Tab = 'overview' | 'review' | 'library';
const date = (value?: string) => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    inbox: <><path d="M4 4h16l2 12v4H2v-4L4 4Z"/><path d="M2 14h6l2 3h4l2-3h6"/></>,
    play: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 9 5 3-5 3V9Z"/></>,
    sparkle: <><path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8L12 2Z"/></>,
    arrow: <><path d="M5 12h14m-5-5 5 5-5 5"/></>,
    logout: <><path d="M10 4H4v16h6m5-12 4 4-4 4m-7-4h11"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.play}</svg>;
}
function Brand() { return <div className="brand"><span className="brand-mark">f<span>✳</span></span><div>fuse<span className="brand-sub">STUDIO</span></div></div>; }
function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [activity, setActivity] = useState<import('./api').Run[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [skill, setSkill] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(callbackError);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Video | null>(null);
  const [preview, setPreview] = useState<Video | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const request = useRef(0);
  const identity = useRef<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    let alive = true;
    let initialResolved = false;
    const timer = setTimeout(() => {
      if (!alive || initialResolved) return;
      setAuthLoading(false);
      setError('Session check timed out. Check your connection, then try Google sign-in again.');
    }, 15000);
    void supabase.auth.getSession().then(({ data, error: authError }) => {
      if (!alive) return;
      initialResolved = true; clearTimeout(timer);
      if (authError) setError(authError.message);
      identity.current = data.session?.user.id || null;
      setSession(data.session); setAuthLoading(false);
    }).catch(e => {
      if (!alive) return;
      initialResolved = true; clearTimeout(timer);
      setError(e instanceof Error ? e.message : 'Could not check your session. Try signing in again.');
      setAuthLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (identity.current !== next?.user.id) {
        request.current++; identity.current = next?.user.id || null;
        setOverview(null); setActivity([]); setVideos([]); setSelected([]); setEditing(null); setPreview(null); setNotice('');
        if (next) setError('');
      }
      setSession(next);
      if (next) { setAuthLoading(false); setBusy(false); }
    });
    return () => { alive = false; clearTimeout(timer); data.subscription.unsubscribe(); };
  }, []);
  async function load() {
    if (!session) return;
    const current = ++request.current;
    setLoading(true); setError('');
    try {
      const [summary, items, runs] = await Promise.all([
        api<Overview>('overview'),
        tab === 'overview' ? Promise.resolve([]) : api<Video[]>(tab === 'review' ? 'drafts' : 'library', { topic_id: skill || undefined, offset: page * 50 }),
        api<import('./api').Run[]>('keyword_runs'),
      ]);
      if (current !== request.current) return;
      setOverview(summary); setActivity(runs); setVideos(items); setSelected([]);
    } catch (e) { if (current === request.current) setError((e as Error).message); }
    finally { if (current === request.current) setLoading(false); }
  }
  useEffect(() => { void load(); return () => { request.current++; }; }, [session?.user.id, tab, skill, page, tick]);
  useEffect(() => {
    if (!session || !activity.some(run => ['running','queued'].includes(run.status))) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && !busy) setTick(v => v + 1); }, 30000);
    return () => clearInterval(timer);
  }, [session?.user.id, activity, busy]);
  function navigate(next: Tab, topic = '') { setTab(next); setSkill(topic); setPage(0); setSelected([]); setNotice(''); }
  async function action(operation: string, payload: object, success: string) {
    const owner = identity.current;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(operation, payload);
      if (identity.current !== owner) return;
      setNotice(success); setEditing(null); await load();
    } catch (e) { if (identity.current === owner) setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function publish(ids: string[]) {
    const owner = identity.current;
    setBusy(true); setError(''); setNotice('');
    let succeeded = 0; const failures: string[] = [];
    for (const id of ids) {
      if (identity.current !== owner) break;
      try { await api('publish', { id }); succeeded++; }
      catch (e) { failures.push(`${videos.find(v => v.id === id)?.title || id}: ${(e as Error).message}`); }
    }
    if (identity.current === owner) {
      await load(); setNotice(`${succeeded} video${succeeded === 1 ? '' : 's'} published.${failures.length ? ` ${failures.length} failed and remain in the queue.` : ''}`);
      if (failures.length) setError(failures.join('\n'));
    }
    setBusy(false);
  }
  if (!session) return <div className="login"><section className="login-story"><Brand/><div><span className="eyebrow">A LITTLE CURIOSITY. A LOT OF POSSIBILITY.</span><h1>Good learning<br/>starts with<br/><em>good discovery.</em></h1><p>A considered collection of videos.<br/>Matched to the skills your community wants to grow.</p></div><span className="login-foot">FUSE / CONTENT STUDIO</span></section><section className="login-form"><div><span className="eyebrow">FOR THE CURIOUS CURATORS</span><h2>Welcome to Studio.</h2><p>Review discoveries. Share something worth learning.</p>{!configured ? <div className="alert">Set the public Supabase URL and publishable key in <code>admin/.env</code> to connect this website. See the setup guide in <code>admin/README.md</code>.</div> : <a className="primary login-button" href={googleLoginUrl}><span className="google">G</span>Continue with Google<Icon name="arrow"/></a>}{authLoading && <p role="status">Checking your existing session. You can continue with Google now.</p>}{error && <div role="alert" className="alert">{error}</div>}<small>Access is limited to approved administrators.</small></div></section></div>;
  const skills = overview?.skills || [];
  const totals = skills.reduce((a, s) => ({ users: a.users + s.users, published: a.published + s.published, drafts: a.drafts + s.drafts }), { users: 0, published: 0, drafts: 0 });
  const collecting = activity.some(run => run.kind === 'collection' && ['running','queued'].includes(run.status));
  const title = tab === 'overview' ? 'A space for better discoveries.' : tab === 'review' ? 'Find the next good lesson.' : 'Your learning collection.';
  return <div className="app"><aside className="sidebar"><Brand/><span className="nav-label">WORKSPACE</span><nav>{([['overview', 'grid', 'Overview'], ['review', 'inbox', 'Review queue'], ['library', 'play', 'Published library']] as const).map(([key, icon, label]) => <button key={key} className={tab === key ? 'nav-item active' : 'nav-item'} onClick={() => navigate(key)} aria-current={tab === key ? 'page' : undefined}><Icon name={icon}/>{label}{key === 'review' && !!totals.drafts && <span className="nav-count">{totals.drafts}</span>}</button>)}</nav><div className="sidebar-note"><Icon name="sparkle"/><strong>Discovery, on a rhythm.</strong><p>Search skills by default. Add optional keywords for focus. Repeat every three days.</p><span className="live-dot"/> YOUR PUBLISHING CHOICE</div><div className="account"><div className="avatar">{(session.user.email || 'A')[0].toUpperCase()}</div><div><strong>Administrator</strong><small>{session.user.email}</small></div><button aria-label="Sign out" title="Sign out" className="icon-button" onClick={() => void supabase!.auth.signOut().then(({ error: e }) => { if (e) setError(e.message); })}><Icon name="logout"/></button></div></aside>
    <main><header className="topbar"><span>Workspace <span className="slash">/</span> <strong>{tab === 'overview' ? 'Overview' : tab === 'review' ? 'Review queue' : 'Published library'}</strong></span><span className="workspace-badge"><span className="live-dot"/> FUSE ADMIN</span></header><div className="content"><div className="page-heading"><div><span className="eyebrow">CURATED WITH INTENTION</span><h1>{title}</h1><p>{tab === 'overview' ? 'Turn your community’s interests into their next small breakthrough.' : tab === 'review' ? 'Searches set to review mode send matching videos here for approval.' : 'Thoughtful videos, ready for the right person at the right time.'}</p></div><div className="heading-actions">{tab !== 'library' && <button className="primary" disabled={busy} onClick={() => { navigate('overview'); setTimeout(() => document.getElementById('keyword-search')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); }}><Icon name="sparkle" size={16}/>Search skills with AI</button>}<button className="secondary" onClick={() => setTick(v => v + 1)} disabled={loading || busy}>{loading ? 'Refreshing…' : 'Refresh'}</button></div></div>
      {tab === 'review' && <p className="discovery-help">Review-mode search results arrive here. Automatic-mode results go straight to the published library. {collecting && 'Discovery is running; this page refreshes automatically.'}</p>}
      {error && <div className="alert" role="alert">{error}<button onClick={() => setTick(v => v + 1)} disabled={busy}>Retry</button></div>}{notice && <div className="notice" role="status"><Icon name="check"/>{notice}</div>}
      {loading && !overview ? <div className="empty" role="status">Loading your workspace…</div> : overview && <>
        {tab === 'overview' ? <>
          <KeywordPanel skills={skills} refresh={tick} onChange={() => setTick(v => v + 1)}/>
          <section className="stats"><Stat label="SKILLS IN DEMAND" value={skills.filter(s => s.users > 0).length} detail="Selected by your community"/><Stat label="AWAITING YOUR EYE" value={totals.drafts} detail="Skill tags counted across drafts"/><Stat label="PUBLISHED SKILL LINKS" value={totals.published} detail="One video can cover several skills"/><Stat label="NEXT DISCOVERY" value={date(overview.schedule.next_collection_at)} detail="Automatic · every three days" compact/></section>
          <section className="discovery-banner"><div className="sparkle-box"><Icon name="sparkle" size={29}/></div><div><span className="eyebrow">YOUR DISCOVERY ASSISTANT</span><h2>Less searching. More thoughtful selection.</h2><p>Fresh YouTube candidates, organized around the skills your users choose.</p></div><button onClick={() => navigate('review')} className="banner-button">Review discoveries <Icon name="arrow"/></button></section>
          <section className="panel"><div className="section-heading"><div><h2>Follow their curiosity</h2><p>Start with the skills your community wants to learn.</p></div><span className="muted">{skills.length} predefined skills</span></div><div className="table-wrap"><table><thead><tr><th>SKILL</th><th>USER SELECTIONS</th><th>PUBLISHED</th><th>IN REVIEW</th><th>COVERAGE</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{skills.map((s, i) => <SkillRow key={s.id} skill={s} index={i} onReview={() => navigate('review', s.id)}/>)}</tbody></table></div>{!skills.length && <div className="empty">No predefined skills were found in the connected project.</div>}</section>
          <section className="panel runs"><div className="section-heading"><div><h2>Behind the discoveries</h2><p>Collection and metadata refresh activity.</p></div><Icon name="clock"/></div>{!activity.length ? <div className="empty">Choose skills and click Search now. Keywords are optional.</div> : activity.map(run => <div className="run" key={run.id}><div><strong>{run.kind === 'collection' ? 'Skill discovery' : 'Video metadata refresh'}</strong><small>{date(run.created_at)} · {run.cursor} / {run.total} batches processed</small>{run.results?.map((result, index) => <div className="run-result" key={index}><strong>{result.keyword}</strong>{result.source === 'skill' ? ' · Skill search' : ' · Keyword refinement'} · {result.published + result.drafted} / {result.target} new videos · {result.published} published · {result.drafted} awaiting review{result.error && ' · Failed'}</div>)}{run.errors.map(e => <div className="run-error" key={e.index}>{e.message}<button disabled={busy || activity.some(r => r.kind === run.kind && ['running','queued'].includes(r.status))} onClick={() => void action('retry', { run_id: run.id, index: e.index }, 'Failed batch queued for retry.')}>Retry batch {e.index + 1}</button></div>)}</div><span className={`badge ${run.status === 'completed' ? 'green' : run.status === 'partial' ? 'amber' : ''}`}>{run.status}</span></div>)}</section>
        </> : <>
          <div className="toolbar"><label className="filter">Skill <select value={skill} onChange={e => { setSkill(e.target.value); setPage(0); }} disabled={busy}><option value="">All skills</option>{skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><span className="muted">{videos.length} videos on this page</span>{tab === 'review' && <><label className="select-all"><input type="checkbox" checked={!!videos.length && selected.length === videos.length} onChange={e => setSelected(e.target.checked ? videos.map(v => v.id) : [])} disabled={busy || !videos.length}/> Select page</label><button className="primary" disabled={busy || !selected.length} onClick={() => void publish(selected)}>{busy ? 'Working…' : `Publish selected${selected.length ? ` (${selected.length})` : ''}`}</button></>}</div>
          {!videos.length ? <div className="empty empty-large"><Icon name={tab === 'review' ? 'sparkle' : 'play'} size={36}/><h2>{loading ? 'Loading videos…' : tab === 'review' ? 'Room for the next discovery.' : 'Your collection starts here.'}</h2><p>{tab === 'review' ? 'New candidates arrive after automatic collection. Approved videos move to the published library.' : 'Publish reviewed videos to make them available for matching recommendations.'}</p></div> : <div className="video-grid" aria-busy={loading}>{videos.map(v => <article className="video-card" key={v.id}><div className="thumbnail"><button onClick={() => setPreview(v)} aria-label={`Preview ${v.title}`}>{v.thumbnail_url ? <img src={v.thumbnail_url} alt="" loading="lazy"/> : <div className="thumbnail-placeholder"><Icon name="play" size={36}/></div>}<span className="play-overlay">▶</span></button>{v.duration_minutes && <span className="duration">{v.duration_minutes} min</span>}{tab === 'review' && <input aria-label={`Select ${v.title}`} type="checkbox" className="video-select" checked={selected.includes(v.id)} disabled={busy} onChange={e => setSelected(ids => e.target.checked ? [...ids, v.id] : ids.filter(id => id !== v.id))}/>}</div><div className="video-body"><div className="video-channel">{v.channel_title || 'YouTube'} {tab === 'library' && <span className={`badge ${v.is_active ? 'green' : ''}`}>{v.is_active ? 'Active' : 'Inactive'}</span>}</div><h2>{v.title}</h2><div className="tags">{v.topic_ids.map(id => <span key={id}>{skills.find(s => s.id === id)?.name || 'Unknown skill'}</span>)}</div>{v.reason && <p className="ai-reason"><Icon name="sparkle" size={14}/>{v.reason}</p>}<details><summary>Video description</summary><p className="description">{v.description || 'No description available.'}</p></details><div className="card-actions">{tab === 'review' ? <><button className="text-button" onClick={() => { setEditing(v); setTags(v.topic_ids); }} disabled={busy}>Edit skills</button><button className="text-button reject" onClick={() => void action('reject', { id: v.id }, 'Video rejected for its assigned skills.')} disabled={busy}>Reject</button><button className="primary" onClick={() => void publish([v.id])} disabled={busy || !v.topic_ids.length}>Publish <Icon name="arrow" size={16}/></button></> : <><button className="text-button" disabled={busy} onClick={() => void action('revise', { id: v.id }, 'Revision added to the review queue.')}>Revise skills</button>{v.is_active && <button className="text-button reject" disabled={busy} onClick={() => void action('deactivate', { id: v.id }, 'Video deactivated for future recommendations.')}>Deactivate</button>}</>}</div></div></article>)}</div>}
          <div className="pagination"><button className="secondary" disabled={page === 0 || loading || busy} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page + 1}</span><button className="secondary" disabled={videos.length < 50 || loading || busy} onClick={() => setPage(p => p + 1)}>Next</button></div>
        </>}
      </>}<footer>Thoughtfully collected. Personally matched.<span>FUSE STUDIO</span></footer></div></main>
    {editing && <Modal title="Choose matching skills" onClose={() => !busy && setEditing(null)}><p>Only users who select at least one of these skills will be eligible for this video.</p><div className="skill-picker">{skills.map(s => <label key={s.id}><input type="checkbox" checked={tags.includes(s.id)} disabled={busy} onChange={e => setTags(ids => e.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id))}/>{s.name}</label>)}</div><button className="primary" disabled={busy || !tags.length} onClick={() => void action('save_tags', { id: editing.id, topic_ids: tags }, 'Skill tags saved.')}>Save skills</button></Modal>}
    {preview && <Modal title={preview.title} onClose={() => setPreview(null)}><iframe title={preview.title} src={`https://www.youtube-nocookie.com/embed/${preview.youtube_video_id}`} allow="encrypted-media; picture-in-picture" allowFullScreen/><p>Preview supplied by YouTube. Some videos may require opening YouTube.</p><a className="text-button" href={`https://www.youtube.com/watch?v=${preview.youtube_video_id}`} target="_blank" rel="noreferrer">Open on YouTube ↗</a></Modal>}
  </div>;
}
function Stat({ label, value, detail, compact }: { label: string; value: number | string; detail: string; compact?: boolean }) { return <div className="stat"><span>{label}</span><strong className={compact ? 'compact' : ''}>{value}</strong><small>{detail}</small></div>; }
function SkillRow({ skill: s, index, onReview }: { skill: Skill; index: number; onReview: () => void }) { return <tr><td><span className={`skill-icon tone-${index % 4}`}>{s.name.slice(0, 2).toUpperCase()}</span><strong>{s.name}</strong></td><td><strong>{s.users}</strong><span className="demand-track"><span style={{ width: `${Math.max(5, Math.min(100, s.users * 5))}%` }}/></span></td><td>{s.published}</td><td>{s.drafts}</td><td><span className={`badge ${!s.users ? '' : s.published ? 'green' : 'amber'}`}>{!s.users ? 'No demand yet' : s.published ? 'Ready to recommend' : 'Needs discoveries'}</span></td><td><button className="text-button" onClick={onReview}>Review <Icon name="arrow" size={15}/></button></td></tr>; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}>✕</button></div>{children}</dialog>;
}
createRoot(document.getElementById('root')!).render(<App/>);
