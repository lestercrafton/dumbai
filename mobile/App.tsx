import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, AppState, Image, Keyboard, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { promptFor, type Car, type Point } from './src/detector';
import * as DB from './src/db';
import * as API from './src/api';
import { setupNotifications, askPermission, scheduleReviewReminder } from './src/notify';
import { startTracking, stopTracking, isTracking } from './src/background';

// Ovanova (OSC green) palette and type scale: #78BA89 from the style guide, #40804F from the logo
export const C = { brand: '#40804F', osc: '#78BA89', brandSoft: '#E8F4EB', ink: '#1B2430', muted: '#6B7280', line: '#E7E2DB', bg: '#F7F5F2', card: '#FFFFFF', ok: '#2F9E44', okSoft: '#E3F5E7', warn: '#B45309', warnSoft: '#FEF3C7' };
const T = { big: 34, title: 20, body: 16, small: 13 };
const TAP = 48;
// Light touch feedback; never let a haptics error break a tap.
const tap = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); };
const pick = () => { Haptics.selectionAsync().catch(() => {}); };
const done = () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); };
const press = ({ pressed }: { pressed: boolean }) => pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] };

type Tab = 'trips' | 'cars' | 'settings';
type Mode = 'send' | 'batch';
type Answer = 'send' | 'batch' | 'log' | 'personal';
const TABS: { k: Tab; icon: string; label: string }[] = [{ k: 'trips', icon: '🚗', label: 'Trips' }, { k: 'cars', icon: '🔑', label: 'Cars' }, { k: 'settings', icon: '⚙️', label: 'Settings' }];
const STATUS: Record<string, [string, 'ok' | 'muted' | 'warn']> = {
  sent: ['Sent to Sugar', 'ok'], queued: ['In Friday batch', 'ok'], reimbursable: ['Business · not sent yet', 'warn'], 'log only': ['Logged · company car', 'muted'],
  personal: ['Personal', 'muted'], untagged: ['Needs review', 'warn'] };

