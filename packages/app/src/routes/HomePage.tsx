/**
 * The homepage.
 *
 * GOAL.md section 2 is specific about this page: it communicates the product,
 * routes into the three subsystems, and stays visually light. The three entries
 * are built from one loop over one list, so they cannot drift into a "main
 * feature" and two "secondary cards" — the equality is structural rather than a
 * matter of remembering to keep three blocks in step.
 */
import { Link } from 'react-router-dom';
import { SUBSYSTEMS, implementedCapabilities } from '../subsystems';
import { CONVENTIONS } from '@mathviz/mathcore';

export function HomePage(): React.JSX.Element {
  const conventions = Object.values(CONVENTIONS).slice(0, 4);

  return (
    <div className="home">
      <section className="home__intro">
        <p className="home__eyebrow">Expression first</p>
        <h1 className="home__title">
          Explore mathematics through expressions, structure, and linked visualizations.
        </h1>
        <p className="home__lede">
          Write the mathematics you want to understand. The system works out what kind of
          object it is, then offers the views and analyses that apply to it. Three areas, one
          mathematical core.
        </p>
      </section>

      <section className="home__entries" aria-label="Subsystems">
        {SUBSYSTEMS.map((subsystem) => (
          <Link key={subsystem.id} to={subsystem.path} className="entry">
            <span className="entry__index">{subsystem.index}</span>
            <h2 className="entry__title">{subsystem.title}</h2>
            <p className="entry__summary">{subsystem.summary}</p>
            <ul className="entry__examples">
              {subsystem.examples.slice(0, 3).map((example) => (
                <li key={example} className="entry__example">
                  {example}
                </li>
              ))}
            </ul>
            <p className="entry__enter">
              <span className="entry__enter-count">
                {implementedCapabilities(subsystem).length} of {subsystem.capabilities.length}{' '}
                capabilities implemented
              </span>
              <span className="entry__enter-arrow" aria-hidden="true">
                →
              </span>
            </p>
          </Link>
        ))}
      </section>

      <section className="home__conventions">
        <h2 className="home__section-title">Conventions</h2>
        <p className="home__lede">
          Where mathematics admits more than one convention, this project picks one, defines
          it in a single place and tests it. No view or subsystem chooses its own.
        </p>
        <dl className="convention-list">
          {conventions.map((convention) => (
            <div key={convention.name} className="convention">
              <dt className="convention__name">{convention.name}</dt>
              <dd className="convention__body">
                <span className="convention__definition">{convention.definition}</span>
                <span className="convention__note">{convention.note}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
