import { manifestFor } from '../scenarioManifest.mjs';

const manifest = manifestFor('transforms');
const skipReason = 'Fourier transform and frequency-domain view are planned.';

export default {
  ...manifest,
  skipReason,
  description: 'planned until the transform-domain vertical slice exists',
  run() {
    throw new Error(skipReason);
  },
};
