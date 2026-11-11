import React from 'react';
import {createRoot} from 'react-dom/client';
import Orders from './Orders.jsx';
import Order from './Order.jsx';
import Graph from './Graph.jsx';
import Ramp from './Ramp.jsx';
import Inbox from './Inbox.jsx';
import TimeValue from './timevalue/Card.jsx';
import CompanyGraph from './timevalue/CompanyGraph.jsx';
import NetworkGraph from './timevalue/NetworkGraph.jsx';
import DemoGuide from './DemoGuide.jsx';
import './style.css';

// Routes: /orders (part entry + list), /orders/:id (one order), /graph (dependencies), /ramp (the approver's simulated Ramp), /inbox (one person's messages).
// The pre-v9 prototype (/request, /approvals) is no longer routed.
function route() {
  const p = location.pathname;
  const order = p.match(/^\/orders\/([A-Za-z0-9_-]+)$/);
  if (order) return <Order id={order[1]}/>;
  if (p === '/') return <NetworkGraph/>; // the demo opens on the dependency graph
  if (p === '/orders') return <Orders/>;
  if (p === '/graph') return <Graph/>;
  if (p === '/ramp') return <Ramp/>;
  if (p === '/inbox') return <Inbox/>;
  if (p === '/network') return <NetworkGraph/>;
  if (p === '/dependencies') return <CompanyGraph/>;
  if (p === '/timevalue') return <TimeValue/>; // Owen's Time Value card (precomputed demo cases)
  return <Orders/>;
}
createRoot(document.getElementById('root')).render(<>{route()}<DemoGuide/></>);
