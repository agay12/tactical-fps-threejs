// Weapon definitions shared by player and bots.
export const WEAPONS = {
  knife:  { name: 'Knife',        dmg: 35,  headMult: 2,   rpm: 120, spread: 0.02, range: 2.5,  cost: 0,    auto: false },
  pistol: { name: 'USP-S',        dmg: 26,  headMult: 4,   rpm: 300, spread: 0.018, range: 100, cost: 0,    auto: false, mag: 12, reserve: 24, reload: 1.8 },
  rifle:  { name: 'AK-47',        dmg: 33,  headMult: 4,   rpm: 600, spread: 0.02,  range: 120, cost: 2700, auto: true,  mag: 30, reserve: 90, reload: 2.4 },
  awp:    { name: 'AWP',          dmg: 115, headMult: 1.5, rpm: 41,  spread: 0.004, range: 200, cost: 4750, auto: false, mag: 5,  reserve: 20, reload: 3.2 },
};

export const ARMOR_COST = 1000;

export function makeLoadout(key) {
  const w = WEAPONS[key];
  return {
    key,
    ammo: w.mag ?? 0,
    reserve: w.reserve ?? 0,
    reloading: 0,
    cooldown: 0,
  };
}
