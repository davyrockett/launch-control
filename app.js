'use strict';
/* Launch Control: David's Apple Reminders as a 3D launch control room (three.js r128, in vendor/).
   Stations sit in rows by urgency: Overdue and Today up front and big, Tomorrow and This week behind, This month and
   Later at the back (smaller, dimmer). Reminders with no date orbit a globe far out past the window ("Deep space").
   The big mission control screen counts down to the next deadline.
   The reminders come from the private davyrockett/launch-control-data repo (tasks.json), which Launch Control Sync on
   David's Mac keeps up to date (mac/ in this repo). "Done" adds the reminder to done.json; the Mac ticks it off.
   Saved on this device (localStorage keys start with "lc."): data (last copy of tasks.json), pending (Done taps the Mac
   hasn't handled yet), theme, sync-token. */

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('lc.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('lc.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const touchy = matchMedia('(pointer: coarse)').matches;
const narrow = () => innerWidth <= 700;

/* =====================================================================================================
   Data: tasks.json from GitHub (via the Mac), and Done taps going back
   ===================================================================================================== */
const REPO = 'https://api.github.com/repos/davyrockett/launch-control-data/contents/';
// The Apps screen's "Save for every app" saves the key as lc.sync-token; otherwise use the one another app keeps here.
const KEYS = ['lc.sync-token', 'ct.sync-token', 'rundown.sync-token', 'sn.sync-token', 'ml.sync-token', 'sp.sync-token',
  'sosed.sync-token', 'ge150.sync-token', 'healthlog-sync-token', 'z4log-sync-token'];
function syncKey() {
  for (const k of KEYS) { try { const v = localStorage.getItem(k); if (v) return v.replace(/^"|"$/g, ''); } catch (e) { /* blocked */ } }
  try { return JSON.parse(localStorage.getItem('js.syncToken')) || ''; } catch (e) { return ''; }
}
const toB64 = (s) => { let bin = ''; new TextEncoder().encode(s).forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin); };
const fromB64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
function gh(path, opts = {}) {
  return fetch(REPO + path, { cache: 'no-store', ...opts,
    headers: { Authorization: `Bearer ${syncKey()}`, Accept: 'application/vnd.github+json' } });
}
async function readJSON(path) {
  const r = await gh(path).catch(() => null);
  if (!r) return { err: 'offline' };
  if (!r.ok) return { err: r.status === 401 ? 'bad-key' : r.status === 404 ? 'no-access' : 'error' };
  const f = await r.json();
  return { json: JSON.parse(fromB64(f.content)), sha: f.sha };
}

let data = store.get('data', null);        // { updated, checked, tasks: [{id, list, name, due, allDay, priority, repeats}], lists }
let pending = store.get('pending', []);    // [{ id, name, list, at, sent }]
const sync = { state: data ? 'cached' : '', at: 0, busy: false };

async function pull() {
  if (!syncKey()) { sync.state = 'no-key'; drawSync(); return; }
  if (sync.busy) return;
  if (!navigator.onLine) { sync.state = 'offline'; drawSync(); return; }
  sync.busy = true;
  try {
    await sendPending();
    const t = await readJSON('tasks.json');
    if (t.err) { sync.state = t.err; return; }
    data = t.json; store.set('data', data);
    sync.state = 'ok'; sync.at = Date.now();
    if (pending.some((p) => p.sent)) await settlePending();
    refresh();
  } catch (e) { sync.state = 'error'; } finally { sync.busy = false; drawSync(); }
}

// Done taps go into done.json's "requests" for the Mac. Sent ones stay hidden here until the Mac has ticked them off
// and saved the reminders again (a repeating reminder keeps its id and just moves to its next date).
async function sendPending() {
  const todo = pending.filter((p) => !p.sent && Date.now() - p.at > 4500);   // after the Undo moment
  if (!todo.length) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const d = await readJSON('done.json');
    if (d.err) return;
    const reqs = Array.isArray(d.json.requests) ? d.json.requests : [];
    const log = Array.isArray(d.json.log) ? d.json.log : [];
    const same = (p) => (r) => r.id === p.id && r.at === p.at;
    // Already there (an earlier send got through but its answer was lost, e.g. the phone locked): don't send it again,
    // or a repeating reminder would get ticked off twice.
    const fresh = todo.filter((p) => !reqs.some(same(p)) && !log.some(same(p)));
    if (!fresh.length) { todo.forEach((p) => { p.sent = true; }); store.set('pending', pending); return; }
    fresh.forEach((p) => { reqs.push({ id: p.id, name: p.name, list: p.list, at: p.at }); });
    const body = JSON.stringify({ ...d.json, requests: reqs }, null, 1) + '\n';
    const put = await gh('done.json', { method: 'PUT',
      body: JSON.stringify({ message: `Done: ${fresh.map((p) => p.name).join(', ')}`.slice(0, 200), content: toB64(body), sha: d.sha }) }).catch(() => null);
    if (!put) return;
    if (put.ok) { todo.forEach((p) => { p.sent = true; }); store.set('pending', pending); return; }
    if (put.status !== 409 && put.status !== 422) return;   // changed meanwhile: read it again
  }
}
async function settlePending() {
  const d = await readJSON('done.json');
  if (d.err) return;
  const log = Array.isArray(d.json.log) ? d.json.log : [];
  pending = pending.filter((p) => {
    if (Date.now() - p.at > 2 * 864e5) return false;   // give up after two days
    const h = log.find((l) => l.id === p.id && l.at === p.at);
    return !(h && data && data.checked >= h.handled);
  });
  store.set('pending', pending);
}

const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
function drawSync() {
  const macOld = data && Date.now() - data.checked > 4 * 3600e3;   // the Mac saves at least every 3 hours
  const st = sync.state;
  const [dot, short] =
    st === 'no-key' ? ['bad', 'Needs your access key'] :
    st === 'bad-key' ? ['bad', 'Access key not accepted'] :
    st === 'no-access' ? ['bad', 'Key can\'t reach the data'] :
    !data ? [st === 'offline' ? 'warn' : '', st === 'offline' ? 'Offline' : 'Loading…'] :
    macOld ? ['warn', `Mac last checked ${ago(data.checked)}`] :
    st === 'offline' || st === 'error' || st === 'cached' ? ['warn', `Saved copy · ${ago(data.checked)}`] :
    ['ok', `In sync · ${ago(data.updated)}`];
  $('sync-dot').className = 'dot ' + dot;
  $('sync-text').textContent = short;
  const n = pending.filter((p) => p.sent).length;
  $('sync-line').textContent = {
    'no-key': 'This device doesn\'t have your access key yet. Add it on the Apps screen (Settings > Access key), or paste it below.',
    'bad-key': 'GitHub didn\'t accept the access key on this device (mistyped or expired).',
    'no-access': 'Your access key can\'t reach the launch-control-data repo yet. Give it access on GitHub (the "davyrockett apps" key).',
    offline: 'Offline. Showing the last copy saved on this device.',
    error: 'Something went wrong reaching GitHub. Showing the last copy saved on this device.',
  }[st] || (data ? `Reminders last changed ${ago(data.updated)}. Your Mac last checked ${ago(data.checked)}.` +
    (macOld ? ' That\'s a while: is the Mac asleep or off?' : '') +
    (n ? ` ${n} Done tap${n === 1 ? '' : 's'} waiting for the Mac.` : '') : 'Checking…');
  const k = syncKey();
  $('key-line').textContent = k ? 'This device has an access key saved.' : 'Paste the same access key your other apps use.';
}

/* =====================================================================================================
   Time buckets
   ===================================================================================================== */
const BK = [
  { k: 'overdue', l: 'Overdue', c: 'Abort recovery', col: '#e34948' },
  { k: 'today', l: 'Today', c: 'T-0', col: '#eda100' },
  { k: 'tomorrow', l: 'Tomorrow', c: 'T-1 day', col: '#1baf7a' },
  { k: 'week', l: 'This week', c: 'T-7 days', col: '#1da9b8' },
  { k: 'month', l: 'This month', c: 'T-30 days', col: '#3987e5' },
  { k: 'later', l: 'Later', c: 'Long range', col: '#6c7ee8' },
  { k: 'someday', l: 'Someday', c: 'Deep space', col: '#9085e9' },
];
BK.forEach((b) => { b.t = []; });
const LCOL = { 'Inbox': '#3987e5', 'Personal': '#eb6834', 'Personal Music': '#1baf7a', 'Resounding Joy': '#eda100', 'Crossing': '#e87ba4',
  'Z4': '#e66767', 'Reminders': '#9085e9', 'On hold': '#b4b2a9', 'Long Term Reminders': '#4fb3d9', 'To Watch, Listen, Read': '#c97fd6',
  'Groceries': '#a88b6a' };
const SPARE = ['#d4a72c', '#5fb88a', '#d9748f', '#7f9be0', '#c98b4a', '#62b5b0'];
function lcol(list) {
  if (LCOL[list]) return LCOL[list];
  const h = data && data.lists && data.lists[list];
  if (h) return (LCOL[list] = h);
  let n = 0; for (const ch of list) n = (n * 31 + ch.charCodeAt(0)) | 0;
  return (LCOL[list] = SPARE[Math.abs(n) % SPARE.length]);
}
const day0 = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const addD = (n) => { const d = day0(); d.setDate(d.getDate() + n); return d; };
const parse = (s) => { const [d, t = '00:00'] = s.split('T'); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return new Date(y, m - 1, dd, h, mi); };
function bucket(t) {
  if (!t.due) return 'someday';
  const d = parse(t.due), dd = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - day0()) / 864e5);
  return dd < 0 ? 'overdue' : dd === 0 ? 'today' : dd === 1 ? 'tomorrow' : dd <= 7 ? 'week' : dd <= 31 ? 'month' : 'later';
}
const BI = (k) => BK.findIndex((b) => b.k === k);
const md = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const wd = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
let RANGE = {};
function ranges() {
  RANGE = { overdue: 'Due before ' + md(day0()), today: wd(day0()), tomorrow: wd(addD(1)), week: md(addD(2)) + ' – ' + md(addD(7)),
    month: md(addD(8)) + ' – ' + md(addD(31)), later: md(addD(32)) + ' and beyond', someday: 'No due date' };
}
function fmt(t) {
  if (!t.due) return 'No date';
  const d = parse(t.due);
  let s = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  if (!t.allDay) s += ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return s;
}

