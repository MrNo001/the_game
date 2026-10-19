// The browser side: shows the menu, reads the keyboard and mouse, and draws the game.
//
// There are two ways to play:
// - Play: the server runs the game. We send it our input and draw the state it sends back.
// - Training: no server. We run the game rules from shared/game.ts ourselves,
//   against a target dummy that never moves.

import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  PLAYER_RADIUS,
  MAX_HEALTH,
  DASH_MAX_CHARGE,
  DASH_COOLDOWN,
  ARROW_COOLDOWN,
  BLAST_DELAY,
  BLAST_COOLDOWN,
  BLAST_FLASH_TIME,
  SHOTGUN_RANGE,
  SHOTGUN_SPREAD,
  SHOTGUN_SHELLS,
  SHOTGUN_RELOAD_TIME,
  SHOTGUN_FLASH_TIME,
  arrowRange,
  blastRadius,
  blastRange,
  blastTarget,
  createGameState,
  createPlayer,
  dashDistance,
  step,
  type Arrow,
  type Blast,
  type Input,
  type Player,
  type Shot,
} from "../shared/game";

// Connect through the same address the page came from; Vite forwards /ws to the game server.
// Tunnel links use https, which requires the secure version of WebSockets (wss).
const protocol = location.protocol === "https:" ? "wss" : "ws";
const SERVER_URL = `${protocol}://${location.host}/ws`;

const HUD_HEIGHT = 80; // a strip below the arena that shows the ability cooldowns

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
canvas.width = ARENA_WIDTH;
canvas.height = ARENA_HEIGHT + HUD_HEIGHT;

let mode: "menu" | "play" | "training" = "menu";
let myId = 0; // which player we are
let state = createGameState();

// ---- Menu ----

const menu = document.getElementById("menu")!;
const exitButton = document.getElementById("exit-button")!; // only shown in Training mode
document.getElementById("play-button")!.addEventListener("click", startPlay);
document.getElementById("training-button")!.addEventListener("click", startTraining);
exitButton.addEventListener("click", openMenu);

function startPlay() {
  mode = "play";
  menu.hidden = true;
  statusText = "Connecting...";
  connect();
}

function startTraining() {
  mode = "training";
  menu.hidden = true;
  exitButton.hidden = false;
  myId = 1;
  // Player 2 is the target dummy: it never gets any input, so it just stands there
  state = createGameState();
  state.players.push(createPlayer(1), createPlayer(2));
}

function openMenu() {
  mode = "menu";
  menu.hidden = false;
  exitButton.hidden = true;
  disconnect();
  state = createGameState();
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Escape") openMenu();
});

// ---- Talking to the server (Play mode only) ----

let socket: WebSocket | null = null;
let statusText = "";
let reconnectTimer = 0;

function connect() {
  const ws = new WebSocket(SERVER_URL);
  socket = ws;

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "welcome") {
      myId = message.id;
      statusText = "";
    }
    if (message.type === "state") {
      state = message.state;
    }
  };

  // The server restarts whenever you edit its code, so keep trying to reconnect
  ws.onclose = (event) => {
    if (socket !== ws) return; // we closed it ourselves by going back to the menu
    state = createGameState();
    statusText = `${event.reason || "Disconnected"}, retrying...`;
    reconnectTimer = window.setTimeout(connect, 1000);
  };
}

function disconnect() {
  clearTimeout(reconnectTimer);
  socket?.close();
  socket = null;
}

// ---- Reading the keyboard and mouse ----

const input: Input = {
  up: false,
  down: false,
  left: false,
  right: false,
  dash: false,
  shoot: false,
  shotgun: false,
  blast: false,
  move: false,
  aimX: 0,
  aimY: 0,
};

// Two ways to control your player, picked in the menu:
// - classic: WASD to move, Shift dash, left click arrow, right click shotgun, E blast
// - click: right click to move, left click arrow, Q shotgun, W dash, E blast
type Controls = "classic" | "click";
let controls: Controls = loadControls();

// In Play mode, send the input every time it changes; the server keeps the latest one.
// (In Training mode there is no socket, and the game loop below reads `input` directly.)
function sendInput() {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(input));
  }
}

