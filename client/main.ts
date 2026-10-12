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
  arrowRange,
  createPlayer,
  dashDistance,
  step,
  type Arrow,
  type GameState,
  type Input,
  type Player,
} from "../shared/game";

// Connect through the same address the page came from; Vite forwards /ws to the game server.
// Tunnel links use https, which requires the secure version of WebSockets (wss).
const protocol = location.protocol === "https:" ? "wss" : "ws";
const SERVER_URL = `${protocol}://${location.host}/ws`;

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
canvas.width = ARENA_WIDTH;
canvas.height = ARENA_HEIGHT;

let mode: "menu" | "play" | "training" = "menu";
let myId = 0; // which player we are
let state: GameState = { players: [], arrows: [] };

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
  state = { players: [createPlayer(1), createPlayer(2)], arrows: [] };
}

function openMenu() {
  mode = "menu";
  menu.hidden = false;
  disconnect();
  state = { players: [], arrows: [] };
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
    state = { players: [], arrows: [] };
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
  sendInput();
}

window.addEventListener("keydown", (e) => setKey(e.code, true));
window.addEventListener("keyup", (e) => setKey(e.code, false));

window.addEventListener("mousemove", (e) => {
  // Convert from page coordinates to arena coordinates
  const rect = canvas.getBoundingClientRect();
  input.aimX = ((e.clientX - rect.left) / rect.width) * ARENA_WIDTH;
  input.aimY = ((e.clientY - rect.top) / rect.height) * ARENA_HEIGHT;
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
  input.dash = input.shoot = false;
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

  for (const arrow of state.arrows) drawArrow(arrow);
  for (const player of state.players) drawPlayer(player);

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

function drawStatus(text: string) {
  ctx.fillStyle = "white";
  ctx.font = "20px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, ARENA_WIDTH / 2, 40);
}