/* =====================================================================================================
   The room (built once; the reminders in it are rebuilt by setTasks)
   ===================================================================================================== */
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FONT = '"Atkinson Hyperlegible", system-ui, sans-serif', HEAD = '"Big Shoulders Display", "Atkinson Hyperlegible", sans-serif';
const NIGHT = { fog: 0x04060b, fogN: 320, fogF: 1100, bg: '#04060b', sky: [[0.008, 0.012, 0.035], [0.07, 0.09, 0.19], [0.22, 0.11, 0.2]], ground: 0x080b10,
  floor: [0x0b0f16, 0.65, 0.36], wall: [0x0b111c, 0.3], mull: 0x161d2b, mount: 0x070a12, desk: [0x161d2b, 0.55], deskTop: 0x0e1420, frame: 0x080c14,
  pad: 0x262a32, keyDim: 0x173a44, strip: 0x2f8f78, inner: 0x0a1426, amb: [0x2a3550, 0.5], hemi: [0x22305a, 0x050505, 0.45],
  sun: [0x8fa8ff, 0.35, -300, 260, -900], room: [0x9fd8ff, 0.35], spot: 2.2, bloom: [0.6, 0.62],
  S: { bg: '#050d16', tx: '#f4f3ee', mu: '#9a9890', sec: '#c3c2b7', line: '#14303a', scan: 'rgba(255,255,255,0.022)', card: 'rgba(6,16,26,0.84)',
    acc: '#5dcaa5', acc2: '#9fe1cb', radar: 'rgba(29,158,117,0.45)', sweep: 'rgba(93,202,165,0.16)', border: '#0f6e56' } };
const DAY = { fog: 0xc7dbed, fogN: 420, fogF: 1700, bg: '#dfe8f0', sky: [[0.2, 0.43, 0.8], [0.78, 0.86, 0.93], [0.25, 0.2, 0.12]], ground: 0x8d897f,
  floor: [0x69717b, 0.25, 0.55], wall: [0xb9b4aa, 0.05], mull: 0x59616c, mount: 0x7d8ca0, desk: [0x3b4350, 0.35], deskTop: 0x2a313b, frame: 0x22272f,
  pad: 0xb5b2aa, keyDim: 0x56616e, strip: 0x1d9e75, inner: 0xdfe9f2, amb: [0xffffff, 0.55], hemi: [0xdfeaff, 0x8a8170, 0.6],
  sun: [0xfff2dc, 0.95, -600, 700, 200], room: [0xffffff, 0.4], spot: 0.6, bloom: [0, 1],
  S: { bg: '#f6f8fa', tx: '#1a1d22', mu: '#6b6a65', sec: '#3d3d3a', line: '#d5dbe0', scan: 'rgba(0,0,0,0.022)', card: 'rgba(255,255,255,0.92)',
    acc: '#0f6e56', acc2: '#0f6e56', radar: 'rgba(15,110,86,0.35)', sweep: 'rgba(29,158,117,0.14)', border: '#1d9e75' } };
let isDay = false, S = NIGHT.S;

const wrap = $('wrap'), panel = $('panel'), panelBody = $('panel-body'), tip = $('tip');
let W = innerWidth || 1024, H = innerHeight || 768;   // 0 while a page opens in the background
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(touchy ? 1.6 : 2, devicePixelRatio));
renderer.setSize(W, H);
wrap.prepend(renderer.domElement);
renderer.domElement.tabIndex = 0;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x04060b, 320, 1100);
const camera = new THREE.PerspectiveCamera(52, W / H, 0.3, 4000);
const HOME = { p: V(0, 21, 29), t: V(0, 4, -10) };
function homeView() {   // a tall phone screen stands further back (outside the room: those walls hide) to see the whole arc
  const a = W / H;
  if (!(a < 1.2)) { const sx = narrow() ? 0 : 7; return { p: HOME.p.clone().add(V(sx, 0, 0)), t: HOME.t.clone().add(V(sx, 0, 0)) }; }   // clear of the side panel
  // Sized for the front rows: the least urgent back corners may crop at the edges.
  const D = clamp(17.5 / (Math.tan(26 * Math.PI / 180) * a), 36, 125), dir = V(0, 0.42, 0.9).normalize();
  const t = V(0, 4, -9);
  return { p: t.clone().addScaledVector(dir, D), t };
}
const hv0 = homeView();
camera.position.copy(hv0.p);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.target.copy(hv0.t);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxDistance = 460; controls.minDistance = 1.5;
let composer = null, bloom = null;
if (THREE.EffectComposer && THREE.UnrealBloomPass && THREE.RenderPass) {
  composer = new THREE.EffectComposer(renderer);
  composer.addPass(new THREE.RenderPass(scene, camera));
  bloom = new THREE.UnrealBloomPass(new THREE.Vector2(W, H), 0.6, 0.5, 0.62);
  composer.addPass(bloom);
  composer.setSize(W, H);
}
const mat = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.85, metalness: 0.15 }, o));
const basic = (c, o = {}) => new THREE.MeshBasicMaterial(Object.assign({ color: c }, o));
// Textures repeat every TEXU units of real size (not once per face), so a long wall and a small desk share one scale.
const TEXU = 6;
function uvWorld(g, w, h, d) {
  const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];   // +x, -x, +y, -y, +z, -z faces
  for (let i = 0; i < uv.count; i++) { const f = dims[Math.floor(i / 4)]; uv.setXY(i, uv.getX(i) * f[0] / TEXU, uv.getY(i) * f[1] / TEXU); }
}
const box = (w, h, d, m, x, y, z, p = scene) => { const g = new THREE.BoxGeometry(w, h, d); uvWorld(g, w, h, d); const b = new THREE.Mesh(g, m); b.position.set(x, y, z); p.add(b); return b; };

const amb = new THREE.AmbientLight(0x2a3550, 0.5); scene.add(amb);
const hemi = new THREE.HemisphereLight(0x22305a, 0x050505, 0.45); scene.add(hemi);
const roomL = [[0, 20, 0], [0, 14, -18]].map((p) => { const l = new THREE.PointLight(0x9fd8ff, 0.35, 70); l.position.set(...p); scene.add(l); return l; });
const sunL = new THREE.DirectionalLight(0x8fa8ff, 0.35); sunL.position.set(-300, 260, -900); scene.add(sunL);
const skyU = { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() } };
scene.add(new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
  vertexShader: 'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: 'uniform vec3 uTop;uniform vec3 uHor;uniform vec3 uGlow;varying vec3 vP;void main(){float h=clamp(vP.y,0.0,1.0);vec3 c=mix(uHor,uTop,pow(h,0.4));c+=uGlow*pow(1.0-h,12.0)*0.7;gl_FragColor=vec4(c,1.0);}' })));
let sd = 5; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
let stars;
{ const g = new THREE.BufferGeometry(), n = 3000, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const R = 1800, t = rnd() * 6.283, p = Math.acos(0.05 + rnd() * 0.95); a[i * 3] = R * Math.sin(p) * Math.cos(t); a[i * 3 + 1] = R * Math.cos(p); a[i * 3 + 2] = R * Math.sin(p) * Math.sin(t); }
  g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
  scene.add(stars); }
const moon = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 32), basic(0xe8e6dc, { fog: false })); moon.position.set(-420, 330, -1300); scene.add(moon);
const sunM = new THREE.Mesh(new THREE.SphereGeometry(55, 32, 32), basic(0xfff6d8, { fog: false })); sunM.position.set(-700, 300, -1400); scene.add(sunM);
const mountM = mat(0x070a12);
for (let i = 0; i < 46; i++) { const a = i / 46 * 6.283 + rnd() * 0.1, r = 760 + rnd() * 180, h = 50 + rnd() * 130; const m = new THREE.Mesh(new THREE.ConeGeometry(90 + rnd() * 90, h, 5), mountM); m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r - 200); m.rotation.y = rnd() * 3; scene.add(m); }
const groundM = mat(0x080b10); const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), groundM); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.06; scene.add(ground);
const floorM = mat(0x0b0f16, { metalness: 0.65, roughness: 0.36 }); const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), floorM); floor.rotation.x = -Math.PI / 2; scene.add(floor);
const wallM = mat(0x0b111c, { metalness: 0.3, roughness: 0.7 }), mullM = mat(0x161d2b, { metalness: 0.6, roughness: 0.4 });
box(80, 2.5, 0.6, wallM, 0, 1.25, -30); box(80, 11, 0.6, wallM, 0, 18.5, -30); [-26, -13, 13, 26].forEach((x) => box(0.5, 10.5, 0.5, mullM, x, 7.75, -30));
box(80, 0.08, 0.14, basic(0x1d9e75), 0, 2.56, -29.6);
// Side walls, back wall and ceiling hide while the camera is outside them (a dollhouse view), so you can stand back.
const shell = { l: box(0.6, 24, 60, wallM, -40, 12, 0), r: box(0.6, 24, 60, wallM, 40, 12, 0), b: box(80, 24, 0.6, wallM, 0, 12, 30), c: box(80, 0.6, 60, wallM, 0, 24, 0) };
const shellStrips = [];
const stripM = basic(0x2f8f78, { transparent: true, opacity: 0.55 });
[-15, 0, 15].forEach((x) => shellStrips.push(['c', box(0.35, 0.08, 54, stripM, x, 23.62, 0)]));
[-20, -10, 0, 10, 20].forEach((z) => { shellStrips.push(['l', box(0.12, 18, 0.3, stripM, -39.6, 12, z)], ['r', box(0.12, 18, 0.3, stripM, 39.6, 12, z)]); });
function cullShell() {
  const p = camera.position, on = { l: p.x > -40.3, r: p.x < 40.3, b: p.z < 30.3, c: p.y < 24.3 };
  for (const k in shell) shell[k].visible = on[k];
  shellStrips.forEach(([k, m]) => { m.visible = on[k]; });
}

