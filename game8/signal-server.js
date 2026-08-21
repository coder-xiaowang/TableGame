"use strict";

const path = require("path");
const startGameServer = require("../shared/server/start-game-server");

startGameServer({
  gameRoot: __dirname,
  sharedRoot: path.resolve(__dirname, "../shared"),
  protocolVersion: 2,
  defaultPort: 8794
});
