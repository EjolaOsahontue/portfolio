import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import gsap from 'gsap'
import { fallbackFolders, fallbackProjects } from './fallback.js'
import { loadContent } from './supabase.js'
import './panels.js'   // About and Contact drawer

// Folders and projects come from Supabase (see src/supabase.js).
// If Supabase is not set up or can't be reached, src/fallback.js is used.
let folders = fallbackFolders
let projects = fallbackProjects

// ================= TWEAK THESE =================
const ARM_AXIS = 'y'              // tonearm swing axis: 'x' | 'y' | 'z'
const ARM_DELTA = 0.35            // swing amount (try -0.35 if it goes the wrong way)
const FIT = 3.2                   // model size in the scene
const LIFT = 0.55                 // how high a tapped sleeve rises
const SPACING = 0.18              // gap between sleeves in a crate
const PEEK = 0.16                 // how much each sleeve further back sticks up
const CRATE_GAP = 0.2             // gap between crates and turntable
const MODEL_SCREEN_HEIGHT = 0.28  // model takes this fraction of the screen height
const WIDTH_PAD = 1.8             // side room around the scene (bigger = smaller scene)
const BOTTOM_MARGIN = 0.1         // empty space under the model
const WIDTH_PAD_PORTRAIT = 1.2    // same as WIDTH_PAD but for tall phone screens
const BOTTOM_MARGIN_PORTRAIT = 0.2
const CAM_TILT = 0.18             // how much the camera looks down
const FOLLOW = 0.35               // drag smoothness (smaller = floatier, 1 = instant)
const DRAG_START = 6              // pixels you move before a drag begins
const NEAR = 0.26                 // drop zone radius around the record (fraction of screen)
const FAR = 0.55                  // where the vinyl starts tilting flat (fraction of screen)
const GLIDE = 1.8                 // seconds for the vinyl to glide to the record
const SPIN = 1.2                  // seconds per record rotation
const READ_SCALE = 0.5            // scene size while reading (0.5 = half size)
const ZOOM_TIME = 1.6             // seconds for the zoom-out transition
const SLEEVE_FLIP_V = false       // name upside down on the sleeve? set true
const SLEEVE_SWAP_UV = false      // name turned sideways on the sleeve? set true

// ================= SCENE =================
const scene = new THREE.Scene()
scene.background = new THREE.Color('#f5c518')

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 1000)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

scene.add(new THREE.HemisphereLight('#ffffff', '#f5c518', 1.0))
const sun = new THREE.DirectionalLight('#ffffff', 2.5)
sun.position.set(5, 10, 6)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 })
scene.add(sun)

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.ShadowMaterial({ opacity: 0.25 })
)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)

// ================= STATE =================
let model, player, record, recordPivot, tonearm
let armRest = 0
let recordRadius = 0.5
let spinTween = null
let gliding = false
let reading = false
let modelW = 1, modelH = 1
let ready = false
const sleeves = []
const view = { k: 1 }                 // 1 = normal, READ_SCALE = zoomed out
const V = () => new THREE.Vector3()
const tmp = V()
const sm = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x) }
const EPS = 1e-4
const lastPtr = { x: 0, y: 0 }
const dropEl = document.getElementById('drop')

// ---- the vinyl a sleeve turns into (only ONE of sleeve/vinyl is ever visible) ----
const vinyl = new THREE.Group()
const vSpin = new THREE.Group()
const vDisc = new THREE.Mesh(
  new THREE.CylinderGeometry(1, 1, 0.03, 64),
  new THREE.MeshStandardMaterial({ color: '#0b0b0b', roughness: 0.35 })
)
const vLabel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.34, 0.34, 0.034, 48),
  new THREE.MeshStandardMaterial({ color: '#e63946', roughness: 0.6 })
)
vDisc.castShadow = true
vSpin.add(vDisc, vLabel)
vinyl.add(vSpin)
vinyl.visible = false
vinyl.scale.setScalar(EPS)
scene.add(vinyl)

