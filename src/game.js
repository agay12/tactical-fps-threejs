// Core game: entities, bots, round/economy system, player controller, HUD.
import * as THREE from '../vendor/three.module.js';
import { WEAPONS, ARMOR_COST, makeLoadout } from './weapons.js';
import { Sfx } from './audio.js';
import { makeRng } from './rng.js';

const EYE = 1.6, RADIUS = 0.4, HEIGHT = 1.8, SPEED = 7.2, WALK = 3.4, GRAVITY = 22, JUMP = 7.5;
const TEAM_COLOR = { ct: 0x3b7dd8, t: 0xc9a227 };
const WIN_ROUNDS = 8, ROUND_TIME = 95, BUY_TIME = 8, END_TIME = 4;

function slideMove(pos, dx, dz, colliders, bounds = 54) {
  const test = (x, z) => {
    const b = new THREE.Box3(
      new THREE.Vector3(x - RADIUS, pos.y + 0.01, z - RADIUS),
      new THREE.Vector3(x + RADIUS, pos.y + HEIGHT, z + RADIUS));
    for (const c of colliders) if (b.intersectsBox(c)) return false;
    return true;
  };
  let nx = pos.x + dx;
  if (test(nx, pos.z)) pos.x = THREE.MathUtils.clamp(nx, -bounds, bounds);
  let nz = pos.z + dz;
  if (test(pos.x, nz)) pos.z = THREE.MathUtils.clamp(nz, -bounds, bounds);
}

export class Game {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.rng = makeRng(opts.seed ?? 1337);
    this.sfx = new Sfx();
    this.opts = opts;
    this.entities = [];
    this.score = { ct: 0, t: 0 };
    this.roundNumber = 0;
    this.phase = 'idle';
    this.timer = 0;
    this.roundWinner = null;
    this.human = null;
    this.buyTime = opts.smoke ? 2 : BUY_TIME;
    this.roundTime = opts.smoke ? 25 : ROUND_TIME;
    this.running = false;
    this.keys = new Set();
    this.raycaster = new THREE.Raycaster();
    this.renderer = null;
    this.errors = [];

