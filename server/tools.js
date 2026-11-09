import {decisions, deriveDecisions} from '../src/decisions.js';
export const tools = [
  {name:'read_project_work', execute:async () => ({items:decisions[0].chain})},
  {name:'check_hardware_calendar', execute:async () => ({milestone:decisions[0].milestone})},
  {name:'map_dependencies', execute:async () => ({engineers:decisions[0].blocked, decisions:deriveDecisions()})},
  {name:'check_policy', execute:async () => ({approvalLimit:500})},
];
export async function runTools(emit) {
  try {
    for (const [index, tool] of tools.entries()) {
      emit({type:'tool.started', index, name:tool.name});
      const result = await tool.execute();
      emit({type:'tool.completed', index, name:tool.name, result});
    }
    emit({type:'run.completed'});
  } catch(error) {emit({type:'run.failed',error:error.message});}
}
