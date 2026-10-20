import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, AppState, Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';
import { promptFor, type Car, type Point } from './src/detector';
import * as DB from './src/db';
import * as API from './src/api';
import { setupNotifications, askPermission } from './src/notify';
import { startTracking, stopTracking, isTracking } from './src/background';

// Ovanova (OSC green) palette and type scale: #78BA89 from the style guide, #40804F from the logo
export const C = { brand: '#40804F', osc: '#78BA89', brandSoft: '#E8F4EB', ink: '#1B2430', muted: '#6B7280', line: '#E7E2DB', bg: '#F7F5F2', card: '#FFFFFF', ok: '#2F9E44', okSoft: '#E3F5E7', warn: '#B45309', warnSoft: '#FEF3C7' };
const T = { big: 34, title: 20, body: 16, small: 13 };
const TAP = 48;

type Tab = 'trips' | 'cars' | 'settings';
type Mode = 'send' | 'batch';
const TABS: { k: Tab; icon: string; label: string }[] = [{ k: 'trips', icon: '🚗', label: 'Trips' }, { k: 'cars', icon: '🔑', label: 'Cars' }, { k: 'settings', icon: '⚙️', label: 'Settings' }];
const STATUS: Record<string, [string, 'ok' | 'muted' | 'warn']> = {
  sent: ['Sent to Sugar', 'ok'], queued: ['In Friday batch', 'ok'], reimbursable: ['Ready to send', 'warn'], 'log only': ['Logged · company car', 'muted'],
  superseded: ['Counted by Tesla', 'muted'], personal: ['Personal', 'muted'], untagged: ['Untagged', 'warn'] };

export default function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => { API.getToken().then(t => setSignedIn(!!t)); }, []);
  if (signedIn === null) return <View style={[s.root, s.center]}><ActivityIndicator color={C.brand} /></View>;
  if (!signedIn) return <Welcome onDone={() => setSignedIn(true)} />;
  return <Main onSignedOut={() => setSignedIn(false)} />;
}

