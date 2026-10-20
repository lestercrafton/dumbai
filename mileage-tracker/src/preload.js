const { contextBridge, ipcRenderer } = require('electron');
const inv = n => (...a) => ipcRenderer.invoke(n, ...a);
contextBridge.exposeInMainWorld('api', {
  account: inv('account:get'), signIn: inv('account:signin'), signOut: inv('account:signout'),
  getTrips: inv('trips:get'), saveTrips: inv('trips:save'), tag: inv('trip:tag'),
  sendNow: inv('trip:sendNow'), queue: inv('trip:queue'), unqueue: inv('trip:unqueue'), preview: inv('email:preview'),
  vehicles: inv('vehicles:get'), saveVehicles: inv('vehicles:save'), addSimulated: inv('vehicles:addSimulated'),
  teslaConnect: inv('tesla:connect'), teslaAddCars: inv('tesla:addCars'),
  getSettings: inv('settings:get'), saveSettings: inv('settings:save'), importTeslaMate: inv('teslamate:import'),
  saveCsv: inv('csv:save'), savePdf: inv('pdf:save'), selftestTick: inv('selftest:tick'), selftestDone: inv('selftest:done'),
  onVehicle: cb => ipcRenderer.on('vehicle', (_, e) => cb(e)), onTripEnded: cb => ipcRenderer.on('trip-ended', (_, t) => cb(t)),
  onTripsChanged: cb => ipcRenderer.on('trips-changed', () => cb()),
});
