/** The public demo routes and the vertical slices that are safe to record. */
export const DEMO_MANIFEST = Object.freeze([
  Object.freeze({ name: 'complex', route: '/complex', status: 'ready' }),
  Object.freeze({ name: 'transforms', route: '/transforms', status: 'planned' }),
  Object.freeze({ name: 'calculus', route: '/calculus', status: 'ready' }),
]);

export const DEMO_NAMES = Object.freeze(DEMO_MANIFEST.map((demo) => demo.name));

export function manifestFor(name) {
  const demo = DEMO_MANIFEST.find((candidate) => candidate.name === name);
  if (demo === undefined) throw new Error(`Unknown demo scenario: ${name}`);
  return demo;
}
