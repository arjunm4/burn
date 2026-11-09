import React from 'react';
import {api, streamRun} from './api.js';
import {DEFAULT_TEXT, applyToolEvent, buildConversation, needsRun} from './conversation.js';

const C = {ink: '#1C1B17', paper: '#F4F2F0', muted: '#7A766F', line: '#E2DFDA', hair: '#EFECE8'};
const requestIdFromPath = () => decodeURIComponent(location.pathname.match(/^\/request\/([^/]+)/)?.[1] || '');

export default class Engineer extends React.Component {
  state = {id: requestIdFromPath(), request: null, requests: [], recent: [], tools: [], running: false, pending: false, error: null, draft: DEFAULT_TEXT};
  mounted = false;

  componentDidMount() {
    this.mounted = true;
    window.addEventListener('popstate', this.onRoute);
    window.addEventListener('focus', this.refresh);
    this.poll = setInterval(this.refresh, 2000);
    this.load();
  }
  componentWillUnmount() {
    this.mounted = false;
    clearInterval(this.poll);
    window.removeEventListener('popstate', this.onRoute);
    window.removeEventListener('focus', this.refresh);
    this.controller?.abort();
  }
  onRoute = () => { this.controller?.abort(); this.setState({id: requestIdFromPath(), request: null, tools: [], running: false, error: null}, this.load); };
  go(id) { history.pushState(null, '', id ? `/request/${encodeURIComponent(id)}` : '/request'); this.onRoute(); }

  load = async () => {
    // A shared fetch started for the previous route resolves null; fetch again for this one.
    const request = (await this.refresh()) ?? (this.state.id ? await this.fetchState() : null);
    if (request && needsRun(request)) this.runAgent();
  };
  // Concurrent callers share one in-flight fetch so load() always sees a result.
  refresh = () => {
    if (!this.mounted) return Promise.resolve(null);
    if (!this.refreshing) this.refreshing = this.fetchState().finally(() => { this.refreshing = null; });
    return this.refreshing;
  };
  fetchState = async () => {
    try {
      const id = this.state.id;
      const {requests} = await api('/requests');
      // The route may have changed while this request was in flight.
      if (!this.mounted || this.state.id !== id) return null;
      const recent = requests.filter(r => r.text || r.id === 'sens').reverse();
      if (!id) { this.setState(s => ({recent, requests, ...(s.pollError ? {error: null, pollError: false} : {})})); return null; }
      const request = requests.find(r => r.id === id);
      if (!request) throw new Error('That request was not found.');
      await new Promise(resolve => this.setState(s => ({recent, requests, ...(s.pollError ? {error: null, pollError: false} : {}), request: s.request?.id === id && request.revision < s.request.revision ? s.request : request}), resolve));
      return request;
    } catch (error) { if (this.mounted) this.setState({error: error.message, pollError: true}); return null; }
  };

  async runAgent() {
    const id = this.state.id;
    if (this.state.running || !id) return;
    const controller = this.controller = new AbortController();
    const current = () => this.mounted && this.controller === controller && this.state.id === id;
    this.setState({running: true, tools: [], error: null});
    try {
      await streamRun(id, controller.signal, event => {
        if (!current()) return;
        this.setState(s => ({tools: applyToolEvent(s.tools, event), ...(event.request?.id === id ? {request: event.request} : {})}));
      });
    } catch (error) { if (current() && error.name !== 'AbortError') this.setState({error: error.message}); }
    if (!current()) return;
    this.setState({running: false});
    await this.refresh();
  }

  async create(event) {
    event.preventDefault();
    const text = this.state.draft.trim();
    if (!text || this.state.pending) return;
    this.setState({pending: true, error: null});
    try {
      const {request} = await api('/requests', {body: {text}});
      this.go(request.id);
    } catch (error) { this.setState({error: error.message}); }
    finally { if (this.mounted) this.setState({pending: false}); }
  }