export default function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => { (async () => {
    const t = await API.getToken();
    // Older installs did not record who is signed in: ask the server once, so the right per-user data opens.
    if (t && !(await DB.currentUser())) { try { await DB.setCurrentUser((await API.me()).email); } catch {} }
    setSignedIn(!!t); })(); }, []);
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
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [selecting, setSelecting] = useState(false), [sel, setSel] = useState<string[]>([]);
  const carsRef = useRef<Car[]>([]); carsRef.current = cars;

  const reload = useCallback(async () => { const list = await DB.trips(); setTrips(list); setCars(await DB.cars()); setLastCar(await DB.getLastCarId());
    scheduleReviewReminder(list.filter(t => !t.category).length).catch(() => {}); }, []);
  const syncNow = useCallback(async () => { try { const r = await API.sync(); if (r.sendError) setMsg('Email not sent: ' + r.sendError); else if (r.uploaded) setMsg(`Synced ${r.uploaded} trip${r.uploaded > 1 ? 's' : ''}`); }
    catch (e: any) { setMsg(e.message); } await reload(); }, [reload]);

  useEffect(() => { (async () => { await setupNotifications(); await DB.migrateNoTesla().catch(() => {}); await reload(); API.pullCars().then(async list => { await reload(); if (new Set(list.map(DB.carKey)).size < list.length) await saveCars(list); }).catch(() => {}); syncNow(); })();
    const sub = Notifications.addNotificationResponseReceivedListener(r => onAction(String(r.notification.request.content.data?.clientId || ''), r.actionIdentifier));
    Notifications.getLastNotificationResponseAsync().then(r => r && onAction(String(r.notification.request.content.data?.clientId || ''), r.actionIdentifier));
    const st = AppState.addEventListener('change', x => { if (x === 'active') syncNow(); });
    return () => { sub.remove(); st.remove(); }; }, []);

  async function onAction(clientId: string, action: string) {
    const t = await DB.trip(clientId); if (!t) return;
    if (action === Notifications.DEFAULT_ACTION_IDENTIFIER) { setTab('trips'); setOpen(clientId); return; }
    if (t.synced) return;
    await answerMany([t.clientId], action as Answer, t.carId);
  }
  const answer = (t: DB.LocalTrip, action: Answer, carId: string | null) => answerMany([t.clientId], action, carId);
  // Applies one answer to one or many trips: updates the screen right away, saves each trip atomically, then syncs.
  async function answerMany(ids: string[], action: Answer, carId: string | null) {
    if (!ids.length) return;
    if (action !== 'personal' && !carId) { if (ids.length === 1) setOpen(ids[0]); setMsg(carsRef.current.length ? 'Pick the car first' : 'Add your car in the Cars tab first'); return; }
    done();
    const patch = { carId: carId ?? null, category: (action === 'personal' ? 'personal' : 'business') as DB.Category, action: (action === 'personal' ? null : action) as DB.Action, synced: 0 as const, serverStatus: null, serverError: null };
    setTrips(list => list.map(t => ids.includes(t.clientId) ? { ...t, ...patch, carId: patch.carId ?? t.carId } : t));
    setOpen(null); setSel([]); setSelecting(false);
    setMsg(`${ids.length > 1 ? ids.length + ' trips' : 'Trip'} marked ${action === 'personal' ? 'personal' : action === 'send' ? 'business · sending now' : action === 'batch' ? 'business · Friday batch' : 'business · logged'}`);
    if (carId) await DB.setLastCarId(carId);
    for (const id of ids) await DB.patchTrip(id, cur => cur.synced && cur.serverStatus === 'sent' ? null : { ...cur, ...patch, carId: patch.carId ?? cur.carId });
    await syncNow();
  }

  const pending = trips.filter(t => !t.category), answered = trips.filter(t => !!t.category);
  async function saveCars(raw: Car[]) {
          // Merge identical cars (same name + model) and move their trips to the one that stays.
          const list: Car[] = [], remap: Record<string, string> = {};
          for (const c of raw) { const c2 = { ...c, name: c.name.trim(), model: (c.model || '').trim() }; const dup = list.find(x => DB.carKey(x) === DB.carKey(c2)); if (dup) remap[c.id] = dup.id; else list.push(c2); }
          const merged = raw.filter(c => c.name.trim()).length - list.length;
          try { setCars(await API.pushCars(list)); setMsg(merged ? `Cars saved · merged ${merged} duplicate${merged > 1 ? 's' : ''}` : 'Cars saved'); }
          catch (e: any) { await DB.replaceCars(list); setCars(list); setMsg('Saved on phone; will retry: ' + e.message); }
          await DB.remapCars(remap); await reload(); }
  const toggleSel = (id: string) => { pick(); setSel(x => x.includes(id) ? x.filter(y => y !== id) : [...x, id]); };
  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar style="dark" />
      <View style={s.header}><Text style={s.hTitle}>{TABS.find(x => x.k === tab)!.label}</Text></View>
      {!!msg && <Pressable onPress={() => setMsg('')} style={s.toast} accessibilityLiveRegion="polite"><Text style={s.toastTxt}>{msg}</Text></Pressable>}
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12, flexGrow: 1 }}>
        <Pressable accessible={false} onPress={Keyboard.dismiss} style={{ gap: 12, flexGrow: 1 }}>
        {tab === 'trips' && (trips.length ? <>
          {!!pending.length && <View style={s.sectionRow}>
            <Text style={s.section}>Needs review · {pending.length}</Text>
            {pending.length > 1 && <Pressable hitSlop={10} onPress={() => { tap(); setSelecting(!selecting); setSel(selecting ? [] : pending.map(t => t.clientId)); }} style={press}>
              <Text style={s.sectionAction}>{selecting ? 'Cancel' : 'Review all at once'}</Text></Pressable>}
          </View>}
          {!!pending.length && !selecting && <Text style={s.muted}>Unanswered trips are never sent or reimbursed. They wait here until you choose.</Text>}
          {selecting && <BulkBar count={sel.length} total={pending.length} cars={cars} lastCar={lastCar} onAll={() => { pick(); setSel(sel.length === pending.length ? [] : pending.map(t => t.clientId)); }} onAnswer={(a, c) => answerMany(sel, a, c)} />}
          {pending.map(t => selecting
            ? <SelectRow key={t.clientId} t={t} on={sel.includes(t.clientId)} onPress={() => toggleSel(t.clientId)} />
            : <TripCard key={t.clientId} t={t} cars={cars} lastCar={lastCar} open onAnswer={answer} />)}
          {!!answered.length && <Text style={s.section}>Recent</Text>}
          {answered.map(t => <TripCard key={t.clientId} t={t} cars={cars} lastCar={lastCar} open={open === t.clientId} onToggle={() => { pick(); setOpen(open === t.clientId ? null : t.clientId); }} onAnswer={answer} />)}
        </> : <Empty icon="🛣️" title="No drives yet" body={'Turn on automatic tracking in Settings, then just drive.\nWe’ll ask “business or personal?” when you park.'} action={{ label: 'Open Settings', onPress: () => setTab('settings') }} />)}
        {tab === 'cars' && <Cars cars={cars} onSave={saveCars} />}
        {tab === 'settings' && <Settings onMsg={setMsg} onSignedOut={onSignedOut} />}
        </Pressable>
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={s.tabBar}>
        {TABS.map(x => <Pressable key={x.k} onPress={() => { if (tab !== x.k) pick(); setTab(x.k); }} style={({ pressed }) => [s.tabItem, pressed && { opacity: 0.6 }]} accessibilityRole="tab" accessibilityState={{ selected: tab === x.k }}>
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
    (async () => { const r = `${await placeName(t.startLoc)} → ${await placeName(t.endLoc)}`; if (!live) return; setRoute(r); await DB.patchTrip(t.clientId, cur => cur.route ? null : { ...cur, route: r }); })();
    return () => { live = false; }; }, [t.clientId]);
  return route;
}

