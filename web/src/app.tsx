import { lazy, Suspense } from 'preact/compat';
import { Footer, Header } from './components/Chrome';
import { route } from './lib/router';
import { atlas, loadError } from './lib/snapshot';
import { AtlasView } from './views/Atlas';
import { NotFound } from './views/NotFound';

const Passport = lazy(() => import('./views/Passport').then((m) => ({ default: m.Passport })));
const Quests = lazy(() => import('./views/Quests').then((m) => ({ default: m.Quests })));
const Quest = lazy(() => import('./views/Quest').then((m) => ({ default: m.Quest })));
const Ask = lazy(() => import('./views/Ask').then((m) => ({ default: m.Ask })));
const How = lazy(() => import('./views/How').then((m) => ({ default: m.How })));
const About = lazy(() => import('./views/About').then((m) => ({ default: m.About })));

function Loading() {
  return (
    <div class="loading" role="status">
      <svg width="48" height="48" viewBox="0 0 64 64" aria-hidden="true" class="spin"><circle cx="32" cy="32" r="24" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="20 12" /></svg>
      <span>Unrolling the atlas…</span>
    </div>
  );
}

function Outlet() {
  const r = route.value;
  const a = atlas.value;
  if (loadError.value) return <div class="error-box" role="alert">{loadError.value}</div>;
  // How and About don't need the data
  if (r.name === 'how') return <How />;
  if (r.name === 'about') return <About />;
  if (!a) return <Loading />;
  switch (r.name) {
    case 'atlas': return <AtlasView atlas={a} query={r.query} />;
    case 'material': return <Passport atlas={a} materialKey={r.params.key} />;
    case 'quests': return <Quests atlas={a} />;
    case 'quest': return <Quest atlas={a} app={r.params.app} preselect={r.query.get('m')} />;
    case 'ask': return <Ask atlas={a} />;
    default: return <NotFound />;
  }
}

export function App() {
  return (
    <>
      <div class="sky" aria-hidden="true" />
      <Header />
      <main id="main" tabIndex={-1}>
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}
