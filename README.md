[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

# Dust Strike — a three.js Tactical FPS

A Counter-Strike-style round-based tactical FPS built with vanilla JavaScript
ES modules and [three.js](https://threejs.org/) (vendored, runs fully offline —
no build step, no CDN calls).

**Play:** open `index.html` via any static server (e.g. `python3 -m http.server`)
or visit the GitHub Pages deployment. Click the canvas to lock the mouse.

## Features

- **Two teams** — Terrorists (T) vs Counter-Terrorists (CT), 5v5 (you + 4 CT bots vs 5 T bots).
- **Rounds** — buy phase (8s) → live round (95s) → round end. Win by eliminating
  the enemy team or (as CT) by surviving until time runs out. First to **8 rounds** wins the match (MR8).
- **Money economy** — start with $800; earn $300 per kill, $3250 per round win,
  $1400 per round loss. Money persists between rounds, cap $16,000.
- **Buy menu (B)** — USP-S pistol (free), AK-47 ($2700), AWP ($4750), Kevlar+Helmet ($1000).
- **Bots with AI** — waypoint graph navigation with BFS pathfinding, line-of-sight
  vision checks, engage/strafe/hunt behaviors, auto-buying, and headshot-capable aim.
- **FPS controls** — pointer lock mouse look, WASD, walk (Shift), jump (Space),
  raycast hitscan shooting with spread, headshot multipliers, reloads and magazines.
- **HUD** — health, armor, money, weapon + ammo, round timer, team score, kill feed,
  scoreboard (Tab), round announcements.
- **Sound** — WebAudio synth gunshots, hit markers, death and round jingles.
- **Map** — hand-built dust2-inspired arena: mid doors, side lanes, crates and platforms.

## Controls

| Key | Action |
|---|---|
| Mouse | Look (click canvas to lock) |
| Left click | Shoot |
| W / A / S / D | Move |
| Shift | Walk (quieter, slower) |
| Space | Jump |
| R | Reload |
| B | Buy menu (buy phase only; keys 1–4 to purchase) |
| Tab | Hold for scoreboard |

## Running / testing

```bash
python3 -m http.server 8080
# open http://localhost:8080/
# headless smoke test (bot-only match, self-terminating):
# open http://localhost:8080/?smoke=1 and inspect window.__smoke
```

`?smoke=1` starts a bot-only match automatically (no pointer lock needed) and
exposes `window.__smoke` with match state, plus `window.__smokeErrors` which
captures any runtime errors — the game is verified to run with **zero console
errors**. The simulation is seeded/deterministic (`?seed=N` to change).

## Tech notes

- Pure ES modules, three.js r160 vendored at `vendor/three.module.js`.
- No bundler, no external network requests at runtime.
- Movement uses axis-separated AABB sliding collision against map colliders.
- Bots navigate a precomputed waypoint graph (edges pruned by raycast against map geometry).
- MIT licensed — see [LICENSE](LICENSE).
