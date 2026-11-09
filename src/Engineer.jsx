import React from 'react';
import {decisions, deriveDecisions} from './decisions.js';
export default class Engineer extends React.Component {

  init = { phase: 'work', step: 0, answer: null, tier: null, typing: false };
  state = { ...this.init };
  componentDidMount() { this.runWork(); }
  componentWillUnmount() { this.controller?.abort(); }
  async runWork() {
    this.controller?.abort(); this.controller = new AbortController();
    try {
      const response = await fetch('/api/work', { signal: this.controller.signal });
      if (!response.ok) throw new Error('Agent backend unavailable');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      while (true) {
        const {value, done} = await reader.read(); if (done) break;
        buffer += decoder.decode(value, {stream:true}); let boundary;
        while ((boundary = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary+1);
          if (!line) continue; const event = JSON.parse(line);
          if (event.type === 'tool.completed') this.setState({step:event.index+1});
          if (event.type === 'run.completed') this.setState({phase:'ask'});
          if (event.type === 'run.failed') throw new Error(event.error);
        }
      }
    } catch(error) { if (error.name !== 'AbortError') this.setState({error:error.message}); }
  }
  think(next) { this.setState({typing:false, ...next}); }
  renderVals() {
    const { phase, step, answer, tier, typing } = this.state;
    const me = text => ({ align: 'flex-end', hasText: true, text, bg: '#1C1B17', color: '#F4F2F0', border: '#1C1B17' });
    const ai = (text, o = {}) => ({ align: 'flex-start', hasText: !!text, text, bg: '#fff', color: '#1C1B17', border: '#E2DFDA', hasWork: !!o.work, work: o.work || [], hasRows: !!o.rows, rows: o.rows || [], hasChoices: !!o.choices, choices: o.choices || [], hasMeta: !!o.meta, meta: o.meta });
    const row = (k, v, o = {}) => ({ k, v, tag: o.tag || '', vColor: o.muted ? '#7A766F' : '#1C1B17', bg: o.sel ? '#F4F2F0' : '#fff', cursor: o.pick ? 'pointer' : 'default', pick: o.pick || (() => {}) });
    const W = [['Reading #rev-c-bringup', '2 work items'], ['Checking hardware calendar', 'EVT build · Nov 14'], ['Mapping dependencies', '4 engineers'], ['Checking policy', '> $500 needs approval']];
    const work = W.slice(0, Math.max(1, step + (phase === 'work' ? 1 : 0))).slice(0, 4).map(([t, r], i) => { const done = i < step; return { t, r: done ? r : '', op: done ? 1 : .4, anim: done ? 'none' : 'pulse 1s infinite' }; });
    const sensor = deriveDecisions()[0];
    const option = i => { const t = sensor.tiers[i]; return '$' + t.price.toLocaleString('en-US') + ' · ' + (t.late ? t.late + 'd late' : 'on time') + ' · $' + t.total.toLocaleString('en-US'); };
    const msgs = [me('ACS37002 × 40 from Digi-Key, standard shipping.'), ai(null, { work })];
    if (phase !== 'work') {
      msgs.push(ai('Firmware validation and Thermal & EMC wait on these. Can firmware start on your Rev B boards?', phase === 'ask' ? { choices: [{ label: 'Yes', pick: () => { this.setState({ answer: 'yes', phase: 'wait' }); this.think({ phase: 'ok', tier: 'std' }); } }, { label: 'No, needs Rev C', pick: () => { this.setState({ answer: 'no', phase: 'wait' }); this.think({ phase: 'rec' }); } }] } : {}));
    }
    if (answer) msgs.push(me(answer === 'yes' ? 'Yes, Rev B works.' : 'No, needs Rev C.'));
    if (phase === 'ok') msgs.push(ai('Then EVT’s slack covers it. Ordered standard.', { rows: [row('Standard', '$300 · Nov 17', { tag: 'ordered' })], meta: 'No approval needed' }));
    if (['rec', 'sent', 'ordered'].includes(phase)) msgs.push(ai('Then standard puts 4 engineers 7 days behind.', {
      rows: [
        row('Standard', option(0), { muted: true, sel: tier === 'std', pick: phase === 'rec' ? () => this.pick('std') : null }),
        row('Priority', option(1), { muted: true, sel: tier === 'pri', pick: phase === 'rec' ? () => this.pick('pri') : null }),
        row('Expedited', option(2), { tag: 'rec', sel: tier === 'exp', pick: phase === 'rec' ? () => this.pick('exp') : null }),
      ], meta: 'Total = shipping + 4 engineers × $1,100/day',
    }));
    if (phase === 'sent') msgs.push(ai(tier === 'exp' ? 'Sent to Priya. I’ll order when she approves.' : `Sent to Priya with the ${tier === 'pri' ? '2' : '7'}-day slip flagged. I’ll order when she approves.`, { meta: tier === 'exp' ? 'Over $500 policy' : 'Deviates from recommendation' }));
    return { msgs, typing, canReset: ['ok', 'sent'].includes(phase), reset: () => {  this.setState({ ...this.init }); this.runWork(); } };
  }
  pick(t) { this.setState({ tier: t, phase: 'wait' }); this.think({ phase: 'sent' }); }
 render() { const {msgs, typing, canReset, reset} = this.renderVals(); return <>{this.state.error && <div role="alert">{this.state.error} <button onClick={() => this.runWork()}>Retry</button></div>}

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
                <div onClick={r.pick} style={{"display":"grid","gridTemplateColumns":"minmax(0,1fr) auto","gap":"12px","padding":"9px 14px","borderTop":"1px solid #EFECE8","background":r.bg,"cursor":r.cursor}}>
                  <span style={{"display":"flex","gap":"8px","alignItems":"baseline"}}><span>{r.k}</span><span style={{"fontSize":"10px","letterSpacing":".06em","textTransform":"uppercase","color":"#7A766F"}}>{r.tag}</span></span>
                  <span style={{"textAlign":"right","color":r.vColor}}>{r.v}</span>
                </div>
              </React.Fragment>)}
            </div>
          </>}
          {m.hasChoices && <>
            <div style={{"display":"flex","gap":"8px","flexWrap":"wrap"}}>
              {m.choices.map((c, index) => <React.Fragment key={index}><button onClick={c.pick} style={{"background":"#fff","border":"1px solid #1C1B17","borderRadius":"20px","padding":"7px 14px","fontSize":"13px","cursor":"pointer","color":"#1C1B17"}}>{c.label}</button></React.Fragment>)}
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
