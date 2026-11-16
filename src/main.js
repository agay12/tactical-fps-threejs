// Bootstrap: renderer, map, input wiring, smoke mode for headless testing.
import { Game } from './game.js';
import { buildMap } from './map.js';

const params = new URLSearchParams(window.location.search);
const SMOKE = params.get('smoke') === '1';

// Global error capture (kept for diagnostics; game must run with zero errors)
window.__smokeErrors = window.__smokeErrors || [];
window.addEventListener('error', (ev) => {
  window.__smokeErrors.push(String(ev.message || ev.error || 'unknown error'));
});
window.addEventListener('unhandledrejection', (ev) => {
  window.__smokeErrors.push('unhandledrejection: ' + String(ev.reason));
});

const canvas = document.getElementById('game');
const game = new Game(canvas, { seed: Number(params.get('seed') || 1337), smoke: SMOKE });
game.setMap(buildMap(game.scene));
window.__game = game;

// --- input wiring ---
canvas.addEventListener('click', () => {
  if (game.human && game.human.alive && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
  }
  game.sfx.ensure();
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) game.onMouseMove(e.movementX, e.movementY);
});
document.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement === canvas && e.button === 0) {
    game.playerFire();
    game.mouseDown = true;
  }
});
document.addEventListener('mouseup', () => { game.mouseDown = false; });
document.addEventListener('keydown', (e) => {
  game.keys.add(e.code);
  if (e.code === 'KeyB') game.toggleBuyMenu();
  if (e.code === 'KeyR') game.startReload(game.human);
  if (e.code === 'Tab') { e.preventDefault(); game.toggleScoreboard(true); }
  if (game.hudEls && game.hudEls.buymenu && !game.hudEls.buymenu.classList.contains('hidden')) {
    if (e.code === 'Digit1') game.buy('pistol');
    if (e.code === 'Digit2') game.buy('rifle');
    if (e.code === 'Digit3') game.buy('awp');
    if (e.code === 'Digit4') game.buy('armor');
  }
});
document.addEventListener('keyup', (e) => {
  game.keys.delete(e.code);
  if (e.code === 'Tab') game.toggleScoreboard(false);
});
window.addEventListener('resize', () => {
  if (!game.renderer) return;
  game.renderer.setSize(window.innerWidth, window.innerHeight);
  game.camera.aspect = window.innerWidth / window.innerHeight;
  game.camera.updateProjectionMatrix();
});

// --- start ---
const playerAsBot = SMOKE || params.get('spectate') === '1';
game.startMatch('ct', playerAsBot);

// --- smoke hook for headless verification ---
if (SMOKE) {
  window.__smoke = {
    status: 'running',
    startedAt: Date.now(),
    rounds: () => game.roundNumber,
    score: () => ({ ...game.score }),
    phase: () => game.phase,
    entitiesAlive: () => game.entities.filter(e => e.alive).length,
    errors: () => window.__smokeErrors,
  };
  // Publish smoke state into the DOM so headless dump-dom can verify it.
  const probe = document.createElement('div');
  probe.id = 'smoke-status';
  probe.style.cssText = 'position:fixed;top:0;left:0;color:#fff;font-size:10px;';
  document.body.appendChild(probe);
  const publish = () => {
    try {
      probe.textContent = 'SMOKE:' + JSON.stringify({
        status: window.__smoke.status, phase: game.phase, round: game.roundNumber,
        score: game.score, alive: game.entities.filter(e => e.alive).length,
        frames: window.__frameCount ? window.__frameCount() : 0,
        kills: game.entities.map(e => e.kills).join(','),
        pos: game.entities.slice(0, 3).map(e => [Math.round(e.pos.x), Math.round(e.pos.z)].join(':')).join(','),
        errors: window.__smokeErrors,
      });
    } catch (e) { /* keep silent */ }
  };
  setInterval(publish, 250);
  publish();
  // End the match early after 40 virtual seconds so smoke runs conclude.
  const smokeEnd = setTimeout(() => {
    try {
      window.__smoke.status = 'done';
      game.running = false;
    } catch (e) { window.__smokeErrors.push('smoke end: ' + e.message); }
  }, 40000);
  window.__smoke.cancelEnd = () => clearTimeout(smokeEnd);
}

// --- game loop ---
let running = true;
let lastFrame = 0;
let frameCount = 0;
function loop() {
  if (!running) return;
  requestAnimationFrame(loop);
  frameCount++;
  lastFrame = performance.now();
  try { game.update(); } catch (e) {
    window.__smokeErrors.push('frame: ' + (e && e.stack ? e.stack.split('\n')[0] : e));
    if (window.__lastFrameError === undefined) window.__lastFrameError = String(e && e.stack || e);
  }
}
requestAnimationFrame(loop);
// Headless-safe fallback: if rAF stalls (no compositor), a low-rate timer
// keeps the simulation advancing. dt is capped inside game.update().
window.__frameCount = () => frameCount;
setInterval(() => {
  if (running && performance.now() - lastFrame > 120) game.update();
}, 50);

// Expose a stop for smoke mode to halt rendering churn
window.__stopLoop = () => { running = false; };
