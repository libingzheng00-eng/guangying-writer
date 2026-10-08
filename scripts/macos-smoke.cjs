/** macOS packaged .app QA; modifies only a new independently identified temporary copy. */
const qa = require('./desktop-smoke.cjs');
if (require.main === module) qa.main('darwin').catch(error => { console.error(error); process.exitCode = 1; });
module.exports = qa;
