import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as Crypto from 'expo-crypto';
import { promptFor, type Car } from './src/detector';
import * as DB from './src/db';
import * as API from './src/api';
import { setupNotifications, askPermission } from './src/notify';
import { startTracking, stopTracking, isTracking } from './src/background';

type Tab = 'trips' | 'cars' | 'settings';
const STATUS: Record<string, string> = { sent: 'Sent to Sugar', queued: 'In Friday batch', reimbursable: 'Ready to send', 'log only': 'Logged (company car)', superseded: 'Counted by Tesla', personal: 'Personal', untagged: 'Untagged' };

export default function App() {
  const [tab, setTab] = useState<Tab>('trips');
  const [trips, setTrips] = useState<DB.LocalTrip[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [lastCar, setLastCar] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const reload = useCallback(async () => { setTrips(await DB.trips()); setCars(await DB.cars()); setLastCar(await DB.getLastCarId()); }, []);
  const syncNow = useCallback(async () => { try { const r = await API.sync(); if (r.sendError) setMsg('Email not sent: ' + r.sendError); else if (r.uploaded) setMsg(`Synced ${r.uploaded} trip(s)`); }
    catch (e: any) { setMsg(e.message); } await reload(); }, [reload]);

  useEffect(() => { (async () => { await setupNotifications(); await reload(); API.pullCars().then(reload).catch(() => {}); syncNow(); })();
    const sub = Notifications.addNotificationResponseReceivedListener(r => onAction(String(r.notification.request.content.data?.clientId || ''), r.actionIdentifier));
    Notifications.getLastNotificationResponseAsync().then(r => r && onAction(String(r.notification.request.content.data?.clientId || ''), r.actionIdentifier));
    const st = AppState.addEventListener('change', s => { if (s === 'active') syncNow(); });
    return () => { sub.remove(); st.remove(); }; }, []);

  async function onAction(clientId: string, action: string) {
    const t = await DB.trip(clientId); if (!t) return;
    if (action === Notifications.DEFAULT_ACTION_IDENTIFIER) { setTab('trips'); setOpen(clientId); return; }
    if (t.synced) return; // already answered
    await answer(t, action as any, t.carId);
  }
  async function answer(t: DB.LocalTrip, action: 'send' | 'batch' | 'log' | 'personal', carId: string | null) {
    if (action !== 'personal' && !carId) { setOpen(t.clientId); setMsg('Pick the car for this trip'); return; }
    if (carId) await DB.setLastCarId(carId);
    await DB.saveTrip({ ...t, carId, category: action === 'personal' ? 'personal' : 'business', action: action === 'send' || action === 'batch' ? action : action === 'log' ? 'log' : null, synced: 0 });
    setOpen(null); await syncNow();
  }

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="dark" />
      <View style={s.tabs}>{(['trips', 'cars', 'settings'] as Tab[]).map(k => <Pressable key={k} onPress={() => setTab(k)} style={[s.tab, tab === k && s.tabOn]}><Text style={s.tabTxt}>{k[0].toUpperCase() + k.slice(1)}</Text></Pressable>)}</View>
      {!!msg && <Pressable onPress={() => setMsg('')}><Text style={s.msg}>{msg}</Text></Pressable>}
      <ScrollView contentContainerStyle={{ padding: 12 }}>
        {tab === 'trips' && (trips.length ? trips.map(t => <TripRow key={t.clientId} t={t} cars={cars} lastCar={lastCar} open={open === t.clientId} onOpen={() => setOpen(open === t.clientId ? null : t.clientId)} onAnswer={answer} />)
          : <Text style={s.muted}>No trips yet. Turn on tracking in Settings, then drive.</Text>)}
        {tab === 'cars' && <Cars cars={cars} onSave={async list => { try { setCars(await API.pushCars(list)); setMsg('Cars saved'); } catch (e: any) { await DB.replaceCars(list); setCars(list); setMsg('Saved on phone; will retry: ' + e.message); } }} />}
        {tab === 'settings' && <Settings onMsg={setMsg} onPaired={async () => { await API.pullCars().catch(() => {}); await reload(); }} />}
      </ScrollView>
    </SafeAreaView>
  );
}

