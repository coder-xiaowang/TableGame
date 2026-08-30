"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSpectatorUiModel,
  createSpectatorUi,
  describeSpectatorJoin,
  spectatorErrorMessage
} from "../client/spectator-ui.js";

test("spectator errors and automatic admission use shared user-facing messages", () => {
  assert.equal(
    spectatorErrorMessage({ payload: { code: "spectator_limit_reached" }, message: "raw" }),
    "旁观席人数已满。"
  );
  assert.equal(spectatorErrorMessage({ message: "自定义错误" }), "自定义错误");
  assert.deepEqual(describeSpectatorJoin({
    memberRole: "spectator",
    autoSpectated: true,
    assignmentReason: "player_seats_full"
  }), {
    notice: "玩家席已满，你已进入旁观席。",
    statusText: "已进入旁观席"
  });
  assert.equal(describeSpectatorJoin({ memberRole: "player", resumed: true }).statusText, "身份已恢复：玩家");
});

test("shared spectator model keeps hosts seated and exposes their room setting", () => {
  const model = buildSpectatorUiModel({
    config: { spectatorsEnabled: true, spectatorLimit: 10 },
    snapshot: { role: "host", memberRole: "player" },
    view: {
      roomRole: "player",
      canChangeSeats: true,
      allowSpectators: true,
      capacity: 4,
      players: [{ id: "host" }],
      spectators: [],
      spectatorCount: 0,
      spectatorLimit: 10,
      permissions: { canManage: true }
    }
  });
  assert.equal(model.memberRole, "player");
  assert.equal(model.showSeatAction, false);
  assert.equal(model.showSetting, true);
  assert.equal(model.settingLabel, "旁观：开放");
  assert.equal(model.showSpectatorPanel, true);
});

test("shared spectator model derives seat availability without game-specific phase names", () => {
  const base = {
    config: { spectatorsEnabled: true, spectatorLimit: 2 },
    snapshot: { role: "guest", memberRole: "spectator" },
    view: {
      roomRole: "spectator",
      canChangeSeats: true,
      allowSpectators: true,
      capacity: 3,
      players: [{ id: "host" }, { id: "p2" }],
      spectators: [{ id: "watch", name: "旁观者", connected: true }],
      spectatorCount: 1,
      spectatorLimit: 2,
      permissions: { canManage: false }
    }
  };
  let model = buildSpectatorUiModel(base);
  assert.equal(model.seatIntent, "play");
  assert.equal(model.showSeatAction, true);
  assert.equal(model.seatDisabled, false);

  model = buildSpectatorUiModel({
    ...base,
    view: { ...base.view, players: [...base.view.players, { id: "p3" }] }
  });
  assert.equal(model.seatDisabled, true);
  assert.equal(model.seatTitle, "玩家席已满");

  model = buildSpectatorUiModel({
    ...base,
    view: { ...base.view, canChangeSeats: false }
  });
  assert.equal(model.showSeatAction, false);
});

test("shared controller sends seat and room-setting intents through the authoritative client", async () => {
  const calls = [];
  const room = {
    snapshot: () => ({ role: "guest", memberRole: "spectator" }),
    changeSeat: async (intent) => calls.push(["seat", intent]),
    setRoomSettings: async (settings) => calls.push(["settings", settings]),
    kick: async (id) => calls.push(["kick", id])
  };
  let view = {
    roomRole: "spectator",
    canChangeSeats: true,
    allowSpectators: true,
    capacity: 3,
    players: [{ id: "host" }],
    spectators: [{ id: "watch", name: "旁观者", connected: true }],
    spectatorCount: 1,
    spectatorLimit: 10,
    permissions: { canManage: false }
  };
  const ui = createSpectatorUi({ room, getView: () => view });
  ui.applyConfig({ spectatorsEnabled: true, spectatorLimit: 10 });
  ui.render(view);
  await ui.changeSeat();
  assert.deepEqual(calls, [["seat", "play"]]);

  room.snapshot = () => ({ role: "host", memberRole: "player" });
  view = { ...view, roomRole: "player", permissions: { canManage: true } };
  ui.render(view);
  await ui.toggleSetting();
  assert.deepEqual(calls[1], ["settings", { allowSpectators: false }]);
});

test("shared spectator list renders names as text and delegates host removal", async () => {
  class FakeNode {
    constructor(ownerDocument = null) {
      this.ownerDocument = ownerDocument;
      this.children = [];
      this.className = "";
      this.textContent = "";
      this.classList = { toggle() {} };
    }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
  }
  const documentRef = { createElement: () => new FakeNode(documentRef) };
  const spectatorList = new FakeNode(documentRef);
  const kicked = [];
  const room = {
    snapshot: () => ({ role: "host", memberRole: "player" }),
    changeSeat: async () => {},
    setRoomSettings: async () => {},
    kick: async (id) => kicked.push(id)
  };
  const view = {
    roomRole: "player",
    canChangeSeats: true,
    allowSpectators: true,
    capacity: 3,
    players: [{ id: "host" }],
    spectators: [{ id: "watch", name: "<img src=x onerror=alert(1)>", connected: true }],
    spectatorCount: 1,
    spectatorLimit: 10,
    permissions: { canManage: true }
  };
  const ui = createSpectatorUi({
    room,
    elements: { spectatorList },
    getView: () => view,
    confirmAction: () => true
  });
  ui.applyConfig({ spectatorsEnabled: true });
  const item = spectatorList.children[0];
  assert.equal(item.children[0].children[1].textContent, "<img src=x onerror=alert(1)>");
  assert.equal(item.children.length, 2);
  await item.children[1].onclick();
  assert.deepEqual(kicked, ["watch"]);
});
