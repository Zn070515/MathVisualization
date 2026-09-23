import { manifestFor } from '../scenarioManifest.mjs';

const manifest = manifestFor('complex');

export default {
  ...manifest,
  description: 'poles, contour integration and accumulated integral trajectory',
  async run() {
    throw new Error('Complex scenario actions are implemented in a later recording task.');
  },
};