    this.initRenderer();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fb6c9);
    this.scene.fog = new THREE.Fog(0x9fb6c9, 60, 160);
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 300);

    const amb = new THREE.AmbientLight(0xffffff, 0.75);
    const sun = new THREE.DirectionalLight(0xfff2d0, 1.1);
    sun.position.set(30, 60, 20);
    this.scene.add(amb, sun);

    // map injected by main (buildMap) before startMatch
    this.clock = new THREE.Clock();
    this.lastHudUpdate = 0;
  }

  initRenderer() {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    } catch (e) {
      this.renderer = null;
      this.errors.push('WebGL unavailable: ' + e.message);
    }
  }

  setMap(map) { this.map = map; }

  // ---------------- match / round flow ----------------
  startMatch(playerTeam = 'ct', playerAsBot = false) {
    this.entities = [];
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
    for (const team of ['ct', 't']) {
      for (let i = 0; i < 5; i++) {
        const isHuman = team === playerTeam && i === 0 && !playerAsBot;
        const e = {
          id: `${team}-${i}`,
          name: isHuman ? 'You' : `${team.toUpperCase()} ${names[i]}`,
          team, isBot: !isHuman, isHuman,
          pos: new THREE.Vector3(), yaw: 0, pitch: 0,
          health: 100, armor: 0, alive: true,
          weapon: makeLoadout('pistol'),
          money: 800, kills: 0, deaths: 0,
          vy: 0, grounded: true,
          mesh: null,
          // bot state
          state: 'idle', path: null, pathIdx: 0, think: 0, target: null,
          lastSeen: null, strafe: 0, strafeT: 0, fireCd: 0,
        };
        const mat = new THREE.MeshLambertMaterial({ color: TEAM_COLOR[team] });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.6), mat);
        mesh.userData.entity = e;
        e.mesh = mesh;
        this.scene.add(mesh);
        this.entities.push(e);
        if (isHuman) this.human = e;
      }
    }
    this.score = { ct: 0, t: 0 };
    this.roundNumber = 0;
    this.buildHud();
    this.startRound();
    this.running = true;
  }

  startRound() {
    this.roundNumber++;
    this.phase = 'buy';
    this.timer = this.buyTime;
    this.roundWinner = null;
    for (const e of this.entities) {
      const spawn = this.map.spawns[e.team][this.entities.filter(x => x.team === e.team).indexOf(e)];
      e.pos.copy(spawn);
      e.health = 100; e.alive = true; e.vy = 0;
      if (!e.survived) e.weapon = makeLoadout('pistol');
      e.survived = false;
      e.weapon.reloading = 0; e.weapon.cooldown = 0;
      e.state = 'idle'; e.path = null; e.target = null; e.lastSeen = null;
      e.mesh.visible = true;
      if (e.isBot) this.botBuy(e);
    }
    this.killFeedMsg(null, null, `Round ${this.roundNumber} — buy phase`);
    this.msg(`Round ${this.roundNumber}`);
  }

  botBuy(e) {
    if (e.money >= WEAPONS.rifle.cost) { e.money -= WEAPONS.rifle.cost; e.weapon = makeLoadout('rifle'); }
    else if (e.money >= WEAPONS.awp.cost && this.rng() < 0.2) { e.money -= WEAPONS.awp.cost; e.weapon = makeLoadout('awp'); }
    if (e.money >= ARMOR_COST && e.armor < 50) { e.money -= ARMOR_COST; e.armor = 100; }
  }

  endRound(winner) {
    if (this.phase !== 'live' && this.phase !== 'buy') return;
    this.phase = 'end';
    this.timer = END_TIME;
    this.roundWinner = winner;
    this.score[winner]++;
    const win = winner === 'ct' ? 3250 : 3250, lose = 1400;
    for (const e of this.entities) {
      e.money = Math.min(16000, e.money + (e.team === winner ? win : lose));
      if (e.alive) e.survived = true;
    }
    this.msg(`${winner === 'ct' ? 'Counter-Terrorists' : 'Terrorists'} win the round!`);
    if (this.human) { winner === this.human.team ? this.sfx.roundWin() : this.sfx.roundLose(); }
    this.killFeedMsg(null, null, `${winner.toUpperCase()} win round ${this.roundNumber} (${this.score.ct}–${this.score.t})`);
    if (this.score[winner] >= WIN_ROUNDS) {
      this.phase = 'over';
      this.msg(`${winner === 'ct' ? 'Counter-Terrorists' : 'Terrorists'} WIN THE MATCH ${this.score.ct}–${this.score.t}`);
      this.running = false;
    }
  }

  checkElimination() {
    const ctAlive = this.entities.filter(e => e.team === 'ct' && e.alive).length;
    const tAlive = this.entities.filter(e => e.team === 't' && e.alive).length;
    if (tAlive === 0) this.endRound('ct');
    else if (ctAlive === 0) this.endRound('t');
  }

  // ---------------- combat ----------------
  losBlocked(from, to) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    if (dist < 0.01) return false;
    dir.normalize();
    this.raycaster.set(from, dir);
    this.raycaster.far = dist;
    const hits = this.raycaster.intersectObjects(this.map.solidMeshes, false);
    return hits.length > 0;
  }

  applyDamage(attacker, victim, dmg, head) {
    if (!victim.alive) return;
    if (victim.armor > 0) { dmg *= 0.6; victim.armor = Math.max(0, victim.armor - dmg * 0.5); }
    victim.health -= dmg;
    if (victim.isHuman) this.sfx.hurt();
    if (victim.health <= 0) {
      victim.alive = false;
      victim.deaths++;
      victim.mesh.visible = false;
      attacker.kills++;
      attacker.money = Math.min(16000, attacker.money + 300);
      this.killFeedMsg(attacker, victim, head ? 'headshot' : '');
      if (victim.isHuman || attacker.isHuman) this.sfx.death();
      this.checkElimination();
    }
  }

  // spread-perturbed direction + trace; returns true if hit victim
  traceShot(shooter, fromV, dirV, weapon, victim) {
    const spread = weapon.spread * (shooter.isHuman && this.keys.has('ShiftLeft') ? 1.4 : 1);
    const dist = fromV.distanceTo(victim.pos.clone().setY(victim.pos.y + 1.2));
    const acc = Math.max(0.08, 1 - dist / (weapon.range * 1.4) - spread * 4 * (1 + Math.random() * 0));
    // deterministic-ish per-bot accuracy via rng
    const hitChance = shooter.isBot ? Math.max(0.12, 1 - dist / 60) * 0.85 : acc;
    if (this.rng() > hitChance) return false;
    if (this.losBlocked(fromV, victim.pos.clone().setY(victim.pos.y + 1.2))) return false;
    const head = this.rng() < 0.18;
    this.applyDamage(shooter, victim, weapon.dmg * (head ? weapon.headMult : 1), head);
    return true;
  }

  botFire(e, target) {
    const w = WEAPONS[e.weapon.key];
    if (e.weapon.cooldown > 0 || e.weapon.reloading > 0) return;
    if (e.weapon.ammo <= 0) { this.startReload(e); return; }
    e.weapon.ammo--;
    e.weapon.cooldown = 60 / w.rpm;
    const from = e.pos.clone().setY(e.pos.y + EYE);
    this.traceShot(e, from, null, w, target);
    if (this.human && (e.pos.distanceTo(this.human.pos) < 40)) this.sfx.shot();
  }

  startReload(e) {
    const w = WEAPONS[e.weapon.key];
    if (!w.mag || e.weapon.reloading > 0 || e.weapon.ammo === w.mag || e.weapon.reserve <= 0) return;
    e.weapon.reloading = w.reload;
  }

  finishReload(e) {
    const w = WEAPONS[e.weapon.key];
    const need = w.mag - e.weapon.ammo;
    const take = Math.min(need, e.weapon.reserve);
    e.weapon.ammo += take; e.weapon.reserve -= take;
  }

  playerFire() {
    const e = this.human;
    if (!e || !e.alive || this.phase !== 'live') return;
    const w = WEAPONS[e.weapon.key];
    if (e.weapon.cooldown > 0 || e.weapon.reloading > 0) return;
    if (e.weapon.ammo <= 0) { this.startReload(e); return; }
    e.weapon.ammo--;
    e.weapon.cooldown = 60 / w.rpm;
    this.sfx.shot();
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(e.pitch, e.yaw, 0, 'YXZ'));
    const spread = w.spread;
    dir.x += (this.rng() - 0.5) * spread * 2;
    dir.y += (this.rng() - 0.5) * spread * 2;
    dir.z += (this.rng() - 0.5) * spread * 2;
    dir.normalize();
    const from = new THREE.Vector3(e.pos.x, e.pos.y + EYE, e.pos.z);
    this.raycaster.set(from, dir);
    this.raycaster.far = w.range;
    const targets = this.entities.filter(x => x.alive && x !== e).map(x => x.mesh);
    const hits = this.raycaster.intersectObjects([...targets, ...this.map.solidMeshes], false);
    if (hits.length) {
      const h = hits[0];
      const ent = h.object.userData.entity;
      if (ent && ent.alive) {
        const head = h.point.y > ent.pos.y + 1.45;
        this.applyDamage(e, ent, w.dmg * (head ? w.headMult : 1), head);
        this.sfx.hit();
      }
    }
  }

  // ---------------- bots ----------------
  visibleEnemies(e) {
    const eye = e.pos.clone().setY(e.pos.y + EYE);
    const out = [];
    for (const o of this.entities) {
      if (o.team === e.team || !o.alive) continue;
      const chest = o.pos.clone().setY(o.pos.y + 1.2);
      const d = eye.distanceTo(chest);
      if (d > 70) continue;
      // FOV check ~150 degrees
      const fwd = new THREE.Vector3(Math.sin(e.yaw), 0, Math.cos(e.yaw));
      const to = chest.clone().sub(eye).setY(0).normalize();
      if (fwd.dot(to) < -0.25) continue;
      if (this.losBlocked(eye, chest)) continue;
      out.push(o);
    }
    return out;
  }

  updateBot(e, dt) {
    if (!e.alive) return;
    e.think -= dt;
    if (e.think <= 0) {
      e.think = 0.25 + this.rng() * 0.15;
      const vis = this.visibleEnemies(e);
      if (vis.length) {
        e.target = vis.sort((a, b) => a.pos.distanceTo(e.pos) - b.pos.distanceTo(e.pos))[0];
        e.state = 'engage';
        e.lastSeen = e.target.pos.clone();
      } else {
        e.target = null;
        if (e.state === 'engage') e.state = 'hunt';
        if (!e.path || e.pathIdx >= e.path.length) {
          // choose objective: last seen enemy pos, else push toward enemy side / random waypoint
          const enemySide = e.team === 'ct' ? 1 : -1;
          const navOk = this.map.nav.ok;
          const enemyNodes = this.map.nav.nodes.filter((n, i) => navOk[i] && Math.sign(n.z) === enemySide);
          const goal = (e.lastSeen && this.rng() < 0.6) ? e.lastSeen
            : (this.rng() < 0.7 && enemyNodes.length)
              ? enemyNodes[this.rng.int(enemyNodes.length)]
              : this.map.nav.nodes[this.rng.int(this.map.nav.nodes.length)];
          e.path = this.findPath(e.pos, goal);
          e.pathIdx = 0;
        }
      }
    }
    const w = WEAPONS[e.weapon.key];
    if (e.weapon.cooldown > 0) e.weapon.cooldown -= dt;
    if (e.weapon.reloading > 0) {
      e.weapon.reloading -= dt;
      if (e.weapon.reloading <= 0) this.finishReload(e);
    }

    if (this.phase !== 'live') return; // frozen during buy/end

    if (e.state === 'engage' && e.target && e.target.alive) {
      const to = e.target.pos.clone().sub(e.pos);
      const desired = Math.atan2(to.x, to.z);
      // turn toward target smoothly
      let diff = desired - e.yaw;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      e.yaw += THREE.MathUtils.clamp(diff, -6 * dt, 6 * dt);
      // strafe
      e.strafeT -= dt;
      if (e.strafeT <= 0) { e.strafeT = 0.5 + this.rng(); e.strafe = this.rng.pick([-1, 0, 1]); }
      const side = new THREE.Vector3(Math.cos(e.yaw), 0, -Math.sin(e.yaw)).multiplyScalar(e.strafe * 2.4 * dt);
      slideMove(e.pos, side.x, side.z, this.map.colliders);
      if (Math.abs(diff) < 0.25) this.botFire(e, e.target);
    } else {
      // follow path
      if (e.path && e.pathIdx < e.path.length) {
        const node = this.map.nav.nodes[e.path[e.pathIdx]];
        const to = node.clone().sub(e.pos).setY(0);
        if (to.length() < 1.5) { e.pathIdx++; }
        else {
          to.normalize();
          const desired = Math.atan2(to.x, to.z);
          let diff = desired - e.yaw;
          while (diff > Math.PI) diff -= 2 * Math.PI;
          while (diff < -Math.PI) diff += 2 * Math.PI;
          e.yaw += THREE.MathUtils.clamp(diff, -4 * dt, 4 * dt);
          const step = to.multiplyScalar(SPEED * dt);
          slideMove(e.pos, step.x, step.z, this.map.colliders);
        }
      } else {
        e.yaw += Math.sin(performance.now() / 900) * 0.002;
      }
    }
  }

  findPath(from, to) {
    // BFS using map.nav (imported lazily to avoid circular import)
    const { nodes, edges, ok } = this.map.nav;
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

  // ---------------- player ----------------
  updatePlayer(dt) {
    const e = this.human;
    if (!e) return;
    if (e.weapon.cooldown > 0) e.weapon.cooldown -= dt;
    if (e.weapon.reloading > 0) {
      e.weapon.reloading -= dt;
      if (e.weapon.reloading <= 0) this.finishReload(e);
    }
    if (!e.alive || this.phase !== 'live') return;
    const speed = this.keys.has('ShiftLeft') ? WALK : SPEED;
    const fwd = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const side = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    if (fwd || side) {
      const sin = Math.sin(e.yaw), cos = Math.cos(e.yaw);
      const dx = (sin * fwd + cos * side) * speed * dt;
      const dz = (cos * fwd - sin * side) * speed * dt;
      slideMove(e.pos, dx, dz, this.map.colliders);
    }
    if (this.keys.has('Space') && e.grounded) { e.vy = JUMP; e.grounded = false; }
    if (!e.grounded) {
      e.vy -= GRAVITY * dt;
      e.pos.y += e.vy * dt;
      if (e.pos.y <= 0) { e.pos.y = 0; e.vy = 0; e.grounded = true; }
    }
    this.camera.position.set(e.pos.x, e.pos.y + EYE, e.pos.z);
    this.camera.rotation.set(e.pitch, e.yaw, 0, 'YXZ');
  }

  onMouseMove(dx, dy) {
    const e = this.human;
    if (!e || !e.alive) return;
    e.yaw -= dx * 0.0022;
    e.pitch -= dy * 0.0022;
    e.pitch = THREE.MathUtils.clamp(e.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
  }

  // ---------------- HUD ----------------
  buildHud() {
    const root = document.getElementById('hud');
    root.innerHTML = `
      <div id="crosshair"></div>
      <div id="topbar"><span id="score-ct">CT 0</span><span id="round-info">R1</span><span id="score-t">T 0</span></div>
      <div id="timer">--:--</div>
      <div id="announce"></div>
      <div id="killfeed"></div>
      <div id="bottombar">
        <div id="health">❤ 100</div>
        <div id="money">$800</div>
        <div id="weapon">USP-S 12/24</div>
        <div id="armor"></div>
      </div>
      <div id="buymenu" class="hidden">
        <h2>Buy Menu (B to close)</h2>
        <div data-buy="pistol">[1] USP-S — free</div>
        <div data-buy="rifle">[2] AK-47 — $2700</div>
        <div data-buy="awp">[3] AWP — $4750</div>
        <div data-buy="armor">[4] Kevlar+Helmet — $1000</div>
      </div>
      <div id="scoreboard" class="hidden"></div>
      <div id="fps-hint">WASD move · Shift walk · Space jump · Mouse look · Click shoot · R reload · B buy · Tab scoreboard</div>`;
    this.hudEls = {
      scoreCt: document.getElementById('score-ct'),
      scoreT: document.getElementById('score-t'),
      roundInfo: document.getElementById('round-info'),
      timer: document.getElementById('timer'),
      announce: document.getElementById('announce'),
      killfeed: document.getElementById('killfeed'),
      health: document.getElementById('health'),
      money: document.getElementById('money'),
      weapon: document.getElementById('weapon'),
      armor: document.getElementById('armor'),
      buymenu: document.getElementById('buymenu'),
      scoreboard: document.getElementById('scoreboard'),
    };
  }

  msg(text) {
    if (!this.hudEls) return;
    this.hudEls.announce.textContent = text;
    clearTimeout(this._msgT);
    this._msgT = setTimeout(() => { if (this.hudEls) this.hudEls.announce.textContent = ''; }, 3000);
  }

  killFeedMsg(attacker, victim, extra) {
    if (!this.hudEls) return;
    const div = document.createElement('div');
    div.textContent = attacker && victim
      ? `${attacker.name} ${extra === 'headshot' ? '✛' : '✖'} ${victim.name}${extra === 'headshot' ? ' (HS)' : ''}`
      : `— ${extra} —`;
    this.hudEls.killfeed.appendChild(div);
    while (this.hudEls.killfeed.children.length > 6) this.hudEls.killfeed.removeChild(this.hudEls.killfeed.firstChild);
    setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 6000);
  }

  toggleBuyMenu() {
    if (!this.hudEls) return;
    this.hudEls.buymenu.classList.toggle('hidden');
  }

  buy(key) {
    const e = this.human;
    if (!e || this.phase !== 'buy') { this.msg('Buy only during buy phase'); return; }
    if (key === 'armor') {
      if (e.money >= ARMOR_COST && e.armor < 100) { e.money -= ARMOR_COST; e.armor = 100; this.sfx.buy(); this.msg('Kevlar+Helmet purchased'); }
      else this.msg('Not enough money or already armored');
      return;
    }
    const w = WEAPONS[key];
    if (!w) return;
    if (e.weapon.key === key) { this.msg('Already equipped'); return; }
    if (e.money < w.cost) { this.msg('Not enough money'); return; }
    e.money -= w.cost;
    e.weapon = makeLoadout(key);
    this.sfx.buy();
    this.msg(`${w.name} purchased`);
  }

  updateHud() {
    if (!this.hudEls) return;
    const e = this.human || this.entities[0];
    const w = WEAPONS[e.weapon.key];
    this.hudEls.scoreCt.textContent = `CT ${this.score.ct}`;
    this.hudEls.scoreT.textContent = `T ${this.score.t}`;
    this.hudEls.roundInfo.textContent = `R${this.roundNumber} · MR${WIN_ROUNDS}`;
    const t = Math.max(0, Math.ceil(this.timer));
    this.hudEls.timer.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    this.hudEls.health.textContent = `❤ ${Math.max(0, Math.round(e.health))}`;
    this.hudEls.money.textContent = `$${e.money}`;
    this.hudEls.weapon.textContent = w.mag
      ? `${w.name} ${e.weapon.ammo}/${e.weapon.reserve}${e.weapon.reloading > 0 ? ' · reloading' : ''}`
      : w.name;
    this.hudEls.armor.textContent = e.armor > 0 ? `🛡 ${e.armor}` : '';
    const sb = this.entities.map(x =>
      `<div class="${x.team}${x.alive ? '' : ' dead'}">${x.name} — ${x.kills}/${x.deaths} — $${x.money} — ${WEAPONS[x.weapon.key].name}</div>`);
    this.hudEls.scoreboard.innerHTML = `<h2>Scoreboard — Round ${this.roundNumber}</h2>` + sb.join('');
  }

  toggleScoreboard(show) {
    if (this.hudEls) this.hudEls.scoreboard.classList.toggle('hidden', !show);
  }

  // ---------------- main loop ----------------
  update() {
    const dt = Math.min(0.1, this.clock.getDelta());
    if (this.phase === 'buy') {
      this.timer -= dt;
      if (this.timer <= 0) { this.phase = 'live'; this.timer = this.roundTime; this.msg('GO GO GO!'); }
    } else if (this.phase === 'live') {
      this.timer -= dt;
      if (this.timer <= 0) this.endRound('ct'); // time out favors defenders
    } else if (this.phase === 'end') {
      this.timer -= dt;
      if (this.timer <= 0 && this.running) this.startRound();
    }
    for (const e of this.entities) {
      if (e.isBot) this.updateBot(e, dt);
    }
    this.updatePlayer(dt);
    for (const e of this.entities) {
      e.mesh.position.set(e.pos.x, e.pos.y + 0.9, e.pos.z);
      e.mesh.rotation.y = e.yaw;
    }
    // if human is dead, spectate from above
    if (this.human && !this.human.alive && this.phase !== 'idle') {
      const alive = this.entities.find(x => x.alive);
      const focus = alive ? alive.pos : new THREE.Vector3(0, 0, 0);
      this.camera.position.set(focus.x, 14, focus.z + 10);
      this.camera.lookAt(focus);
    }
    // Throttle rendering in smoke mode (software GL is slow); sim still runs at full rate.
    const skip = this.opts.smoke ? 8 : 1;
    this._frameNo = (this._frameNo || 0) + 1;
    if (this.renderer && this.map && this._frameNo % skip === 0) this.renderer.render(this.scene, this.camera);
    const now = performance.now();
    if (now - this.lastHudUpdate > 100) { this.lastHudUpdate = now; this.updateHud(); }
  }
}