// while carried, the vinyl draws on top of everything (never hidden by a crate)
function setOnTop(on) {
  vDisc.material.depthTest = !on
  vLabel.material.depthTest = !on
  vDisc.renderOrder = on ? 999 : 0
  vLabel.renderOrder = on ? 1000 : 0
}

const UP = new THREE.Vector3(0, 1, 0)
const qFlat = new THREE.Quaternion()
let held = null          // sleeve whose vinyl is being carried
let carryTilt = 0        // 0 = vinyl faces the camera, 1 = lying flat

function updateVinyl() {
  if (!held) return
  held.getWorldPosition(vinyl.position)
  const toCam = tmp.copy(camera.position).sub(vinyl.position).normalize()
  const qFace = new THREE.Quaternion().setFromUnitVectors(UP, toCam)
  vinyl.quaternion.copy(qFace).slerp(qFlat, sm(carryTilt))
}

function toVinyl(s) {
  if (s.userData.form !== 'sleeve') return
  s.userData.form = 'toVinyl'
  s.userData.busy = true
  held = s
  carryTilt = 0
  setOnTop(true)
  vLabel.material.color.set(s.userData.project.color)
  const st = { a: 1, b: 0 }
  gsap.timeline({
    onComplete: () => {
      s.userData.form = 'vinyl'
      s.userData.waiters.splice(0).forEach((f) => f())
    },
  })
    .to(st, {
      a: 0, duration: 0.16, ease: 'power2.in',
      onUpdate: () => s.scale.copy(s.userData.baseScale).multiplyScalar(Math.max(st.a, EPS)),
    })
    .add(() => { s.visible = false; vinyl.visible = true; updateVinyl() })
    .to(st, {
      b: 1, duration: 0.45, ease: 'back.out(1.7)',
      onUpdate: () => {
        vinyl.scale.setScalar(Math.max(recordRadius * st.b, EPS))
        vSpin.rotation.y = -Math.PI * (1 - st.b)
      },
    })
}

function toSleeve(s, then) {
  s.userData.form = 'toSleeve'
  const st = { b: 1, a: 0 }
  gsap.timeline({
    onComplete: () => {
      s.userData.form = 'sleeve'
      s.userData.busy = false
      held = null
      vinyl.visible = false
      then && then()
    },
  })
    .to(st, {
      b: 0, duration: 0.2, ease: 'power2.in',
      onUpdate: () => vinyl.scale.setScalar(Math.max(recordRadius * st.b, EPS)),
    })
    .add(() => { s.visible = true; s.scale.copy(s.userData.baseScale).multiplyScalar(EPS) })
    .to(st, {
      a: 1, duration: 0.4, ease: 'back.out(1.7)',
      onUpdate: () => s.scale.copy(s.userData.baseScale).multiplyScalar(Math.max(st.a, EPS)),
    })
}

function whenVinyl(s, cb) {
  if (s.userData.form === 'vinyl') cb()
  else s.userData.waiters.push(cb)
}

// ================= LOAD CONTENT, THEN THE MODEL =================
loadContent().then((content) => {
  if (content) { folders = content.folders; projects = content.projects }

  new GLTFLoader().load(`${import.meta.env.BASE_URL}models/scene.glb`, (gltf) => {
    model = gltf.scene
    scene.add(model)
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })

    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(V())
    model.scale.setScalar(FIT / Math.max(size.x, size.y, size.z))
    box.setFromObject(model)
    const c = box.getCenter(V())
    model.position.x -= c.x
    model.position.z -= c.z
    model.position.y -= box.min.y
    model.updateMatrixWorld(true)

    try {
      setupParts()
      buildTracklist()
      frameCamera()
      ready = true
    } catch (err) {
      console.error('Setup failed:', err)
    }
  }, undefined, (e) => console.error('Could not load model', e))
})