// Trip card. Hero: date + miles. Unanswered: one calm question. Answered: a quiet summary with a "Change" link.
function TripCard({ t, cars, open, onToggle, onAnswer }: { t: DB.LocalTrip; cars: Car[]; lastCar?: string | null; open: boolean; onToggle?: () => void; onAnswer: (t: DB.LocalTrip, a: Answer, carId: string | null) => void }) {
  const d = new Date(t.startTime), route = useRoute(t), answered = !!t.category, locked = t.serverStatus === 'sent';
  const car = t.category === 'business' ? cars.find(c => c.id === t.carId) : undefined; // only a car the driver picked
  const editing = !answered || (open && !locked);
  return (
    <View style={[s.card, !answered && s.cardPending]}>
      <View style={s.tripTop}>
        <View style={{ flex: 1 }}>
          <Text style={s.when}>{d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
          <Text style={s.time}>{d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {t.durationMin} min</Text>
        </View>
        <Text style={s.miles}>{t.miles.toFixed(1)}<Text style={s.unit}> mi</Text></Text>
      </View>
      {!!route && <Text style={s.route} numberOfLines={1}>{route}</Text>}
      {answered && <View style={s.summary}>
        <Summary t={t} car={car} />
        {!locked && onToggle && <Pressable hitSlop={12} onPress={onToggle} style={press}><Text style={s.linkSmall}>{open ? 'Done' : 'Change'}</Text></Pressable>}
      </View>}
      {editing && <AnswerFlow cars={cars} initial={answered ? t : undefined} onAnswer={(a, c) => onAnswer(t, a, c)} />}
    </View>);
}
function Summary({ t, car }: { t: DB.LocalTrip; car?: Car }) {
  const label = t.category === 'personal' ? 'Personal' : t.serverStatus === 'sent' ? 'Sent for reimbursement' : t.action === 'send' ? 'Sending now' : t.action === 'batch' ? 'Friday batch' : 'Business · logged';
  const tone = t.category === 'personal' ? C.muted : C.brand;
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, flexWrap: 'wrap' }}>
    <View style={[s.dot, { backgroundColor: tone }]} /><Text style={[s.sumTxt, { color: t.category === 'personal' ? C.ink : C.brand }]}>{t.category === 'business' ? 'Business' : 'Personal'}</Text>
    {t.category === 'business' && <Text style={s.sumMeta}>{label}</Text>}
    {car && <View style={s.carTag}><Text style={s.carTagTxt}>{car.name}</Text></View>}
    {!!t.serverError && <Text style={[s.sumMeta, { color: C.warn }]}>{t.serverError}</Text>}
  </View>;
}

