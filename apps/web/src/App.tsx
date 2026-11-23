import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { NotFound } from '@/components/NotFound';
import { PrintPage } from '@/pages/PrintPage';
import { HomePage } from '@/pages/HomePage';
import { ProjectPage } from '@/pages/ProjectPage';
import { SettingsPage } from '@/pages/SettingsPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true } },
});

const router = createBrowserRouter([
  // the printable build plan has its own layout: no app chrome, sidebar or chat
  { path: '/projects/:id/print', element: <PrintPage /> },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'projects/:id', element: <ProjectPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFound title="Page not found" message="There is nothing at this address." /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
