import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/patrick-hand/400.css';
import './styles.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró el elemento #root.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
