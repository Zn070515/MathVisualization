import { manifestFor } from '../scenarioManifest.mjs';

const manifest = manifestFor('calculus');

export default {
  ...manifest,
  description: 'Cartesian 3D surface, hover readout and parameter slider',
  async run() {
    throw new Error('Calculus scenario actions are implemented in a later recording task.');
  },
};
