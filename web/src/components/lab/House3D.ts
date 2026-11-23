/**
 * The 3D cut-away apartment (Three.js). Imperative: the lab view creates one, feeds it a layout once
 * per scenario and a frame (temperatures and flows for one moment) many times per second.
 *
 * What is drawn comes from the simulation: floor, wall and glass colours are the simulated surface
 * temperatures; emitters and pipes take the water temperature; arrow length is the heat flux through
 * each wall and window; particle speed follows the heat delivered. The particle paths themselves are
 * illustrative convection loops (natural convection rises at a warm emitter and sinks at cold glass),
 * not a fluid-dynamics solution: the page says so.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEPTH, DOORS, EXPOSURES, HEIGHT, sharedLength, type Side, sideLength, WIDTH, ZONES, type ZoneId, type ZoneSpec } from '../../lib/sim/apartment';
import type { Scenario } from '../../lib/sim/engine';
import { emitterInfo } from '../../lib/sim/systems';
import { tempRgb } from '../../lib/sim/tempscale';

export interface Layout {
  scenario: Scenario;
  heated: Record<ZoneId, boolean>;
  cooled: Record<ZoneId, boolean>;
}

export interface ZoneFrame {
  air: number;
  surf: number;
  /** heat delivered by the emitter, W (negative = cooling) */
  q: number;
  /** heat lost through windows and opaque walls, W */
  lossWin: number;
  lossOpaque: number;
}

export interface Frame {
  outdoor: number;
  zones: Record<ZoneId, ZoneFrame>;
  mode: number;
  supply: number;
  /** generator output as a share of its capacity, 0..1 */
  load: number;
  /** sun position: compass azimuth and elevation in degrees, null at night */
  sun: { az: number; el: number } | null;
}

export interface Colors {
  ink: string;
  ink3: string;
  rule: string;
  bg: string;
  surface: string;
}

export interface Label {
  id: string;
  text: string;
  x: number;
  y: number;
  visible: boolean;
}

const T = 0.25; // wall thickness
const PARTITION = 0.1;
const W2 = WIDTH / 2;
const D2 = DEPTH / 2;
/** plan (x, y) -> world (x, z): front facade (y = 0) faces the camera at +z */
const wx = (x: number) => x - W2;
const wz = (y: number) => D2 - y;

interface WallFace {
  zone: ZoneId;
  side: Side;
  exterior: boolean;
  mats: THREE.MeshLambertMaterial[];
  glass?: THREE.MeshBasicMaterial;
  arrowsWall: THREE.ArrowHelper[];
  arrowWin?: THREE.ArrowHelper;
  wallArea: number;
  winArea: number;
}

interface Emitter {
  zone: ZoneId;
  mat?: THREE.MeshLambertMaterial;
  lineColors?: THREE.BufferAttribute;
  lineN?: number;
  /** origin of the convection loop and the inward direction, in world coordinates */
  origin: THREE.Vector3;
  inward: THREE.Vector3;
  along: THREE.Vector3;
  depth: number;
  span: number;
  kind: 'wall-low' | 'floor' | 'wall-high';
}

interface Particles {
  zone: ZoneId;
  points: THREE.Points;
  u: Float32Array;
  w: Float32Array;
  e: Emitter;
}

const PARTICLES_PER_ROOM = 70;

function makeLoop(depth: number, kind: Emitter['kind']) {
  // a rounded rectangle in the (inward, up) plane; s in [0,1) runs: up the emitter wall, across the
  // ceiling, down the far wall, back along the floor
  const a0 = 0.25;
  const a1 = Math.max(a0 + 0.5, depth - 0.3);
  const y0 = 0.25;
  const y1 = HEIGHT - 0.3;
  const legs = [y1 - y0, a1 - a0, y1 - y0, a1 - a0];
  const total = legs.reduce((a, b) => a + b, 0);
  const cuts = [legs[0] / total, (legs[0] + legs[1]) / total, (legs[0] + legs[1] + legs[2]) / total];
  void kind;
  return (s: number, out: { a: number; y: number; seg: number; f: number }) => {
    if (s < cuts[0]) {
      const f = s / cuts[0];
      out.a = a0;
      out.y = y0 + f * (y1 - y0);
      out.seg = 0;
      out.f = f;
    } else if (s < cuts[1]) {
      const f = (s - cuts[0]) / (cuts[1] - cuts[0]);
      out.a = a0 + f * (a1 - a0);
      out.y = y1;
      out.seg = 1;
      out.f = f;
    } else if (s < cuts[2]) {
      const f = (s - cuts[1]) / (cuts[2] - cuts[1]);
      out.a = a1;
      out.y = y1 - f * (y1 - y0);
      out.seg = 2;
      out.f = f;
    } else {
      const f = (s - cuts[2]) / (1 - cuts[2]);
      out.a = a1 - f * (a1 - a0);
      out.y = y0;
      out.seg = 3;
      out.f = f;
    }
    return out;
  };
}

