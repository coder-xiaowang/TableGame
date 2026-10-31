"use strict";

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const migrated=["game","game2","game3","game4","game5","game6","game7","game8","game9","game10","game11","game13","game14","game15","game16","game17","game18","game19","game20","game21","game22","game23"];
const showcase=["game","game2","game7","game16","game17","game21","game22","game23"];
const requiredIds=["setupPanel","hostModeButton","guestModeButton","hostSetup","guestSetup","hostNameInput","guestNameInput","roomCodeInput","createRoomButton","joinRoomButton"];

function read(...parts){return fs.readFileSync(path.join(root,...parts),"utf8");}

test("all authoritative entry pages use the shared behavior and style contract",()=>{
  for(const game of migrated){
    const html=read(game,"index.html"),script=read(game,"app.js");
    assert.match(html,/data-room-entry/,`${game} entry root`);
    assert.match(html,/data-entry-modes/,`${game} mode switch`);
    assert.match(html,/data-entry-form="host"/,`${game} host form`);
    assert.match(html,/data-entry-form="guest"/,`${game} guest form`);
    for(const id of requiredIds)assert.match(html,new RegExp(`id=["']${id}["']`),`${game} #${id}`);
    const sharedIndex=html.indexOf("/shared/styles/room-entry-shell.css"),themeIndex=html.lastIndexOf("styles.css");
    assert.ok(sharedIndex>=0&&themeIndex>sharedIndex,`${game} loads its theme after shared entry primitives`);
    assert.match(script,/createRoomEntryController/,`${game} uses shared entry behavior`);
    assert.match(script,/buildCreatePayload/,`${game} explicitly preserves game-specific create fields`);
  }
});

test("showcase entry shells expose story, access, mode and form regions",()=>{
  for(const game of showcase){
    const html=read(game,"index.html");
    assert.match(html,/data-entry-story/,`${game} story region`);
    assert.match(html,/data-entry-access/,`${game} access region`);
    assert.match(html,/data-entry-modes/,`${game} mode switch`);
    assert.match(html,/data-entry-form="host"/,`${game} host form`);
    assert.match(html,/data-entry-form="guest"/,`${game} guest form`);
  }
});

test("entry theme assets referenced by migrated games still exist",()=>{
  for(const game of showcase){
    const css=read(game,"styles.css");
    for(const match of css.matchAll(/url\(["']?(assets\/[^"')]+)["']?\)/g)){
      assert.ok(fs.existsSync(path.join(root,game,match[1])),`${game}/${match[1]} exists`);
    }
  }
});

test("shared entry primitives provide narrow-screen and overflow safety floors",()=>{
  const css=read("shared","styles","room-entry-shell.css");
  assert.match(css,/\[data-entry-story\].*min-width:0/);
  assert.match(css,/\[data-entry-form\].*min-width:0/);
  assert.match(css,/@media\(max-width:720px\)/);
  assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/max-width:100%/);
  assert.match(css,/min-height:44px/);
});
