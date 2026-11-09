import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deriveDecisions} from './decisions.js';
import {runTools} from '../server/tools.js';
test('sensor costs include blocked engineer delay',()=>{const d=deriveDecisions()[0];assert.deepEqual(d.tiers.map(t=>t.total),[31100,9450,1200]);assert.equal(d.rec.name,'Expedited');});
test('approval releases dependent booking',()=>{assert.equal(deriveDecisions().find(d=>d.id==='cham').kind,'wait');assert.notEqual(deriveDecisions(undefined,{sens:true}).find(d=>d.id==='cham').kind,'wait');});
test('working events wrap executed tools',async()=>{const events=[];await runTools(e=>events.push(e));assert.equal(events.length,9);assert.equal(events[1].result.items.length,2);assert.equal(events.at(-1).type,'run.completed');});
