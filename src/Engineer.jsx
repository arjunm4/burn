import React from 'react';
import {deriveDecisions} from './decisions.js';
import {api, streamRun} from './api.js';
export default class Engineer extends React.Component {

  state = { request: null, step: 0, working: true, pending: false, error: null };
  mounted = false;
  async componentDidMount() {
    this.mounted = true;
    window.addEventListener('focus', this.refresh);
    this.poll = setInterval(this.refresh, 2000);
    await this.initialize();
  }
  initialize = async () => {
    const request = await this.refresh();
    if (!this.mounted || !request) return;
    if (request.status === 'needs_answer') this.runWork();
    else this.setState({working:false, step:4});
  };
  componentWillUnmount() {
    this.mounted = false;
    clearInterval(this.poll);
    window.removeEventListener('focus', this.refresh);
    this.controller?.abort();
  }
  refresh = async () => {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const data = await api('/requests');
      const request = data.requests.find(r => r.id === 'sens');
      if (!request) throw new Error('The sensor request was not found.');
      if (this.mounted) await new Promise(resolve => this.setState(state => ({request: !state.request || request.revision >= state.request.revision ? request : state.request}), resolve));
      return request;
    } catch (error) { if (this.mounted) this.setState({error: error.message}); }
    finally { this.refreshing = false; }
  };
  async runWork() {
    if (this.running || !this.state.request) return;
    this.running = true;
    this.controller = new AbortController();
    this.setState({working: true, step: 0, error: null});
    try {
      await streamRun('sens', this.controller.signal, event => {
        if (!this.mounted) return;
        if (event.type === 'tool.completed') this.setState({step: event.index + 1});
        if (event.type === 'run.completed') this.setState({working: false});
      });
      await this.refresh();
    } catch (error) { if (this.mounted && error.name !== 'AbortError') this.setState({error: error.message}); }
    finally { this.running = false; }
  }
  async mutate(action, body = {}) {
    if (this.state.pending || !this.state.request) return;
    this.setState({pending: true, error: null});
    try {
      const {request} = await api(`/requests/sens/${action}`, {body: {...body, revision: this.state.request.revision}});
      if (this.mounted) await new Promise(resolve => this.setState({request}, resolve));
      if (action === 'reset' && this.mounted) await this.runWork();
    } catch (error) {
      if (error.status === 409) await this.refresh();
      if (this.mounted) this.setState({error: error.message});
    } finally { if (this.mounted) this.setState({pending: false}); }
  }
  renderVals() {
    const {request, step, working, pending} = this.state;
    const answer = request.answer;
    const phase = working && request.status === 'needs_answer' ? 'work' : ({needs_answer:'ask', choosing:'rec', pending_approval:'sent', ordered:'ordered'}[request.status] || 'work');
    const tier = request.selectedTier;
    const typing = pending;
    const me = text => ({ align: 'flex-end', hasText: true, text, bg: '#1C1B17', color: '#F4F2F0', border: '#1C1B17' });
    const ai = (text, o = {}) => ({ align: 'flex-start', hasText: !!text, text, bg: '#fff', color: '#1C1B17', border: '#E2DFDA', hasWork: !!o.work, work: o.work || [], hasRows: !!o.rows, rows: o.rows || [], hasChoices: !!o.choices, choices: o.choices || [], hasMeta: !!o.meta, meta: o.meta });
    const row = (k, v, o = {}) => ({ k, v, tag: o.tag || '', vColor: o.muted ? '#7A766F' : '#1C1B17', bg: o.sel ? '#F4F2F0' : '#fff', cursor: o.pick ? 'pointer' : 'default', pick: o.pick || (() => {}) });
    const W = [['Reading #rev-c-bringup', '2 work items'], ['Checking hardware calendar', 'EVT build · Nov 14'], ['Mapping dependencies', '4 engineers'], ['Checking policy', '> $500 needs approval']];
    const work = W.slice(0, Math.max(1, step + (phase === 'work' ? 1 : 0))).slice(0, 4).map(([t, r], i) => { const done = i < step; return { t, r: done ? r : '', op: done ? 1 : .4, anim: done ? 'none' : 'pulse 1s infinite' }; });
    const sensor = deriveDecisions([request], request.status === 'ordered' ? {sens:true} : {})[0];
    const option = i => { const t = sensor.tiers[i]; return '$' + t.price.toLocaleString('en-US') + ' · ' + (t.late ? t.late + 'd late' : 'on time') + ' · $' + t.total.toLocaleString('en-US'); };
    const msgs = [me('ACS37002 × 40 from Digi-Key, standard shipping.'), ai(null, { work })];
    if (phase !== 'work') {
      msgs.push(ai('Firmware validation and Thermal & EMC wait on these. Can firmware start on your Rev B boards?', phase === 'ask' ? { choices: [{ label: 'Yes', pick: () => this.mutate('answer', {answer:'yes'}) }, { label: 'No, needs Rev C', pick: () => this.mutate('answer', {answer:'no'}) }] } : {}));
    }
    if (answer) msgs.push(me(answer === 'yes' ? 'Yes, Rev B works.' : 'No, needs Rev C.'));
    if (answer === 'yes' && phase === 'ordered') msgs.push(ai('Then EVT’s slack covers it. Created a draft purchase order for standard shipping.', { rows: [row('Standard', '$300 · Nov 17', { tag: 'draft PO' })], meta: `No approval needed · ${request.order?.id || 'Draft order'}` }));
    if (answer === 'no' && ['rec', 'sent', 'ordered'].includes(phase)) msgs.push(ai('Then standard puts 4 engineers 7 days behind.', {
      rows: [
        row('Standard', option(0), { muted: true, sel: tier === 0, pick: phase === 'rec' ? () => this.mutate('select', {tier:0}) : null }),
        row('Priority', option(1), { muted: true, sel: tier === 1, pick: phase === 'rec' ? () => this.mutate('select', {tier:1}) : null }),
        row('Expedited', option(2), { tag: 'rec', sel: tier === 2, pick: phase === 'rec' ? () => this.mutate('select', {tier:2}) : null }),
      ], meta: 'Total = shipping + 4 engineers × $1,100/day',
    }));
    if (phase === 'sent') msgs.push(ai(tier === 2 ? 'Sent to Priya. I’ll create the draft purchase order when she approves.' : `Sent to Priya with the ${tier === 1 ? '2' : '7'}-day slip flagged. I’ll create the draft purchase order when she approves.`, { meta: tier === 2 ? 'Over $500 policy' : 'Deviates from recommendation' }));
    if (answer === 'no' && phase === 'ordered') msgs.push(ai(`Priya approved ${request.tiers[request.approvedTier ?? tier].name.toLowerCase()}. Draft purchase order created.`, {meta: request.order?.id || 'Draft order'}));
    return {msgs, typing, canReset: !pending && ['ordered', 'sent'].includes(phase), reset: () => this.mutate('reset')};
  }
 render() { if (!this.state.request) return <main style={{padding:'40px 24px',fontSize:13}}>{this.state.error ? <div role="alert">{this.state.error} <button onClick={this.initialize}>Retry</button></div> : 'Loading request…'}</main>; const {msgs, typing, canReset, reset} = this.renderVals(); return <>{this.state.error && <div role="alert">{this.state.error} <button onClick={() => this.state.request.status === 'needs_answer' ? this.runWork() : this.refresh()}>Retry</button></div>}

<div style={{"minHeight":"100vh","fontSize":"13px","display":"flex","flexDirection":"column"}}>
  <header style={{"display":"flex","alignItems":"center","gap":"18px","padding":"14px 24px","borderBottom":"1px solid #E2DFDA"}}>
    <span style={{"fontSize":"16px","letterSpacing":".04em"}}>ramp</span>
    <span style={{"color":"#7A766F"}}>Procurement</span><span style={{"color":"#C9C5BE"}}>/</span><span>PR-2291</span>
    <a href="/approvals" style={{"marginLeft":"auto","color":"#7A766F","fontSize":"12px"}}>Approver →</a>
  </header>
  <main style={{"flex":"1","display":"grid","placeItems":"start center","padding":"40px 24px 60px"}}>
    <div style={{"width":"100%","maxWidth":"520px","display":"flex","flexDirection":"column","gap":"12px"}}>
      {msgs.map((m, index) => <React.Fragment key={index}>
        <div style={{"display":"flex","flexDirection":"column","gap":"6px","alignItems":m.align}}>
          {m.hasText && <><div style={{"maxWidth":"82%","padding":"10px 14px","borderRadius":"14px","background":m.bg,"color":m.color,"border":`1px solid ${m.border}`,"lineHeight":"1.45","textWrap":"pretty"}}>{m.text}</div></>}
          {m.hasWork && <>
            <div style={{"display":"flex","flexDirection":"column","gap":"5px","padding":"4px 14px","fontSize":"12px","color":"#7A766F"}}>
              {m.work.map((w, index) => <React.Fragment key={index}><div style={{"display":"flex","gap":"10px","alignItems":"center"}}><span style={{"width":"6px","height":"6px","borderRadius":"50%","background":"#1C1B17","opacity":w.op,"animation":w.anim}}></span><span>{w.t}</span><span style={{"color":"#1C1B17"}}>{w.r}</span></div></React.Fragment>)}
            </div>
          </>}
          {m.hasRows && <>
            <div style={{"width":"82%","border":"1px solid #E2DFDA","borderRadius":"12px","background":"#fff","overflow":"hidden"}}>
              {m.rows.map((r, index) => <React.Fragment key={index}>
                <div role={r.cursor === 'pointer' ? 'button' : undefined} tabIndex={r.cursor === 'pointer' && !this.state.pending ? 0 : undefined} onKeyDown={event => { if (event.key === 'Enter' && !this.state.pending) r.pick(); }} aria-disabled={this.state.pending || undefined} onClick={this.state.pending ? undefined : r.pick} style={{"display":"grid","gridTemplateColumns":"minmax(0,1fr) auto","gap":"12px","padding":"9px 14px","borderTop":"1px solid #EFECE8","background":r.bg,"cursor":r.cursor}}>
                  <span style={{"display":"flex","gap":"8px","alignItems":"baseline"}}><span>{r.k}</span><span style={{"fontSize":"10px","letterSpacing":".06em","textTransform":"uppercase","color":"#7A766F"}}>{r.tag}</span></span>
                  <span style={{"textAlign":"right","color":r.vColor}}>{r.v}</span>
                </div>
              </React.Fragment>)}
            </div>
          </>}
          {m.hasChoices && <>
            <div style={{"display":"flex","gap":"8px","flexWrap":"wrap"}}>
              {m.choices.map((c, index) => <React.Fragment key={index}><button disabled={this.state.pending} onClick={c.pick} style={{"background":"#fff","border":"1px solid #1C1B17","borderRadius":"20px","padding":"7px 14px","fontSize":"13px","cursor":"pointer","color":"#1C1B17"}}>{c.label}</button></React.Fragment>)}
            </div>
          </>}
          {m.hasMeta && <><span style={{"fontSize":"11px","color":"#7A766F","padding":"0 4px"}}>{m.meta}</span></>}
        </div>
      </React.Fragment>)}
      {typing && <><div style={{"alignSelf":"flex-start","padding":"10px 14px","borderRadius":"14px","border":"1px solid #E2DFDA","background":"#fff","color":"#7A766F","letterSpacing":".2em"}}>···</div></>}
      {canReset && <><button onClick={reset} style={{"alignSelf":"center","marginTop":"20px","background":"transparent","border":"0","color":"#7A766F","fontSize":"12px","cursor":"pointer","textDecoration":"underline","textUnderlineOffset":"3px"}}>Restart demo</button></>}
    </div>
  </main>
</div>
</>; }
}