function TripRow({ t, cars, lastCar, open, onOpen, onAnswer }: { t: DB.LocalTrip; cars: Car[]; lastCar: string | null; open: boolean; onOpen: () => void; onAnswer: (t: DB.LocalTrip, a: any, carId: string | null) => void }) {
  const [carId, setCarId] = useState<string | null>(t.carId || lastCar);
  const car = cars.find(c => c.id === carId), p = promptFor(car), d = new Date(t.startTime);
  const label = t.serverStatus ? STATUS[t.serverStatus] || t.serverStatus : t.category ? 'Waiting to sync' : 'Needs an answer';
  return (
    <View style={s.card}>
      <Pressable onPress={onOpen}><Text style={s.h}>{d.toLocaleDateString()} {d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {t.miles} mi · {t.durationMin} min</Text>
        <Text style={s.muted}>{label}{t.serverError ? ' · ' + t.serverError : ''}</Text></Pressable>
      {(open || !t.category) && !t.synced && <View>
        <Text style={s.label}>Car</Text>
        <View style={s.wrap}>{cars.map(c => <Pressable key={c.id} onPress={() => setCarId(c.id)} style={[s.chip, carId === c.id && s.chipOn]}><Text>{c.name}{c.isTesla ? ' (Tesla)' : c.ownership === 'business' ? ' (company)' : ''}</Text></Pressable>)}</View>
        {!cars.length && <Text style={s.muted}>Add your cars in the Cars tab.</Text>}
        {p.note && <Text style={s.muted}>{p.note}</Text>}
        <View style={s.wrap}>
          {p.actions.includes('send') && <Btn title="Business · Send now" onPress={() => onAnswer(t, 'send', carId)} />}
          {p.actions.includes('batch') && <Btn title="Business · Batch Friday" onPress={() => onAnswer(t, 'batch', carId)} />}
          {p.actions.includes('log') && <Btn title="Business (log)" onPress={() => onAnswer(t, 'log', carId)} />}
          <Btn title="Personal" onPress={() => onAnswer(t, 'personal', carId)} />
        </View></View>}
    </View>);
}

function Cars({ cars, onSave }: { cars: Car[]; onSave: (c: Car[]) => void }) {
  const [list, setList] = useState<Car[]>(cars); useEffect(() => setList(cars), [cars]);
  const upd = (i: number, p: Partial<Car>) => setList(list.map((c, j) => j === i ? { ...c, ...p } : c));
  return (<View>
    {list.map((c, i) => <View key={c.id} style={s.card}>
      <TextInput style={s.input} value={c.name} placeholder="Name (e.g. F-150)" onChangeText={v => upd(i, { name: v })} />
      <TextInput style={s.input} value={c.model || ''} placeholder="Model (optional)" onChangeText={v => upd(i, { model: v })} />
      <View style={s.rowB}><Text>Company (business) car</Text><Switch value={c.ownership === 'business'} onValueChange={v => upd(i, { ownership: v ? 'business' : 'personal' })} /></View>
      <View style={s.rowB}><Text>Tesla (tracked by the car)</Text><Switch value={c.isTesla} onValueChange={v => upd(i, { isTesla: v })} /></View>
      <Btn title="Remove" onPress={() => Alert.alert('Remove car?', c.name, [{ text: 'Cancel' }, { text: 'Remove', style: 'destructive', onPress: () => setList(list.filter((_, j) => j !== i)) }])} />
    </View>)}
    <View style={s.wrap}><Btn title="Add car" onPress={() => setList([...list, { id: 'car-' + Crypto.randomUUID().slice(0, 8), name: '', ownership: 'personal', isTesla: false }])} />
      <Btn title="Save" onPress={() => onSave(list.filter(c => c.name.trim()))} /></View>
    <Text style={s.muted}>Personal car + business trip = reimbursed. Company car = logged only. Tesla = the car's own log counts, so the phone trip is not counted twice.</Text>
  </View>);
}

function Settings({ onMsg, onPaired }: { onMsg: (m: string) => void; onPaired: () => void }) {
  const [server, setServer] = useState(API.DEFAULT_SERVER), [token, setTok] = useState(''), [tracking, setTracking] = useState(false), [me, setMe] = useState<API.Me | null>(null);
  useEffect(() => { API.getServer().then(setServer); isTracking().then(setTracking); API.me().then(setMe).catch(() => {}); }, []);
  return (<View>
    <Text style={s.label}>Server</Text><TextInput style={s.input} autoCapitalize="none" value={server} onChangeText={setServer} />
    <Text style={s.label}>Device token</Text><TextInput style={s.input} autoCapitalize="none" secureTextEntry placeholder="Paste the token you were given" value={token} onChangeText={setTok} />
    <Btn title="Pair phone" onPress={async () => { await API.setServer(server); if (token) await API.setToken(token);
      try { const m = await API.me(); setMe(m); onMsg('Paired as ' + m.email); onPaired(); } catch (e: any) { onMsg(e.message); } }} />
    {me && <Text style={s.muted}>{me.name} · {me.email}{'\n'}Reimbursements go to {me.sugar}. Next batch {new Date(me.nextBatch).toLocaleString()}.{'\n'}{me.emailReady ? 'Email ready' : 'Email not set up on the server yet'} · {me.driveReady ? 'Drive log on' : 'Drive log off'}</Text>}
    <View style={s.rowB}><Text style={s.h}>Automatic trip tracking</Text><Switch value={tracking} onValueChange={async v => {
      if (v) { await askPermission(); const err = await startTracking(); if (err) onMsg(err); } else await stopTracking(); setTracking(await isTracking()); }} /></View>
    <Text style={s.muted}>Uses location "Always". A trip starts after about a minute above 15 mph and ends after about 4 minutes stopped.</Text>
  </View>);
}

const Btn = ({ title, onPress }: { title: string; onPress: () => void }) => <Pressable onPress={onPress} style={s.btn}><Text style={s.btnTxt}>{title}</Text></Pressable>;
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f6f6f6' }, tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#ddd' }, tab: { flex: 1, padding: 12, alignItems: 'center' },
  tabOn: { borderBottomWidth: 3, borderColor: '#1a73e8' }, tabTxt: { fontWeight: '600' }, msg: { backgroundColor: '#fff3cd', padding: 10 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 10 }, h: { fontWeight: '600', fontSize: 16 }, muted: { color: '#666', marginTop: 4 },
  label: { marginTop: 10, fontWeight: '600' }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }, rowB: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 }, chipOn: { borderColor: '#1a73e8', backgroundColor: '#e8f0fe' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginTop: 6 },
  btn: { backgroundColor: '#1a73e8', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, marginTop: 6 }, btnTxt: { color: '#fff', fontWeight: '600' } });