function setKey(code: string, pressed: boolean) {
  if (controls === "classic") {
    if (code === "KeyW") input.up = pressed;
    if (code === "KeyS") input.down = pressed;
    if (code === "KeyA") input.left = pressed;
    if (code === "KeyD") input.right = pressed;
    if (code === "ShiftLeft" || code === "ShiftRight") input.dash = pressed;
  } else {
    if (code === "KeyQ") input.shotgun = pressed;
    if (code === "KeyW") input.dash = pressed;
  }
  if (code === "KeyE") input.blast = pressed;
  sendInput();
}

window.addEventListener("keydown", (e) => setKey(e.code, true));
window.addEventListener("keyup", (e) => setKey(e.code, false));

// The right mouse button shoots in classic controls and walks in click-to-move controls
function setRightButton(pressed: boolean) {
  if (controls === "classic") input.shotgun = pressed;
  else input.move = pressed;
}

window.addEventListener("mousemove", (e) => {
  // Convert from page coordinates to arena coordinates
  const rect = canvas.getBoundingClientRect();
  input.aimX = ((e.clientX - rect.left) / rect.width) * canvas.width;
  input.aimY = ((e.clientY - rect.top) / rect.height) * canvas.height;
  sendInput();
});

// The left button charges the bow in both control schemes
canvas.addEventListener("mousedown", (e) => {
  if (e.button === 0) input.shoot = true;
  if (e.button === 2) setRightButton(true);
  sendInput();
});

window.addEventListener("mouseup", (e) => {
  if (e.button === 0) input.shoot = false;
  if (e.button === 2) setRightButton(false);
  sendInput();
});

// Don't open the browser's right-click menu over the arena
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

function releaseEverything() {
  input.up = input.down = input.left = input.right = false;
  input.dash = input.shoot = input.shotgun = input.blast = input.move = false;
  sendInput();
}

// When the window loses focus we never hear the key-up, so release everything
window.addEventListener("blur", releaseEverything);

// ---- Picking the control scheme (in the menu) ----

const controlButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("#controls-picker button"));
for (const button of controlButtons) {
  button.addEventListener("click", () => setControls(button.dataset.controls as Controls));
}
showControls();

function setControls(newControls: Controls) {
  releaseEverything(); // so nothing stays stuck from the old key bindings
  controls = newControls;
  try {
    localStorage.setItem("controls", controls);
  } catch {
    // Storage can be blocked (e.g. private windows); the choice just won't be remembered
  }
  showControls();
}

function loadControls(): Controls {
  try {
    return localStorage.getItem("controls") === "click" ? "click" : "classic";
  } catch {
    return "classic";
  }
}

// Highlight the chosen scheme and show its help text below the arena
function showControls() {
  for (const button of controlButtons) {
    button.classList.toggle("selected", button.dataset.controls === controls);
  }
  document.getElementById("help-classic")!.hidden = controls !== "classic";
  document.getElementById("help-click")!.hidden = controls !== "click";
}

// ---- Game loop: runs once per screen refresh ----

let lastTime = 0;

function frame(time: number) {
  // Seconds since the last frame, capped so switching tabs doesn't cause a big jump
  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;

  // In Training mode we run the game rules here, exactly like the server does in Play mode
  if (mode === "training") {
    step(state, { [myId]: input }, dt);
  }

  draw();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// ---- Drawing ----

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const blast of state.blasts) drawBlast(blast); // first, so they look like they're on the ground
  for (const arrow of state.arrows) drawArrow(arrow);
  for (const shot of state.shots) drawShot(shot);
  for (const player of state.players) drawPlayer(player);
  drawHud();

  if (mode === "play") {
    let message = statusText;
    if (!message && state.players.length < 2) message = "Waiting for another player...";
    if (message) drawStatus(message);
  }
}