// The launch pad outside the window
const PAD = V(0, 0, -220);
const padM = mat(0x262a32); const pad = new THREE.Mesh(new THREE.CylinderGeometry(32, 36, 2, 48), padM); pad.position.set(PAD.x, 1, PAD.z); scene.add(pad);
const tower = new THREE.Group(); tower.position.set(15, 2, PAD.z); scene.add(tower);
const tw = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(7, 80, 7, 1, 12, 1)), new THREE.LineBasicMaterial({ color: 0xd85a30 })); tw.position.y = 40; tower.add(tw);
box(5, 80, 5, mat(0x3a2018), 0, 40, 0, tower);
const arm = box(9, 1.2, 1.2, mat(0x5f5e5a), -6, 52, 0, tower);
const beaconM = basic(0xff4040, { transparent: true }); const beacon = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 12), beaconM); beacon.position.y = 82; tower.add(beacon);
const rocket = new THREE.Group(); rocket.position.set(PAD.x, 2, PAD.z); scene.add(rocket);
const wM = mat(0xf1efe8, { roughness: 0.42, metalness: 0.25 }), rM = mat(0xe24b4a, { roughness: 0.5 }), kM = mat(0x1a1a1a, { roughness: 0.6 });
const core = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 54, 40), wM); core.position.y = 33; rocket.add(core);
[18, 44].forEach((y) => { const r = new THREE.Mesh(new THREE.CylinderGeometry(4.06, 4.06, 1.2, 40), kM); r.position.y = y; rocket.add(r); });
const nose = new THREE.Mesh(new THREE.ConeGeometry(4, 14, 40), rM); nose.position.y = 67; rocket.add(nose);
[-6.6, 6.6].forEach((x) => { const b = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 32, 24), wM); b.position.set(x, 22, 0); rocket.add(b); const c = new THREE.Mesh(new THREE.ConeGeometry(2, 5, 24), rM); c.position.set(x, 40.5, 0); rocket.add(c); });
box(9, 0.6, 9, kM, 0, 6.2, 0, rocket);
const flame = new THREE.Mesh(new THREE.ConeGeometry(5, 28, 24), basic(0xffc04a, { transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
flame.rotation.x = Math.PI; flame.position.y = -8; flame.visible = false; rocket.add(flame);
const flameL = new THREE.PointLight(0xffa040, 0, 300); flameL.position.y = -4; rocket.add(flameL);
const spots = [-48, 48].map((x) => { const s = new THREE.SpotLight(0xfff4e0, 2.2, 340, 0.3, 0.5); s.position.set(x, 3, PAD.z + 52); s.target = core; scene.add(s); box(3, 2, 1, basic(0xfff4e0), x, 3, PAD.z + 52); return s; });
const beams = [-90, 90].map((x, i) => { const g = new THREE.CylinderGeometry(16, 0.8, 460, 24, 1, true); g.translate(0, 230, 0);
  const m = new THREE.Mesh(g, basic(0x9fb8ff, { transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  m.position.set(x, 0, PAD.z - 60); m.userData.ph = i * 2.1; scene.add(m); return m; });
const steamM = () => new THREE.MeshStandardMaterial({ color: 0xc4cad4, transparent: true, opacity: 0, depthWrite: false, roughness: 1 });
const wisps = []; for (let i = 0; i < 22; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 12), steamM()); m.userData.ph = i / 22; scene.add(m); wisps.push(m); }
const plume = []; for (let i = 0; i < 16; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 12), steamM()); m.userData.a = i / 16 * 6.283; scene.add(m); plume.push(m); }
const shoot = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 60), basic(0xffffff, { transparent: true, opacity: 0, blending: THREE.AdditiveBlending, fog: false })); scene.add(shoot);
let shootT = -1, shootNext = 4; const shootV = V(0, 0, 0);
let dust;
{ const g = new THREE.BufferGeometry(), n = 380, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = (rnd() - 0.5) * 76; a[i * 3 + 1] = 0.5 + rnd() * 22; a[i * 3 + 2] = (rnd() - 0.5) * 56; }
  g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fe1cb, size: 0.07, transparent: true, opacity: 0.35, depthWrite: false })); scene.add(dust); }

// ---------- drawing on canvases (screens, cards, labels) ----------
const ink = (c) => { if (!isDay) return c; const k = new THREE.Color(c).multiplyScalar(0.6); return '#' + k.getHexString(); };
function ctex(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const t = new THREE.CanvasTexture(c); t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return { c, x: c.getContext('2d'), t }; }
function fit(x, s, w) { if (x.measureText(s).width <= w) return s; while (s.length > 1 && x.measureText(s + '…').width > w) s = s.slice(0, -1); return s + '…'; }
function rr(x, a, b, w, h, r) { x.beginPath(); if (x.roundRect) x.roundRect(a, b, w, h, r); else x.rect(a, b, w, h); }
function dot(x, cx, cy, r, c) { x.fillStyle = c; x.beginPath(); x.arc(cx, cy, r, 0, 6.283); x.fill(); }
function scan(x, w, h) { x.fillStyle = S.scan; for (let y = 0; y < h; y += 4) x.fillRect(0, y, w, 1); }
function drawCard(tx, t, col) {
  const x = tx.x; x.clearRect(0, 0, 512, 112);
  x.fillStyle = S.card; rr(x, 2, 2, 508, 108, 16); x.fill();
  x.strokeStyle = col; x.globalAlpha = 0.65; x.lineWidth = 2; rr(x, 2, 2, 508, 108, 16); x.stroke(); x.globalAlpha = 1;
  x.fillStyle = col; x.fillRect(14, 20, 6, 72);
  x.fillStyle = S.tx; x.font = '700 31px ' + FONT; x.fillText(fit(x, t.name, 456), 34, 50);
  dot(x, 41, 79, 6, lcol(t.list)); x.font = '22px ' + FONT; x.fillStyle = S.sec;
  x.fillText(fit(x, t.list + (t.due ? '  ·  ' + fmt(t) : ''), 440), 54, 87);
  tx.t.needsUpdate = true;
}
function drawSat(tx, t) {
  const x = tx.x; x.clearRect(0, 0, 512, 84);
  x.fillStyle = S.card; rr(x, 2, 2, 508, 80, 14); x.fill();
  x.strokeStyle = lcol(t.list); x.globalAlpha = 0.6; x.lineWidth = 2; rr(x, 2, 2, 508, 80, 14); x.stroke(); x.globalAlpha = 1;
  dot(x, 30, 42, 9, lcol(t.list)); x.fillStyle = S.tx; x.font = '700 29px ' + FONT; x.fillText(fit(x, t.name, 448), 50, 52);
  tx.t.needsUpdate = true;
}
function drawScreen(b) {
  const { x, c } = b.tex, w = c.width, h = c.height;
  x.fillStyle = S.bg; x.fillRect(0, 0, w, h); scan(x, w, h);
  x.strokeStyle = b.col; x.globalAlpha = 0.8; x.lineWidth = 5; x.strokeRect(3, 3, w - 6, h - 6); x.globalAlpha = 1;
  x.fillStyle = ink(b.col); x.font = '800 60px ' + HEAD; x.fillText(b.l.toUpperCase(), 28, 72); x.fillStyle = S.mu; x.font = '24px ' + FONT; x.fillText(b.c, 28, 106);
  x.textAlign = 'right'; x.fillStyle = S.tx; x.font = '800 110px ' + HEAD; x.fillText(b.t.length, w - 28, 108);
  x.fillStyle = S.mu; x.font = '22px ' + FONT; x.fillText(b.t.length === 1 ? 'task' : 'tasks', w - 28, 136); x.textAlign = 'left';
  x.fillStyle = S.sec; x.font = '25px ' + FONT; x.fillText(RANGE[b.k], 28, 150); x.fillStyle = S.line; x.fillRect(28, 172, w - 56, 2);
  if (!b.t.length) { x.fillStyle = S.acc; x.font = '700 38px ' + FONT; x.fillText('All clear', 28, 236); b.tex.t.needsUpdate = true; return; }
  const cnt = {}; b.t.forEach((t) => { cnt[t.list] = (cnt[t.list] || 0) + 1; });
  let px = 28, py = 222; x.font = '25px ' + FONT;
  Object.keys(cnt).forEach((k) => { const s = k + ' ' + cnt[k], tw = x.measureText(s).width + 48; if (px + tw > w - 20) { px = 28; py += 42; }
    if (py > h - 16) return; x.fillStyle = lcol(k); x.fillRect(px, py - 18, 16, 16); x.fillStyle = S.tx; x.fillText(s, px + 24, py); px += tw; });
  b.tex.t.needsUpdate = true;
}

// ---------- the six stations ----------
const deskM = mat(0x161d2b, { metalness: 0.55, roughness: 0.45 }), deskTopM = mat(0x0e1420, { metalness: 0.4, roughness: 0.5 });
const frameM = mat(0x080c14, { metalness: 0.6, roughness: 0.35 }), keyDimM = basic(0x173a44);

