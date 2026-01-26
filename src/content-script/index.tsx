import React from 'react';
import ReactDOM from 'react-dom/client';
import OverlayApp from './overlayApp';
import '../styles.css';

function mount() {
  const containerId = 'bilibilidry-root';
  if (document.getElementById(containerId)) return;

  const container = document.createElement('div');
  container.id = containerId;
  document.documentElement.appendChild(container);
  ReactDOM.createRoot(container).render(<OverlayApp />);
}

mount();