function drawPlayer(p: Player) {
  const color = p.id === myId ? "#4fc3f7" : "#ef5350"; // you are blue, the enemy is red
  const dirX = Math.cos(p.aimAngle);
  const dirY = Math.sin(p.aimAngle);

  // Aim indicator: a short pointer, or a dashed line as long as the shot while charging
  const aimLength = p.arrowCharge > 0 ? arrowRange(p.arrowCharge) : PLAYER_RADIUS + 15;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash(p.arrowCharge > 0 ? [8, 6] : []);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + dirX * aimLength, p.y + dirY * aimLength);
  ctx.stroke();
  ctx.setLineDash([]);

  // Blast preview: a faint ring showing how far you can reach,
  // and a dashed circle where the mark will land and how big it will be
  if (p.blastCharge > 0) {
    const target = blastTarget(p);
    const radius = blastRadius(p.blastCharge);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(p.x, p.y, blastRange(p.blastCharge), 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.15;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(target.x, target.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(target.x, target.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Click-to-move: a small cross where you're walking to (only your own, so the enemy's stays secret)
  if (p.id === myId && p.moveTarget) {
    const { x, y } = p.moveTarget;
    const size = 6;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(x - size, y - size);
    ctx.lineTo(x + size, y + size);
    ctx.moveTo(x + size, y - size);
    ctx.lineTo(x - size, y + size);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Dash preview: a see-through circle where you will land
  if (p.dashCharge > 0) {
    const distance = dashDistance(p.dashCharge);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x + dirX * distance, p.y + dirY * distance, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Dash charge ring: fills clockwise from the top, full circle = max charge
  if (p.dashCharge > 0) {
    const fraction = p.dashCharge / DASH_MAX_CHARGE;
    const start = -Math.PI / 2;
    ctx.strokeStyle = "#ffeb3b";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_RADIUS + 6, start, start + fraction * Math.PI * 2);
    ctx.stroke();
  }

  // Health bar
  const barWidth = 40;
  const barX = p.x - barWidth / 2;
  const barY = p.y - PLAYER_RADIUS - 16;
  ctx.fillStyle = "#333";
  ctx.fillRect(barX, barY, barWidth, 5);
  ctx.fillStyle = "#66bb6a";
  ctx.fillRect(barX, barY, barWidth * (p.health / MAX_HEALTH), 5);

  // Shotgun shells above the health bar: bright = loaded.
  // While reloading, the empty shells slowly fill up from the bottom.
  const shellWidth = 6;
  const shellHeight = 10;
  const shellGap = 4;
  const shellsWidth = SHOTGUN_SHELLS * shellWidth + (SHOTGUN_SHELLS - 1) * shellGap;
  const shellY = barY - shellHeight - 4;
  const reloaded = p.shotgunReload > 0 ? 1 - p.shotgunReload / SHOTGUN_RELOAD_TIME : 0; // 0 to 1
  for (let i = 0; i < SHOTGUN_SHELLS; i++) {
    const shellX = p.x - shellsWidth / 2 + i * (shellWidth + shellGap);
    const loaded = i < p.shells;
    const fill = loaded ? 1 : reloaded;
    ctx.fillStyle = "#333";
    ctx.fillRect(shellX, shellY, shellWidth, shellHeight);
    ctx.fillStyle = loaded ? "#ff7043" : "#795548";
    ctx.fillRect(shellX, shellY + shellHeight * (1 - fill), shellWidth, shellHeight * fill);
  }
}

function drawArrow(arrow: Arrow) {
  const length = 14;
  ctx.strokeStyle = arrow.ownerId === myId ? "#b3e5fc" : "#ffcdd2";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(arrow.x - Math.cos(arrow.angle) * length, arrow.y - Math.sin(arrow.angle) * length);
  ctx.lineTo(arrow.x, arrow.y);
  ctx.stroke();
}

function drawBlast(blast: Blast) {
  if (!blast.exploded) {
    // Warning: an outline that fills up as the explosion gets closer
    const progress = 1 - blast.timeLeft / BLAST_DELAY; // 0 to 1
    const color = blast.ownerId === myId ? "#4fc3f7" : "#ef5350";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(blast.x, blast.y, blast.radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.35;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(blast.x, blast.y, blast.radius * progress, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    // The explosion: a bright flash that fades out
    const fade = 1 + blast.timeLeft / BLAST_FLASH_TIME; // 1 down to 0
    ctx.globalAlpha = Math.max(0, fade);
    ctx.fillStyle = "#ffb74d";
    ctx.beginPath();
    ctx.arc(blast.x, blast.y, blast.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// The shotgun blast: a bright cone that quickly fades out
function drawShot(shot: Shot) {
  const fade = shot.timeLeft / SHOTGUN_FLASH_TIME; // 1 down to 0
  ctx.globalAlpha = 0.7 * fade;
  ctx.fillStyle = "#ffb74d";
  ctx.beginPath();
  ctx.moveTo(shot.x, shot.y);
  ctx.arc(shot.x, shot.y, SHOTGUN_RANGE, shot.angle - SHOTGUN_SPREAD / 2, shot.angle + SHOTGUN_SPREAD / 2);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

// The ability bar in the strip below the arena
function drawHud() {
  const me = state.players.find((p) => p.id === myId);
  if (!me) return;

  ctx.fillStyle = "#15151a";
  ctx.fillRect(0, ARENA_HEIGHT, ARENA_WIDTH, HUD_HEIGHT);

  const dash = { name: "Dash", cooldown: me.dashCooldown, maxCooldown: DASH_COOLDOWN };
  const arrow = { name: "Arrow", cooldown: me.arrowCooldown, maxCooldown: ARROW_COOLDOWN };
  const shotgun = { name: "Shotgun", cooldown: me.shotgunReload, maxCooldown: SHOTGUN_RELOAD_TIME };
  const blast = { name: "Blast", cooldown: me.blastCooldown, maxCooldown: BLAST_COOLDOWN };
  const abilities =
    controls === "classic"
      ? [{ key: "Shift", ...dash }, { key: "L-Click", ...arrow }, { key: "R-Click", ...shotgun }, { key: "E", ...blast }]
      : [{ key: "L-Click", ...arrow }, { key: "Q", ...shotgun }, { key: "W", ...dash }, { key: "E", ...blast }];

  const size = 60;
  const gap = 16;
  const totalWidth = abilities.length * size + (abilities.length - 1) * gap;
  const y = ARENA_HEIGHT + (HUD_HEIGHT - size) / 2;
  let x = (ARENA_WIDTH - totalWidth) / 2;

  for (const ability of abilities) {
    const ready = ability.cooldown === 0;

    // Slot background
    ctx.fillStyle = "#2a2a33";
    ctx.fillRect(x, y, size, size);

    // While on cooldown, a dark cover shrinks away as the time runs out
    if (!ready) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(x, y, size, size * (ability.cooldown / ability.maxCooldown));
    }

    // Border: bright when the ability is ready
    ctx.strokeStyle = ready ? "#4fc3f7" : "#444";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, size, size);

    // Text: seconds left (top), ability name (middle), key to press (bottom)
    ctx.textAlign = "center";
    if (!ready) {
      ctx.fillStyle = "white";
      ctx.font = "bold 15px sans-serif";
      ctx.fillText(ability.cooldown.toFixed(1), x + size / 2, y + 18);
    }
    ctx.fillStyle = ready ? "white" : "#888";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText(ability.name, x + size / 2, y + 36);
    ctx.fillStyle = "#aaa";
    ctx.font = "11px sans-serif";
    ctx.fillText(ability.key, x + size / 2, y + size - 7);

    x += size + gap;
  }

  // Score (Play mode only): your kills on top, the enemy's below
  if (mode === "play") {
    const enemy = state.players.find((p) => p.id !== myId);
    ctx.textAlign = "left";
    ctx.font = "bold 20px sans-serif";
    ctx.fillStyle = "#4fc3f7";
    ctx.fillText(`You  ${me.score}`, 24, ARENA_HEIGHT + 34);
    ctx.fillStyle = "#ef5350";
    ctx.fillText(`Enemy  ${enemy?.score ?? 0}`, 24, ARENA_HEIGHT + 62);
  }
}

function drawStatus(text: string) {
  ctx.fillStyle = "white";
  ctx.font = "20px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, ARENA_WIDTH / 2, 40);
}