// ---------- real materials: surface textures drawn here in code (nothing to download) ----------
// Each set is near-white, so the day/night colours above still set the overall tone; the textures add the detail.
// map = colour detail, bump = small dents and ridges that catch the light, rough = where it's shinier or duller.
function texSet(draw, n = 512) {
  const out = {};
  ['map', 'bump', 'rough'].forEach((k) => {
    const c = document.createElement('canvas'); c.width = c.height = n; draw[k](c.getContext('2d'), n);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); out[k] = t;
  });
  return out;
}
let tsd = 7; const trnd = () => (tsd = (tsd * 16807) % 2147483647) / 2147483647;
function grain(x, n, amt) {   // fine speckle over everything drawn so far
  const d = x.getImageData(0, 0, n, n), p = d.data;
  for (let i = 0; i < p.length; i += 4) { const v = (trnd() - 0.5) * amt; p[i] += v; p[i + 1] += v; p[i + 2] += v; }
  x.putImageData(d, 0, 0);
}
const g8 = (v) => `rgb(${v},${v},${v})`;
// Raised-floor tiles: 2 x 2 per texture, each a slightly different shade, with dark seams and a bevel.
const floorT = texSet({
  map: (x, n) => { const h = n / 2; for (let i = 0; i < 4; i++) { const tx = (i % 2) * h, ty = (i >> 1) * h;
      x.fillStyle = g8(228 + Math.round(trnd() * 16)); x.fillRect(tx, ty, h, h);
      x.fillStyle = 'rgba(255,255,255,0.22)'; x.fillRect(tx + 5, ty + 5, h - 10, 3); x.fillRect(tx + 5, ty + 5, 3, h - 10);
      x.fillStyle = 'rgba(0,0,0,0.1)'; x.fillRect(tx + 5, ty + h - 8, h - 10, 3); x.fillRect(tx + h - 8, ty + 5, 3, h - 10);
      x.strokeStyle = g8(172); x.lineWidth = 4; x.strokeRect(tx + 1, ty + 1, h - 2, h - 2); }
    grain(x, n, 16); },
  bump: (x, n) => { const h = n / 2; x.fillStyle = '#000'; x.fillRect(0, 0, n, n);
    for (let i = 0; i < 4; i++) { const tx = (i % 2) * h, ty = (i >> 1) * h; x.fillStyle = g8(150); x.fillRect(tx + 4, ty + 4, h - 8, h - 8); x.fillStyle = '#fff'; x.fillRect(tx + 9, ty + 9, h - 18, h - 18); }
    grain(x, n, 10); },
  rough: (x, n) => { x.fillStyle = g8(200); x.fillRect(0, 0, n, n); const h = n / 2;
    for (let i = 0; i < 4; i++) { x.fillStyle = g8(170 + Math.round(trnd() * 50)); x.fillRect((i % 2) * h + 6, (i >> 1) * h + 6, h - 12, h - 12); }
    grain(x, n, 40); },
});
// Brushed metal: long horizontal streaks.
function streaks(x, n, base, spread, alpha) {
  x.fillStyle = g8(base); x.fillRect(0, 0, n, n);
  for (let i = 0; i < 2600; i++) { const v = Math.round(base + (trnd() - 0.5) * spread), y = trnd() * n, len = 40 + trnd() * 380;
    x.fillStyle = `rgba(${v},${v},${v},${alpha})`; x.fillRect(trnd() * n - 40, y, len, 1 + (trnd() < 0.2 ? 1 : 0)); }
}
const metalT = texSet({
  map: (x, n) => { streaks(x, n, 225, 50, 0.55); grain(x, n, 6); },
  bump: (x, n) => { streaks(x, n, 128, 120, 0.5); },
  rough: (x, n) => { streaks(x, n, 190, 90, 0.6); },
});
// Wall panels: two panels across, a seam halfway up, screws in the corners.
function panels(x, n, face, seam, screw) {
  x.fillStyle = face; x.fillRect(0, 0, n, n); const h = n / 2;
  x.fillStyle = seam; x.fillRect(0, 0, n, 5); x.fillRect(0, h - 2, n, 5); x.fillRect(0, 0, 5, n); x.fillRect(h - 2, 0, 5, n);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const sx = (i >> 1) * h + (i % 2 ? h - 18 : 18), sy = (j >> 1) * h + (j % 2 ? h - 18 : 18);
    x.fillStyle = screw; x.beginPath(); x.arc(sx, sy, 5, 0, 6.283); x.fill(); }
}
const wallT = texSet({
  map: (x, n) => { panels(x, n, g8(232), g8(150), g8(170)); x.fillStyle = 'rgba(255,255,255,0.25)';
    for (let i = 0; i < 4; i++) x.fillRect((i % 2) * n / 2 + 8, (i >> 1) * n / 2 + 8, n / 2 - 16, 2); grain(x, n, 12); },
  bump: (x, n) => { panels(x, n, g8(200), '#000', '#fff'); grain(x, n, 8); },
  rough: (x, n) => { panels(x, n, g8(215), g8(255), g8(120)); grain(x, n, 30); },
});
// Keyboard decks: matte rubber with a fine non-slip dot grid.
function dots(x, n, base, dot) { x.fillStyle = base; x.fillRect(0, 0, n, n); x.fillStyle = dot; for (let i = 4; i < n; i += 8) for (let j = 4; j < n; j += 8) { x.beginPath(); x.arc(i, j, 1.6, 0, 6.283); x.fill(); } }
const rubberT = texSet({
  map: (x, n) => { dots(x, n, g8(232), g8(244)); grain(x, n, 8); },
  bump: (x, n) => { dots(x, n, '#000', '#fff'); },
  rough: (x, n) => { dots(x, n, g8(255), g8(200)); },
});
function dress(m, t, bump) { m.map = t.map; m.bumpMap = t.bump; m.bumpScale = bump; m.roughnessMap = t.rough; m.needsUpdate = true; }
dress(floorM, floorT, 0.035); dress(wallM, wallT, 0.04); dress(mullM, metalT, 0.008);
dress(deskM, metalT, 0.008); dress(frameM, metalT, 0.006); dress(deskTopM, rubberT, 0.01);
{ const uv = floor.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 80 / TEXU, uv.getY(i) * 60 / TEXU); }
const STEP = 1.12, SLOTS = 5;
// Rows by urgency: NOW up front and big, NEXT in the middle, LATER at the back (smaller and dimmer). Deep space is outside.
const LAY = [{ x: -5.6, z: 5, s: 1.1, dim: 1 }, { x: 5.6, z: 5, s: 1.1, dim: 1 },
  { x: -17.5, z: -8, s: 0.95, dim: 0.84 }, { x: 17.5, z: -8, s: 0.95, dim: 0.84 },
  { x: -25, z: -21, s: 0.82, dim: 0.64 }, { x: 25, z: -21, s: 0.82, dim: 0.64 }];
const FACE = V(0, 0, 44);   // every console turns toward a point behind the usual view
const CARDG = new THREE.PlaneGeometry(4.6, 1.0), LABG = new THREE.PlaneGeometry(3.4, 0.56), SATG = new THREE.SphereGeometry(0.16, 12, 12);
const picks = []; let cardMeshes = [];
BK.slice(0, 6).forEach((b, i) => {
  const L = LAY[i], g = new THREE.Group();
  g.position.set(L.x, 0, L.z); g.rotation.y = Math.atan2(FACE.x - L.x, FACE.z - L.z); g.scale.setScalar(L.s); scene.add(g); b.g = g; b.dim = L.dim;
  const col = new THREE.Color(b.col), accM = basic(col);
  const d = box(8.4, 2.4, 3.2, deskM, 0, 1.2, 0, g);
  const kb = box(8.4, 0.22, 1.9, deskTopM, 0, 2.5, 0.85, g); kb.rotation.x = 0.3;
  for (let k = 0; k < 14; k++) box(0.46, 0.08, 0.3, k % 5 === 0 ? accM : keyDimM, -3.25 + (k % 7) * 1.08, 0.14, k < 7 ? -0.35 : 0.25, kb);
  b.strip = basic(col, { transparent: true, opacity: 0.9 }); box(8.4, 0.09, 0.09, b.strip, 0, 2.44, 1.64, g);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(5.5, 40), basic(col, { transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }));
  pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.04, 2); g.add(pool); pool.material.opacity = 0.1 * L.dim;
  const pl = new THREE.PointLight(col, 0.75 * L.dim * L.dim, 16); pl.position.set(0, 3.4, 3); g.add(pl); b.pl = pl;
  const sg = new THREE.Group(); sg.position.set(0, 5, -0.9); sg.rotation.x = -0.18; g.add(sg);
  const fr = box(7.7, 4.4, 0.3, frameM, 0, 0, 0, sg);
  b.tex = ctex(640, 360);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 4.05), basic(0xffffff, { map: b.tex.t })); scr.position.z = 0.2; sg.add(scr); b.scrM = scr.material;
  if (i === 0) {   // Overdue: two alarm beacons that flash in turn
    b.beacons = [-3.75, 3.75].map((bx) => { box(0.62, 0.22, 0.62, frameM, bx, 2.3, 0.05, sg);
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), basic(0xff3b30, { transparent: true })); m.position.set(bx, 2.58, 0.05); sg.add(m); return m; });
  }
  [d, fr, scr].forEach((m) => { m.userData.bi = i; picks.push(m); });
  b.cs = new THREE.Group(); b.cs.position.set(0, 7.75, -0.9); g.add(b.cs); b.cards = []; b.off = 0;
});
// The runway: pulses come in from the window toward you, speeding up and turning red as they get close.
const RUN = { z0: -28, z1: 16 };
box(0.12, 0.04, RUN.z1 - RUN.z0, basic(0x1d9e75), 0, 0.04, (RUN.z0 + RUN.z1) / 2);
const PC = [new THREE.Color('#5dcaa5'), new THREE.Color('#eda100'), new THREE.Color('#ff3b30')];
const pulses = []; for (let k = 0; k < 9; k++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), basic(0x7fe0c4)); m.userData.o = k / 9; scene.add(m); pulses.push(m); }
function applyDim() {   // the back rows sit in a dimmer part of the room
  BK.slice(0, 6).forEach((b) => { const v = isDay ? 1 - (1 - b.dim) * 0.55 : b.dim; b.scrM.color.setScalar(v); b.cards.forEach((m) => m.material.color.setScalar(v)); });
}