function setupParts() {
  player = model.getObjectByName('vinyl_player')
  record = model.getObjectByName('Record')
  tonearm = model.getObjectByName('Tonearm')
  armRest = tonearm.rotation[ARM_AXIS]

  // ---- record pivot + visible stripe ----
  const rbox = new THREE.Box3().setFromObject(record)
  const rc = rbox.getCenter(V())
  recordRadius = (rbox.max.x - rbox.min.x) / 2
  recordPivot = new THREE.Group()
  record.parent.add(recordPivot)
  recordPivot.position.copy(record.parent.worldToLocal(rc.clone()))
  recordPivot.updateMatrixWorld(true)
  recordPivot.attach(record)

  const ws = recordPivot.getWorldScale(V()).x
  const rLocal = recordRadius / ws
  const topLocal = (rbox.max.y - rc.y) / ws
  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(rLocal * 0.85, rLocal * 0.07),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.4, depthWrite: false })
  )
  stripe.rotation.x = -Math.PI / 2
  stripe.position.set(rLocal * 0.5, topLocal + 0.003 / ws, 0)
  recordPivot.add(stripe)

  // ---- crates ----
  const binOrig = model.getObjectByName('metal_storage_bin_mesh')
  const base = model.getObjectByName('Sleeve')

  const binBox = new THREE.Box3().setFromObject(binOrig)
  const binSize = binBox.getSize(V())
  const binC = binBox.getCenter(V())
  const binOrigin = binOrig.getWorldPosition(V())
  const ptBox = new THREE.Box3().setFromObject(player)
  const ptSize = ptBox.getSize(V())
  const ptC = ptBox.getCenter(V())

  const sleeveSize = new THREE.Box3().setFromObject(base).getSize(V())
  const thin = sleeveSize.x < sleeveSize.z ? 'x' : 'z'
  const sleeveOffset = base.getWorldPosition(V()).sub(binC)

  // crates are split left / right of the turntable, any number of folders works
  const step = binSize.x + CRATE_GAP
  const first = ptSize.x / 2 + binSize.x / 2 + CRATE_GAP
  const nL = Math.ceil(folders.length / 2)
  const nR = folders.length - nL
  const slotX = [
    ...Array.from({ length: nL }, (_, i) => ptC.x - first - (nL - 1 - i) * step),
    ...Array.from({ length: nR }, (_, i) => ptC.x + first + i * step),
  ]

  folders.forEach((f, i) => {
    const bin = i === 0 ? binOrig : binOrig.clone()
    if (i > 0) {
      bin.material = binOrig.material.clone()
      binOrig.parent.add(bin)
    }
    if (f.color) bin.material.color.set(f.color)
    const delta = new THREE.Vector3(slotX[i] - binC.x, 0, 0)
    bin.position.copy(bin.parent.worldToLocal(binOrigin.clone().add(delta)))
    bin.updateMatrixWorld(true)
    f.bin = bin
    f.sleeves = []
  })

  // centre everything sideways, measure it
  const all = new THREE.Box3().setFromObject(player)
  folders.forEach((f) => all.union(new THREE.Box3().setFromObject(f.bin)))
  model.position.x -= all.getCenter(V()).x
  model.updateMatrixWorld(true)
  all.setFromObject(player)
  folders.forEach((f) => all.union(new THREE.Box3().setFromObject(f.bin)))
  const allSize = all.getSize(V())
  modelW = allSize.x
  modelH = allSize.y + LIFT * 0.5

  // sleeves into their crates
  folders.forEach((f) => {
    const mine = projects.filter((p) => p.folder === f.name)
    const n = mine.length
    const c0 = new THREE.Box3().setFromObject(f.bin).getCenter(V())
    // Thin axis z: the back sleeve keeps the spot a lone sleeve has (clear of the crate's front wall)
    // and the rest step forward from it, so none of them hides behind the wall.
    const sp = thin === 'z' && n > 1 ? Math.min(SPACING, (binSize.z * 0.45) / (n - 1)) : SPACING
    const worlds = mine.map((p, i) => {
      const w = c0.clone().add(sleeveOffset)
      w[thin] += thin === 'z' ? i * sp : (i - (n - 1) / 2) * sp
      return w
    })
    if (thin === 'z' && n > 1) {
      const order = worlds.map((w, i) => i).sort((a, b) => worlds[a].z - worlds[b].z)
      order.forEach((idx, rank) => { worlds[idx].y += (n - 1 - rank) * PEEK })
    }
    mine.forEach((p, i) => {
      const s = base.clone()
      s.material = base.material.clone()
      s.material.color.set(p.color)
      base.parent.add(s)
      applyName(s, p)
      s.position.copy(s.parent.worldToLocal(worlds[i].clone()))
      s.castShadow = true
      s.userData = {
        project: p, folder: f, home: s.position.clone(), baseScale: s.scale.clone(),
        up: false, busy: false, form: 'sleeve', waiters: [],
      }
      sleeves.push(s)
      f.sleeves.push(s)
    })
  })
  base.visible = false

  // crate labels
  const labels = document.getElementById('labels')
  folders.forEach((f) => {
    const b = new THREE.Box3().setFromObject(f.bin)
    f.anchor = new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, b.max.z)
    const el = document.createElement('button')
    el.className = 'crate-label'
    el.innerHTML = `${f.name}<small>${f.sleeves.length}</small>`
    el.addEventListener('click', () => toggleCrate(f))
    labels.appendChild(el)
    f.label = el
  })
  // neighbouring labels sit on alternating rows on narrow screens so they never overlap
  ;[...folders].sort((a, b) => a.anchor.x - b.anchor.x).forEach((f, rank) => { f.row = rank % 2 })
}

