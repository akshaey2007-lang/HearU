import React from 'react';
import { createRoot } from 'react-dom/client';

import '../../app/globals.css';
import HearU from '../../app/page';
import './runtime';

const root = document.getElementById('root');
if (!root) throw new Error('HearU could not find its app container.');

createRoot(root).render(
  <React.StrictMode>
    <HearU />
  </React.StrictMode>,
);
