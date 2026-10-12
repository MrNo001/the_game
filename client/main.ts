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
  BLAST_RADIUS,
  BLAST_DELAY,
  BLAST_COOLDOWN,
  BLAST_FLASH_TIME,
  arrowRange,
  createGameState,
  createPlayer,
  dashDistance,
  step,
  type Arrow,
  type Blast,
  type Input,
  type Player,
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
document.getElementById("play-button")!.addEventListener("click", startPlay);
document.getElementById("training-button")!.addEventListener("click", startTraining);

function startPlay() {
  mode = "play";
  menu.hidden = true;
  statusText = "Connecting...";
  connect();
}

function startTraining() {
  mode = "training";
  menu.hidden = true;
  myId = 1;
  // Player 2 is the target dummy: it never gets any input, so it just stands there
  state = createGameState();
  state.players.push(createPlayer(1), createPlayer(2));
}

function openMenu() {
  mode = "menu";
  menu.hidden = false;
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
  blast: false,
  aimX: 0,
  aimY: 0,
};

// In Play mode, send the input every time it changes; the server keeps the latest one.
// (In Training mode there is no socket, and the game loop below reads `input` directly.)
function sendInput() {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(input));
  }
}

function setKey(code: string, pressed: boolean) {
  if (code === "KeyW") input.up = pressed;
  if (code === "KeyS") input.down = pressed;
  if (code === "KeyA") input.left = pressed;
  if (code === "KeyD") input.right = pressed;
  if (code === "ShiftLeft" || code === "ShiftRight") input.dash = pressed;
  if (code === "KeyE") input.blast = pressed;
  sendInput();
}

window.addEventListener("keydown", (e) => setKey(e.code, true));
window.addEventListener("keyup", (e) => setKey(e.code, false));

window.addEventListener("mousemove", (e) => {
  // Convert from page coordinates to arena coordinates
  const rect = canvas.getBoundingClientRect();
  input.aimX = ((e.clientX - rect.left) / rect.width) * canvas.width;
  input.aimY = ((e.clientY - rect.top) / rect.height) * canvas.height;
  sendInput();
});

canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return; // left button only
  input.shoot = true;
  sendInput();
});

window.addEventListener("mouseup", (e) => {
  if (e.button !== 0) return;
  input.shoot = false;
  sendInput();
});

// When the window loses focus we never hear the key-up, so release everything
window.addEventListener("blur", () => {
  input.up = input.down = input.left = input.right = false;
  input.dash = input.shoot = input.blast = false;
  sendInput();
});

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
    ctx.arc(blast.x, blast.y, BLAST_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.35;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(blast.x, blast.y, BLAST_RADIUS * progress, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    // The explosion: a bright flash that fades out
    const fade = 1 + blast.timeLeft / BLAST_FLASH_TIME; // 1 down to 0
    ctx.globalAlpha = Math.max(0, fade);
    ctx.fillStyle = "#ffb74d";
    ctx.beginPath();
    ctx.arc(blast.x, blast.y, BLAST_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// The ability bar in the strip below the arena
function drawHud() {
  const me = state.players.find((p) => p.id === myId);
  if (!me) return;

  ctx.fillStyle = "#15151a";
  ctx.fillRect(0, ARENA_HEIGHT, ARENA_WIDTH, HUD_HEIGHT);

  const abilities = [
    { key: "Shift", name: "Dash", cooldown: me.dashCooldown, maxCooldown: DASH_COOLDOWN },
    { key: "Mouse", name: "Arrow", cooldown: me.arrowCooldown, maxCooldown: ARROW_COOLDOWN },
    { key: "E", name: "Blast", cooldown: me.blastCooldown, maxCooldown: BLAST_COOLDOWN },
  ];

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
}

function drawStatus(text: string) {
  ctx.fillStyle = "white";
  ctx.font = "20px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, ARENA_WIDTH / 2, 40);
}
