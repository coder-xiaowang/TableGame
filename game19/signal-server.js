"use strict";

const path = require("path");
const startAuthoritativeGameServer = require("../shared/server/start-authoritative-game-server");
const { createSqliteRoomStore } = require("../shared/server/sqlite-room-store");

const databasePath = process.env.GAME19_DB_PATH || path.resolve(__dirname, ".data/game19.sqlite");

import("./server/game-engine.mjs")
  .then((engine) => startAuthoritativeGameServer({
    gameRoot: __dirname,
    sharedRoot: path.resolve(__dirname, "../shared"),
    engine,
    protocolVersion: 3,
    defaultPort: 8805,
    roomStore: createSqliteRoomStore({ filename: databasePath })
  }))
  .catch((error) => {
    console.error("Unable to start authoritative BANG! server:", error);
    process.exitCode = 1;
  });