// ================= SLEEVE ARTWORK =================
// Prints each project's name on its record sleeve.

// flat (planar) UVs across the sleeve's two big sides, so the artwork maps cleanly
function planarUV(geo) {
  geo.computeBoundingBox()
  const bb = geo.boundingBox
  const size = bb.getSize(new THREE.Vector3())
  const axes = ['x', 'y', 'z'].sort((a, b) => size[b] - size[a])
  let [va, ua] = [axes[0], axes[1]]            // tallest side = up, next = across
  if (SLEEVE_SWAP_UV) [va, ua] = [ua, va]
  const pos = geo.attributes.position
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const p = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) }
    const u = (p[ua] - bb.min[ua]) / (size[ua] || 1)
    let v = (p[va] - bb.min[va]) / (size[va] || 1)
    if (SLEEVE_FLIP_V) v = 1 - v
    uv[i * 2] = u
    uv[i * 2 + 1] = v
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return { uSize: size[ua], vSize: size[va] }
}

// readable text colour for a given sleeve colour
function inkFor(hex) {
  const c = new THREE.Color(hex)
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  return lum > 0.5 ? '#14110b' : '#fffdf3'
}

// draws the sleeve print: folder at the top, the name big at the bottom, status line
// bandFrac = how much of the sleeve's height sticks out above the sleeve in front of it
function drawSleeve(p, w, h, bandFrac = 0.18) {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const g = cv.getContext('2d')
  const ink = inkFor(p.color)
  const pad = w * 0.08
  const bandH = Math.max(h * bandFrac, w * 0.12)

  g.fillStyle = p.color
  g.fillRect(0, 0, w, h)
  g.strokeStyle = ink
  g.globalAlpha = 0.35
  g.lineWidth = w * 0.012
  g.strokeRect(pad * 0.55, pad * 0.55, w - pad * 1.1, h - pad * 1.1)

  // name band along the top: this is the part you can still see when a sleeve sits behind another
  g.globalAlpha = 0.14
  g.fillStyle = ink
  g.fillRect(0, 0, w, bandH)
  g.globalAlpha = 0.5
  g.fillRect(0, bandH - w * 0.008, w, w * 0.008)
  g.globalAlpha = 1
  g.fillStyle = ink
  g.textBaseline = 'middle'
  const bandW = w - pad * 1.4
  const bandName = String(p.name || '').toUpperCase()
  let bs = Math.min(bandH * 0.52, w * 0.16)
  g.font = `800 ${bs}px system-ui, 'Segoe UI', Arial, sans-serif`
  while (bs > 8 && g.measureText(bandName).width > bandW) {
    bs *= 0.94
    g.font = `800 ${bs}px system-ui, 'Segoe UI', Arial, sans-serif`
  }
  g.fillText(bandName, pad * 0.7, bandH * 0.5)
  g.textBaseline = 'alphabetic'

  // folder and pressing line, just under the band
  const topY = bandH + pad * 0.6 + w * 0.05
  g.font = `700 ${w * 0.05}px ui-monospace, Menlo, Consolas, monospace`
  g.globalAlpha = 0.75
  g.fillText(String(p.folder || '').toUpperCase(), pad, topY)
  g.textAlign = 'right'
  g.fillText(p.status === 'Finished' ? 'PRESSED' : 'TEST PRESSING', w - pad, topY)
  g.textAlign = 'left'
  g.globalAlpha = 1

  // name: shrink until it fits in at most 4 lines
  const maxW = w - pad * 2
  const words = String(p.name || '').toUpperCase().split(/\s+/).filter(Boolean)
  const wrap = (size) => {
    g.font = `800 ${size}px system-ui, 'Segoe UI', Arial, sans-serif`
    const lines = []
    let line = ''
    for (const word of words) {
      const t = line ? line + ' ' + word : word
      if (g.measureText(t).width <= maxW || !line) line = t
      else { lines.push(line); line = word }
    }
    if (line) lines.push(line)
    return lines
  }
  let size = w * 0.2
  let lines = wrap(size)
  while (size > w * 0.035 &&
         (lines.length > 4 || lines.some((l) => g.measureText(l).width > maxW) || lines.length * size * 1.02 > Math.min(h * 0.6, h - topY - pad * 3.2))) {
    size *= 0.92
    lines = wrap(size)
  }
  const lh = size * 1.02
  const y = h - pad * 1.6 - (lines.length - 1) * lh
  lines.forEach((l, i) => g.fillText(l, pad, y + i * lh))

  // small status mark above the name
  g.font = `700 ${w * 0.045}px ui-monospace, Menlo, Consolas, monospace`
  g.globalAlpha = 0.7
  g.fillText(p.status === 'Finished' ? '● FINISHED' : '○ IN PROGRESS', pad, y - size * 1.05)
  g.globalAlpha = 1
  return cv
}