// ---------- Deep space (no due date) ----------
// Far out past the window: nothing here is due, so it drifts at a distance.
const HB = BK[6], DS = V(24, 10, -82), DK = 2.8, SK = 1.7;   // DK: globe size; SK: the spread-out ring
const dsG = new THREE.Group(); dsG.position.copy(DS); dsG.scale.setScalar(DK); scene.add(dsG);
const globe = new THREE.Group(); dsG.add(globe);
const innerM = basic(0x0a1426); const inner = new THREE.Mesh(new THREE.SphereGeometry(1.75, 32, 32), innerM); globe.add(inner); inner.userData.bi = 6; picks.push(inner);
globe.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.95, 2), basic(0x1d9e75, { wireframe: true, transparent: true, opacity: 0.45 })));
const eq = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.025, 6, 80), basic(0x9085e9, { transparent: true, opacity: 0.7 })); eq.rotation.x = Math.PI / 2.3; globe.add(eq);
const sats = [];
const plaque = ctex(512, 96);
const pm = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.68), basic(0xffffff, { map: plaque.t, transparent: true })); pm.position.set(0, 3.1, 0); dsG.add(pm); pm.userData.bi = 6; picks.push(pm);
function drawPlaque() {
  const x = plaque.x; x.clearRect(0, 0, 512, 96); x.fillStyle = S.card; rr(x, 2, 2, 508, 92, 14); x.fill();
  x.fillStyle = ink('#9085e9'); x.font = '800 40px ' + HEAD; x.fillText('DEEP SPACE', 24, 46);
  x.fillStyle = S.sec; x.font = '24px ' + FONT; x.fillText('Someday · ' + HB.t.length + ' with no date', 24, 80); plaque.t.needsUpdate = true;
}

// ---------- the big mission control screen ----------
const BIG = { x: 0, y: 18.5, z: -29.3, w: 27, h: 9 };
const big = ctex(1536, 512);
const bigScr = new THREE.Mesh(new THREE.PlaneGeometry(BIG.w, BIG.h), basic(0xffffff, { map: big.t })); bigScr.position.set(BIG.x, BIG.y, BIG.z); scene.add(bigScr);
bigScr.userData.big = true; picks.push(bigScr); box(28, 9.8, 0.3, frameM, 0, 18.5, -29.5);
let tasks = [], NL = null, blips = [], segs = [], bigHover = null;
function nextLaunch() {
  const n = new Date(), f = tasks.filter((t) => t.due && parse(t.due) > n), timed = f.filter((t) => !t.allDay);
  return (timed.length ? timed : f).sort((a, b) => parse(a.due) - parse(b.due))[0] || null;
}
function cd(ms) { if (ms < 0) return 'T+ 00:00:00'; const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), z = (n) => String(n).padStart(2, '0'); return 'T-minus ' + (d ? d + 'd ' : '') + z(Math.floor(s % 86400 / 3600)) + ':' + z(Math.floor(s % 3600 / 60)) + ':' + z(s % 60); }
const RC = { x: 1290, y: 262, r: 190 };
function drawBig(T) {
  const { x, c } = big, w = c.width, h = c.height;
  x.fillStyle = S.bg; x.fillRect(0, 0, w, h); scan(x, w, h); x.strokeStyle = S.border; x.lineWidth = 6; x.strokeRect(3, 3, w - 6, h - 6);
  const n = new Date();
  x.fillStyle = S.acc; x.font = '800 50px ' + HEAD; x.fillText('MISSION CONTROL', 48, 74);
  x.fillStyle = S.mu; x.font = '30px ' + FONT;
  x.fillText(n.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + '   ' + n.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }), 48, 114);
  if (NL) {
    if (bigHover && bigHover.kind === 'next') { x.fillStyle = S.line; rr(x, 36, 262, 940, 92, 10); x.fill(); }
    x.fillStyle = S.tx; x.font = '500 100px ui-monospace,Menlo,monospace'; x.fillText(cd(parse(NL.due) - n), 48, 236);
    x.fillStyle = S.acc2; x.font = '34px ' + FONT; x.fillText(fit(x, 'Next launch: ' + NL.name, 920), 48, 296);
    x.fillStyle = S.mu; x.font = '28px ' + FONT; x.fillText(fmt(NL), 48, 338);
  } else { x.fillStyle = S.tx; x.font = '500 64px ' + FONT; x.fillText(tasks.length ? 'No deadlines ahead' : 'Waiting for data', 48, 236); }
  segs = []; let bx = 48; const bw = 920, tot = tasks.length;
  if (tot) BK.forEach((b, i) => {
    const sw = bw * b.t.length / tot; if (sw <= 0) return;
    const hv = bigHover && bigHover.kind === 'seg' && bigHover.i === i;
    x.fillStyle = b.col; x.globalAlpha = hv ? 1 : 0.85; x.fillRect(bx, hv ? 378 : 384, Math.max(2, sw - 4), hv ? 38 : 26); x.globalAlpha = 1;
    x.fillStyle = hv ? S.tx : S.sec; x.font = (hv ? '700 ' : '') + '21px ' + FONT;
    const lb = b.t.length + ' ' + b.l.toLowerCase();
    if (x.measureText(lb).width < sw - 6) x.fillText(lb, bx, 446); else if (sw > 22) x.fillText(b.t.length, bx, 446);
    segs.push({ x0: bx, x1: bx + sw, i }); bx += sw;
  });
  const cx = RC.x, cy = RC.y, RR = RC.r;
  x.strokeStyle = S.radar; x.lineWidth = 2; [RR, RR * 0.66, RR * 0.33].forEach((r) => { x.beginPath(); x.arc(cx, cy, r, 0, 6.283); x.stroke(); });
  x.beginPath(); x.moveTo(cx - RR, cy); x.lineTo(cx + RR, cy); x.moveTo(cx, cy - RR); x.lineTo(cx, cy + RR); x.stroke();
  const sw = (T * 1.1) % 6.283;
  x.fillStyle = S.sweep; x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, RR, sw - 0.7, sw); x.closePath(); x.fill();
  x.strokeStyle = S.acc; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(sw) * RR, cy + Math.sin(sw) * RR); x.stroke();
  blips.forEach((p) => {
    const df = ((sw - p.a) % 6.283 + 6.283) % 6.283, hv = bigHover && bigHover.kind === 'blip' && bigHover.p === p;
    x.globalAlpha = hv ? 1 : Math.max(0.28, 1 - df / 3.2);
    const bx2 = cx + Math.cos(p.a) * p.r, by2 = cy + Math.sin(p.a) * p.r; dot(x, bx2, by2, hv ? 12 : 8, p.c);
    if (hv) { x.strokeStyle = S.tx; x.lineWidth = 2; x.beginPath(); x.arc(bx2, by2, 17, 0, 6.283); x.stroke(); }
  });
  x.globalAlpha = 1; x.fillStyle = S.mu; x.font = '22px ' + FONT; x.textAlign = 'center'; x.fillText('Closer to center = more urgent', cx, cy + RR + 38); x.textAlign = 'left';
  big.t.needsUpdate = true;
}
function bigRegion(uv) {
  const px = uv.x * 1536, py = (1 - uv.y) * 512;
  if (py >= 368 && py <= 458) { const s = segs.find((s) => px >= s.x0 && px < s.x1); if (s) { const b = BK[s.i]; return { kind: 'seg', i: s.i, text: b.t.length + ' ' + b.l.toLowerCase() + '. Click to open the station.' }; } }
  if (NL && py >= 250 && py <= 356 && px >= 36 && px <= 980) return { kind: 'next', i: BI(NL.b), text: 'Open ' + NL.name };
  const dx = px - RC.x, dy = py - RC.y;
  if (Math.hypot(dx, dy) < RC.r + 12) {
    let best = null, bd = touchy ? 40 : 24;
    blips.forEach((p) => { const d = Math.hypot(px - (RC.x + Math.cos(p.a) * p.r), py - (RC.y + Math.sin(p.a) * p.r)); if (d < bd) { bd = d; best = p; } });
    if (best) return { kind: 'blip', p: best, i: best.bi, text: best.t.name + ' · ' + BK[best.bi].l };
  }
  return null;
}

