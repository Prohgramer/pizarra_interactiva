import { SessionProvider } from './hooks/useSession';
import { parseRoute, usePathname } from './lib/router';
import { BoardPage } from './pages/BoardPage';
import { CaseStudyPage } from './pages/CaseStudyPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
  return (
    <SessionProvider>
      <Screen />
    </SessionProvider>
  );
}

function Screen() {
  const route = parseRoute(usePathname());

  switch (route.page) {
    case 'home':
      return <HomePage />;
    case 'login':
      return <LoginPage />;
    case 'case':
      return <CaseStudyPage />;
    case 'board':
      // La key reinicia todo el estado (y el socket) al cambiar de sala.
      return <BoardPage key={route.roomId} roomId={route.roomId} />;
    case 'not-found':
      return <NotFoundPage />;
  }
}
