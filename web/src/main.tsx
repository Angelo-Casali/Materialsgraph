import { render } from 'preact';
import { App } from './app';
import { startPrefs } from './lib/prefs';
import { startRouter } from './lib/router';
import { loadSnapshot } from './lib/snapshot';
import './styles/main.css';

startPrefs();
startRouter();
void loadSnapshot().catch(() => undefined);
render(<App />, document.getElementById('app')!);