/* ---------- putting the reminders in the room ---------- */
let shownSig = '';
function visibleTasks() {
  const hide = new Set(pending.map((p) => p.id));
  return (data && Array.isArray(data.tasks) ? data.tasks : []).filter((t) => !hide.has(t.id));
}
// Called whenever the data, the hidden Done taps or the date changes. Rebuilds only if something shows differently.
function refresh(force) {
  const list = visibleTasks();
  const sig = day0().getTime() + '|' + list.map((t) => t.id + t.name + t.due + t.list).join('|');
  if (sig === shownSig && !force) return;
  shownSig = sig;
  setTasks(list);
}
function setTasks(list) {
  ranges();
  tasks = list.map((t) => ({ ...t, b: bucket(t) }));
  BK.forEach((b) => {
    b.t = tasks.filter((t) => t.b === b.k).sort((x, y) => b.k === 'someday'
      ? (x.list < y.list ? -1 : x.list > y.list ? 1 : x.name.localeCompare(y.name))
      : (parse(x.due) - parse(y.due)) || x.name.localeCompare(y.name));
  });
  cardMeshes = [];
  BK.slice(0, 6).forEach((b, i) => {
    b.cards.forEach((m) => { b.cs.remove(m); m.userData.tx.t.dispose(); m.material.dispose(); });
    b.cards = []; b.off = 0;
    b.t.forEach((t) => {
      const tx = ctex(512, 112);
      const m = new THREE.Mesh(CARDG, basic(0xffffff, { map: tx.t, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      m.userData = { bi: i, task: t, tx }; b.cs.add(m); b.cards.push(m); cardMeshes.push(m);
      m.material.color.setScalar(isDay ? 1 - (1 - b.dim) * 0.55 : b.dim);
    });
  });
  sats.forEach((o) => { scene.remove(o.s); scene.remove(o.lab); o.s.material.dispose(); o.tx.t.dispose(); o.lab.material.dispose(); });
  sats.length = 0;
  const NS = HB.t.length, tiers = Math.max(3, Math.ceil(NS / 18)), ringR = NS > 54 ? 12 : 10.5;
  let sd2 = 11; const r2 = () => (sd2 = (sd2 * 16807) % 2147483647) / 2147483647;
  HB.t.forEach((t, i) => {
    const s = new THREE.Mesh(SATG, basic(lcol(t.list))); scene.add(s); s.userData = { bi: 6, task: t };
    const tx = ctex(512, 84);
    const lab = new THREE.Mesh(LABG, basic(0xffffff, { map: tx.t, transparent: true, depthWrite: false, opacity: 0 })); lab.visible = false; lab.scale.setScalar(SK); scene.add(lab); lab.userData = { bi: 6, task: t };
    const ang = i / NS * 6.283, tier = i % tiers;
    sats.push({ s, lab, tx, t, q: new THREE.Quaternion().setFromEuler(new THREE.Euler((r2() - 0.5) * 2.2, r2() * 6.28, (r2() - 0.5) * 2.2)),
      r: 2.7 + r2() * 1.5, th: r2() * 6.283, sp: 0.15 + r2() * 0.35,
      tgt: V(Math.sin(ang) * ringR, (tier / (tiers - 1) - 0.5) * 6.4, Math.cos(ang) * ringR).multiplyScalar(SK).add(DS) });
    cardMeshes.push(s, lab);
  });
  NL = nextLaunch();
  blips = tasks.filter((t) => ['overdue', 'today', 'tomorrow', 'week'].includes(t.b)).map((t, i) => {
    const r = { overdue: [30, 75], today: [90, 125], tomorrow: [135, 160], week: [160, 185] }[t.b];
    return { a: (i * 2.399) % 6.283, r: r[0] + ((i * 37) % 100) / 100 * (r[1] - r[0]), c: BK[BI(t.b)].col, bi: BI(t.b), t };
  });
  bigHover = null;
  redrawAll();
  if (!bigFocus) { if (cur >= 0 && cur < 7) showStation(cur); else showOverview(); }
}
function redrawAll() {
  BK.slice(0, 6).forEach((b) => { drawScreen(b); b.cards.forEach((m) => drawCard(m.userData.tx, m.userData.task, b.col)); });
  sats.forEach((o) => drawSat(o.tx, o.t)); drawPlaque(); drawBig(clock.elapsedTime);
}

/* =====================================================================================================
   Day and night (follows Appearance in Settings: Light = day, Dark = night)
   ===================================================================================================== */
const ICO = { sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>' };
function applyTheme(d) {
  isDay = d; const P = d ? DAY : NIGHT; S = P.S;
  document.documentElement.setAttribute('data-theme', d ? 'light' : 'dark');
  document.querySelector('meta[name=theme-color]').setAttribute('content', P.bg);
  scene.fog.color.setHex(P.fog); scene.fog.near = P.fogN; scene.fog.far = P.fogF;
  skyU.uTop.value.setRGB(...P.sky[0]); skyU.uHor.value.setRGB(...P.sky[1]); skyU.uGlow.value.setRGB(...P.sky[2]);
  groundM.color.setHex(P.ground); floorM.color.setHex(P.floor[0]); floorM.metalness = P.floor[1]; floorM.roughness = P.floor[2];
  wallM.color.setHex(P.wall[0]); wallM.metalness = P.wall[1]; mullM.color.setHex(P.mull); mountM.color.setHex(P.mount);
  deskM.color.setHex(P.desk[0]); deskM.metalness = P.desk[1]; deskTopM.color.setHex(P.deskTop); frameM.color.setHex(P.frame); padM.color.setHex(P.pad);
  keyDimM.color.setHex(P.keyDim); stripM.color.setHex(P.strip); innerM.color.setHex(P.inner);
  amb.color.setHex(P.amb[0]); amb.intensity = P.amb[1]; hemi.color.setHex(P.hemi[0]); hemi.groundColor.setHex(P.hemi[1]); hemi.intensity = P.hemi[2];
  sunL.color.setHex(P.sun[0]); sunL.intensity = P.sun[1]; sunL.position.set(P.sun[2], P.sun[3], P.sun[4]);
  roomL.forEach((l) => { l.color.setHex(P.room[0]); l.intensity = P.room[1]; }); spots.forEach((s) => { s.intensity = P.spot; });
  stars.visible = !d; moon.visible = !d; sunM.visible = d; beams.forEach((b) => { b.visible = !d; });
  dust.material.color.setHex(d ? 0x5f8f80 : 0x9fe1cb); if (d) { shootT = -1; shoot.material.opacity = 0; }
  if (bloom) { bloom.strength = P.bloom[0]; bloom.threshold = P.bloom[1]; bloom.enabled = P.bloom[0] > 0; }
  applyDim();
  redrawAll();
  $('theme-ico').innerHTML = d ? ICO.moon : ICO.sun;
  $('theme-label').textContent = d ? 'Night' : 'Day';
  $('bTheme').title = d ? 'Switch to night' : 'Switch to day';
}
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
function themeFromSettings() {
  const t = store.get('theme', 'dark');
  applyTheme(t === 'auto' ? !darkMQ.matches : t === 'light');
  markSegs();
}
darkMQ.addEventListener('change', () => { if (store.get('theme', 'dark') === 'auto') themeFromSettings(); });
$('bTheme').onclick = () => { store.set('theme', isDay ? 'dark' : 'light'); themeFromSettings(); };

/* =====================================================================================================
   The side panel
   ===================================================================================================== */
let frozen = false, spread = 0;
function showOverview() {
  const od = BK[0].t.length, td = BK[1].t.length;
  panelBody.innerHTML = '<div class="p-title">Mission overview</div><div class="p-sub">' +
    (data ? tasks.length + ' to do. ' + od + ' overdue, ' + td + ' due today.' : syncKey() ? 'Loading your reminders…' : 'Add your access key in Settings to load your reminders.') + '</div>' +
    BK.map((b, i) => '<button type="button" class="st" data-st="' + i + '"><span class="sw" style="background:' + b.col + '"></span><span class="tx">' + b.l +
      ' <span class="rg">· ' + b.c + '</span><br><span class="rg">' + RANGE[b.k] + '</span></span><span class="n">' + b.t.length + '</span></button>').join('');
}
function row(t) {
  return '<div class="task"><span class="tx">' + esc(t.name) + '<br><span class="meta"><i style="background:' + lcol(t.list) + '"></i>' + esc(t.list) +
    (t.due ? ' · ' + fmt(t) : '') + (t.repeats ? ' · repeats' : '') + '</span></span><button type="button" class="done-btn" data-done="' + esc(t.id) + '">Done</button></div>';
}
function showStation(i) {
  const b = BK[i];
  let h = '<button type="button" class="p-back" data-over="1">‹ Overview</button><div class="p-title" style="color:' + b.col + '">' + b.l + '</div><div class="p-sub">' + b.c + ' · ' + RANGE[b.k] + '</div>';
  if (b.k === 'someday') {
    h += '<div class="deep"><button type="button" class="btn" id="bFreeze">' + (frozen ? 'Unfreeze' : 'Freeze') + '</button><label for="spread">Spread</label>' +
      '<input type="range" id="spread" min="0" max="100" step="1" value="' + Math.round(spread * 100) + '"><span class="out" id="spreadOut">' + spreadText() + '</span></div>';
  }
  if (!b.t.length) h += '<div class="clear">All clear.</div>';
  else if (b.k === 'someday') { let last = ''; b.t.forEach((t) => { if (t.list !== last) { h += '<div class="grp" style="color:' + lcol(t.list) + '">' + esc(t.list) + '</div>'; last = t.list; } h += row(t); }); }
  else b.t.forEach((t) => { h += row(t); });
  panelBody.innerHTML = h;
  panel.scrollTop = 0;
}
const spreadText = () => (spread === 0 ? 'Orbiting' : spread === 1 ? 'Spread out' : Math.round(spread * 100) + '%');
panel.addEventListener('click', (e) => {
  const a = e.target.closest('[data-st]'), o = e.target.closest('[data-over]'), d = e.target.closest('[data-done]');
  if (e.target.closest('#bFreeze')) { frozen = !frozen; e.target.closest('#bFreeze').textContent = frozen ? 'Unfreeze' : 'Freeze'; return; }
  if (d) { markDone(d.dataset.done); return; }
  if (a) goStation(+a.dataset.st);
  if (o) { if (walk) { cur = -1; showOverview(); } else goHome(); }
});
panel.addEventListener('input', (e) => {
  if (e.target.id !== 'spread') return;
  spread = +e.target.value / 100; $('spreadOut').textContent = spreadText();
  if (cur === 6 && !walk) deepView();
});
$('panel-fold').onclick = () => panel.classList.toggle('folded');
function unfold() { panel.classList.remove('folded'); }

/* ---------- Done ---------- */
let toastTimer = 0, lastDone = null;
function toast(text, undo) {
  $('toast-text').textContent = text; $('toast-undo').hidden = !undo; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, undo ? 4500 : 6000);
}
function markDone(id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  if (!syncKey()) { toast('To tick things off from here, add your access key in Settings.'); return; }
  lastDone = { id: t.id, name: t.name, list: t.list, at: Date.now(), sent: false };
  pending.push(lastDone); store.set('pending', pending);
  refresh();
  toast(`Ticked off “${t.name}”.`, true);
  setTimeout(() => { pull(); }, 4800);
}
$('toast-undo').onclick = () => {
  if (lastDone && !lastDone.sent) { pending = pending.filter((p) => p !== lastDone); store.set('pending', pending); refresh(); }
  lastDone = null; $('toast').hidden = true;
};

/* =====================================================================================================
   Moving around: flying between views, the big screen, walking
   ===================================================================================================== */
let fly = null, watch = false, cur = -1;
function flyTo(p, t) { fly = { p, t }; watch = false; }
let walk = false, yaw = 0, pitch = 0, bobT = 0; const keys = {}, touch = {}; const EYE = 5.4;
const walkHint = $('walkHint'), cross = $('cross'), padEl = $('pad'), hint = $('hint'), bWalk = $('bWalk'), bigBack = $('bigBack');
hint.textContent = touchy ? 'Drag to look around, pinch to zoom. Tap a console, the big screen, or Deep space out the window.'
  : 'Drag to look around. Scroll to zoom. Click a console, the big screen, or Deep space out the window. Enter to walk.';
walkHint.textContent = touchy ? 'Use the arrows to walk · drag to look' : 'W A S D or arrows to move · drag to look · Shift to run · Esc to stop';
let hintGone = false;
function dropHint() { if (!hintGone) { hintGone = true; hint.style.opacity = 0; } }
let bigFocus = false;
const show = (el, on) => { el.style.opacity = on ? 1 : 0; el.style.pointerEvents = on ? 'auto' : 'none'; };
function exitBig() { if (!bigFocus) return; bigFocus = false; bigHover = null; show(panel, true); show(bigBack, false); $('bBig').classList.remove('on'); }
function goBig() {
  setWalk(false); cur = 7; bigFocus = true; show(panel, false); show(bigBack, true); dropHint(); $('bBig').classList.add('on');
  const vf = camera.fov * Math.PI / 360, hf = Math.atan(Math.tan(vf) * camera.aspect);
  const d = Math.max((BIG.w * 1.06 / 2) / Math.tan(hf), (BIG.h * 1.12 / 2) / Math.tan(vf));
  flyTo(V(BIG.x, BIG.y, BIG.z + d), V(BIG.x, BIG.y, BIG.z));
}
bigBack.onclick = () => goHome();
$('bBig').onclick = goBig;
function setWalk(on) {
  if (on === walk) return;
  walk = on; controls.enabled = !on; fly = null; watch = false;
  for (const k in keys) keys[k] = false; for (const k in touch) touch[k] = false;
  bWalk.classList.toggle('on', on);
  if (on) {
    exitBig(); dropHint();
    const d = new THREE.Vector3(); camera.getWorldDirection(d); yaw = Math.atan2(-d.x, -d.z); pitch = 0;
    const p = camera.position;
    if (p.z > -30 && p.z < 30 && Math.abs(p.x) < 40) { p.x = clamp(p.x, -38.5, 38.5); p.z = clamp(p.z, -28.5, 28.5); }
    collide(p.clone(), p); camera.rotation.order = 'YXZ';
    show(walkHint, true); cross.style.opacity = 1; show(padEl, true);
    bWalk.querySelector('span').textContent = 'Stop walking'; renderer.domElement.focus();
  } else {
    const f = V(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    controls.target.copy(camera.position).addScaledVector(f, 10);
    show(walkHint, false); cross.style.opacity = 0; show(padEl, false);
    bWalk.querySelector('span').textContent = 'Walk';
  }
}
bWalk.onclick = () => setWalk(!walk);
function goStation(i) {
  if (i === 7) { goBig(); return; }
  exitBig(); cur = i; showStation(i); unfold(); dropHint();
  if (walk) return;
  // On a phone the list covers the bottom of the screen, so look a little lower to keep the station above it.
  const lift = narrow() ? 2.6 : 0;
  if (i === 6) deepView();
  else { const g = BK[i].g; flyTo(g.localToWorld(V(narrow() ? 0 : 2.3, 9.2 + lift, 14.5 + lift * 2)), g.localToWorld(V(narrow() ? 0 : 2.3, 7.4 - lift * 0.9, 0))); }
}
function deepView() {   // out past the window (stays outside it); further back when the ring is spread out
  const k = 1 + spread * 0.25, sx = narrow() ? 0 : 7 * k;
  flyTo(DS.clone().add(V(sx, 8 * k, 36 * k)), DS.clone().add(V(sx, narrow() ? -6 * k : 0, 0)));
}
function goHome() { setWalk(false); exitBig(); cur = -1; const h = homeView(); flyTo(h.p, h.t); showOverview(); }
$('bOver').onclick = goHome;
$('bNext').onclick = () => { setWalk(false); goStation((cur + 1) % 8); };
$('bWin').onclick = () => { setWalk(false); exitBig(); cur = -1; flyTo(V(0, 9, -24), V(0, 36, -220)); showOverview(); };
let touched = false;
controls.addEventListener('start', () => { touched = true; fly = null; watch = false; exitBig(); dropHint(); });

const obstacles = BK.slice(0, 6).map((b, i) => ({ x: b.g.position.x, z: b.g.position.z, r: 4.8 * LAY[i].s }));
[-26, -13, 13, 26].forEach((x) => obstacles.push({ x, z: -30, r: 1 }));
const rocketOb = { x: PAD.x, z: PAD.z, r: 10 }, towerOb = { x: 15, z: PAD.z, r: 5.5 };
function collide(prev, p) {
  const m = 1.2;
  if (p.z > -30 - m && p.z < 30 + m) [-40, 40].forEach((wx) => { const s = Math.sign(prev.x - wx) || 1; if ((p.x - wx) * s < m) p.x = wx + s * m; });
  if (p.x > -40 - m && p.x < 40 + m) { const s = Math.sign(prev.z - 30) || -1; if ((p.z - 30) * s < m) p.z = 30 + s * m; }
  p.x = clamp(p.x, -700, 700); p.z = clamp(p.z, -1000, 250);
  obstacles.concat(rocket.position.y < 20 ? [rocketOb, towerOb] : [towerOb]).forEach((o) => {
    const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz) || 0.001; if (d < o.r) { p.x = o.x + dx / d * o.r; p.z = o.z + dz / d * o.r; }
  });
}
const MOVE = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', ' ']);
addEventListener('keydown', (e) => {
  if (!$('settings-sheet').hidden || e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (!walk) {
    if (k === 'escape' && bigFocus) { goHome(); return; }
    if (k === 'enter' && document.activeElement === renderer.domElement) { e.preventDefault(); setWalk(true); }
    return;
  }
  if (k === 'escape') { setWalk(false); return; }
  if (MOVE.has(k)) { e.preventDefault(); keys[k] = true; }
});
addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
padEl.querySelectorAll('[data-k]').forEach((b) => {
  const k = b.dataset.k;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); touch[k] = true; b.setPointerCapture(e.pointerId); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => b.addEventListener(ev, () => { touch[k] = false; }));
});
let launchT = -1; const bL = $('bLaunch');
bL.onclick = () => {
  if (launchT >= 0) return; launchT = 0; bL.classList.add('on');
  if (!walk) { exitBig(); flyTo(V(0, 9, -24), V(0, 36, -220)); setTimeout(() => { if (!walk) watch = true; }, 1300); }
};

/* ---------- clicking and hovering in the room ---------- */
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(); let down = null, last = null, dragging = false;
function hit(e, list) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(mouse, camera);
  return ray.intersectObjects(list, false).find((h) => h.object.visible && (!h.object.material.transparent || h.object.material.opacity > 0.25));
}
const cvs = renderer.domElement;
cvs.addEventListener('pointerdown', (e) => {
  down = [e.clientX, e.clientY]; last = [e.clientX, e.clientY]; dragging = true; wrap.style.cursor = 'grabbing'; tip.style.opacity = 0;
  if (walk) { cvs.setPointerCapture(e.pointerId); cvs.focus(); }
});
cvs.addEventListener('pointerup', (e) => {
  dragging = false; wrap.style.cursor = 'grab';
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > (touchy ? 10 : 5)) return;
  const h = hit(e, cardMeshes.concat(picks)); if (!h) return;
  if (h.object.userData.big) { if (bigFocus && h.uv) { const r = bigRegion(h.uv); if (r) goStation(r.i); } else goBig(); return; }
  goStation(h.object.userData.bi);
});
function showTip(e, html) { tip.innerHTML = html; tip.style.left = Math.min(e.clientX + 14, W - 270) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; tip.style.opacity = 1; }
cvs.addEventListener('pointermove', (e) => {
  if (dragging) {
    if (walk && last) { yaw -= (e.clientX - last[0]) * 0.0045; pitch = clamp(pitch - (e.clientY - last[1]) * 0.0045, -1.35, 1.35); }
    last = [e.clientX, e.clientY]; return;
  }
  if (e.pointerType === 'touch') return;
  const h = hit(e, cardMeshes.concat([bigScr])); bigHover = null;
  if (h && h.object.userData.big) {
    if (bigFocus && h.uv) { const r = bigRegion(h.uv); bigHover = r; if (r) { showTip(e, esc(r.text)); wrap.style.cursor = 'pointer'; } else { tip.style.opacity = 0; wrap.style.cursor = 'grab'; } }
    else { showTip(e, '<b>Mission control</b><br><span class="s">Click to focus on the big screen</span>'); wrap.style.cursor = 'pointer'; }
    return;
  }
  wrap.style.cursor = 'grab';
  if (h && h.object.userData.task) { const t = h.object.userData.task; showTip(e, '<b>' + esc(t.name) + '</b><br><span class="s">' + esc(t.list) + ' · ' + fmt(t) + '</span>'); }
  else tip.style.opacity = 0;
});
cvs.addEventListener('pointerleave', () => { tip.style.opacity = 0; bigHover = null; });