export class House3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private root = new THREE.Group();
  private sunLight = new THREE.DirectionalLight(0xffffff, 1.4);
  private sunDisc: THREE.Mesh;
  private floors = new Map<ZoneId, THREE.MeshLambertMaterial>();
  private faces: WallFace[] = [];
  private emitters: Emitter[] = [];
  private particles: Particles[] = [];
  private pipeDots: { points: THREE.Points; path: THREE.Vector3[]; lengths: number[]; total: number; u: Float32Array; supply: boolean } | null = null;
  private fan: THREE.Object3D | null = null;
  private frame: Frame | null = null;
  private layout: Layout | null = null;
  private raf = 0;
  private last = 0;
  private ro: ResizeObserver;
  private io: IntersectionObserver;
  private labelAnchors: { id: string; pos: THREE.Vector3; text: () => string }[] = [];
  private tmpRgb: [number, number, number] = [0, 0, 0];
  private loopPt = { a: 0, y: 0, seg: 0, f: 0 };
  onLabels: ((l: Label[]) => void) | null = null;
  motion = true;

  constructor(
    private host: HTMLElement,
    private colors: Colors,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(new THREE.Color(colors.bg));
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
    this.camera.position.set(9, 13, 17);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.6, 0);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 40;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.addEventListener('change', () => (this.dirty = true));
    this.controls.update();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a84, 1.6));
    this.sunLight.position.set(5, 10, 8);
    this.scene.add(this.sunLight);
    this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(0.6, 32), new THREE.MeshBasicMaterial({ color: 0xfab219 }));
    this.scene.add(this.sunDisc);
    this.scene.add(this.root);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.io = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      this.dirty = true;
    });
    this.io.observe(host);
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  setColors(c: Colors) {
    this.colors = c;
    this.renderer.setClearColor(new THREE.Color(c.bg));
    if (this.layout) this.setLayout(this.layout);
  }

  resize() {
    const w = this.host.clientWidth || 600;
    const h = this.host.clientHeight || 400;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    const portrait = w / h < 1.1;
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      this.view('reset');
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private portrait = false;
  private home() {
    // phones see the flat in portrait: step back so the whole plan fits
    return this.portrait ? new THREE.Vector3(10, 19, 24) : new THREE.Vector3(9, 13, 17);
  }

  view(kind: 'reset' | 'top' | 'left' | 'right') {
    const t = this.controls.target;
    if (kind === 'reset') this.camera.position.copy(this.home());
    else if (kind === 'top') this.camera.position.set(0.01, this.portrait ? 34 : 24, 0.6);
    else {
      const ang = kind === 'left' ? 0.5 : -0.5;
      const p = this.camera.position.clone().sub(t);
      p.applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      this.camera.position.copy(t.clone().add(p));
    }
    this.controls.update();
  }

  private clear() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.root.clear();
    this.floors.clear();
    this.faces = [];
    this.emitters = [];
    this.particles = [];
    this.pipeDots = null;
    this.fan = null;
    this.labelAnchors = [];
  }

  private edges(mesh: THREE.Mesh, color = this.colors.ink, opacity = 1) {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
    e.position.copy(mesh.position);
    e.rotation.copy(mesh.rotation);
    this.root.add(e);
  }

  private box(w: number, h: number, d: number, x: number, y: number, z: number, color: string | THREE.Color, edge = true) {
    const mat = new THREE.MeshLambertMaterial({ color });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    this.root.add(m);
    if (edge) this.edges(m);
    return { mesh: m, mat };
  }

  setLayout(layout: Layout) {
    this.layout = layout;
    this.clear();
    const s = layout.scenario;
    const exposed = new Set<Side>(EXPOSURES.find((e) => e.id === s.exposure)?.sides ?? []);
    const em = emitterInfo(s.emitter);
    const neutral = this.colors.rule;

    // ground grid and a compass rose
    const grid = new THREE.GridHelper(30, 30, new THREE.Color(this.colors.rule), new THREE.Color(this.colors.rule));
    grid.position.y = -0.02;
    this.root.add(grid);
    this.addCompass(s.frontFacing);

    // floors
    for (const z of ZONES) {
      const mat = new THREE.MeshLambertMaterial({ color: neutral });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(z.x1 - z.x0, z.y1 - z.y0), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(wx((z.x0 + z.x1) / 2), 0, wz((z.y0 + z.y1) / 2));
      this.root.add(m);
      this.floors.set(z.id, mat);
      this.labelAnchors.push({ id: z.id, pos: new THREE.Vector3(wx((z.x0 + z.x1) / 2), 0.1, wz((z.y0 + z.y1) / 2)), text: () => '' });
    }
    // slab under the flat
    const slab = this.box(WIDTH + 2 * T, 0.3, DEPTH + 2 * T, 0, -0.16, 0, this.colors.surface);
    void slab;

    // exterior walls, split around the windows
    for (const z of ZONES) {
      for (const side of ['front', 'back', 'left', 'right'] as Side[]) {
        const len = sideLength(z, side);
        if (!len) continue;
        this.buildWall(z, side, len, exposed.has(side));
      }
    }

    // interior partitions with door gaps
    for (let i = 0; i < ZONES.length; i++) {
      for (let j = i + 1; j < ZONES.length; j++) {
        const a = ZONES[i];
        const b = ZONES[j];
        const L = sharedLength(a, b);
        if (!L) continue;
        const door = DOORS.some(([p, q]) => (p === a.id && q === b.id) || (p === b.id && q === a.id));
        this.buildPartition(a, b, door);
      }
    }

    // above / below context
    if (s.above === 'roof') {
      const r = new THREE.Mesh(new THREE.BoxGeometry(WIDTH + 2 * T, 0.3, DEPTH + 2 * T));
      r.position.set(0, HEIGHT + 0.15, 0);
      this.edges(r, this.colors.ink3, 0.8);
      r.geometry.dispose();
      this.labelAnchors.push({ id: 'roof', pos: new THREE.Vector3(-W2, HEIGHT + 0.4, -D2), text: () => 'Roof' });
    } else {
      const r = new THREE.Mesh(new THREE.BoxGeometry(WIDTH + 2 * T, HEIGHT, DEPTH + 2 * T));
      r.position.set(0, HEIGHT * 1.5 + 0.3, 0);
      this.edges(r, this.colors.rule, 0.9);
      r.geometry.dispose();
      this.labelAnchors.push({ id: 'above', pos: new THREE.Vector3(-W2 + 1.5, HEIGHT + 1.4, -D2), text: () => 'Heated flat above' });
    }

    // emitters
    for (const z of ZONES) {
      if (!layout.heated[z.id] && !layout.cooled[z.id]) continue;
      this.buildEmitter(z, s, exposed, em.id);
    }

    // generator and pipes
    this.buildGenerator(s);

    // particles
    for (const e of this.emitters) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTICLES_PER_ROOM * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PARTICLES_PER_ROOM * 3), 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true }));
      this.root.add(pts);
      const u = new Float32Array(PARTICLES_PER_ROOM);
      const w = new Float32Array(PARTICLES_PER_ROOM);
      for (let i = 0; i < PARTICLES_PER_ROOM; i++) {
        u[i] = (i * 0.618034) % 1;
        w[i] = ((i * 0.381966 * 7) % 1) * 0.9 + 0.05;
      }
      this.particles.push({ zone: e.zone, points: pts, u, w, e });
    }
    if (this.frame) this.setFrame(this.frame);
    this.dirty = true;
  }

  private addCompass(frontFacing: number) {
    // N arrow on the ground in front of the flat: world angle of compass north relative to the front (+z)
    const d = ((0 - frontFacing) * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.sin(d), 0, Math.cos(d));
    const origin = new THREE.Vector3(W2 + 2.2, 0.02, D2 + 1.5);
    const arrow = new THREE.ArrowHelper(dir, origin, 1.6, new THREE.Color(this.colors.ink).getHex(), 0.4, 0.25);
    this.root.add(arrow);
    this.labelAnchors.push({ id: 'north', pos: origin.clone().add(dir.clone().multiplyScalar(2)), text: () => 'N' });
  }

  private isDark() {
    const c = new THREE.Color(this.colors.bg);
    return c.r + c.g + c.b < 1.2;
  }

  private sideGeom(z: ZoneSpec, side: Side) {
    // returns start point, direction along the wall, outward normal (world), for the zone's segment
    switch (side) {
      case 'front':
        return { p0: new THREE.Vector3(wx(z.x0), 0, wz(0)), along: new THREE.Vector3(1, 0, 0), out: new THREE.Vector3(0, 0, 1) };
      case 'back':
        return { p0: new THREE.Vector3(wx(z.x0), 0, wz(DEPTH)), along: new THREE.Vector3(1, 0, 0), out: new THREE.Vector3(0, 0, -1) };
      case 'left':
        return { p0: new THREE.Vector3(wx(0), 0, wz(z.y0)), along: new THREE.Vector3(0, 0, -1), out: new THREE.Vector3(-1, 0, 0) };
      case 'right':
        return { p0: new THREE.Vector3(wx(WIDTH), 0, wz(z.y0)), along: new THREE.Vector3(0, 0, -1), out: new THREE.Vector3(1, 0, 0) };
    }
  }

  private wallBox(p0: THREE.Vector3, along: THREE.Vector3, out: THREE.Vector3, a0: number, a1: number, y0: number, y1: number, color: string) {
    const len = a1 - a0;
    const h = y1 - y0;
    if (len <= 0.01 || h <= 0.01) return null;
    const c = p0.clone().add(along.clone().multiplyScalar((a0 + a1) / 2)).add(out.clone().multiplyScalar(T / 2));
    const alongX = Math.abs(along.x) > 0.5;
    return this.box(alongX ? len : T, h, alongX ? T : len, c.x, y0 + h / 2, c.z, color);
  }

  private buildWall(z: ZoneSpec, side: Side, len: number, exterior: boolean) {
    const g = this.sideGeom(z, side);
    const win = exterior ? z.windows.filter((w) => w.side === side).reduce((a, w) => a + w.area, 0) : 0;
    const mats: THREE.MeshLambertMaterial[] = [];
    const color = exterior ? this.colors.surface : this.colors.rule;
    const face: WallFace = { zone: z.id, side, exterior, mats, arrowsWall: [], wallArea: len * HEIGHT - win, winArea: win };
    if (win > 0) {
      const door = win >= 3;
      const wh = door ? 2.2 : 1.4;
      const sill = door ? 0 : 0.9;
      const ww = Math.min(len - 0.5, win / wh);
      const a0 = (len - ww) / 2;
      const a1 = a0 + ww;
      for (const b of [
        this.wallBox(g.p0, g.along, g.out, 0, a0, 0, HEIGHT, color),
        this.wallBox(g.p0, g.along, g.out, a1, len, 0, HEIGHT, color),
        this.wallBox(g.p0, g.along, g.out, a0, a1, 0, sill, color),
        this.wallBox(g.p0, g.along, g.out, a0, a1, sill + wh, HEIGHT, color),
      ]) {
        if (b) mats.push(b.mat);
      }
      const glassMat = new THREE.MeshBasicMaterial({ color: 0xcde2fb, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), glassMat);
      const c = g.p0.clone().add(g.along.clone().multiplyScalar((a0 + a1) / 2)).add(g.out.clone().multiplyScalar(T / 2));
      glass.position.set(c.x, sill + wh / 2, c.z);
      if (Math.abs(g.along.z) > 0.5) glass.rotation.y = Math.PI / 2;
      this.root.add(glass);
      this.edges(glass);
      face.glass = glassMat;
      const arrowPos = c.clone().setY(sill + wh / 2).add(g.out.clone().multiplyScalar(T / 2 + 0.05));
      face.arrowWin = this.arrow(g.out, arrowPos);
    } else {
      const b = this.wallBox(g.p0, g.along, g.out, 0, len, 0, HEIGHT, color);
      if (b) mats.push(b.mat);
    }
    if (exterior) {
      const n = Math.max(1, Math.round(len / 2.5));
      for (let i = 0; i < n; i++) {
        const a = ((i + 0.5) / n) * len;
        if (win > 0 && Math.abs(a - len / 2) < 1.2) continue;
        const pos = g.p0.clone().add(g.along.clone().multiplyScalar(a)).add(g.out.clone().multiplyScalar(T + 0.05)).setY(1.9);
        face.arrowsWall.push(this.arrow(g.out, pos));
      }
    }
    this.faces.push(face);
  }

  private buildPartition(a: ZoneSpec, b: ZoneSpec, door: boolean) {
    const vertical = a.x1 === b.x0 || b.x1 === a.x0;
    // partitions sit at room temperature: a light neutral in both themes
    const color = this.isDark() ? '#8f8e88' : '#e4e3e1';
    if (vertical) {
      const x = a.x1 === b.x0 ? a.x1 : a.x0;
      const y0 = Math.max(a.y0, b.y0);
      const y1 = Math.min(a.y1, b.y1);
      const segs: [number, number][] = door && y1 - y0 > 1.4 ? [[y0, (y0 + y1) / 2 - 0.45], [(y0 + y1) / 2 + 0.45, y1]] : [[y0, y1]];
      if (door && y1 - y0 <= 1.4) return;
      for (const [p, q] of segs) this.box(PARTITION, HEIGHT, q - p, wx(x), HEIGHT / 2, wz((p + q) / 2), color);
    } else {
      const y = a.y1 === b.y0 ? a.y1 : a.y0;
      const x0 = Math.max(a.x0, b.x0);
      const x1 = Math.min(a.x1, b.x1);
      const segs: [number, number][] = door && x1 - x0 > 1.4 ? [[x0, (x0 + x1) / 2 - 0.45], [(x0 + x1) / 2 + 0.45, x1]] : [[x0, x1]];
      for (const [p, q] of segs) this.box(q - p, HEIGHT, PARTITION, wx((p + q) / 2), HEIGHT / 2, wz(y), color);
    }
  }

  private buildEmitter(z: ZoneSpec, s: Scenario, exposed: Set<Side>, emitter: string) {
    // pick the wall with the largest window on an exterior side, else the zone's longest exterior side, else the back wall
    const wins = z.windows.filter((w) => exposed.has(w.side)).sort((a, b) => b.area - a.area);
    const sides = (['front', 'back', 'left', 'right'] as Side[]).filter((sd) => sideLength(z, sd) > 0);
    const side: Side = wins[0]?.side ?? sides.find((sd) => exposed.has(sd)) ?? sides[0] ?? 'back';
    const g = this.sideGeom(z, side);
    const len = sideLength(z, side) || 2;
    const inward = g.out.clone().multiplyScalar(-1);
    const mid = g.p0.clone().add(g.along.clone().multiplyScalar(len / 2));
    const depth = Math.abs(g.along.x) > 0.5 ? z.y1 - z.y0 : z.x1 - z.x0;
    const alongX = Math.abs(g.along.x) > 0.5;
    const split = s.generator === 'split' && z.id !== 'bath';
    const coolSplitOnly = s.cooling === 'split' && s.generator !== 'split';
    let kind: Emitter['kind'] = 'wall-low';
    let mat: THREE.MeshLambertMaterial | undefined;
    let lineColors: THREE.BufferAttribute | undefined;
    let lineN = 0;
    if (split || (coolSplitOnly && this.layout?.cooled[z.id] && !this.layout?.heated[z.id])) {
      kind = 'wall-high';
      // indoor unit high on the wall opposite the window
      const far = mid.clone().add(inward.clone().multiplyScalar(depth - 0.15));
      const b = this.box(alongX ? 0.9 : 0.22, 0.3, alongX ? 0.22 : 0.9, far.x, 2.25, far.z, '#ffffff');
      mat = b.mat;
      const e: Emitter = { zone: z.id, mat, origin: far.clone().setY(0), inward: inward.clone().multiplyScalar(-1), along: g.along.clone(), depth, span: len, kind };
      this.emitters.push(e);
      return;
    }
    if (s.generator !== 'split' && s.generator !== 'electric' && emitter === 'underfloor') {
      kind = 'floor';
      // serpentine pipe on the floor
      const pts: THREE.Vector3[] = [];
      const xs = z.x1 - z.x0 - 0.6;
      const ys = z.y1 - z.y0 - 0.6;
      const passes = Math.max(3, Math.round(xs / 0.5));
      for (let i = 0; i <= passes; i++) {
        const x = z.x0 + 0.3 + (xs * i) / passes;
        const ya = i % 2 === 0 ? z.y0 + 0.3 : z.y0 + 0.3 + ys;
        const yb = i % 2 === 0 ? z.y0 + 0.3 + ys : z.y0 + 0.3;
        pts.push(new THREE.Vector3(wx(x), 0.03, wz(ya)), new THREE.Vector3(wx(x), 0.03, wz(yb)));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      lineN = pts.length;
      lineColors = new THREE.BufferAttribute(new Float32Array(lineN * 3), 3);
      geo.setAttribute('color', lineColors);
      this.root.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true })));
    } else {
      // radiator, fan coil, electric panel or towel rail under the window
      const w = z.id === 'bath' ? 0.5 : Math.min(1.4, len * 0.45);
      const h = z.id === 'bath' ? 0.9 : emitter === 'fancoil' ? 0.55 : 0.6;
      const p = mid.clone().add(inward.clone().multiplyScalar(0.12));
      const b = this.box(alongX ? w : 0.08, h, alongX ? 0.08 : w, p.x, 0.15 + h / 2, p.z, this.colors.surface);
      mat = b.mat;
    }
    this.emitters.push({ zone: z.id, mat, lineColors, lineN, origin: mid.clone(), inward, along: g.along.clone(), depth, span: len, kind });
  }

  private buildGenerator(s: Scenario) {
    const outdoorUnit = s.generator === 'hp-air' || s.generator === 'hybrid' || s.generator === 'split' || s.cooling === 'split';
    const boiler = s.generator === 'boiler' || s.generator === 'boiler-old' || s.generator === 'hybrid';
    let src: THREE.Vector3 | null = null;
    if (outdoorUnit) {
      const x = wx(8.2);
      const z = wz(0) + 1.0;
      this.box(1.0, 0.75, 0.4, x, 0.38, z, this.colors.surface);
      const fan = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.28, 3, 1), new THREE.MeshBasicMaterial({ color: this.colors.ink, side: THREE.DoubleSide }));
      fan.position.set(x, 0.4, z + 0.21);
      this.root.add(fan);
      this.fan = fan;
      this.labelAnchors.push({ id: 'outdoor-unit', pos: new THREE.Vector3(x, 0.95, z), text: () => 'Outdoor unit' });
      src = new THREE.Vector3(x, 0.05, wz(0) - 0.4);
    }
    if (s.generator === 'hp-ground') {
      const x = wx(9.2);
      const z = wz(0) + 1.2;
      for (const dx of [-0.15, 0.15]) {
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x + dx, 0, z), new THREE.Vector3(x + dx, -6, z)]);
        this.root.add(new THREE.Line(geo, new THREE.LineDashedMaterial({ color: this.colors.ink3, dashSize: 0.3, gapSize: 0.2 })).computeLineDistances());
      }
      this.labelAnchors.push({ id: 'borehole', pos: new THREE.Vector3(x, -3, z), text: () => 'Ground loop' });
      const b = this.box(0.6, 0.9, 0.6, wx(9.4), 0.45, wz(0.6), this.colors.surface);
      void b;
      this.labelAnchors.push({ id: 'hp-unit', pos: new THREE.Vector3(wx(9.4), 1.1, wz(0.6)), text: () => 'Heat pump' });
      src = new THREE.Vector3(wx(9.4), 0.05, wz(0.6));
    }
    if (boiler) {
      const x = wx(0.4);
      const z = wz(7.6);
      this.box(0.45, 0.7, 0.35, x, 1.6, z, this.colors.surface);
      this.labelAnchors.push({ id: 'boiler', pos: new THREE.Vector3(x, 2.1, z), text: () => 'Boiler' });
      if (!src) src = new THREE.Vector3(x, 0.05, z);
    }
    if (s.generator === 'hp-air' || s.generator === 'hybrid') this.labelAnchors.push({ id: 'tank', pos: new THREE.Vector3(wx(5.6), 1.2, wz(7.6)), text: () => '' });
    // pipes from the generator to each hydronic emitter, drawn along the floor
    if (!src || s.generator === 'split' || s.generator === 'electric') return;
    const path: THREE.Vector3[] = [src.clone()];
    const hub = new THREE.Vector3(wx(5.5), 0.05, wz(4.6));
    path.push(new THREE.Vector3(src.x, 0.05, hub.z), hub.clone());
    for (const e of this.emitters) {
      if (e.kind === 'wall-high') continue;
      const tgt = e.origin.clone().add(e.inward.clone().multiplyScalar(0.3)).setY(0.05);
      path.push(new THREE.Vector3(tgt.x, 0.05, hub.z), tgt, new THREE.Vector3(tgt.x, 0.05, hub.z), hub.clone());
    }
    const lengths: number[] = [0];
    for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + path[i].distanceTo(path[i - 1]));
    const total = lengths[lengths.length - 1];
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path), new THREE.LineBasicMaterial({ color: this.colors.ink3 }));
    this.root.add(line);
    const mk = (supply: boolean) => {
      const n = Math.max(20, Math.round(total * 3));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, color: 0xffffff }));
      this.root.add(pts);
      const u = new Float32Array(n);
      for (let i = 0; i < n; i++) u[i] = (i / n + (supply ? 0 : 0.5 / n)) % 1;
      return { points: pts, path, lengths, total, u, supply };
    };
    this.pipeDots = mk(true);
  }

  setFrame(f: Frame) {
    this.frame = f;
    if (!this.layout) return;
    const c = this.tmpRgb;
    const em = emitterInfo(this.layout.scenario.emitter);
    for (const z of ZONES) {
      const zf = f.zones[z.id];
      const floor = this.floors.get(z.id);
      if (floor && zf) {
        // underfloor heating warms the floor surface: q / (area * 10.8 W/m2K), EN 1264 heat-transfer coefficient
        const area = (z.x1 - z.x0) * (z.y1 - z.y0);
        const ufh = this.layout.scenario.emitter === 'underfloor' && this.layout.scenario.generator !== 'split' && this.layout.scenario.generator !== 'electric';
        const t = zf.surf + (ufh ? zf.q / (area * 10.8) : 0);
        floor.color.setRGB(...tempRgb(t, c));
      }
    }
    for (const face of this.faces) {
      const zf = f.zones[face.zone];
      if (!zf) continue;
      const u = this.layout.scenario.env;
      if (face.exterior) {
        // inner surface temperature of the wall: T_air - U * Rsi * (T_air - T_out)
        const tw = zf.air - u.uWall * 0.13 * (zf.air - f.outdoor);
        for (const m of face.mats) m.color.setRGB(...tempRgb(tw, c));
        if (face.glass) {
          const tg = zf.air - u.uWindow * 0.13 * (zf.air - f.outdoor);
          face.glass.color.setRGB(...tempRgb(tg, c));
        }
        // flux arrows: W/m2 through windows and walls
        const z = ZONES.find((x) => x.id === face.zone)!;
        const zoneWin = z.windows.reduce((a, w) => a + (this.faceExposed(w.side) ? w.area : 0), 0);
        const fluxWin = zoneWin > 0 ? zf.lossWin / zoneWin : 0;
        const wallTot = this.zoneWallArea(face.zone);
        const fluxWall = wallTot > 0 ? zf.lossOpaque / wallTot : 0;
        if (face.arrowWin) this.setArrow(face.arrowWin, fluxWin);
        for (const a of face.arrowsWall) this.setArrow(a, fluxWall);
      } else {
        for (const m of face.mats) m.color.set(this.colors.rule);
      }
    }
    for (const e of this.emitters) {
      const zf = f.zones[e.zone];
      if (!zf) continue;
      const on = Math.abs(zf.q) > 5;
      let t = zf.air;
      if (on) {
        if (e.kind === 'wall-high') t = zf.q > 0 ? zf.air + 15 : zf.air - 12;
        else if (f.supply > 0) t = f.supply - (zf.q > 0 ? em.dtWater / 2 : -2);
        else t = zf.q > 0 ? 60 : zf.air;
      }
      if (e.mat) e.mat.color.setRGB(...tempRgb(t, c));
      if (e.lineColors && e.lineN) {
        for (let i = 0; i < e.lineN; i++) {
          const ti = on && f.supply > 0 ? f.supply - (em.dtWater * i) / (e.lineN - 1) * Math.sign(zf.q) : zf.air;
          tempRgb(ti, c);
          e.lineColors.setXYZ(i, c[0], c[1], c[2]);
        }
        e.lineColors.needsUpdate = true;
      }
    }
    if (this.pipeDots) {
      const mat = this.pipeDots.points.material as THREE.PointsMaterial;
      mat.color.setRGB(...tempRgb(f.supply > 0 ? f.supply : 20, c));
      this.pipeDots.points.visible = f.mode !== 0 && f.supply > 0;
    }
    // sun
    if (f.sun && f.sun.el > 0) {
      const d = ((f.sun.az - this.layout.scenario.frontFacing) * Math.PI) / 180;
      const el = (f.sun.el * Math.PI) / 180;
      const dir = new THREE.Vector3(Math.sin(d) * Math.cos(el), Math.sin(el), Math.cos(d) * Math.cos(el));
      this.sunLight.position.copy(dir.clone().multiplyScalar(20));
      this.sunLight.intensity = 0.4 + 1.4 * Math.sin(el);
      this.sunDisc.visible = true;
      this.sunDisc.position.copy(dir.multiplyScalar(18));
      this.sunDisc.lookAt(this.camera.position);
    } else {
      this.sunLight.intensity = 0.15;
      this.sunDisc.visible = false;
    }
    this.dirty = true;
  }

  private faceExposed(side: Side) {
    const s = this.layout?.scenario;
    return !!s && (EXPOSURES.find((e) => e.id === s.exposure)?.sides ?? []).includes(side);
  }

  private zoneWallArea(id: ZoneId) {
    return this.faces.filter((f) => f.zone === id && f.exterior).reduce((a, f) => a + f.wallArea, 0);
  }

  private arrow(dir: THREE.Vector3, pos: THREE.Vector3) {
    const a = new THREE.ArrowHelper(dir, pos, 0.5, new THREE.Color(this.colors.ink).getHex(), 0.18, 0.12);
    a.userData = { out: dir.clone(), base: pos.clone() };
    this.root.add(a);
    return a;
  }

  /** Arrow length = heat flux (W/m2); it points out when heat leaves, in when the sun-warmed wall gives heat to the room. */
  private setArrow(a: THREE.ArrowHelper, flux: number) {
    const mag = Math.abs(flux);
    a.visible = mag > 2;
    if (!a.visible) return;
    const len = Math.min(1.6, 0.25 + mag / 40);
    const out = a.userData.out as THREE.Vector3;
    const base = a.userData.base as THREE.Vector3;
    if (flux >= 0) {
      a.setDirection(out);
      a.position.copy(base);
    } else {
      a.setDirection(out.clone().multiplyScalar(-1));
      a.position.copy(base).add(out.clone().multiplyScalar(len));
    }
    a.setLength(len, Math.min(0.25, len * 0.4), 0.12);
  }

  private particleTemp(e: Emitter, zf: ZoneFrame, seg: number, f: number, supply: number): number {
    const air = zf.air;
    const q = zf.q;
    const glass = air - (this.layout?.scenario.env.uWindow ?? 2) * 0.13 * (air - (this.frame?.outdoor ?? air));
    if (e.kind === 'floor') {
      // underfloor: air sinks at the cold window (seg 0 reversed), warms along the floor, rises at the far wall
      const floorExcess = q > 0 ? Math.min(6, q / 200) : q < 0 ? Math.max(-6, q / 200) : 0;
      switch (seg) {
        case 0:
          return air - 0.15 * (air - glass) * (1 - f);
        case 3:
          return air + floorExcess * 0.5 * (1 - f);
        case 2:
          return air + floorExcess * 0.2;
        default:
          return air - 0.15 * (air - glass) * f;
      }
    }
    const plume = q > 0 ? Math.min(14, Math.max(2, (supply > 0 ? supply : air + 20) - air) * 0.3) : q < 0 ? -Math.min(10, Math.max(2, air - (supply > 0 ? supply : air - 12)) * 0.4) : 0;
    switch (seg) {
      case 0:
        return air + plume * (1 - 0.3 * f) - (q === 0 ? 0.15 * (air - glass) * (1 - f) : 0);
      case 1:
        return air + plume * 0.6 * (1 - f) + 0.4;
      case 2:
        return air;
      default:
        return air - 0.4 - 0.1 * (air - glass) * f;
    }
  }

  private loop(now: number) {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    // draw only when it shows: offscreen or in a hidden tab the scene is left alone
    if (this.visible && !document.hidden) {
      // damping keeps the camera gliding after a drag: update() fires 'change' while it moves
      this.controls.update();
      const moving = this.motion && this.particles.length > 0;
      if (moving || this.dirty) this.render(this.motion ? dt : 0);
    }
    this.raf = requestAnimationFrame(this.loop);
  }

  private visible = true;
  private dirty = true;

  private render(dt: number) {
    const f = this.frame;
    if (f && this.layout) {
      const c = this.tmpRgb;
      for (const p of this.particles) {
        const zf = f.zones[p.zone];
        if (!zf) continue;
        const pos = p.points.geometry.getAttribute('position') as THREE.BufferAttribute;
        const col = p.points.geometry.getAttribute('color') as THREE.BufferAttribute;
        const loopFn = makeLoop(p.e.kind === 'floor' ? p.e.depth : p.e.depth, p.e.kind);
        // speed: gentle drift when idle, faster with heat delivered (illustrative)
        const strength = Math.min(1, Math.abs(zf.q) / 1200);
        const speed = (0.03 + 0.22 * strength) * (p.e.kind === 'wall-high' ? 1.4 : 1);
        const reverse = p.e.kind === 'floor' || (p.e.kind === 'wall-high' ? zf.q >= 0 : zf.q < 0);
        for (let i = 0; i < p.u.length; i++) {
          p.u[i] = (p.u[i] + dt * speed * (reverse ? -1 : 1) + 1) % 1;
          const lp = loopFn(p.u[i], this.loopPt);
          const wob = Math.sin(p.u[i] * 12 + i) * 0.08;
          const a = p.e.kind === 'wall-high' ? lp.a : lp.a;
          const y = p.e.kind === 'wall-high' ? HEIGHT - lp.y + 0.05 : lp.y;
          const along = (p.w[i] - 0.5) * (p.e.span - 0.6);
          const x = p.e.origin.x + p.e.inward.x * (a + wob) + p.e.along.x * along;
          const z = p.e.origin.z + p.e.inward.z * (a + wob) + p.e.along.z * along;
          pos.setXYZ(i, x, y, z);
          const seg = p.e.kind === 'wall-high' ? [1, 0, 3, 2][lp.seg] : lp.seg;
          tempRgb(this.particleTemp(p.e, zf, seg, lp.f, f.supply), c);
          col.setXYZ(i, c[0], c[1], c[2]);
        }
        pos.needsUpdate = true;
        col.needsUpdate = true;
      }
      if (this.pipeDots && this.pipeDots.points.visible) {
        const d = this.pipeDots;
        const pos = d.points.geometry.getAttribute('position') as THREE.BufferAttribute;
        const v = 0.04 + 0.1 * f.load;
        for (let i = 0; i < d.u.length; i++) {
          d.u[i] = (d.u[i] + dt * v) % 1;
          const s = d.u[i] * d.total;
          let k = 1;
          while (k < d.lengths.length - 1 && d.lengths[k] < s) k++;
          const a = d.path[k - 1];
          const b = d.path[k];
          const seg = d.lengths[k] - d.lengths[k - 1] || 1;
          const t = (s - d.lengths[k - 1]) / seg;
          pos.setXYZ(i, a.x + (b.x - a.x) * t, 0.06, a.z + (b.z - a.z) * t);
        }
        pos.needsUpdate = true;
      }
      if (this.fan) this.fan.rotation.z += dt * (f.mode !== 0 ? 4 + 10 * f.load : 0);
    }
    this.renderer.render(this.scene, this.camera);
    this.dirty = false;
    this.emitLabels();
  }

  private labelKey = '';
  /** Projects the label anchors and reports them only when they moved on screen (camera, resize, layout). */
  private emitLabels() {
    if (!this.onLabels) return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const out: Label[] = [];
    const v = new THREE.Vector3();
    for (const a of this.labelAnchors) {
      v.copy(a.pos).project(this.camera);
      out.push({ id: a.id, text: a.text(), x: Math.round(((v.x + 1) / 2) * w), y: Math.round(((1 - v.y) / 2) * h), visible: v.z < 1 && v.z > -1 });
    }
    const key = out.map((l) => `${l.id}${l.x},${l.y},${l.visible}`).join('|');
    if (key === this.labelKey) return;
    this.labelKey = key;
    this.onLabels(out);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io.disconnect();
    this.controls.dispose();
    this.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** True when the browser can create a WebGL context. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