function applyName(s, p) {
  s.geometry = s.geometry.clone()                // never touch the shared geometry
  const { uSize, vSize } = planarUV(s.geometry)
  const w = 512
  const h = Math.max(256, Math.round(w * (vSize / uSize)))
  // the strip of a sleeve that shows above the one in front is PEEK tall in the world
  const worldH = new THREE.Box3().setFromObject(s).getSize(new THREE.Vector3()).y || 1
  const bandFrac = Math.min(0.45, Math.max(0.1, (PEEK / worldH) * 1.05))
  const tex = new THREE.CanvasTexture(drawSleeve(p, w, h, bandFrac))
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  s.material.map = tex
  s.material.color.set('#ffffff')                // so the print is not tinted
  s.material.needsUpdate = true
}

// ================= TRACKLIST =================
function buildTracklist() {
  const list = document.getElementById('list')
  list.innerHTML = ''
  let n = 0
  folders.forEach((f, i) => {
    const sec = document.createElement('div')
    sec.className = 'side'
    const h = document.createElement('button')
    h.className = 'side-h'
    h.textContent = `Side ${String.fromCharCode(65 + i)} · ${f.name}`
    h.addEventListener('click', () => { if (!reading) toggleCrate(f) })
    sec.appendChild(h)
    if (!f.sleeves.length) {
      const e = document.createElement('div')
      e.className = 'empty'
      e.textContent = 'No tracks yet'
      sec.appendChild(e)
    }
    f.sleeves.forEach((s) => {
      const p = s.userData.project
      const b = document.createElement('button')
      b.className = 'track'
      b.dataset.id = p.name
      b.innerHTML =
        `<span class="no">${String(++n).padStart(2, '0')}</span>` +
        `<span class="nm">${p.name}</span>` +
        `<span class="st">${p.status === 'Finished' ? '●' : '○'}</span>`
      b.addEventListener('click', () => {
        requestPlay(s)
        if (innerWidth <= 900) document.getElementById('tracks').open = false
      })
      sec.appendChild(b)
    })
    list.appendChild(sec)
  })
  if (innerWidth <= 900) document.getElementById('tracks').open = false
}

