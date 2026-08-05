import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const isEmbed = new URLSearchParams(window.location.search).get('embed') === '1';
if (isEmbed) {
  document.body.classList.add('embed-mode');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
