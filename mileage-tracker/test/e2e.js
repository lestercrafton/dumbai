// End-to-end: launches the real Electron app in simulated-car mode against the local SMTP catcher (no real email).
const { spawnSync } = require('child_process'), fs = require('fs'), path = require('path'), assert = require('assert');
const { startCatcher } = require('./smtp-catcher');
(async () => {
  const dir = '/tmp/mt-selftest'; fs.rmSync(dir, { recursive: true, force: true });
  const cat = await startCatcher(2525, path.join(dir, 'mail'));
  const env = { ...process.env, MT_SELFTEST: '1', MT_SIM_MS: '150', MT_DATA_DIR: dir, SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525', SMTP_FROM: 'lester@ovanova.co',
    MT_TEST_ACCOUNT: JSON.stringify({ sub: 'test-lester', email: 'lester@ovanova.co', name: 'Lester Crafton' }) };
  const electron = require('electron'), args = [electron, '.', '--no-sandbox'];
  const cmd = process.env.DISPLAY ? args : ['xvfb-run', '-a', ...args];
  const child = require('child_process').spawn(cmd[0], cmd.slice(1), { env, cwd: path.join(__dirname, '..'), stdio: 'ignore' });
  await new Promise(r => { child.on('exit', r); setTimeout(() => { child.kill(); r(); }, 120000); });
  await cat.close();
  const r = JSON.parse(fs.readFileSync(path.join(dir, 'selftest.json'), 'utf8')); console.log(JSON.stringify(r, null, 2));
  const checks = [
    ['app ran all steps', r.ok],
    ['Google account scope (test account)', r.account === 'lester@ovanova.co'],
    ['micro pre-configured', /^micro\/7SAYGDEE4RA246655/.test(r.defaultVehicle[0])],
    ['trip detected + prompt shown', !!r.promptShownFor],
    ['Send now delivered to catcher', /^Sent 1 trip/.test(r.sendNow) && cat.got.length === 1 && cat.got[0].to === 'sugar@ovanova.co'],
    ['real PDF + CSV attached', cat.got[0] && cat.got[0].attachments.some(a => a.contentType === 'application/pdf' && a.size > 1000) && cat.got[0].attachments.some(a => a.contentType === 'text/csv')],
    ['Sugar format', cat.got[0] && /^Mileage Reimbursement Request – .* Drive to HQ for the Friday team meeting Trip \(/.test(cat.got[0].subject) && cat.got[0].text.includes('**Odometer and calculation**')],
    ['Wait till end of week queued', r.queued === true],
    ['double submit refused', /already submitted/.test(r.doubleSubmit) && cat.got.length === 1],
    ['sent filter', r.sentRows === 1], ['per-vehicle filter', r.chrisRows === true],
    ['CSV + PDF export', fs.existsSync(r.csvPath) && fs.statSync(r.pdfPath).size > 1000],
    ['one notification per completed trip', r.notifications === r.storedCarTrips && r.notifications >= 3],
  ];
  let fail = 0; for (const [n, ok] of checks) { console.log((ok ? '  ✓ ' : '  ✗ ') + n); if (!ok) fail++; }
  console.log(`e2e: ${checks.length - fail} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
