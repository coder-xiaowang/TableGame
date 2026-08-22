"use strict";

const path = require("path");
const startGameServer = require("../shared/server/start-game-server");

startGameServer({
  gameRoot: __dirname,
  sharedRoot: path.resolve(__dirname, "../shared"),
  protocolVersion: 3,
  defaultPort: 8797
});