/* =====================================================================================================
   Animation
   ===================================================================================================== */
const clock = new THREE.Clock();
let lastBig = 0, lastDay = day0().getTime(); const tmpV = new THREE.Vector3();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05), T = clock.elapsedTime;
  BK[0].strip.opacity = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(T * 2.2)); beaconM.opacity = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(T * 2.4));
  BK.slice(0, 6).forEach((b) => {
    const n = b.cards.length; if (!n) return;
    if (n <= SLOTS) b.cards.forEach((m, j) => { m.position.y = (n - 1 - j) * STEP + Math.sin(T * 1.1 + j * 0.9) * 0.05; m.material.opacity = 0.95; m.visible = true; });
    else {
      b.off += dt * 0.3; const L = n * STEP, hi = (SLOTS - 1) * STEP;
      b.cards.forEach((m, j) => { const p = ((((SLOTS - 1 - j) * STEP + b.off) % L) + L) % L; const f = clamp(Math.min(p / 0.7 + 1, (hi - p) / 0.7 + 1), 0, 1);
        m.position.y = p; m.material.opacity = 0.95 * f; m.visible = f > 0.02; });
    }
  });
  pulses.forEach((m) => {
    const u = (T * 0.06 + m.userData.o) % 1, z = RUN.z0 + (RUN.z1 - RUN.z0) * u * u, w = clamp((z + 12) / 24, 0, 1);
    m.position.set(0, 0.16, z); m.scale.setScalar(0.6 + u * 0.9);
    m.material.color.copy(w < 0.5 ? PC[0].clone().lerp(PC[1], w * 2) : PC[1].clone().lerp(PC[2], w * 2 - 1));
  });
  const od = BK[0];
  if (od.beacons) { const on = od.t.length > 0, ph = (T * 1.6) % 1 < 0.5;
    od.beacons.forEach((m, j) => { m.visible = on; m.material.opacity = (j === 0) === ph ? 1 : 0.18; });
    od.pl.intensity = on ? 0.75 + 0.9 * Math.max(0, Math.sin(T * 6.3)) : 0.75; }
  if (!frozen) { globe.rotation.y += dt * 0.1; sats.forEach((o) => { o.th += o.sp * dt; }); }
  pm.quaternion.copy(camera.quaternion);
  const e = spread < 0.5 ? 2 * spread * spread : 1 - Math.pow(-2 * spread + 2, 2) / 2, la = clamp((spread - 0.35) / 0.4, 0, 1);
  sats.forEach((o) => {
    tmpV.set(Math.cos(o.th) * o.r, 0, Math.sin(o.th) * o.r).applyQuaternion(o.q).multiplyScalar(DK).add(DS);
    o.s.position.lerpVectors(tmpV, o.tgt, e); o.s.scale.setScalar(DK + (SK * 1.5 - DK) * e);
    o.lab.visible = la > 0.01; o.lab.material.opacity = la * 0.95;
    if (o.lab.visible) { o.lab.position.copy(o.s.position); o.lab.position.y += 0.48 * SK; o.lab.quaternion.copy(camera.quaternion); }
  });
  dust.rotation.y = Math.sin(T * 0.05) * 0.08; dust.position.y = Math.sin(T * 0.21) * 0.3;
  beams.forEach((b) => { b.rotation.z = Math.sin(T * 0.22 + b.userData.ph) * 0.38; b.rotation.x = -0.12 + Math.sin(T * 0.15 + b.userData.ph) * 0.12; });
  wisps.forEach((m, i) => { const p = (T * 0.05 + m.userData.ph) % 1; m.position.set(PAD.x + Math.sin(i * 1.7) * 9 * (0.3 + p), 4 + p * 42, PAD.z + Math.cos(i * 2.3) * 7 * (0.3 + p)); m.scale.setScalar(0.8 + p * 2.6); m.material.opacity = launchT > 1 ? 0 : (isDay ? 0.3 : 0.2) * (1 - p) * Math.min(1, p * 5); });
  if (!isDay && shootT < 0 && T > shootNext) {
    shootT = 0; shoot.position.set(-500 + Math.random() * 1000, 420 + Math.random() * 250, -900 - Math.random() * 300);
    shootV.set((Math.random() < 0.5 ? -1 : 1) * (500 + Math.random() * 300), -220, 60); shoot.lookAt(shoot.position.clone().add(shootV));
  }
  if (shootT >= 0) { shootT += dt; shoot.position.addScaledVector(shootV, dt); shoot.material.opacity = Math.max(0, Math.sin(Math.min(1, shootT / 1.1) * Math.PI)) * 0.9; if (shootT > 1.1) { shootT = -1; shoot.material.opacity = 0; shootNext = T + 5 + Math.random() * 7; } }
  if (T - lastBig > 0.1) {
    drawBig(T); lastBig = T;
    if (innerWidth && (innerWidth !== W || innerHeight !== H)) onResize();   // a missed resize (opened in the background)
    const d0 = day0().getTime(); if (d0 !== lastDay) { lastDay = d0; refresh(); }   // past midnight: reminders move along a station
  }
  if (launchT >= 0) {
    launchT += dt; const lt = launchT; if (lt > 0.5) arm.rotation.y = Math.min(1.2, (lt - 0.5) * 0.8);
    if (lt > 1.3) {
      flame.visible = true; flame.scale.set(1, 0.85 + Math.random() * 0.3, 1); flameL.intensity = 3 + Math.random();
      const a = Math.max(0, lt - 3); rocket.position.y = 2 + 3.5 * a * a;
      plume.forEach((m) => { const k = Math.min(1, (lt - 1.3) / 4); m.position.set(PAD.x + Math.cos(m.userData.a) * k * 50, 4 + k * 6, PAD.z + Math.sin(m.userData.a) * k * 50); m.scale.setScalar(0.4 + k * 1.9); m.material.opacity = Math.max(0, 0.5 * (1 - (lt - 6) / 10)); });
    }
    if (lt > 4 && lt < 9) { const sh = 0.05 * (1 - (lt - 4) / 5); camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh; }
    if (lt > 20) { launchT = -1; watch = false; rocket.position.y = 2; arm.rotation.y = 0; flame.visible = false; flameL.intensity = 0; plume.forEach((m) => { m.material.opacity = 0; }); bL.classList.remove('on'); }
  }
  if (walk) {
    const fwd = (keys.w || keys.arrowup || touch.f ? 1 : 0) - (keys.s || keys.arrowdown || touch.b ? 1 : 0), str = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
    const turn = (keys.arrowleft || touch.tl ? 1 : 0) - (keys.arrowright || touch.tr ? 1 : 0);
    yaw += turn * 1.9 * dt; const run = keys.shift, sp = (run ? 20 : 8.5) * dt;
    const mv = V(-Math.sin(yaw) * fwd + Math.cos(yaw) * str, 0, -Math.cos(yaw) * fwd - Math.sin(yaw) * str);
    if (mv.lengthSq() > 0) { mv.normalize().multiplyScalar(sp); const prev = camera.position.clone(), np = prev.clone().add(mv); collide(prev, np); camera.position.x = np.x; camera.position.z = np.z; bobT += dt * (run ? 13 : 8.5); }
    camera.position.y += (EYE + Math.sin(bobT) * 0.07 - camera.position.y) * 0.1; camera.rotation.set(pitch, yaw, 0, 'YXZ');
  } else {
    const k = 1 - Math.pow(0.013, dt);   // the same glide speed on a slow phone as on a fast Mac
    if (fly) { camera.position.lerp(fly.p, k); controls.target.lerp(fly.t, k); if (camera.position.distanceTo(fly.p) < 0.05) fly = null; }
    if (watch) { const rp = rocket.position.clone(); rp.y += 36; controls.target.lerp(rp, k); }
    controls.update();
  }
  cullShell();
  if (composer) composer.render(); else renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
