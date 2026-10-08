/** Windows entry retained for existing CI and callers; shared QA uses the real packaged EXE. */
const qa = require('./desktop-smoke.cjs');
if (require.main === module) qa.main('win32').catch(error => { console.error(error); process.exitCode = 1; });
module.exports = qa;