// ================= CAMERA =================
function frameCamera() {
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  const dV = (modelH / MODEL_SCREEN_HEIGHT) / 2 / t
  // on a tall phone screen the scene fills most of the width and sits higher, not squashed at the very bottom
  const portrait = camera.aspect < 0.8
  const pad = portrait ? WIDTH_PAD_PORTRAIT : WIDTH_PAD
  const dH = (modelW * pad) / 2 / (t * camera.aspect)
  const d = Math.max(dV, dH) / view.k
  const visH = 2 * d * t
  const lookY = visH * (0.5 - (portrait ? BOTTOM_MARGIN_PORTRAIT : BOTTOM_MARGIN))
  camera.position.set(0, lookY + d * CAM_TILT, d)
  camera.lookAt(0, lookY, 0)
}

// ================= HELPERS =================
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const setPointer = (x, y) => {
  lastPtr.x = x
  lastPtr.y = y
  pointer.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1)
  raycaster.setFromCamera(pointer, camera)
}
const toLocal = (s, world) => s.parent.worldToLocal(world.clone())
const homeWorld = (s) => s.parent.localToWorld(s.userData.home.clone())
const liftedLocal = (s) => toLocal(s, homeWorld(s).add(new THREE.Vector3(0, LIFT, 0)))

function moveTo(s, local, duration = 0.45, ease = 'power3.out') {
  return gsap.to(s.position, { x: local.x, y: local.y, z: local.z, duration, ease })
}
function setUp(s, up) {
  if (s.userData.busy) return
  s.userData.up = up
  moveTo(s, up ? liftedLocal(s) : s.userData.home)
}
function toggleCrate(f) {
  const raise = f.sleeves.some((s) => !s.userData.up)
  f.sleeves.forEach((s, i) => gsap.delayedCall(i * 0.06, () => setUp(s, raise)))
}

const minDim = () => Math.min(innerWidth, innerHeight)

// where the record is on screen (this is the drop target)
function recordScreen() {
  const c = new THREE.Box3().setFromObject(recordPivot).getCenter(V()).project(camera)
  return { x: ((c.x + 1) / 2) * innerWidth, y: ((1 - c.y) / 2) * innerHeight }
}
function distToRecord(x, y) {
  const r = recordScreen()
  return Math.hypot(x - r.x, y - r.y)
}

// ================= DRAG & TAP =================
let drag = null

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!ready || gliding || reading || drag) return
  setPointer(e.clientX, e.clientY)
  const hit = raycaster.intersectObjects(sleeves, false)
    .find((h) => h.object.visible && !h.object.userData.busy)
  if (!hit) return
  e.preventDefault()
  try { renderer.domElement.setPointerCapture(e.pointerId) } catch (_) {}
  const s = hit.object
  gsap.killTweensOf(s.position)
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
    camera.getWorldDirection(V()).negate(), hit.point)
  const offset = hit.point.clone().sub(s.getWorldPosition(V()))
  drag = { s, plane, offset, x: e.clientX, y: e.clientY, moved: false, target: null }
})

