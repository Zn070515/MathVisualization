/**
 * The one shell shared by everything.
 *
 * A single hairline-ruled header carrying the product name and the three
 * subsystem links, then the page. There is no ribbon, no permanent toolbar, no
 * object tree and no mode selector, because GOAL.md section 5.1 asks for the
 * default layout to stay conceptually "expressions | canvas".
 */
import { type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { SUBSYSTEMS } from '../subsystems';

export function AppShell({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="shell">
      <header className="shell__header">
        <Link to="/" className="shell__wordmark">
          MathVisualization
        </Link>
        <nav className="shell__nav" aria-label="Subsystems">
          {SUBSYSTEMS.map((subsystem) => (
            <NavLink
              key={subsystem.id}
              to={subsystem.path}
              className={({ isActive }) =>
                isActive ? 'shell__nav-link shell__nav-link--active' : 'shell__nav-link'
              }
            >
              <span className="shell__nav-index">{subsystem.index}</span>
              {subsystem.title}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="shell__main">{children}</main>
    </div>
  );
}
