import {decisions, deriveDecisions} from '../src/decisions.js';
export const tools = [
  {name:'read_project_work', execute:async (request) => ({items:request.chain})},
  {name:'check_hardware_calendar', execute:async (request) => ({milestone:request.milestone})},
  {name:'map_dependencies', execute:async (request) => ({engineers:request.blocked, decisions:deriveDecisions([request])})},
  {name:'check_policy', execute:async () => ({approvalLimit:500})},
];
export async function runTools(emit, request=decisions[0]) {
  try {
    for (const [index, tool] of tools.entries()) {
      emit({type:'tool.started', index, name:tool.name});
      const result = await tool.execute(request);
      emit({type:'tool.completed', index, name:tool.name, result});
    }
    emit({type:'run.completed'});
  } catch(error) {emit({type:'run.failed',error:error.message});}
}