addEventListener('pointermove', (e) => {
  if (!drag) return
  lastPtr.x = e.clientX
  lastPtr.y = e.clientY
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > DRAG_START) {
    drag.moved = true
    toVinyl(drag.s)                    // the moment you drag, sleeve -> vinyl
  }
})

function endDrag(x, y) {
  if (!drag) return
  const { s, moved } = drag
  drag = null
  dropEl.classList.remove('on', 'hot')

  if (!moved) { setUp(s, !s.userData.up); return }       // tap = raise / lower

  if (distToRecord(x, y) < NEAR * minDim()) glideAndPlay(s)
  else whenVinyl(s, () => toSleeve(s, () => setUp(s, false)))
}

addEventListener('pointerup', (e) => endDrag(e.clientX, e.clientY))
addEventListener('pointercancel', () => endDrag(lastPtr.x, lastPtr.y))
addEventListener('blur', () => endDrag(lastPtr.x, lastPtr.y))

// ================= VINYL -> RECORD =================
function requestPlay(s) {
  if (reading) exitReading(() => glideAndPlay(s))
  else glideAndPlay(s)
}

function glideAndPlay(s) {
  if (!ready || gliding) return
  gliding = true
  s.userData.up = false
  gsap.killTweensOf(s.position)
  if (s.userData.form === 'sleeve') toVinyl(s)           // track click: turn into a vinyl first
  whenVinyl(s, () => runGlide(s))
}

function runGlide(s) {
  const rb = new THREE.Box3().setFromObject(recordPivot)
  const rc = rb.getCenter(V())
  const landY = rb.max.y + 0.012 * recordRadius
  const hover = rc.clone(); hover.y = landY + LIFT * 1.3
  const start = s.getWorldPosition(V())
  const t0 = carryTilt
  const prox = { k: 0 }

  gsap.timeline()
    // 1. glide over the record, tilting flat on the way
    .to(prox, {
      k: 1, duration: GLIDE, ease: 'power2.inOut',
      onUpdate: () => {
        tmp.lerpVectors(start, hover, prox.k)
        tmp.y += Math.sin(Math.PI * prox.k) * 0.25
        s.position.copy(toLocal(s, tmp))
        carryTilt = Math.max(t0, Math.min(1, prox.k * 1.5))
      },
    })
    // 2. lower onto the record (normal depth again, so the record is in front/behind correctly)
    .add(() => {
      held = null
      carryTilt = 1
      setOnTop(false)
      vinyl.quaternion.copy(qFlat)
      gsap.to(vinyl.position, { y: landY, duration: 0.7, ease: 'power2.in' })
    })
    .to({}, { duration: 0.75 })
    // 3. vinyl becomes the record: play + zoom out; the empty sleeve pops back home
    .add(() => {
      vinyl.visible = false
      s.position.copy(s.userData.home)
      s.visible = true
      s.scale.copy(s.userData.baseScale).multiplyScalar(EPS)
      const st = { a: 0 }
      gsap.to(st, {
        a: 1, duration: 0.5, ease: 'back.out(1.7)',
        onUpdate: () => s.scale.copy(s.userData.baseScale).multiplyScalar(Math.max(st.a, EPS)),
      })
      play(s.userData.project)
    })
    .to({}, {
      duration: 0.9,
      onComplete: () => { s.userData.form = 'sleeve'; s.userData.busy = false; gliding = false },
    })
}

// ================= PLAY + READING MODE =================
function play(p) {
  gsap.to(tonearm.rotation, { [ARM_AXIS]: armRest + ARM_DELTA, duration: 1.2, ease: 'power2.inOut' })
  if (!spinTween) {
    spinTween = gsap.to(recordPivot.rotation, {
      y: recordPivot.rotation.y + Math.PI * 2, duration: SPIN, repeat: -1, ease: 'none',
    })
  }
  document.querySelectorAll('.track').forEach((b) => b.classList.toggle('on', b.dataset.id === p.name))
  enterReading(p)
}

