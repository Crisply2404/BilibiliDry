import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startHosts } from './hosts';

// The tree renders into the two Shadow DOM hosts through portals (see hosts.ts), so its own root
// container never needs to be in the page.
startHosts();
createRoot(document.createElement('div')).render(<App />);
