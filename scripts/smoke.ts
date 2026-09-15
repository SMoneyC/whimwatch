/**
 * Live checks against wickedwhimsmod.com and wicked.cc using plain HTTP.
 * LoversLab and Patreon need a browser: run `npm run smoke:app` for those.
 */
import { createNodeFetcher } from '../src/core/fetcher.js';
import { runSmoke } from '../src/main/smoke.js';

const failures = await runSmoke(createNodeFetcher());
if (failures) process.exit(1);