function onResize() {
  if (!innerWidth || !innerHeight) return;
  W = innerWidth; H = innerHeight; renderer.setSize(W, H); if (composer) composer.setSize(W, H);
  camera.aspect = W / H; camera.updateProjectionMatrix();
  if (bigFocus) goBig(); else if (cur === -1 && !walk && !touched) goHome();   // still on the first view: re-frame it
}
addEventListener('resize', onResize);

/* =====================================================================================================
   Settings
   ===================================================================================================== */
const sheet = $('settings-sheet');
function openSettings() {
  $('ver-line').textContent = `You're on ${window.APP_VERSION}.`; $('set-update').disabled = false;
  drawSync(); markSegs(); sheet.hidden = false;
}
function closeSettings() { sheet.hidden = true; }
$('settings-open').onclick = openSettings;
$('sync-chip').onclick = openSettings;
sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('[data-close]')) closeSettings(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSettings(); });
function markSegs() {
  const t = store.get('theme', 'dark');
  document.querySelectorAll('.seg[data-key=theme] [data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === t)));
}
document.querySelectorAll('.seg[data-key=theme] [data-v]').forEach((b) => { b.onclick = () => { store.set('theme', b.dataset.v); themeFromSettings(); }; });
$('sync-now').onclick = () => { $('sync-line').textContent = 'Checking…'; pull(); };
$('key-save').onclick = () => {
  const v = $('key-input').value.trim(); if (!v) return;
  try { localStorage.setItem('lc.sync-token', v); } catch (e) { /* private mode */ }
  $('key-input').value = ''; pull();
};
$('set-update').onclick = async () => {
  const ver = $('ver-line'), ub = $('set-update'), reg = window.SW_REG;
  if (!reg || !navigator.onLine) { ver.textContent = 'Connect to the internet, then try again.'; return; }
  ub.disabled = true; ver.textContent = 'Checking…';
  try { await reg.update(); } catch (e) { /* offline */ }
  const w = reg.waiting || reg.installing;
  if (w) {
    ver.textContent = 'Updating now…';
    const go = () => w.postMessage('skipWaiting');
    if (w.state === 'installed') go(); else w.addEventListener('statechange', () => { if (w.state === 'installed') go(); });
  } else { ver.textContent = `You're on the latest version (${window.APP_VERSION}).`; ub.disabled = false; }
};

/* =====================================================================================================
   Start
   ===================================================================================================== */
ranges();
themeFromSettings();
refresh(true);
loop();
drawSync();
pull();
setInterval(() => { if (document.visibilityState === 'visible') pull(); }, 60000);
setInterval(drawSync, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
addEventListener('online', pull);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => redrawAll());
if (narrow()) panel.classList.add('folded');

/* ---------- offline support + updates (see sw.js) ---------- */
(async () => {
  if (!('serviceWorker' in navigator) || location.hostname === 'localhost') return;   // testing on the Mac: always the newest files
  const reg = await navigator.serviceWorker.register('sw.js').catch(() => null);
  if (!reg) return;
  window.SW_REG = reg;
  const banner = $('update-banner');
  const hadController = Boolean(navigator.serviceWorker.controller);
  const apply = (worker) => worker.postMessage('skipWaiting');
  const justOpened = () => performance.now() < 20000;   // nothing to lose right after opening, so update on its own
  const handle = (worker) => {
    if (!worker || !navigator.serviceWorker.controller) return;
    if (justOpened()) apply(worker); else { banner.hidden = false; $('update-btn').onclick = () => apply(worker); }
  };
  const watchW = (worker) => {
    if (!worker) return;
    if (worker.state === 'installed') return handle(worker);
    worker.addEventListener('statechange', () => { if (worker.state === 'installed') handle(worker); });
  };
  handle(reg.waiting); watchW(reg.installing);
  reg.addEventListener('updatefound', () => watchW(reg.installing));
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  const check = () => { if (navigator.onLine) reg.update().catch(() => {}).then(() => handle(reg.waiting)); };
  check();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
})();
