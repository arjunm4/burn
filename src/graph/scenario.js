// Maps shipping choices on open requests to part arrival dates for the graph engine.
import {arrivalDate} from '../decisions.js';

export const catalogOf = r => r.catalogId || r.id;
// The request that decides each part's arrival: an approved order wins, then a live request.
export function requestsByPart(requests) {
  const byPart = {};
  for (const r of requests) {
    const key = catalogOf(r), prev = byPart[key];
    if (!prev || (r.status === 'ordered' && prev.status !== 'ordered')) byPart[key] = r;
  }
  return byPart;
}
// What the world looks like today: an approved order, a choice awaiting approval, else what was asked for.
export const chosenTier = r => r.status === 'ordered' ? (r.approvedTier ?? r.selectedTier ?? 0) : r.status === 'pending_approval' && r.approvalReasons?.length ? r.selectedTier : (r.asked ?? 0);
export function defaultChoices(requests) {
  return Object.fromEntries(Object.entries(requestsByPart(requests)).map(([k, r]) => [k, chosenTier(r)]));
}
export function arrivalsFor(graph, requests, choices = {}, {fastest = false} = {}) {
  const byPart = requestsByPart(requests);
  const arrivals = {};
  for (const n of graph.nodes) {
    const r = n.kind === 'part' && byPart[n.attrs?.catalogId];
    if (!r || n.attrs?.end) continue; // bookings keep their calendar window
    const tiers = r.tiers || [];
    const i = fastest ? tiers.reduce((b, t, j) => (t.days < tiers[b].days ? j : b), 0) : (choices[n.attrs.catalogId] ?? chosenTier(r));
    if (tiers[i]) arrivals[n.id] = tiers[i].arrivesOn || arrivalDate(tiers[i].days);
  }
  return arrivals;
}
