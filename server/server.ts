// The authoritative server: it receives inputs from both players,
// runs the game rules from shared/game.ts, and sends the result to everyone.

import { WebSocketServer, WebSocket } from "ws";
import { createPlayer, step, type GameState, type Input } from "../shared/game";

const PORT = 3000;
const TICK_RATE = 60; // game updates per second

const state: GameState = { players: [], arrows: [] };
const inputs: Record<number, Input> = {}; // latest input from each player, by id

const server = new WebSocketServer({ port: PORT });
console.log(`Game server listening on ws://localhost:${PORT}`);

server.on("connection", (socket) => {
  // Take whichever player slot (1 or 2) is free
  const takenIds = state.players.map((p) => p.id);
  const id = [1, 2].find((slot) => !takenIds.includes(slot));
  if (id === undefined) {
    socket.close(1000, "Game is full");
    return;
  }

  state.players.push(createPlayer(id));
  socket.send(JSON.stringify({ type: "welcome", id }));
  console.log(`Player ${id} joined`);

  socket.on("message", (data) => {
    inputs[id] = JSON.parse(data.toString());
  });

  socket.on("close", () => {
    state.players = state.players.filter((p) => p.id !== id);
    delete inputs[id];
    console.log(`Player ${id} left`);
  });
});

// The game loop: move the game forward, then send the new state to everyone.
// We measure the real time between ticks because timers aren't perfectly on time.
let lastTime = performance.now();

setInterval(() => {
  const now = performance.now();
  const dt = (now - lastTime) / 1000; // seconds
  lastTime = now;

  step(state, inputs, dt);

  const message = JSON.stringify({ type: "state", state });
  for (const client of server.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}, 1000 / TICK_RATE);
