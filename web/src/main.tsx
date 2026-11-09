import { render } from 'preact';
import { App } from './app';
import { startPrefs } from './lib/prefs';
import { startRouter } from './lib/router';
import { loadSnapshot } from './lib/snapshot';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles/main.css';

startPrefs();
startRouter();
void loadSnapshot().catch(() => undefined);
render(<App />, document.getElementById('app')!);