function enterReading(p) {
  reading = true
  document.body.classList.add('reading')
  gsap.to(view, { k: READ_SCALE, duration: ZOOM_TIME, ease: 'power3.inOut', onUpdate: frameCamera })
  showStage(p)
}

function exitReading(done) {
  token++                                   // stop any typing
  reading = false
  document.body.classList.remove('reading')
  gsap.to(view, {
    k: 1, duration: ZOOM_TIME * 0.8, ease: 'power3.inOut',
    onUpdate: frameCamera, onComplete: () => done && done(),
  })
}

document.getElementById('back').addEventListener('click', () => exitReading())
addEventListener('keydown', (e) => { if (e.key === 'Escape' && reading) exitReading() })

// ================= STAGE TEXT =================
const $ = (id) => document.getElementById(id)
let token = 0

function typeInto(el, text, my, speed, cb) {
  el.textContent = ''
  let i = 0
  const step = () => {
    if (my !== token) return
    i = Math.min(i + 1, text.length)
    el.textContent = text.slice(0, i)
    if (i < text.length) setTimeout(step, speed)
    else cb && cb()
  }
  step()
}

function showStage(p) {
  const my = ++token
  $('kicker').textContent = `${p.folder}  ·  ${p.status}`
  $('name').textContent = ''
  $('desc').textContent = ''
  $('tech').classList.remove('show')
  $('tech').innerHTML = p.tech.map((t) => `<span>${t}</span>`).join('')
  const live = $('live')
  live.classList.toggle('show', !!p.live)
  if (p.live) live.href = p.live

  const more = $('more')
  if (p.slug) {
    more.href = `${import.meta.env.BASE_URL}project.html#${encodeURIComponent(p.slug)}`
    more.classList.add('show')
  } else more.classList.remove('show')

  setTimeout(() => {
    if (my !== token) return
    typeInto($('name'), p.name, my, 45, () =>
      typeInto($('desc'), p.description, my, 14, () => $('tech').classList.add('show')))
  }, 900)
}

// ================= RESIZE + LOOP =================
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  if (ready) frameCamera()
})

renderer.setAnimationLoop(() => {
  if (drag && drag.moved) {
    // the vinyl rides under the pointer (grab offset melts away so it centres on it)
    setPointer(lastPtr.x, lastPtr.y)
    const p = V()
    if (raycaster.ray.intersectPlane(drag.plane, p)) {
      drag.offset.multiplyScalar(0.85)
      drag.s.getWorldPosition(tmp).lerp(p.sub(drag.offset), FOLLOW)
      drag.s.position.copy(toLocal(drag.s, tmp))
    }

    // tilt flat as the pointer nears the record
    const d = distToRecord(lastPtr.x, lastPtr.y)
    carryTilt = Math.min(1, Math.max(0, (FAR * minDim() - d) / ((FAR - NEAR) * minDim())))

    // drop ring around the record
    const r = recordScreen()
    const size = NEAR * minDim() * 2
    dropEl.style.width = dropEl.style.height = `${size}px`
    dropEl.style.transform = `translate(${r.x - size / 2}px, ${r.y - size / 2}px)`
    dropEl.classList.add('on')
    dropEl.classList.toggle('hot', d < NEAR * minDim())
  }
  updateVinyl()

  // crate labels follow the crates
  if (ready) {
    folders.forEach((f) => {
      tmp.copy(f.anchor).project(camera)
      const x = ((tmp.x + 1) / 2) * innerWidth
      const y = ((1 - tmp.y) / 2) * innerHeight
      const drop = innerWidth < 600 && f.row ? 30 : 6
      f.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, ${drop}px)`
    })
  }
  renderer.render(scene, camera)
})