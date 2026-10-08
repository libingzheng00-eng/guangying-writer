/** Raw macOS startup of the unchanged .app, on an isolated hosted runner.
 * --app <candidate.app> --output <new-dir> [--manifest <build-manifest.json>]
 * Uses the Info.plist executable directly, never `open` or an installed user app.
 */
'use strict';
const { main } = require('./desktop-launch.cjs');
if (require.main === module) main('darwin').catch(error => { console.error(error); process.exitCode = 1; });
