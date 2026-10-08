/** Raw Windows startup of the unchanged distributable, on an isolated hosted runner.
 * --app <unpacked-app> --output <new-dir> [--manifest <build-manifest.json>]
 */
'use strict';
const { main, inventory } = require('./desktop-launch.cjs');
if (require.main === module) main('win32').catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { inventory };