  async dispatch(action) {
    const {request} = this.state;
    if (!action || this.state.pending || !request) return;
    this.setState({pending: true, error: null});
    try {
      const {request: next} = await api(`/requests/${encodeURIComponent(request.id)}/${action.type}`, {body: {...action.body, revision: request.revision}});
      if (this.mounted) this.setState({request: next});
      if (action.type === 'reset' && this.mounted) { this.setState({tools: []}); await this.runAgent(); }
    } catch (error) {
      if (error.status === 409) await this.refresh();
      if (this.mounted) this.setState({error: error.message});
    } finally { if (this.mounted) this.setState({pending: false}); }
  }

  renderComposer(compact) {
    const {draft, pending} = this.state;
    return <form onSubmit={e => this.create(e)} style={{display: 'flex', gap: 8, alignItems: 'flex-end', width: '100%'}}>
      <label style={{flex: 1, display: 'flex', flexDirection: 'column', gap: 6}}>
        {!compact && <span style={{color: C.muted, fontSize: 12}}>What do you need? Part, quantity, vendor and shipping.</span>}
        <textarea value={draft} rows={compact ? 1 : 2} maxLength={2000} onChange={e => this.setState({draft: e.target.value})}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) this.create(e); }}
          style={{font: 'inherit', fontSize: 13, resize: 'none', padding: '10px 14px', borderRadius: 14, border: `1px solid ${C.line}`, background: '#fff', color: C.ink}}/>
      </label>
      <button type="submit" disabled={pending || !draft.trim()} style={{background: C.ink, color: C.paper, border: `1px solid ${C.ink}`, borderRadius: 20, padding: '9px 16px', fontSize: 13, cursor: 'pointer'}}>Send</button>
    </form>;
  }

  renderStart() {
    const {recent} = this.state;
    const STATUS = {needs_answer: 'needs your answer', choosing: 'pick shipping', pending_approval: 'with Priya', ordered: 'draft PO', unsupported: 'no match', analyzing: 'working'};
    return <div style={{width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 24}}>
      <div style={{fontSize: 20, letterSpacing: '-.02em'}}>New purchase request</div>
      {this.renderComposer(false)}
      {recent.length > 0 && <div style={{display: 'flex', flexDirection: 'column'}}>
        <div style={{fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: C.muted, paddingBottom: 6}}>Your requests</div>
        {recent.map(r => <a key={r.id} href={`/request/${encodeURIComponent(r.id)}`} onClick={e => { e.preventDefault(); this.go(r.id); }}
          style={{display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderTop: `1px solid ${C.hair}`}}>
          <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{r.text || DEFAULT_TEXT}</span>
          <span style={{color: C.muted, whiteSpace: 'nowrap'}}>{r.pr} · {STATUS[r.status] || r.status}</span>
        </a>)}
      </div>}
    </div>;
  }

  renderConversation() {
    const {request, tools, running, pending} = this.state;
    const msgs = buildConversation(request, {tools, running, requests: this.state.requests});
    return <div style={{width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 12}}>
      {msgs.map((m, i) => <div key={i} style={{display: 'flex', flexDirection: 'column', gap: 6, alignItems: m.from === 'me' ? 'flex-end' : 'flex-start'}}>
        {m.text && <div style={{maxWidth: '82%', padding: '10px 14px', borderRadius: 14, lineHeight: 1.45, textWrap: 'pretty', ...(m.from === 'me' ? {background: C.ink, color: C.paper, border: `1px solid ${C.ink}`} : {background: '#fff', color: C.ink, border: `1px solid ${C.line}`})}}>{m.text}</div>}
        {m.work && <div aria-live="polite" style={{display: 'flex', flexDirection: 'column', gap: 5, padding: '4px 14px', fontSize: 12, color: C.muted}}>
          {m.work.map(w => <div key={w.index} style={{display: 'flex', gap: 10, alignItems: 'center'}}>
            <span style={{width: 6, height: 6, borderRadius: '50%', background: C.ink, opacity: w.done ? 1 : .4, animation: w.done ? 'none' : 'pulse 1s infinite'}}/>
            <span>{w.label}</span><span style={{color: C.ink}}>{w.summary}</span>
          </div>)}
        </div>}
        {m.rows && <div style={{width: '82%', border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff', overflow: 'hidden'}}>
          {m.rows.map((r, j) => {
            const Tag = r.action ? 'button' : 'div';
            return <Tag key={j} {...(r.action ? {type: 'button', disabled: pending, onClick: () => this.dispatch(r.action), 'data-option': ''} : {})}
              style={{display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12, width: '100%', textAlign: 'left', font: 'inherit', fontSize: 13, color: C.ink, padding: '9px 14px', border: 0, borderTop: j ? `1px solid ${C.hair}` : 0, background: r.selected ? C.paper : '#fff', cursor: r.action ? 'pointer' : 'default'}}>
              <span style={{display: 'flex', flexDirection: 'column', gap: 1}}>
                <span style={{display: 'flex', gap: 8, alignItems: 'baseline'}}><span>{r.name}</span>{r.tag && <span style={{fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted}}>{r.tag}</span>}</span>
                <span style={{color: C.muted, fontSize: 12}}>{r.detail}</span>
              </span>
              <span style={{textAlign: 'right', alignSelf: 'center'}}>{r.total}{r.action && <span style={{color: C.muted, marginLeft: 10}}>Choose →</span>}</span>
            </Tag>;
          })}
        </div>}
        {m.choices && <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
          {m.choices.map(c => <button key={c.label} disabled={pending} onClick={() => this.dispatch(c.action)} style={{background: '#fff', border: `1px solid ${C.ink}`, borderRadius: 20, padding: '7px 14px', fontSize: 13, cursor: 'pointer', color: C.ink}}>{c.label}</button>)}
        </div>}
        {(m.meta || m.status) && <span style={{fontSize: 11, color: C.muted, padding: '0 4px', display: 'flex', gap: 8, alignItems: 'center'}}>
          {m.status && <span style={{border: `1px solid ${C.ink}`, color: C.ink, borderRadius: 10, padding: '1px 7px'}}>{m.status}</span>}{m.meta}
        </span>}
        {m.compose && <div style={{width: '100%'}}>{this.renderComposer(true)}</div>}
      </div>)}
      {pending && <div style={{alignSelf: 'flex-start', padding: '10px 14px', borderRadius: 14, border: `1px solid ${C.line}`, background: '#fff', color: C.muted, letterSpacing: '.2em'}}>···</div>}
      {!running && !pending && <div style={{display: 'flex', justifyContent: 'center', gap: 20, marginTop: 20}}>
        <a href="/request" onClick={e => { e.preventDefault(); this.setState({draft: DEFAULT_TEXT}); this.go(''); }} style={{color: C.muted, fontSize: 12}}>New request</a>
        {request.id === 'sens' && ['ordered', 'pending_approval'].includes(request.status) && <button onClick={() => this.dispatch({type: 'reset', body: {}})} style={{background: 'transparent', border: 0, color: C.muted, fontSize: 12, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3}}>Restart demo</button>}
      </div>}
    </div>;
  }

  render() {
    const {id, request, error, running} = this.state;
    return <div style={{minHeight: '100vh', fontSize: 13, display: 'flex', flexDirection: 'column'}}>
      <header style={{display: 'flex', alignItems: 'center', gap: 18, padding: '14px 24px', borderBottom: `1px solid ${C.line}`}}>
        <span style={{fontSize: 16, letterSpacing: '.04em'}}>ramp</span>
        <span style={{color: C.muted}}>Procurement</span><span style={{color: '#C9C5BE'}}>/</span><span>{id ? request?.pr || '…' : 'New request'}</span>
        <a href="/approvals" style={{marginLeft: 'auto', color: C.muted, fontSize: 12}}>Approver →</a>
      </header>
      <main style={{flex: 1, display: 'grid', placeItems: 'start center', padding: '40px 24px 60px'}}>
        {error && <div role="alert" style={{width: '100%', maxWidth: 520, marginBottom: 16, color: C.ink}}>{error} <button onClick={() => (request && needsRun(request) && !running ? this.runAgent() : this.load())}>Retry</button></div>}
        {!id ? this.renderStart() : request ? this.renderConversation() : !error && <span style={{color: C.muted}}>Loading request…</span>}
      </main>
    </div>;
  }
}
