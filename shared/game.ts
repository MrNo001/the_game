// The game rules: how players move, dash, shoot and get hit.
// Both the server (to run the real game) and the browser (to draw
// the charge indicators) import this file, so the rules exist in one place.

// ---- Tuning knobs: change these to try out new ideas ----

export const ARENA_WIDTH = 1000;
export const ARENA_HEIGHT = 600;

export const PLAYER_RADIUS = 20;
export const PLAYER_SPEED = 250; // pixels per second
export const MAX_HEALTH = 100;

export const DASH_MAX_CHARGE = 1; // seconds of holding Shift to reach full power
export const DASH_MIN_DISTANCE = 60;
export const DASH_MAX_DISTANCE = 300;
export const DASH_SPEED = 1500; // pixels per second while dashing
export const DASH_COOLDOWN = 1.5; // seconds

export const ARROW_MAX_CHARGE = 1; // seconds of holding the mouse to reach full power
export const ARROW_MIN_RANGE = 150;
export const ARROW_MAX_RANGE = 700;
export const ARROW_SPEED = 900; // pixels per second
export const ARROW_RADIUS = 5;
export const ARROW_DAMAGE = 20;
export const ARROW_COOLDOWN = 0.3; // seconds

// ---- Data ----

// What a player is pressing right now. The browser sends this to the server.
export interface Input {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  dash: boolean; // Shift is held
  shoot: boolean; // mouse button is held
  aimX: number; // mouse position in the arena
  aimY: number;
}

export interface Player {
  id: number; // 1 or 2
  x: number;
  y: number;
  aimAngle: number; // radians, pointing at the mouse
  health: number;
  dashCharge: number; // seconds Shift has been held (0 = not charging)
  dashCooldown: number; // seconds until the next dash is allowed
  dashTimeLeft: number; // seconds left in the dash currently happening
  dashAngle: number; // direction of the dash currently happening
  arrowCharge: number; // seconds the mouse has been held (0 = not charging)
  arrowCooldown: number; // seconds until the next arrow is allowed
}

export interface Arrow {
  ownerId: number; // who shot it, so it can't hit its own shooter
  x: number;
  y: number;
  angle: number;
  distanceLeft: number; // the arrow disappears when this reaches 0
}

export interface GameState {
  players: Player[];
  arrows: Arrow[];
}

// ---- Helpers ----

// Turns "how long was the button held" into a distance between min and max.
export function dashDistance(charge: number): number {
  const power = charge / DASH_MAX_CHARGE; // 0 to 1
  return DASH_MIN_DISTANCE + power * (DASH_MAX_DISTANCE - DASH_MIN_DISTANCE);
}

export function arrowRange(charge: number): number {
  const power = charge / ARROW_MAX_CHARGE; // 0 to 1
  return ARROW_MIN_RANGE + power * (ARROW_MAX_RANGE - ARROW_MIN_RANGE);
}

// Player 1 starts on the left, player 2 on the right.
export function createPlayer(id: number): Player {
  return {
    id,
    x: id === 1 ? 200 : ARENA_WIDTH - 200,
    y: ARENA_HEIGHT / 2,
    aimAngle: id === 1 ? 0 : Math.PI,
    health: MAX_HEALTH,
    dashCharge: 0,
    dashCooldown: 0,
    dashTimeLeft: 0,
    dashAngle: 0,
    arrowCharge: 0,
    arrowCooldown: 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ---- Simulation ----

// Advances the whole game by `dt` seconds.
export function step(state: GameState, inputs: Record<number, Input>, dt: number) {
  for (const player of state.players) {
    const input = inputs[player.id];
    if (input) updatePlayer(state, player, input, dt);
  }
  updateArrows(state, dt);
}

function updatePlayer(state: GameState, p: Player, input: Input, dt: number) {
  p.aimAngle = Math.atan2(input.aimY - p.y, input.aimX - p.x);

  p.dashCooldown = Math.max(0, p.dashCooldown - dt);
  p.arrowCooldown = Math.max(0, p.arrowCooldown - dt);

  if (p.dashTimeLeft > 0) {
    // Mid-dash: fly in the dash direction, ignoring WASD
    const time = Math.min(dt, p.dashTimeLeft);
    p.x += Math.cos(p.dashAngle) * DASH_SPEED * time;
    p.y += Math.sin(p.dashAngle) * DASH_SPEED * time;
    p.dashTimeLeft -= time;
  } else {
    // Walking with WASD
    const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const length = Math.hypot(dx, dy); // so diagonals aren't faster
    if (length > 0) {
      p.x += (dx / length) * PLAYER_SPEED * dt;
      p.y += (dy / length) * PLAYER_SPEED * dt;
    }
  }

  p.x = clamp(p.x, PLAYER_RADIUS, ARENA_WIDTH - PLAYER_RADIUS);
  p.y = clamp(p.y, PLAYER_RADIUS, ARENA_HEIGHT - PLAYER_RADIUS);

  updateDash(p, input, dt);
  updateBow(state, p, input, dt);
}

// Hold Shift to charge, release to dash toward the mouse.
function updateDash(p: Player, input: Input, dt: number) {
  if (input.dash && p.dashCooldown === 0) {
    p.dashCharge = Math.min(p.dashCharge + dt, DASH_MAX_CHARGE);
  } else if (p.dashCharge > 0) {
    // Shift was just released
    p.dashAngle = p.aimAngle;
    p.dashTimeLeft = dashDistance(p.dashCharge) / DASH_SPEED;
    p.dashCooldown = DASH_COOLDOWN;
    p.dashCharge = 0;
  }
}

// Hold the mouse to charge, release to shoot toward the mouse.
function updateBow(state: GameState, p: Player, input: Input, dt: number) {
  if (input.shoot && p.arrowCooldown === 0) {
    p.arrowCharge = Math.min(p.arrowCharge + dt, ARROW_MAX_CHARGE);
  } else if (p.arrowCharge > 0) {
    // Mouse was just released
    state.arrows.push({
      ownerId: p.id,
      x: p.x,
      y: p.y,
      angle: p.aimAngle,
      distanceLeft: arrowRange(p.arrowCharge),
    });
    p.arrowCooldown = ARROW_COOLDOWN;
    p.arrowCharge = 0;
  }
}

function updateArrows(state: GameState, dt: number) {
  for (const arrow of state.arrows) {
    const move = Math.min(ARROW_SPEED * dt, arrow.distanceLeft);
    arrow.x += Math.cos(arrow.angle) * move;
    arrow.y += Math.sin(arrow.angle) * move;
    arrow.distanceLeft -= move;

    for (const p of state.players) {
      if (p.id === arrow.ownerId) continue;

      const distance = Math.hypot(p.x - arrow.x, p.y - arrow.y);
      if (distance < PLAYER_RADIUS + ARROW_RADIUS) {
        p.health -= ARROW_DAMAGE;
        if (p.health <= 0) {
          Object.assign(p, createPlayer(p.id)); // respawn at the start
        }
        arrow.distanceLeft = 0; // used up
        break;
      }
    }
  }

  // Remove arrows that hit someone or flew their full range
  state.arrows = state.arrows.filter((arrow) => arrow.distanceLeft > 0);
}