// Step 1: Business or Personal. Step 2 (business only): which car. Step 3: send now / Friday batch only for a personal car;
// a company car just logs. Nothing is pre-picked, so a card never shows a guessed car.
function AnswerFlow({ cars, initial, onAnswer }: { cars: Car[]; initial?: DB.LocalTrip; onAnswer: (a: Answer, carId: string | null) => void }) {
  const [biz, setBiz] = useState(false), [carId, setCarId] = useState<string | null>(initial?.category === 'business' ? initial.carId : null);
  const car = cars.find(c => c.id === carId), company = car?.ownership === 'business';
  if (!biz) return <View style={s.actions}>
    <Choice primary title="Business" onPress={() => setBiz(true)} />
    <Choice title="Personal" onPress={() => onAnswer('personal', null)} />
  </View>;
  return <View style={{ marginTop: 16, gap: 12 }}>
    <Text style={s.ask}>Which car?</Text>
    {cars.length ? <View style={s.chips}>
      {cars.map(c => <Pressable key={c.id} onPress={() => { pick(); setCarId(c.id); }} accessibilityRole="radio" accessibilityState={{ selected: carId === c.id }}
        style={({ pressed }) => [s.chip, carId === c.id && s.chipOn, pressed && { opacity: 0.7 }]}>
        <Text style={[s.chipTxt, carId === c.id && s.chipTxtOn]}>{c.name}</Text></Pressable>)}
    </View> : <Text style={s.muted}>Add your car in the Cars tab first.</Text>}
    {car && (company
      ? <><Text style={s.muted}>Company car: logged, not reimbursed.</Text><View style={s.actions}><Choice primary title="Log trip" onPress={() => onAnswer('log', carId)} /></View></>
      : <View style={s.actions}>
          <Choice primary title="Friday batch" onPress={() => onAnswer('batch', carId)} />
          <Choice title="Send now" onPress={() => onAnswer('send', carId)} />
        </View>)}
    <Pressable hitSlop={10} onPress={() => { pick(); setBiz(false); }} style={({ pressed }) => [{ alignSelf: 'center', paddingVertical: 4 }, pressed && { opacity: 0.6 }]}><Text style={s.linkSmall}>Back</Text></Pressable>
  </View>;
}
const Choice = ({ title, onPress, primary }: { title: string; onPress: () => void; primary?: boolean }) =>
  <Pressable onPress={() => { tap(); onPress(); }} accessibilityRole="button"
    style={({ pressed }) => [s.big, primary ? s.bigPrimary : s.bigAlt, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
    <Text style={[s.bigTxt, !primary && { color: C.brand }]}>{title}</Text>
  </Pressable>;

function SelectRow({ t, on, onPress }: { t: DB.LocalTrip; on: boolean; onPress: () => void }) {
  const d = new Date(t.startTime), route = useRoute(t);
  return <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={({ pressed }) => [s.card, s.selRow, on && s.selOn, pressed && { opacity: 0.8 }]}>
    <View style={[s.box, on && s.boxOn]}>{on && <Text style={s.boxTick}>✓</Text>}</View>
    <View style={{ flex: 1 }}>
      <Text style={s.when}>{d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · {d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
      {!!route && <Text style={s.route} numberOfLines={1}>{route}</Text>}
    </View>
    <Text style={[s.miles, { fontSize: 22, lineHeight: 26 }]}>{t.miles.toFixed(1)} <Text style={s.unit}>mi</Text></Text>
  </Pressable>;
}
function BulkBar({ count, total, cars, onAll, onAnswer }: { count: number; total: number; cars: Car[]; lastCar?: string | null; onAll: () => void; onAnswer: (a: Answer, carId: string | null) => void }) {
  return <View style={[s.card, { borderColor: C.brand, borderWidth: 1.5 }]}>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={[s.cardTitle, { flex: 1 }]}>{count} of {total} selected</Text>
      <Pressable hitSlop={10} onPress={onAll} style={press}><Text style={s.sectionAction}>{count === total ? 'Select none' : 'Select all'}</Text></Pressable>
    </View>
    {count > 0 ? <AnswerFlow cars={cars} onAnswer={onAnswer} /> : <Text style={s.muted}>Tap trips below to select them.</Text>}
  </View>;
}

// Compact car list: one row per car (name, model, Personal/Company), tap Edit to rename, Remove to delete.
function Cars({ cars, onSave }: { cars: Car[]; onSave: (c: Car[]) => Promise<void> }) {
  const [list, setList] = useState<Car[]>(cars), [editing, setEditing] = useState<string | null>(null), [saving, setSaving] = useState(false);
  useEffect(() => setList(cars), [cars]);
  const dirty = JSON.stringify(list) !== JSON.stringify(cars);
  const upd = (id: string, p: Partial<Car>) => setList(l => l.map(c => c.id === id ? { ...c, ...p } : c));
  const add = () => { const id = 'car-' + Crypto.randomUUID().slice(0, 8); setList(l => [...l, { id, name: '', ownership: 'personal' }]); setEditing(id); };
  const remove = (c: Car) => Alert.alert('Remove car?', c.name || 'This car', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { done(); setList(l => l.filter(x => x.id !== c.id)); } }]);
  if (!list.length) return <Empty icon="🚙" title="Add your car" body="Tell us what you drive so business trips are counted the right way." action={{ label: 'Add a car', onPress: add }} />;
  return (<>
    <View style={[s.card, { paddingVertical: 4 }]}>
      {list.map((c, i) => <View key={c.id} style={[s.carRow, i > 0 && s.carRowLine]}>
        {editing === c.id ? <View style={{ gap: 8 }}>
          <TextInput returnKeyType="done" submitBehavior="blurAndSubmit" autoFocus style={s.input} value={c.name} placeholder="Name (e.g. Dodge Ram)" placeholderTextColor={C.muted} onChangeText={v => upd(c.id, { name: v })} />
          <TextInput returnKeyType="done" submitBehavior="blurAndSubmit" style={s.input} value={c.model || ''} placeholder="Model (optional)" placeholderTextColor={C.muted} onChangeText={v => upd(c.id, { model: v })} />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}><Pressable hitSlop={8} onPress={() => { pick(); setEditing(null); }} style={press}><Text style={s.sectionAction}>Done</Text></Pressable></View>
        </View> : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.6 }]} onPress={() => { pick(); setEditing(c.id); }}>
            <Text style={s.carName} numberOfLines={1}>{c.name || 'Unnamed car'}</Text>
            {!!c.model && <Text style={s.muted} numberOfLines={1}>{c.model}</Text>}
          </Pressable>
          <Pressable hitSlop={8} onPress={() => { pick(); setEditing(c.id); }} style={press} accessibilityLabel={'Edit ' + c.name}><Text style={s.iconBtn}>✎</Text></Pressable>
          <Pressable hitSlop={8} onPress={() => remove(c)} style={press} accessibilityLabel={'Remove ' + c.name}><Text style={[s.iconBtn, { color: '#C92A2A' }]}>✕</Text></Pressable>
        </View>}
        <View style={[s.seg, { marginTop: 8, alignSelf: 'stretch' }]}>
          {(['personal', 'business'] as const).map(o => <Pressable key={o} onPress={() => { if (c.ownership !== o) pick(); upd(c.id, { ownership: o }); }} accessibilityRole="button" accessibilityState={{ selected: c.ownership === o }}
            style={({ pressed }) => [s.segItem, { flex: 1, alignItems: 'center' }, c.ownership === o && s.segOn, pressed && { opacity: 0.7 }]}>
            <Text style={[s.segTxt, c.ownership === o && { color: C.ink }]}>{o === 'personal' ? 'Personal · reimbursed' : 'Company · log only'}</Text></Pressable>)}
        </View>
      </View>)}
    </View>
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Btn alt title="+ Add car" onPress={add} />
      <Btn title={saving ? 'Saving…' : dirty ? 'Save' : 'Saved ✓'} onPress={async () => {
        if (saving) return; setSaving(true); setEditing(null);
        try { await onSave(list.filter(c => c.name.trim())); } finally { setSaving(false); } }} />
    </View>
  </>);
}

