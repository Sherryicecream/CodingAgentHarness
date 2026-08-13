import React from 'react';
import { createRoot } from 'react-dom/client';
import { StaticDemoApp } from './StaticDemoApp.js';
import './static-demo.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><StaticDemoApp /></React.StrictMode>);
