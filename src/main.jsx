import React from 'react';
import {createRoot} from 'react-dom/client';
import Orders from './Orders.jsx';
import Order from './Order.jsx';
import Graph from './Graph.jsx';
import Engineer from './Engineer.jsx';
import Approvals from './Approvals.jsx';
import Ramp from './Ramp.jsx';
import Inbox from './Inbox.jsx';
import TimeValue from './timevalue/Card.jsx';
import CompanyGraph from './timevalue/CompanyGraph.jsx';
import './style.css';

// Routes: /orders (part entry + list), /orders/:id (one order), /graph (dependencies), /ramp (the approver's simulated Ramp), /inbox (one person's messages).
// /request and /approvals are the pre-v9 prototype, kept until the new flow replaces them.
function route() {
  const p = location.pathname;
  const order = p.match(/^\/orders\/([A-Za-z0-9_-]+)$/);
  if (order) return <Order id={order[1]}/>;
  if (p === '/orders' || p === '/') return <Orders/>;
  if (p === '/graph') return <Graph/>;
  if (p === '/ramp') return <Ramp/>;
  if (p === '/inbox') return <Inbox/>;
  if (p === '/dependencies') return <CompanyGraph/>;
  if (p === '/timevalue') return <TimeValue/>; // Owen's Time Value card (precomputed demo cases)
  if (p === '/approvals') return <Approvals/>;
  return <Engineer/>;
}
createRoot(document.getElementById('root')).render(route());