const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const RANGES: { label: string; get: () => [Date, Date] }[] = [
  { label: 'This month', get: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), 1), n]; } },
  { label: 'Last month', get: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth() - 1, 1), new Date(n.getFullYear(), n.getMonth(), 0)]; } },
  { label: 'This year', get: () => { const n = new Date(); return [new Date(n.getFullYear(), 0, 1), n]; } }];
// Pick a date range, build a Google Sheet in the user's own Drive, and open it.
function ExportCard({ onMsg }: { onMsg: (m: string) => void }) {
  const [from, setFrom] = useState(() => ymdLocal(RANGES[0].get()[0])), [to, setTo] = useState(() => ymdLocal(new Date()));
  const [busy, setBusy] = useState(false), [range, setRange] = useState('This month');
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  return <View style={s.card}>
    <Text style={s.cardTitle}>Export to Google Sheet</Text>
    <Text style={s.muted}>A new sheet in your Drive → Mileage logs, with totals. Reimbursement emails keep working as before.</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 10 }}>
      {RANGES.map(r => <Pressable key={r.label} onPress={() => { pick(); const [a, b] = r.get(); setFrom(ymdLocal(a)); setTo(ymdLocal(b)); setRange(r.label); }}
        accessibilityState={{ selected: range === r.label }} style={({ pressed }) => [s.chip, range === r.label && s.chipOn, pressed && { opacity: 0.7 }]}>
        <Text style={[s.chipTxt, range === r.label && s.chipTxtOn]}>{r.label}</Text></Pressable>)}
    </ScrollView>
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
      <View style={{ flex: 1 }}><Text style={s.label}>From</Text><TextInput returnKeyType="done" submitBehavior="blurAndSubmit" style={[s.input, { marginTop: 4 }]} value={from} onChangeText={v => { setFrom(v); setRange(''); }} placeholder="YYYY-MM-DD" placeholderTextColor={C.muted} keyboardType="numbers-and-punctuation" maxLength={10} /></View>
      <View style={{ flex: 1 }}><Text style={s.label}>To</Text><TextInput returnKeyType="done" submitBehavior="blurAndSubmit" style={[s.input, { marginTop: 4 }]} value={to} onChangeText={v => { setTo(v); setRange(''); }} placeholder="YYYY-MM-DD" placeholderTextColor={C.muted} keyboardType="numbers-and-punctuation" maxLength={10} /></View>
    </View>
    <View style={{ flexDirection: 'row', marginTop: 10, opacity: valid ? 1 : 0.5 }}>
      <Btn title={busy ? 'Building sheet…' : 'Export & open'} onPress={async () => {
        if (busy) return; if (!valid) { onMsg('Dates must be YYYY-MM-DD, start before end'); return; }
        setBusy(true);
        try { await API.sync().catch(() => {}); const r = await API.exportSheet(from, to); done(); onMsg('Sheet ready in Drive → Mileage logs'); await Linking.openURL(r.url); }
        catch (e: any) { onMsg('Export failed: ' + e.message); } finally { setBusy(false); } }} />
    </View>
    <Text style={[s.muted, { marginTop: 6 }]}>Only answered trips are included; answer anything in Needs review first.</Text>
  </View>;
}

