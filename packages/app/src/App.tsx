/**
 * Routing.
 *
 * Four routes, and the three subsystem routes are all the same component with a
 * different identifier. There is deliberately no per-subsystem shell, layout or
 * expression panel: a second copy of the shell is how three subsystems quietly
 * become three applications (GOAL.md 6, 23).
 */
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { HomePage } from './routes/HomePage';
import { SubsystemPage } from './routes/SubsystemPage';
import { AppShell } from './shell/AppShell';

export function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/complex" element={<SubsystemPage subsystem="complex" />} />
          <Route path="/transforms" element={<SubsystemPage subsystem="transforms" />} />
          <Route path="/calculus" element={<SubsystemPage subsystem="calculus" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