function Welcome({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  return (
    <SafeAreaView style={[s.root, s.welcome]}>
      <StatusBar style="light" />
      <View style={s.center}>
        <Image source={require('./assets/splash-icon.png')} style={{ width: 120, height: 120 }} />
        <Text style={s.wTitle}>Ovanova Moves</Text>
        <Text style={s.wSub}>Your drives, logged automatically.{'\n'}One tap to say business or personal.</Text>
      </View>
      <View style={{ gap: 12 }}>
        {!!err && <Text style={s.wErr}>{err}</Text>}
        <Pressable disabled={busy} style={({ pressed }) => [s.wBtn, pressed && { opacity: 0.85 }]} onPress={async () => {
          setBusy(true); setErr('');
          try { await API.signInWithGoogle(); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }}>
          {busy ? <ActivityIndicator color={C.brand} /> : <Text style={s.wBtnTxt}>Sign in with Google</Text>}
        </Pressable>
        <Text style={s.wFine}>We'll ask to send reimbursement emails from your Gmail and keep your mileage log in your Google Drive.</Text>
      </View>
    </SafeAreaView>);
}

function Main({ onSignedOut }: { onSignedOut: () => void }) {
  const [tab, setTab] = useState<Tab>('trips');
  const [trips, setTrips] = useState<DB.LocalTrip[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [lastCar, setLastCar] = useState<string | null>(null);
  const [mode, setModeState] = useState<Mode>('batch');
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const reload = useCallback(async () => { setTrips(await DB.trips()); setCars(await DB.cars()); setLastCar(await DB.getLastCarId()); setModeState(await DB.getKv<Mode>('businessMode', 'batch')); }, []);
  const syncNow = useCallback(async () => { try { const r = await API.sync(); if (r.sendError) setMsg('Email not sent: ' + r.sendError); else if (r.uploaded) setMsg(`Synced ${r.uploaded} trip${r.uploaded > 1 ? 's' : ''}`); }
    catch (e: any) { setMsg(e.message); } await reload(); }, [reload]);
  const setMode = (m: Mode) => { setModeState(m); DB.setKv('businessMode', m); };

  useEffect(() => { (async () => { await setupNotifications(); await reload(); API.pullCars().then(reload).catch(() => {}); syncNow(); })();
    const sub = Notifications.addNotificationResponseReceivedListener(r => onAction(String(r.notification.request.content.data?.clientId || ''), r.actionIdentifier));
    Notifications.getLastNotificationResponseAsync().then(r => r && onAction(String(r.notification.request.content.data?.clientId || ''), r.actionIdentifier));
    const st = AppState.addEventListener('change', x => { if (x === 'active') syncNow(); });
    return () => { sub.remove(); st.remove(); }; }, []);

  async function onAction(clientId: string, action: string) {
    const t = await DB.trip(clientId); if (!t) return;
    if (action === Notifications.DEFAULT_ACTION_IDENTIFIER) { setTab('trips'); setOpen(clientId); return; }
    if (t.synced) return;
    await answer(t, action as any, t.carId);
  }
  async function answer(t: DB.LocalTrip, action: 'send' | 'batch' | 'log' | 'personal', carId: string | null) {
    if (action !== 'personal' && !carId) { setOpen(t.clientId); setMsg(cars.length ? 'Pick the car for this trip' : 'Add your car in the Cars tab first'); return; }
    if (carId) await DB.setLastCarId(carId);
    await DB.saveTrip({ ...t, carId, category: action === 'personal' ? 'personal' : 'business', action: action === 'send' || action === 'batch' ? action : action === 'log' ? 'log' : null, synced: 0 });
    setOpen(null); await syncNow();
  }

  const pending = trips.filter(t => !t.category && !t.synced), done = trips.filter(t => !(!t.category && !t.synced));
  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar style="dark" />
      <View style={s.header}><Text style={s.hTitle}>{TABS.find(x => x.k === tab)!.label}</Text></View>
      {!!msg && <Pressable onPress={() => setMsg('')} style={s.toast}><Text style={s.toastTxt}>{msg}</Text></Pressable>}
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}>
        {tab === 'trips' && (trips.length ? <>
          {!!pending.length && <Text style={s.section}>Needs an answer</Text>}
          {pending.map(t => <TripCard key={t.clientId} t={t} cars={cars} lastCar={lastCar} mode={mode} setMode={setMode} open onAnswer={answer} />)}
          {!!done.length && <Text style={s.section}>Recent</Text>}
          {done.map(t => <TripCard key={t.clientId} t={t} cars={cars} lastCar={lastCar} mode={mode} setMode={setMode} open={open === t.clientId} onToggle={() => setOpen(open === t.clientId ? null : t.clientId)} onAnswer={answer} />)}
        </> : <Empty icon="🛣️" title="No drives yet" body={'Turn on automatic tracking in Settings, then just drive.\nWe’ll ask “business or personal?” when you park.'} action={{ label: 'Open Settings', onPress: () => setTab('settings') }} />)}
        {tab === 'cars' && <Cars cars={cars} onSave={async list => { try { setCars(await API.pushCars(list)); setMsg('Cars saved'); } catch (e: any) { await DB.replaceCars(list); setCars(list); setMsg('Saved on phone; will retry: ' + e.message); } }} />}
        {tab === 'settings' && <Settings onMsg={setMsg} onSignedOut={onSignedOut} />}
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={s.tabBar}>
        {TABS.map(x => <Pressable key={x.k} onPress={() => setTab(x.k)} style={s.tabItem} accessibilityRole="tab" accessibilityState={{ selected: tab === x.k }}>
          <Text style={[s.tabIcon, tab !== x.k && { opacity: 0.45 }]}>{x.icon}</Text>
          <Text style={[s.tabLabel, tab === x.k && { color: C.brand }]}>{x.label}</Text>
          {x.k === 'trips' && !!pending.length && <View style={s.badge}><Text style={s.badgeTxt}>{pending.length}</Text></View>}
        </Pressable>)}
      </SafeAreaView>
    </SafeAreaView>);
}

const fmt = (p: Point) => `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`;
async function placeName(p: Point) {
  try { const [a] = await Location.reverseGeocodeAsync({ latitude: p.lat, longitude: p.lon }); return a ? (a.name && a.street && !a.name.includes(a.street) ? a.name : a.street || a.district || a.city || fmt(p)) : fmt(p); } catch { return fmt(p); }
}
function useRoute(t: DB.LocalTrip) {
  const [route, setRoute] = useState(t.route || '');
  useEffect(() => { if (t.route || !t.startLoc || !t.endLoc) return; let live = true;
    (async () => { const r = `${await placeName(t.startLoc)} → ${await placeName(t.endLoc)}`; if (!live) return; setRoute(r); const cur = await DB.trip(t.clientId); if (cur) await DB.saveTrip({ ...cur, route: r }); })();
    return () => { live = false; }; }, [t.clientId]);
  return route;
}

function TripCard({ t, cars, lastCar, mode, setMode, open, onToggle, onAnswer }: { t: DB.LocalTrip; cars: Car[]; lastCar: string | null; mode: Mode; setMode: (m: Mode) => void; open: boolean; onToggle?: () => void; onAnswer: (t: DB.LocalTrip, a: any, carId: string | null) => void }) {
  const [carId, setCarId] = useState<string | null>(t.carId || lastCar || cars[0]?.id || null);
  useEffect(() => { if (!carId && (lastCar || cars[0])) setCarId(lastCar || cars[0].id); }, [lastCar, cars]);
  const car = cars.find(c => c.id === carId), p = promptFor(car), d = new Date(t.startTime), route = useRoute(t);
  const [label, tone] = t.serverStatus ? STATUS[t.serverStatus] || [t.serverStatus, 'muted'] : t.category ? ['Waiting to sync', 'muted'] : ['Business or personal?', 'warn'];
  const canAnswer = open && !t.synced;
  const businessAction = p.actions.includes('log') ? 'log' : mode;
  return (
    <View style={[s.card, !t.category && s.cardPending]}>
      <Pressable onPress={onToggle} disabled={!onToggle} style={s.tripTop}>
        <View style={{ flex: 1 }}>
          <Text style={s.when}>{d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · {d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
          {!!route && <Text style={s.route} numberOfLines={1}>{route}</Text>}
          <Pill tone={tone as any}>{label}{t.serverError ? ' · ' + t.serverError : ''}</Pill>
        </View>
        <View style={{ alignItems: 'flex-end' }}><Text style={s.miles}>{t.miles.toFixed(1)}</Text><Text style={s.unit}>mi · {t.durationMin} min</Text></View>
      </Pressable>
      {canAnswer && <View style={{ marginTop: 14, gap: 10 }}>
        {cars.length > 0 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {cars.map(c => <Pressable key={c.id} onPress={() => setCarId(c.id)} style={[s.chip, carId === c.id && s.chipOn]}>
            <Text style={[s.chipTxt, carId === c.id && { color: C.brand }]}>{c.name}{c.isTesla ? ' · Tesla' : c.ownership === 'business' ? ' · company' : ''}</Text></Pressable>)}
        </ScrollView> : <Text style={s.muted}>Add your car in the Cars tab to log business trips.</Text>}
        {car && !p.actions.includes('log') && <View style={s.seg}>
          {(['batch', 'send'] as Mode[]).map(m => <Pressable key={m} onPress={() => setMode(m)} style={[s.segItem, mode === m && s.segOn]}>
            <Text style={[s.segTxt, mode === m && { color: C.ink }]}>{m === 'batch' ? 'Friday batch' : 'Send now'}</Text></Pressable>)}
        </View>}
        {!!p.note && car && <Text style={s.muted}>{p.note}</Text>}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable style={({ pressed }) => [s.big, { backgroundColor: C.brand }, pressed && { opacity: 0.85 }]} onPress={() => onAnswer(t, businessAction, carId)}><Text style={s.bigTxt}>Business</Text></Pressable>
          <Pressable style={({ pressed }) => [s.big, s.bigAlt, pressed && { opacity: 0.85 }]} onPress={() => onAnswer(t, 'personal', carId)}><Text style={[s.bigTxt, { color: C.ink }]}>Personal</Text></Pressable>
        </View>
      </View>}
    </View>);
}

function Cars({ cars, onSave }: { cars: Car[]; onSave: (c: Car[]) => void }) {
  const [list, setList] = useState<Car[]>(cars); useEffect(() => setList(cars), [cars]);
  const upd = (i: number, p: Partial<Car>) => setList(list.map((c, j) => j === i ? { ...c, ...p } : c));
  const add = () => setList([...list, { id: 'car-' + Crypto.randomUUID().slice(0, 8), name: '', ownership: 'personal', isTesla: false }]);
  if (!list.length) return <Empty icon="🚙" title="Add your car" body="Tell us what you drive so business trips are counted the right way." action={{ label: 'Add a car', onPress: add }} />;
  return (<>
    {list.map((c, i) => <View key={c.id} style={s.card}>
      <TextInput style={s.input} value={c.name} placeholder="Name (e.g. F-150)" placeholderTextColor={C.muted} onChangeText={v => upd(i, { name: v })} />
      <TextInput style={[s.input, { marginTop: 8 }]} value={c.model || ''} placeholder="Model (optional)" placeholderTextColor={C.muted} onChangeText={v => upd(i, { model: v })} />
      <Row label="Company car" hint="Logged only, no reimbursement"><Switch trackColor={{ true: C.brand }} value={c.ownership === 'business'} onValueChange={v => upd(i, { ownership: v ? 'business' : 'personal' })} /></Row>
      <Row label="Tesla" hint="Miles come from the car, never counted twice"><Switch trackColor={{ true: C.brand }} value={c.isTesla} onValueChange={v => upd(i, { isTesla: v })} /></Row>
      <Pressable style={s.link} onPress={() => Alert.alert('Remove car?', c.name, [{ text: 'Cancel' }, { text: 'Remove', style: 'destructive', onPress: () => setList(list.filter((_, j) => j !== i)) }])}><Text style={[s.linkTxt, { color: '#C92A2A' }]}>Remove</Text></Pressable>
    </View>)}
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Btn alt title="Add car" onPress={add} /><Btn title="Save" onPress={() => onSave(list.filter(c => c.name.trim()))} />
    </View>
    <Text style={[s.muted, { textAlign: 'center' }]}>Personal car + business trip = reimbursed.</Text>
  </>);
}

function Settings({ onMsg, onSignedOut }: { onMsg: (m: string) => void; onSignedOut: () => void }) {
  const [tracking, setTracking] = useState(false), [me, setMe] = useState<API.Me | null>(null);
  const [to, setTo] = useState(''), [cc, setCc] = useState('');
  const load = async () => { try { const m = await API.me(); setMe(m); setTo(m.sugar); setCc(m.sugarCc || ''); } catch (e: any) { onMsg(e.message); } };
  useEffect(() => { isTracking().then(setTracking); load(); }, []);
  return (<>
    <View style={s.card}>
      <Row label="Automatic tracking" hint="Starts after a minute above 15 mph, ends after 4 minutes parked">
        <Switch trackColor={{ true: C.brand }} value={tracking} onValueChange={async v => {
          if (v) { await askPermission(); const err = await startTracking(); if (err) onMsg(err); } else await stopTracking(); setTracking(await isTracking()); }} /></Row>
    </View>
    {me && <View style={s.card}>
      <Text style={s.cardTitle}>{me.name}</Text><Text style={s.muted}>{me.email}</Text>
      <View style={{ gap: 6, marginTop: 10 }}>
        <Pill tone={me.emailReady ? 'ok' : 'warn'}>{me.emailVia === 'gmail' ? 'Emails send from your Gmail' : me.emailReady ? 'Emails send from the server' : 'Email permission missing — sign in again'}</Pill>
        <Pill tone={me.driveReady ? 'ok' : 'warn'}>{me.driveReady ? 'Log saved to Drive → Mileage logs' : 'Drive permission missing — sign in again'}</Pill>
      </View>
      <Text style={[s.muted, { marginTop: 10 }]}>Next Friday batch: {new Date(me.nextBatch).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text>
    </View>}
    {me && <View style={s.card}>
      <Text style={s.cardTitle}>Reimbursements go to</Text>
      <TextInput style={[s.input, { marginTop: 10 }]} autoCapitalize="none" keyboardType="email-address" value={to} onChangeText={setTo} placeholder="sugar@ovanova.co" placeholderTextColor={C.muted} />
      <TextInput style={[s.input, { marginTop: 8 }]} autoCapitalize="none" keyboardType="email-address" value={cc} onChangeText={setCc} placeholder="CC (optional)" placeholderTextColor={C.muted} />
      <View style={{ flexDirection: 'row', marginTop: 10 }}><Btn title="Save" onPress={async () => { try { const r = await API.saveRecipient(to, cc); setTo(r.sugar); setCc(r.sugarCc || ''); onMsg('Saved'); } catch (e: any) { onMsg(e.message); } }} /></View>
    </View>}
    <Pressable style={s.link} onPress={async () => { await API.signOut(); onSignedOut(); }}><Text style={s.linkTxt}>Sign out</Text></Pressable>
  </>);
}

const Btn = ({ title, onPress, alt }: { title: string; onPress: () => void; alt?: boolean }) =>
  <Pressable onPress={onPress} style={({ pressed }) => [s.btn, alt && s.bigAlt, pressed && { opacity: 0.85 }]}><Text style={[s.btnTxt, alt && { color: C.ink }]}>{title}</Text></Pressable>;
const Row = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) =>
  <View style={s.row}><View style={{ flex: 1, paddingRight: 12 }}><Text style={s.rowLabel}>{label}</Text>{!!hint && <Text style={s.muted}>{hint}</Text>}</View>{children}</View>;
const Pill = ({ tone, children }: { tone: 'ok' | 'muted' | 'warn'; children: ReactNode }) =>
  <View style={[s.pill, { backgroundColor: tone === 'ok' ? C.okSoft : tone === 'warn' ? C.warnSoft : '#EFEDEA' }]}><Text style={[s.pillTxt, { color: tone === 'ok' ? C.ok : tone === 'warn' ? C.warn : C.muted }]}>{children}</Text></View>;
const Empty = ({ icon, title, body, action }: { icon: string; title: string; body: string; action?: { label: string; onPress: () => void } }) =>
  <View style={s.empty}><Text style={{ fontSize: 48 }}>{icon}</Text><Text style={s.emptyTitle}>{title}</Text><Text style={[s.muted, { textAlign: 'center', fontSize: T.body }]}>{body}</Text>
    {action && <View style={{ flexDirection: 'row', marginTop: 8 }}><Btn title={action.label} onPress={action.onPress} /></View>}</View>;

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  welcome: { backgroundColor: C.brand, padding: 24 }, wTitle: { color: '#fff', fontSize: T.big, fontWeight: '800', marginTop: 20 },
  wSub: { color: '#E3F1E6', fontSize: T.body + 1, textAlign: 'center', marginTop: 10, lineHeight: 24 },
  wBtn: { backgroundColor: '#fff', borderRadius: 14, minHeight: 56, alignItems: 'center', justifyContent: 'center' }, wBtnTxt: { color: C.brand, fontSize: T.body + 1, fontWeight: '700' },
  wFine: { color: '#E3F1E6', fontSize: T.small, textAlign: 'center', lineHeight: 18 }, wErr: { color: '#fff', backgroundColor: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 10, textAlign: 'center' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }, hTitle: { fontSize: 30, fontWeight: '800', color: C.ink },
  toast: { marginHorizontal: 16, marginTop: 8, backgroundColor: C.ink, borderRadius: 12, padding: 12 }, toastTxt: { color: '#fff', fontSize: T.small + 1 },
  section: { fontSize: T.small, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 4 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.line }, cardPending: { borderColor: C.osc, borderWidth: 1.5 },
  cardTitle: { fontSize: T.title - 2, fontWeight: '700', color: C.ink },
  tripTop: { flexDirection: 'row', alignItems: 'flex-start' }, when: { fontSize: T.body, fontWeight: '600', color: C.ink }, route: { fontSize: T.small + 1, color: C.muted, marginTop: 2, marginBottom: 8 },
  miles: { fontSize: T.big, fontWeight: '800', color: C.ink, lineHeight: 38 }, unit: { fontSize: T.small, color: C.muted },
  pill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 6 }, pillTxt: { fontSize: T.small, fontWeight: '600' },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: C.line, justifyContent: 'center', backgroundColor: '#fff' },
  chipOn: { borderColor: C.brand, backgroundColor: C.brandSoft }, chipTxt: { fontSize: T.small + 1, fontWeight: '600', color: C.muted },
  seg: { flexDirection: 'row', backgroundColor: '#EFEDEA', borderRadius: 10, padding: 3, alignSelf: 'flex-start' }, segItem: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  segOn: { backgroundColor: '#fff' }, segTxt: { fontSize: T.small, fontWeight: '600', color: C.muted },
  big: { flex: 1, minHeight: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, bigAlt: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: C.line },
  bigTxt: { color: '#fff', fontSize: T.body + 2, fontWeight: '700' },
  btn: { flex: 1, minHeight: TAP, borderRadius: 12, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }, btnTxt: { color: '#fff', fontSize: T.body, fontWeight: '700' },
  input: { minHeight: TAP, backgroundColor: C.bg, borderRadius: 12, paddingHorizontal: 14, fontSize: T.body, color: C.ink },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: TAP, marginTop: 10 }, rowLabel: { fontSize: T.body, fontWeight: '600', color: C.ink },
  muted: { color: C.muted, fontSize: T.small + 1, marginTop: 2 }, link: { minHeight: TAP, alignItems: 'center', justifyContent: 'center' }, linkTxt: { color: C.muted, fontSize: T.body, fontWeight: '600' },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 48, paddingHorizontal: 24 }, emptyTitle: { fontSize: T.title + 2, fontWeight: '800', color: C.ink },
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderColor: C.line },
  tabItem: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingTop: 6 }, tabIcon: { fontSize: 22 }, tabLabel: { fontSize: 11, fontWeight: '600', color: C.muted, marginTop: 2 },
  badge: { position: 'absolute', top: 4, right: '30%', backgroundColor: C.brand, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }, badgeTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
