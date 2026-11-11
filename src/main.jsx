import React from 'react';
import {createRoot} from 'react-dom/client';
import Engineer from './Engineer.jsx';
import Approvals from './Approvals.jsx';
import Graph from './Graph.jsx';
import TimeValue from './timevalue/Card.jsx';
import './style.css';
createRoot(document.getElementById('root')).render(location.pathname === '/approvals' ? <Approvals/> : location.pathname === '/graph' ? <Graph/> : location.pathname === '/timevalue' ? <TimeValue/> : <Engineer/>);
