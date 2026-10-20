const { app, BrowserWindow, ipcMain, shell, dialog, Notification } = require('electron');
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
const nodemailer = require('nodemailer');
const { FleetApi, FleetSource, Simulator, Poller, importTeslaMate } = require('./tesla');
const { AccountService } = require('./service');
const { googleSignIn } = require('./google');

const dataDir = process.env.MT_DATA_DIR || app.getPath('userData');
const appConfig = JSON.parse(fs.readFileSync(process.env.MT_APP_CONFIG || path.join(__dirname, '..', 'app-config.json'), 'utf8'));
const teslaApp = { ...appConfig.tesla, clientId: process.env.TESLA_CLIENT_ID || appConfig.tesla.clientId, tokenBroker: process.env.TESLA_TOKEN_BROKER || appConfig.tesla.tokenBroker };
const SELFTEST = !!process.env.MT_SELFTEST;
let win, svc = null, pollers = new Map(), notifications = 0;

async function renderPdf(html) {
  const w = new BrowserWindow({ show: false });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="font-family:Arial">${html}</body></html>`));
  const pdf = await w.webContents.printToPDF({}); w.destroy(); return pdf;
}
function openAccount(user) {
  stopAll();
  const dir = path.join(dataDir, 'accounts', user.sub.replace(/[^\w-]/g, '_'));
  svc = new AccountService({ dir, user, appConfig, renderPdf, transport: smtp => nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined, tls: smtp.host === '127.0.0.1' ? { rejectUnauthorized: false } : undefined }),
    notify: ({ to, vehicle, trip }) => { // push to the car's owner on this machine (each owner runs the app signed into their own account)
      notifications++;
      if (Notification.isSupported() && !SELFTEST) { const n = new Notification({ title: `${vehicle.name}: trip ended (${trip.miles} mi)`,
          body: `${to.name || ''} — was it a business trip? Send now or wait till end of week.` }); n.on('click', () => { win.show(); win.focus(); }); n.show(); }
      win && win.webContents.send('trip-ended', trip); } });
  fs.writeFileSync(path.join(dataDir, 'session.json'), JSON.stringify(user));
  startAll();
  // resume persisted queue on launch: if the Friday send was missed (app closed), it goes out now
  setTimeout(() => svc && svc.tick().then(r => r.length && win && win.webContents.send('trips-changed')).catch(e => win && win.webContents.send('vehicle', { event: 'error', vehicleName: 'Sugar email', message: e.message })), 3000);
  return user;
}
function saveLogin(vid) { return login => { const vs = svc.vehicles(), v = vs.find(x => x.id === vid); if (v) { v.teslaLogin = login; svc.saveVehicles(vs); } }; }
function startAll() {
  const ms = Number(process.env.MT_SIM_MS) || 2000;
  svc.vehicles().forEach((v, i) => {
    let src;
    if (v.source === 'simulator') src = new Simulator(10000 * (i + 1), Number(process.env.MT_SIM_DRIVE_TICKS) || 6);
    else if (v.teslaLogin && v.vin) src = new FleetSource(new FleetApi(teslaApp, v.teslaLogin, saveLogin(v.id)), v.vin);
    else return;
    const p = new Poller(src, e => {
      if (e.event === 'end') svc.onTripEnd(v, e.trip);
      win && win.webContents.send('vehicle', { ...e, vehicleId: v.id, vehicleName: v.name });
    }, v.source === 'simulator' ? ms : (v.pollSeconds || 60) * 1000);
    p.fastMs = v.source === 'simulator' ? ms : 10000; p.start(); pollers.set(v.id, p);
  });
}
function stopAll() { pollers.forEach(p => p.stop()); pollers.clear(); }
setInterval(() => svc && svc.tick().then(r => r.length && win && win.webContents.send('trips-changed')).catch(e => console.error('schedule', e.message)), 60000);

const need = () => { if (!svc) throw new Error('Sign in first'); return svc; };
const h = (n, f) => ipcMain.handle(n, (_, ...a) => f(...a));
h('account:get', () => svc && svc.user);
h('account:signin', async () => openAccount(process.env.MT_TEST_ACCOUNT ? JSON.parse(process.env.MT_TEST_ACCOUNT)
  : await googleSignIn({ clientId: process.env.GOOGLE_CLIENT_ID || appConfig.google.clientId, clientSecret: process.env.GOOGLE_CLIENT_SECRET || appConfig.google.clientSecret, open: u => shell.openExternal(u) })));
h('account:signout', () => { stopAll(); svc = null; fs.rmSync(path.join(dataDir, 'session.json'), { force: true }); return true; });
h('trips:get', () => need().trips());
h('trips:save', t => { need().saveTrips(t); return true; });
h('trip:tag', (id, c, p, r) => need().tag(id, c, p, r));
h('trip:sendNow', ids => need().send(ids, 'now'));
h('trip:queue', ids => need().queue(ids));
h('trip:unqueue', ids => need().unqueue(ids));
h('email:preview', async ids => { const m = await need().build(need().trips().filter(t => ids.includes(t.id)));
  return { to: m.recipients, from: m.from, subject: m.subject, text: m.text, attachments: m.attachments.map(a => a.filename) }; });
h('vehicles:get', () => need().vehicles().map(v => ({ ...v, teslaLogin: undefined, connected: !!(v.teslaLogin && v.teslaLogin.refreshToken) })));
h('vehicles:save', list => { const cur = need().vehicles(); need().saveVehicles(list.map(v => ({ ...v, teslaLogin: (cur.find(c => c.id === v.id) || {}).teslaLogin || null }))); stopAll(); startAll(); return true; });
h('vehicles:addSimulated', name => { const vs = need().vehicles(); const v = { id: 'sim' + Date.now(), name, owner: need().user.name, ownerEmail: need().user.email, model: 'Simulated Tesla', vin: 'SIM' + vs.length, source: 'simulator' };
  vs.push(v); need().saveVehicles(vs); stopAll(); startAll(); return v; });
// "Connect my Tesla": Tesla sign-in with PKCE on the shared app, then the user picks which car(s) to add.
h('tesla:connect', async () => {
  if (!teslaApp.clientId) throw new Error('This build has no Tesla app configured yet (admin: fill app-config.json tesla.clientId)');
  const login = {}, api = new FleetApi(teslaApp, login, () => {}), { verifier, challenge } = FleetApi.pkce(), state = crypto.randomBytes(12).toString('hex');
  const u = new URL(teslaApp.redirectUri);
  await new Promise((resolve, reject) => { const srv = http.createServer(async (req, res) => {
      const q = new URL(req.url, u.origin).searchParams; if (!q.get('code') && !q.get('error')) { res.end(); return; }
      try { if (q.get('error')) throw new Error(q.get('error')); if (q.get('state') !== state) throw new Error('state mismatch');
        await api.exchangeCode(q.get('code'), verifier); res.end('Tesla connected. Return to Mileage Tracker.'); resolve(); }
      catch (e) { res.end('Error: ' + e.message); reject(e); } finally { srv.close(); } });
    srv.listen(Number(u.port), '127.0.0.1', () => shell.openExternal(api.authorizeUrl(state, challenge))); setTimeout(() => { srv.close(); reject(new Error('Timed out')); }, 300000); });
  const cars = await api.vehicles(), key = crypto.randomBytes(8).toString('hex');
  pendingLogins.set(key, login); return { key, cars: cars.map(c => ({ vin: c.vin, name: c.display_name })) };
});
const pendingLogins = new Map();
h('tesla:addCars', (key, picks) => { const login = pendingLogins.get(key); if (!login) throw new Error('Connect again'); pendingLogins.delete(key);
  const vs = need().vehicles();
  for (const p of picks) { const ex = vs.find(v => v.vin === p.vin);
    if (ex) Object.assign(ex, { teslaLogin: login, source: 'fleet' });
    else vs.push({ id: 'v' + Date.now() + p.vin.slice(-4), name: p.name || p.vin, owner: need().user.name, ownerEmail: need().user.email, model: 'Tesla', vin: p.vin, source: 'fleet', teslaLogin: login }); }
  need().saveVehicles(vs); stopAll(); startAll(); return true; });
h('settings:get', () => { const s = need().settings(); return { ...s, smtp: { ...s.smtp, pass: s.smtp.pass ? '••••' : '' } }; });
h('settings:save', s => { need().saveSettings(s); return true; });
h('teslamate:import', async (url, since, vehicleId) => { const v = need().vehicles().find(x => x.id === vehicleId) || need().vehicles()[0];
  const got = await importTeslaMate(process.env.TESLAMATE_DATABASE_URL || url, since); return got.map(t => need().onTripEnd(v, t)).filter(Boolean).length; });
const savePath = async name => SELFTEST ? { filePath: path.join(dataDir, name) } : dialog.showSaveDialog(win, { defaultPath: name });
h('csv:save', async (name, csv) => { const r = await savePath(name); if (r.filePath) fs.writeFileSync(r.filePath, csv); return r.filePath || null; });
h('pdf:save', async name => { const r = await savePath(name); if (r.filePath) fs.writeFileSync(r.filePath, await win.webContents.printToPDF({})); return r.filePath || null; });
h('selftest:tick', () => need().tick());
h('selftest:done', result => { fs.writeFileSync(path.join(dataDir, 'selftest.json'), JSON.stringify({ ...result, notifications, storedCarTrips: svc ? svc.trips().filter(t => t.source === 'tesla').length : 0 }, null, 2)); app.quit(); });

app.whenReady().then(() => {
  fs.mkdirSync(dataDir, { recursive: true });
  try { openAccount(JSON.parse(fs.readFileSync(path.join(dataDir, 'session.json'), 'utf8'))); } catch {}
  win = new BrowserWindow({ width: 1250, height: 880, webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  win.loadFile(path.join(__dirname, 'index.html'), { query: SELFTEST ? { selftest: '1' } : {} });
});
app.on('window-all-closed', () => app.quit());
