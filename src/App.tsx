import { useEffect } from 'react';
import {
  BrowserRouter,
  Link,
  MemoryRouter,
  NavLink,
  Route,
  Routes,
  useLocation,
} from 'react-router';
import { purgeDeleted } from './data/repo';
import { ToastProvider } from './ui/components/Toast';
import { IconGear, IconList, IconSpark } from './ui/components/Icons';
import { UpdatePrompt } from './ui/components/UpdatePrompt';
import { useSettings } from './ui/hooks';
import { DoScreen } from './ui/screens/DoScreen';
import { DumpScreen } from './ui/screens/DumpScreen';
import { HomeScreen } from './ui/screens/HomeScreen';
import { PickScreen } from './ui/screens/PickScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { TaskScreen } from './ui/screens/TaskScreen';
import { TasksScreen } from './ui/screens/TasksScreen';

function Shell({ withUpdatePrompt }: { withUpdatePrompt: boolean }) {
  const location = useLocation();
  const settings = useSettings();
  const inDoMode = /\/do$/.test(location.pathname);

  useEffect(() => {
    document.documentElement.dataset.motion = settings.motion;
  }, [settings.motion]);

  useEffect(() => {
    void purgeDeleted().catch(() => {});
  }, []);

  // Move focus to the main heading on navigation so screen readers announce the new screen.
  // Screens that load data render their heading a moment later, so wait for it briefly.
  useEffect(() => {
    const focusHeading = () => {
      const h = document.querySelector<HTMLElement>('main h1');
      if (!h) return false;
      h.tabIndex = -1;
      h.focus({ preventScroll: true });
      return true;
    };
    if (focusHeading()) return;
    const main = document.querySelector('main');
    if (!main) return;
    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect();
    });
    observer.observe(main, { childList: true, subtree: true });
    const stop = setTimeout(() => observer.disconnect(), 2000);
    return () => {
      observer.disconnect();
      clearTimeout(stop);
    };
  }, [location.pathname]);

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="app-title">
          Task Unstucker
        </Link>
        <Link to="/settings" className="btn ghost icon" aria-label="Settings">
          <IconGear />
        </Link>
      </header>
      <main className={inDoMode ? 'full' : undefined}>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/task/:id" element={<TaskScreen />} />
          <Route path="/task/:id/do" element={<DoScreen />} />
          <Route path="/do" element={<DoScreen />} />
          <Route path="/tasks" element={<TasksScreen />} />
          <Route path="/pick" element={<PickScreen />} />
          <Route path="/dump" element={<DumpScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route
            path="*"
            element={
              <div className="stack">
                <h1>Nothing here</h1>
                <Link to="/" className="btn primary">
                  Go to start
                </Link>
              </div>
            }
          />
        </Routes>
      </main>
      {!inDoMode && (
        <nav className="bottom-nav" aria-label="Main">
          <NavLink to="/" end>
            <IconSpark /> Unstick
          </NavLink>
          <NavLink to="/tasks">
            <IconList /> Tasks
          </NavLink>
        </nav>
      )}
      {withUpdatePrompt && <UpdatePrompt />}
    </div>
  );
}

export function App({ withUpdatePrompt = true }: { withUpdatePrompt?: boolean }) {
  // The single-file preview runs inside a frame where URL paths don't work.
  const Router = import.meta.env.VITE_PREVIEW ? MemoryRouter : BrowserRouter;
  return (
    <Router>
      <ToastProvider>
        <Shell withUpdatePrompt={withUpdatePrompt} />
      </ToastProvider>
    </Router>
  );
}
