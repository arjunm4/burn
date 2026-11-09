import React from 'react';
import {deriveDecisions} from './decisions.js';
import {api} from './api.js';
export default class Approvals extends React.Component {

  state = {sel:'sens', tier:{}, approved:{}, resolvedBy:{}, requests:null, pending:false, error:null};
  mounted = false;
  componentDidMount() {
    this.mounted = true;
    this.refresh();
    this.poll = setInterval(this.refresh, 2000);
    window.addEventListener('focus', this.refresh);
  }
  componentWillUnmount() {
    this.mounted = false;
    clearInterval(this.poll);
    window.removeEventListener('focus', this.refresh);
  }
  refresh = async () => {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const data = await api('/requests');
      if (this.mounted) this.setState(state => ({requests:data.requests.map(request => { const previous = state.requests?.find(r => r.id === request.id); return previous && previous.revision > request.revision ? previous : request; }), approved:data.approved, resolvedBy:data.resolvedBy}));
    } catch(error) { if (this.mounted) this.setState({error:error.message}); }
    finally { this.refreshing = false; }
  };
  async approve(request, tier) {
    if (this.state.pending) return;
    this.setState({pending:true, error:null});
    try {
      const {request: updated} = await api(`/requests/${encodeURIComponent(request.id)}/approve`, {body:{tier,revision:request.revision}});
      if (this.mounted) this.setState(state => ({requests:state.requests.map(r => r.id === updated.id ? updated : r)}));
      await this.refresh();
    } catch(error) {
      if (error.status === 409) await this.refresh();
      if (this.mounted) this.setState({error:error.message});
    } finally { if (this.mounted) this.setState({pending:false}); }
  }
  renderVals() {
    const st = this.state, fmt = n => '$' + Math.round(n).toLocaleString('en-US');
    const limit = this.props.autoApproveLimit ?? 500;
    const showHandled = this.props.showHandled ?? true;
    // Unmatched requests have nothing for an approver to decide.
    const raw = st.requests.filter(r => r.status !== 'unsupported');
    const list = deriveDecisions(raw, st.approved, limit).map(d => ({...d,
      kind: d.status === 'ordered' ? 'done' : ['analyzing','needs_answer','choosing','waiting','unsupported'].includes(d.status) ? 'wait' : d.status === 'pending_approval' ? 'need' : d.kind,
    }));
    const sel = list.find(d => d.id === st.sel) || list[0];
    const selTier = sel.tiers[sel.status === 'ordered' ? (sel.approvedTier ?? sel.selectedTier ?? sel.rec.i) : (st.tier[sel.id] ?? sel.selectedTier ?? sel.rec.i)];
    const asked = sel.tiers[sel.asked];
    const need = list.filter(d => d.kind === 'need'), wait = list.filter(d => d.kind === 'wait'), handled = list.filter(d => d.kind === 'auto' || d.kind === 'done');
    const row = d => ({
      part: d.part,
      line: d.kind === 'wait' ? `${d.project} · ${d.waitingOn ? 'after ' + d.waitingOn.part : 'awaiting engineer'}` : `${d.project} · ${d.blocked ? d.blocked + ' waiting' : 'nobody waiting'}`,
      amt: d.kind === 'wait' ? '—' : d.kind === 'done' ? `${d.tiers[d.approvedTier ?? d.selectedTier ?? d.rec.i].name}` : `${d.rec.name} · +${fmt(d.premium)}`,
      amt2: d.kind === 'done' ? 'draft PO created' : d.kind === 'wait' ? 'no recommendation yet' : st.resolvedBy[d.id] ? `resolved by ${st.resolvedBy[d.id]}` : d.avoided > 0 ? `avoids ${fmt(d.avoided)}${d.unknown ? ' · unverified' : ''}` : d.tiers[d.asked].i !== d.rec.i ? `asked ${d.tiers[d.asked].name.toLowerCase()}` : 'auto',
      amt2Color: st.resolvedBy[d.id] ? '#1C1B17' : '#7A766F',
      edge: d.id === sel.id ? '#1C1B17' : 'transparent', bg: d.id === sel.id ? '#fff' : 'transparent', select: () => this.setState({ sel: d.id }),
    });
    const sum = (arr, f) => arr.reduce((a, d) => a + f(d), 0);
    const groups = [
      { label: 'Need you', right: `${need.length} · +${fmt(sum(need, d => d.premium))} avoids ${fmt(sum(need, d => d.avoided))}`, items: need.map(row) },
      { label: 'Waiting on another decision', right: String(wait.length), items: wait.map(row) },
      ...(showHandled ? [{ label: 'Handled', right: `${handled.length} · +${fmt(sum(handled, d => d.premium))}`, items: handled.map(row) }] : []),
    ];
    const facts = [
      { k: 'Requested', v: `${asked.name} · ${sel.who}` },
      ...(sel.text ? [{ k: 'Asked as', v: `“${sel.text}”` }] : []),
      { k: 'Recommended', v: sel.kind === 'wait' ? '—' : `${sel.rec.name} · +${fmt(sel.premium)} over cheapest` },
      { k: 'Waiting', v: sel.blocked ? `${sel.blocked} engineers · ${sel.milestone}` : `Nobody · ${sel.milestone}` },
      { k: 'If cheapest', v: sel.cheapest.late ? `${sel.cheapest.late} days late · ${fmt(sel.cheapest.delay)} delay cost` : 'On time' },
      { k: 'Basis', v: sel.basis, hasLink: true, link: sel.link },
      ...(sel.unknown ? [{ k: 'Unverified', v: sel.unknown }] : []),
    ];
    const tiers = sel.tiers.map(t => ({ name: t.name, tag: t.i === sel.rec.i && t.i === sel.asked ? 'rec · requested' : t.i === sel.rec.i ? 'rec' : t.i === sel.asked ? 'requested' : '', arrives: t.late ? `${t.late}d late` : 'on time', lateColor: t.late ? '#1C1B17' : '#7A766F', total: fmt(t.total), bg: t.i === selTier.i ? '#F4F2F0' : 'transparent', select: () => { if (!st.pending && sel.kind === 'need') this.setState({tier:{...st.tier,[sel.id]:t.i}}); } }));
    const node = (label, sub, hit, kind) => ({ label, sub, arrow: true, bg: hit ? '#1C1B17' : kind === 'part' ? '#F4F2F0' : '#fff', color: hit ? '#F4F2F0' : '#1C1B17', border: hit || kind !== 'work' ? '#1C1B17' : '#E2DFDA' });
    const trace = [{ ...node(sel.part, selTier.late ? `${selTier.late}d late` : 'on time', false, 'part'), arrow: false },
      ...sel.chain.map(c => node(c, sel.blocked ? `${c === sel.chain[0] ? sel.chain0 : sel.chain1}` : 'no one', selTier.late > 0, 'work')),
      node(sel.milestone, selTier.late ? `slips ${selTier.late}d` : 'holds', selTier.late > 0, 'ms')];
    const VERB = { Expedited: 'Expedite', Priority: 'Ship priority', Standard: 'Ship standard', 'Current vendor': 'Keep current vendor', 'Second vendor': 'Switch to second vendor' };
    const verb = t => VERB[t] || `Book ${t.toLowerCase()}`;
    const status = sel.kind === 'done' ? `Approved · ${selTier.name} · Draft PO ${sel.order?.id || 'created'}` : sel.kind === 'auto' ? `Auto-approved · under ${fmt(limit)} and matches request` : sel.kind === 'wait' ? sel.waitingOn ? `Recommendation follows ${sel.waitingOn.part}` : 'Waiting for the engineer’s answer and shipping selection' : selTier.i !== sel.rec.i ? 'Overrides recommendation' : sel.approvalReasons?.length ? `Needs approval · ${sel.approvalReasons.map(r => ({over_limit: 'over $500', off_recommendation: 'requester picked another option'}[r] || r)).join(' · ')}` : '';
    return {
      needCount: need.length,
      hasTrace: sel.kind !== 'wait' && sel.chain.length > 0, traceTier: `if ${selTier.name.toLowerCase()}`, trace,
      groups,
      eyebrow: `${sel.pr} · ${sel.project}`, headline: sel.kind === 'wait' ? `Hold ${sel.part}` : `${verb(sel.rec.name)} · ${sel.part}`,
      facts, hasTiers: sel.tiers.length > 1 && sel.kind !== 'wait', tiers,
      showApprove: sel.kind === 'need', approve: () => this.approve(sel, selTier.i), approveLabel: `Approve ${selTier.name.toLowerCase()} · ${fmt(selTier.price)}`, requester: sel.who.split(' ')[0], status, engineerHref: `/request/${encodeURIComponent(sel.id)}`,
    };
  }
 render() { if (!this.state.requests?.length) return <main style={{padding:'40px 24px',fontSize:13}}>{this.state.error ? <div role="alert">{this.state.error} <button onClick={this.refresh}>Retry</button></div> : 'Loading approvals…'}</main>; const {needCount, hasTrace, traceTier, trace, groups, eyebrow, headline, facts, hasTiers, tiers, showApprove, approve, approveLabel, requester, status, engineerHref} = this.renderVals(); return <>{this.state.error && <div role="alert">{this.state.error} <button onClick={this.refresh}>Retry</button></div>}

<div data-q-root="1" style={{"minHeight":"100vh","fontSize":"13px","display":"flex","flexDirection":"column"}}>
  <header style={{"display":"flex","alignItems":"center","gap":"18px","padding":"14px 24px","borderBottom":"1px solid #E2DFDA"}}>
    <span style={{"fontSize":"16px","letterSpacing":".04em"}}>ramp</span>
    <span style={{"color":"#7A766F"}}>Procurement</span><span style={{"color":"#C9C5BE"}}>/</span><span>Decisions</span>
    <a href={engineerHref} style={{"marginLeft":"auto","color":"#7A766F","fontSize":"12px","textDecoration":"none"}}>Engineer side →</a>
    <span style={{"color":"#7A766F","fontSize":"12px"}}>Priya Nair</span>
  </header>
  <main data-q-main="1" style={{"display":"grid","gridTemplateColumns":"minmax(300px,400px) minmax(0,1fr)","flex":"1"}}>
    <section style={{"display":"flex","flexDirection":"column","paddingBottom":"24px"}}>
      <div style={{"padding":"20px 20px 12px","fontSize":"20px","letterSpacing":"-.02em"}}>{needCount} to approve</div>
      {groups.map((g, index) => <React.Fragment key={index}>
        <div style={{"display":"flex","justifyContent":"space-between","padding":"14px 20px 6px","fontSize":"11px","letterSpacing":".1em","textTransform":"uppercase","color":"#7A766F"}}><span>{g.label}</span><span>{g.right}</span></div>
        {g.items.map((d, index) => <React.Fragment key={index}>
          <button onClick={d.select} style={{"display":"grid","gridTemplateColumns":"minmax(0,1fr) auto","gap":"12px","alignItems":"center","textAlign":"left","padding":"9px 20px 9px 18px","border":"0","borderLeft":`2px solid ${d.edge}`,"background":d.bg,"cursor":"pointer","color":"#1C1B17","fontSize":"13px"}}>
            <span style={{"display":"flex","flexDirection":"column","gap":"1px","minWidth":"0"}}><span style={{"whiteSpace":"nowrap","overflow":"hidden","textOverflow":"ellipsis"}}>{d.part}</span><span style={{"color":"#7A766F","fontSize":"12px","whiteSpace":"nowrap","overflow":"hidden","textOverflow":"ellipsis"}}>{d.line}</span></span>
            <span style={{"display":"flex","flexDirection":"column","gap":"1px","alignItems":"flex-end","fontSize":"12px","whiteSpace":"nowrap"}}><span>{d.amt}</span><span style={{"color":d.amt2Color}}>{d.amt2}</span></span>
          </button>
        </React.Fragment>)}
      </React.Fragment>)}
    </section>

    <aside style={{"borderLeft":"1px solid #E2DFDA","background":"#fff","padding":"28px 32px 40px","display":"flex","flexDirection":"column","gap":"28px","minWidth":"0"}}>
      <div style={{"display":"flex","flexDirection":"column","gap":"6px"}}>
        <div style={{"fontSize":"11px","letterSpacing":".1em","textTransform":"uppercase","color":"#7A766F"}}>{eyebrow}</div>
        <div style={{"fontSize":"24px","letterSpacing":"-.02em","lineHeight":"1.15"}}>{headline}</div>
      </div>

      <div style={{"display":"grid","gridTemplateColumns":"max-content minmax(0,1fr)","columnGap":"28px","maxWidth":"560px"}}>
        {facts.map((f, index) => <React.Fragment key={index}>
          <span style={{"color":"#7A766F","padding":"9px 0","borderTop":"1px solid #EFECE8"}}>{f.k}</span>
          <span style={{"padding":"9px 0","borderTop":"1px solid #EFECE8","display":"flex","gap":"8px","alignItems":"baseline","flexWrap":"wrap"}}><span>{f.v}</span>{f.hasLink && <><a href="#" style={{"color":"#7A766F","fontSize":"12px"}}>{f.link}</a></>}</span>
        </React.Fragment>)}
      </div>

      {hasTrace && <>
      <div style={{"display":"flex","flexDirection":"column","gap":"10px","maxWidth":"560px"}}>
        <div style={{"display":"flex","justifyContent":"space-between","fontSize":"11px","letterSpacing":".1em","textTransform":"uppercase","color":"#7A766F"}}><span>Trace</span><span>{traceTier}</span></div>
        <div style={{"display":"flex","alignItems":"center","overflowX":"auto","paddingBottom":"4px"}}>
          {trace.map((n, index) => <React.Fragment key={index}>
            <span style={{"display":"flex","alignItems":"center"}}>
              {n.arrow && <><span style={{"width":"12px","height":"1px","background":"#C9C5BE","flexShrink":"0"}}></span></>}
              <span style={{"display":"flex","flexDirection":"column","padding":"5px 8px","borderRadius":"6px","border":`1px solid ${n.border}`,"background":n.bg,"color":n.color,"fontSize":"11px","lineHeight":"1.3"}}><span style={{"whiteSpace":"nowrap"}}>{n.label}</span><span style={{"opacity":".65","whiteSpace":"nowrap"}}>{n.sub}</span></span>
            </span>
          </React.Fragment>)}
        </div>
      </div>
      </>}

      {hasTiers && <>
      <div style={{"display":"flex","flexDirection":"column","maxWidth":"560px"}}>
        <div style={{"display":"grid","gridTemplateColumns":"minmax(0,1fr) 110px 110px","fontSize":"11px","letterSpacing":".1em","textTransform":"uppercase","color":"#7A766F","paddingBottom":"6px","borderBottom":"1px solid #E2DFDA"}}><span>Option</span><span style={{"textAlign":"right"}}>Arrives</span><span style={{"textAlign":"right"}}>Total cost</span></div>
        {tiers.map((t, index) => <React.Fragment key={index}>
          <div role="button" tabIndex={this.state.pending ? -1 : 0} onKeyDown={event => { if (event.key === 'Enter') t.select(); }} aria-disabled={this.state.pending || undefined} onClick={t.select} style={{"display":"grid","gridTemplateColumns":"minmax(0,1fr) 110px 110px","alignItems":"baseline","padding":"9px 8px","margin":"0 -8px","borderBottom":"1px solid #EFECE8","cursor":"pointer","background":t.bg,"borderRadius":"6px"}}>
            <span style={{"display":"flex","gap":"8px","alignItems":"center"}}><span>{t.name}</span><span style={{"color":"#7A766F","fontSize":"12px"}}>{t.tag}</span></span>
            <span style={{"textAlign":"right","color":t.lateColor}}>{t.arrives}</span>
            <span style={{"textAlign":"right"}}>{t.total}</span>
          </div>
        </React.Fragment>)}
      </div>
      </>}

      <div style={{"display":"flex","gap":"10px","alignItems":"center","flexWrap":"wrap"}}>
        {showApprove && <>
          <button disabled={this.state.pending} onClick={approve} style={{"background":"#E4F222","border":"1px solid #E4F222","borderRadius":"6px","padding":"10px 16px","fontSize":"14px","cursor":"pointer","color":"#1C1B17"}}>{approveLabel}</button>
          <a href={engineerHref} style={{"background":"#fff","border":"1px solid #E2DFDA","borderRadius":"6px","padding":"10px 14px","fontSize":"13px","cursor":"pointer","color":"#1C1B17","textDecoration":"none"}}>Open engineer chat</a>
        </>}
        <span style={{"color":"#7A766F","fontSize":"12px"}}>{status}</span>
      </div>
    </aside>
  </main>
</div>
</>; }
}
