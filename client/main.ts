// The browser side: read the keyboard and mouse, send them to the server,
// and draw whatever game state the server sends back.

import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  PLAYER_RADIUS,
  MAX_HEALTH,
  DASH_MAX_CHARGE,
  arrowRange,
  dashDistance,
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

// ---- Talking to the server ----

let socket: WebSocket;
let myId = 0; // which player we are; the server tells us
let state: GameState = { players: [], arrows: [] };
let statusText = "Connecting...";

function connect() {
  socket = new WebSocket(SERVER_URL);

  socket.onmessage = (event) => {
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
  socket.onclose = (event) => {
    state = { players: [], arrows: [] };
    statusText = `${event.reason || "Disconnected"}, retrying...`;
    setTimeout(connect, 1000);
  };
}

connect();

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

// Send the input every time it changes; the server keeps the latest one.
function sendInput() {
  if (socket.readyState === WebSocket.OPEN) {
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

// ---- Drawing ----

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const arrow of state.arrows) drawArrow(arrow);
  for (const player of state.players) drawPlayer(player);

  let message = statusText;
  if (!message && state.players.length < 2) message = "Waiting for another player...";
  if (message) drawStatus(message);

  requestAnimationFrame(draw);
}

requestAnimationFrame(draw);

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