function Settings({ onMsg, onSignedOut }: { onMsg: (m: string) => void; onSignedOut: () => void }) {
  const [tracking, setTracking] = useState(false), [me, setMe] = useState<API.Me | null>(null);
  const [to, setTo] = useState(''), [cc, setCc] = useState('');
  const load = async () => { try { const m = await API.me(); setMe(m); setTo(m.sugar); setCc(m.sugarCc || ''); } catch (e: any) { onMsg(e.message); } };
  useEffect(() => { isTracking().then(setTracking); load(); }, []);
  return (<>
    <View style={s.card}>
      <Row label="Automatic tracking" hint="Starts after a minute above 15 mph, ends after 5–6 minutes parked. Quick stops (gas, errands) under 10 minutes stay one trip.">
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
      <TextInput returnKeyType="done" submitBehavior="blurAndSubmit" style={[s.input, { marginTop: 10 }]} autoCapitalize="none" keyboardType="email-address" value={to} onChangeText={setTo} placeholder="sugar@ovanova.co" placeholderTextColor={C.muted} />
      <TextInput returnKeyType="done" submitBehavior="blurAndSubmit" style={[s.input, { marginTop: 8 }]} autoCapitalize="none" keyboardType="email-address" value={cc} onChangeText={setCc} placeholder="CC (optional)" placeholderTextColor={C.muted} />
      <View style={{ flexDirection: 'row', marginTop: 10 }}><Btn title="Save" onPress={async () => { try { const r = await API.saveRecipient(to, cc); setTo(r.sugar); setCc(r.sugarCc || ''); onMsg('Saved'); } catch (e: any) { onMsg(e.message); } }} /></View>
    </View>}
    {me && <ExportCard onMsg={onMsg} />}
    <Pressable style={({ pressed }) => [s.link, pressed && { opacity: 0.6 }]} onPress={async () => { tap(); await stopTracking().catch(() => {}); await scheduleReviewReminder(0).catch(() => {}); await API.signOut(); onSignedOut(); }}><Text style={s.linkTxt}>Sign out</Text></Pressable>
  </>);
}

