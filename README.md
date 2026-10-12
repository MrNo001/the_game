# Arena Prototype

A two-player top-down fighter for trying out mechanics quickly.

## Run it

```
npm install
npm run dev
```

Open http://localhost:5173 in two browser windows, one for each player.

- **WASD**: move
- **Hold Shift**: charge a dash, release to dash toward the mouse
- **Hold left mouse**: charge an arrow, release to shoot

## How it fits together

```
shared/game.ts   The game rules and tuning numbers. Used by both sides.
server/server.ts Runs the real game at 60 updates/sec and sends the state to both players.
client/main.ts   Sends your keys/mouse to the server and draws the state it gets back.
```

The browser never decides what happens. It only sends input and draws. The server runs the rules, so both players always see the same result.

## Changing things

- **Tuning:** edit the numbers at the top of `shared/game.ts`.
- **New mechanics:** add them to `step()` in `shared/game.ts`.

Saving a file restarts the server and reloads the page automatically.
