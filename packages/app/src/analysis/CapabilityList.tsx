/**
 * What this subsystem can and cannot do yet.
 *
 * Two lists, built from one source (`subsystems.ts`), with the unimplemented half
 * stated plainly. This is the honest counterpart to a toolbar: rather than offer
 * buttons that do not work, the interface names what exists and what is planned,
 * so nothing has to be faked and nothing is silently missing.
 */
import type { SubsystemDefinition } from '../subsystems';

export function CapabilityList({ subsystem }: { subsystem: SubsystemDefinition }): React.JSX.Element {
  const implemented = subsystem.capabilities.filter((capability) => capability.status === 'implemented');
  const planned = subsystem.capabilities.filter((capability) => capability.status === 'planned');

  return (
    <section className="capabilities" aria-label="Capabilities">
      <header className="capabilities__header">
        <h2 className="capabilities__title">{subsystem.title}</h2>
        <p className="capabilities__count">
          {implemented.length} implemented · {planned.length} planned
        </p>
      </header>

      <ul className="capabilities__list">
        {implemented.map((capability) => (
          <li key={capability.name} className="capability capability--implemented">
            <span className="capability__mark" aria-hidden="true">
              ●
            </span>
            <span className="capability__body">
              <span className="capability__name">{capability.name}</span>
              <span className="capability__summary">{capability.summary}</span>
            </span>
          </li>
        ))}
        {planned.map((capability) => (
          <li key={capability.name} className="capability capability--planned">
            <span className="capability__mark" aria-hidden="true">
              ○
            </span>
            <span className="capability__body">
              <span className="capability__name">{capability.name}</span>
              <span className="capability__summary">{capability.summary}</span>
            </span>
          </li>
        ))}
      </ul>

      <p className="capabilities__legend">
        <span aria-hidden="true">●</span> works today · <span aria-hidden="true">○</span> not
        implemented, and not approximated
      </p>
    </section>
  );
}
