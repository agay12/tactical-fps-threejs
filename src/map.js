// Hand-built dust2-inspired simple map: ground, outer walls, lanes, crates.
// Returns colliders (THREE.Box3 list), spawn points and a waypoint nav graph.
import * as THREE from '../vendor/three.module.js';

const MAT = {
  ground: new THREE.MeshLambertMaterial({ color: 0x8a7f5c }),
  wall: new THREE.MeshLambertMaterial({ color: 0xb0a483 }),
  crate: new THREE.MeshLambertMaterial({ color: 0x7a5a2e }),
  wallLong: new THREE.MeshLambertMaterial({ color: 0xa39877 }),
};

export function buildMap(scene) {
  const colliders = [];
  const solidMeshes = [];

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), MAT.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = false;
  scene.add(ground);

  function box(x, y, z, w, h, d, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || MAT.wall);
    m.position.set(x, y + h / 2, z);
    scene.add(m);
    const b = new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(x, y + h / 2, z), new THREE.Vector3(w, h, d));
    colliders.push(b);
    solidMeshes.push(m);
    return m;
  }

  // Outer walls (arena is 120 x 120, playfield x in [-55,55], z in [-55,55])
  const H = 8, T = 2;
  box(0, 0, 56, 120, H, T, MAT.wallLong);   // north
  box(0, 0, -56, 120, H, T, MAT.wallLong);  // south
  box(56, 0, 0, T, H, 120, MAT.wallLong);   // east
  box(-56, 0, 0, T, H, 120, MAT.wallLong);  // west

  // Mid structure: long walls creating a mid corridor, with gaps (doors)
  box(-8, 0, 20, 26, H, 2.2, MAT.wallLong);       // wall west of mid (T side) gap at left
  box(14, 0, 12, 22, H, 2.2, MAT.wallLong);       // wall east of mid (T side)
  box(-8, 0, -20, 26, H, 2.2, MAT.wallLong);      // wall west of mid (CT side)
  box(14, 0, -12, 22, H, 2.2, MAT.wallLong);      // wall east of mid (CT side)
  // Mid "double doors" pillars
  box(-1.5, 0, 4, 3, H, 2, MAT.wall);
  box(1.5, 0, -4, 3, H, 2, MAT.wall);

  // Left lane (x ~ -35): site A-ish plateau with boxes
  box(-40, 0, 30, 18, 1.2, 18, MAT.wall);   // low platform (walkable-ish, acts as block)
  box(-44, 0, 24, 3, 3, 3, MAT.crate);
  box(-38, 0, 32, 3, 3, 3, MAT.crate);
  box(-34, 0, 36, 3, 3, 3, MAT.crate);
  box(-40, 0, -32, 4, 4, 4, MAT.crate);     // A site crates (CT side)
  box(-34, 0, -36, 3, 3, 3, MAT.crate);

  // Right lane (x ~ 35): site B-ish with crates
  box(44, 0, -30, 18, 1.2, 18, MAT.wall);
  box(40, 0, -26, 3, 3, 3, MAT.crate);
  box(46, 0, -34, 3, 3, 3, MAT.crate);
  box(40, 0, 30, 4, 4, 4, MAT.crate);       // B tunnels crates (T side)
  box(34, 0, 38, 3, 3, 3, MAT.crate);

  // Scatter cover in open areas
  box(24, 0, 22, 3, 3, 3, MAT.crate);
  box(-24, 0, -22, 3, 3, 3, MAT.crate);
  box(0, 0, 34, 4, 4, 4, MAT.crate);        // mid top box
  box(0, 0, -34, 4, 4, 4, MAT.crate);       // mid bottom box

  // Spawns
  const ctSpawns = [
    new THREE.Vector3(-6, 0, -50), new THREE.Vector3(-2, 0, -50),
    new THREE.Vector3(2, 0, -50), new THREE.Vector3(6, 0, -50),
    new THREE.Vector3(0, 0, -46),
  ];
  const tSpawns = [
    new THREE.Vector3(-6, 0, 50), new THREE.Vector3(-2, 0, 50),
    new THREE.Vector3(2, 0, 50), new THREE.Vector3(6, 0, 50),
    new THREE.Vector3(0, 0, 46),
  ];

  // Waypoints: lanes + connectors. Segments blocked by colliders are pruned.
  const wp = [
    // T side
    new THREE.Vector3(0, 0, 46), new THREE.Vector3(0, 0, 38),
    new THREE.Vector3(-16, 0, 38), new THREE.Vector3(16, 0, 38),
    new THREE.Vector3(-34, 0, 38), new THREE.Vector3(38, 0, 36),
    new THREE.Vector3(-44, 0, 30), new THREE.Vector3(46, 0, 24),
    // mid
    new THREE.Vector3(-4, 0, 18), new THREE.Vector3(4, 0, 8),
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(-4, 0, -8), new THREE.Vector3(4, 0, -18),
    // CT side
    new THREE.Vector3(0, 0, -38), new THREE.Vector3(0, 0, -46),
    new THREE.Vector3(-16, 0, -38), new THREE.Vector3(16, 0, -38),
    new THREE.Vector3(-34, 0, -38), new THREE.Vector3(38, 0, -36),
    new THREE.Vector3(-44, 0, -30), new THREE.Vector3(46, 0, -24),
    // lane connectors
    new THREE.Vector3(-48, 0, 0), new THREE.Vector3(48, 0, 0),
    new THREE.Vector3(-48, 0, 14), new THREE.Vector3(-48, 0, -14),
    new THREE.Vector3(48, 0, 14), new THREE.Vector3(48, 0, -14),
    new THREE.Vector3(24, 0, 0), new THREE.Vector3(-24, 0, 0),
  ];

  // Build nav graph: edge if segment between nodes is clear of colliders
  // (inflated a bit for agent radius) and nodes are not inside colliders.
  const NAV_R = 1.1;
  const nodes = wp.map((p) => p.clone());
  const nodeOk = nodes.map((p) => !colliders.some((b) => {
    const c = b.clone().expandByScalar(NAV_R);
    return c.containsPoint(new THREE.Vector3(p.x, 1, p.z));
  }));
  const edges = nodes.map(() => []);
  const ray = new THREE.Ray();
  const tmp = new THREE.Vector3();
  for (let i = 0; i < nodes.length; i++) {
    if (!nodeOk[i]) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      if (!nodeOk[j]) continue;
      const a = nodes[i], b = nodes[j];
      const d = a.distanceTo(b);
      if (d > 26) continue;
      tmp.copy(b).sub(a).normalize();
      ray.set(new THREE.Vector3(a.x, 1.2, a.z), tmp);
      const inflated = colliders.map((c) => c.clone().expandByScalar(NAV_R));
      let blocked = false;
      for (const c of inflated) {
        const hit = ray.intersectBox(c, new THREE.Vector3());
        if (hit) {
          const hd = hit.distanceTo(ray.origin);
          if (hd < d - 0.3) { blocked = true; break; }
        }
      }
      if (!blocked) { edges[i].push(j); edges[j].push(i); }
    }
  }
  // Safety: ensure global connectivity — BFS from node 0, then link each
  // unreached ok node to its nearest reached node until the graph is connected.
  const connected = () => {
    const seen = new Array(nodes.length).fill(false);
    const q = [0]; seen[0] = true;
    while (q.length) {
      const u = q.shift();
      for (const v of edges[u]) if (!seen[v]) { seen[v] = true; q.push(v); }
    }
    return seen;
  };
  for (let guard = 0; guard < nodes.length; guard++) {
    const seen = connected();
    const unreached = [];
    for (let i = 0; i < nodes.length; i++) if (nodeOk[i] && !seen[i]) unreached.push(i);
    if (unreached.length === 0) break;
    for (const i of unreached) {
      let best = -1, bd = Infinity;
      for (let j = 0; j < nodes.length; j++) {
        if (j === i || !nodeOk[j] || !seen[j]) continue;
        const d = nodes[i].distanceTo(nodes[j]);
        if (d < bd) { bd = d; best = j; }
      }
      if (best >= 0) { edges[i].push(best); edges[best].push(i); }
    }
  }

  return { colliders, solidMeshes, spawns: { ct: ctSpawns, t: tSpawns }, nav: { nodes, edges, ok: nodeOk } };
}

// BFS path over the nav graph. Returns array of node indices from nearest
// node to `from` to nearest node to `to`, or null.
export function findPath(nav, from, to) {
  const { nodes, edges, ok } = nav;
  const nearest = (p) => {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      if (!ok[i]) continue;
      const d = nodes[i].distanceTo(p);
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  };
  const s = nearest(from), e = nearest(to);
  if (s < 0 || e < 0) return null;
  const prev = new Array(nodes.length).fill(-1);
  const seen = new Array(nodes.length).fill(false);
  const q = [s]; seen[s] = true;
  while (q.length) {
    const u = q.shift();
    if (u === e) break;
    for (const v of edges[u]) if (!seen[v]) { seen[v] = true; prev[v] = u; q.push(v); }
  }
  if (!seen[e]) return null;
  const path = [];
  for (let u = e; u !== -1; u = prev[u]) path.push(u);
  path.reverse();
  return path;
}