const Btn = ({ title, onPress, alt }: { title: string; onPress: () => void; alt?: boolean }) =>
  <Pressable onPress={() => { tap(); onPress(); }} accessibilityRole="button" style={({ pressed }) => [s.btn, alt && s.bigAlt, pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }]}><Text style={[s.btnTxt, alt && { color: C.ink }]}>{title}</Text></Pressable>;
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
  card: { backgroundColor: C.card, borderRadius: 18, padding: 18, shadowColor: '#1B2430', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }, cardPending: { borderLeftWidth: 3, borderLeftColor: C.osc },
  cardTitle: { fontSize: T.title - 2, fontWeight: '700', color: C.ink },
  tripTop: { flexDirection: 'row', alignItems: 'flex-start' }, when: { fontSize: T.body + 1, fontWeight: '600', color: C.ink, letterSpacing: -0.2 }, time: { fontSize: T.small + 1, color: C.muted, marginTop: 2 },
  route: { fontSize: T.small + 1, color: C.muted, marginTop: 10 },
  miles: { fontSize: T.big, fontWeight: '700', color: C.ink, lineHeight: 38, letterSpacing: -0.8, fontVariant: ['tabular-nums'] }, unit: { fontSize: T.body - 1, fontWeight: '500', color: C.muted, letterSpacing: 0 },
  pill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 6 }, pillTxt: { fontSize: T.small, fontWeight: '600' },
  chip: { minHeight: 38, paddingHorizontal: 16, borderRadius: 999, justifyContent: 'center', backgroundColor: '#F1EFEC' }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipOn: { backgroundColor: C.brand }, chipTxt: { fontSize: T.small + 2, fontWeight: '500', color: C.ink }, chipTxtOn: { color: '#fff', fontWeight: '600' },
  seg: { flexDirection: 'row', backgroundColor: '#EFEDEA', borderRadius: 10, padding: 3, alignSelf: 'flex-start' }, segItem: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  segOn: { backgroundColor: '#fff' }, segTxt: { fontSize: T.small, fontWeight: '600', color: C.muted },
  big: { flex: 1, minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, bigPrimary: { backgroundColor: C.brand }, bigAlt: { backgroundColor: C.brandSoft },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 }, ask: { fontSize: T.small + 1, fontWeight: '600', color: C.muted },
  summary: { flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  dot: { width: 8, height: 8, borderRadius: 4 }, sumTxt: { fontSize: T.body - 1, fontWeight: '600' }, sumMeta: { fontSize: T.small + 1, color: C.muted },
  carTag: { backgroundColor: '#F1EFEC', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }, carTagTxt: { fontSize: T.small, color: C.ink, fontWeight: '500' },
  linkSmall: { color: C.brand, fontSize: T.small + 2, fontWeight: '600' },
  bigTxt: { color: '#fff', fontSize: T.body + 1, fontWeight: '600', letterSpacing: -0.2 }, bigSub: { color: '#E3F1E6', fontSize: T.small - 1, marginTop: 2 },
  bigOn: { borderWidth: 3, borderColor: C.osc }, label: { fontSize: T.small, fontWeight: '700', color: C.ink },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionAction: { color: C.brand, fontWeight: '700', fontSize: T.small + 1 },
  selRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }, selOn: { borderColor: C.brand, backgroundColor: C.brandSoft },
  box: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  carRow: { paddingVertical: 12 }, carRowLine: { borderTopWidth: 1, borderColor: C.line }, carName: { fontSize: T.body + 1, fontWeight: '700', color: C.ink },
  iconBtn: { fontSize: 18, color: C.muted, paddingHorizontal: 6, fontWeight: '700' },
  boxOn: { backgroundColor: C.brand, borderColor: C.brand }, boxTick: { color: '#fff', fontWeight: '800' },
  btn: { flex: 1, minHeight: TAP, borderRadius: 12, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }, btnTxt: { color: '#fff', fontSize: T.body, fontWeight: '700' },
  input: { minHeight: TAP, backgroundColor: C.bg, borderRadius: 12, paddingHorizontal: 14, fontSize: T.body, color: C.ink },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: TAP, marginTop: 10 }, rowLabel: { fontSize: T.body, fontWeight: '600', color: C.ink },
  muted: { color: C.muted, fontSize: T.small + 1, marginTop: 2 }, link: { minHeight: TAP, alignItems: 'center', justifyContent: 'center' }, linkTxt: { color: C.muted, fontSize: T.body, fontWeight: '600' },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 48, paddingHorizontal: 24 }, emptyTitle: { fontSize: T.title + 2, fontWeight: '800', color: C.ink },
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderColor: C.line },
  tabItem: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingTop: 6 }, tabIcon: { fontSize: 22 }, tabLabel: { fontSize: 11, fontWeight: '600', color: C.muted, marginTop: 2 },
  badge: { position: 'absolute', top: 4, right: '30%', backgroundColor: C.brand, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }, badgeTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
