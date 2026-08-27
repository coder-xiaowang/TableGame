# UNO 联机版

game5 已升级为协议 v3 的可持久化服务端权威模式。完整牌堆、弃牌堆、所有玩家手牌、回合、罚牌链、+4 合法性、UNO 抢喊窗口、倒计时和胜负均由 Node.js 服务端保存并裁决；浏览器只提交动作并渲染属于当前玩家的脱敏视图。

## 启动

```text
node game5/signal-server.js
```

默认地址为 `http://localhost:8791`。本地数据库默认为 `game5/.data/game5.sqlite`，生产环境建议使用仓库外路径：

```text
GAME5_DB_PATH=/var/lib/tablegame/game5/game5.sqlite PORT=8791 node game5/signal-server.js
```

服务使用 Node.js 内置 SQLite，推荐 Node.js 24。页面依赖 `/shared/`，不能直接双击 `index.html`。

## 权威与隐私边界

- 每位玩家只收到自己的真实手牌，其他玩家只显示等量背面。
- 牌堆顺序、其他玩家牌面、待定胜者和 `+4` 是否违法不会发送给任何浏览器，包括房主。
- 服务器只向当前被罚玩家发送 `canChallenge`，质疑后才公开结果。
- 摸到可出牌后，服务器只允许打出该张新牌或保留结束回合。
- `catchUno` 是服务器原子动作；多人同时抢抓时只有最先到达的合法动作成功，违规者不会重复摸牌。
- 动作带状态版本和唯一动作编号，重复请求不会重复出牌、摸牌或处罚。
- 服务重启后从 SQLite 恢复完整私密状态和绝对截止时间。

游戏中移出玩家时，其手牌会由服务器秘密洗回摸牌堆。若移除当前玩家，服务器把行动权交给按当前方向的下一位玩家。

## 测试

```text
node --test game5/rules.test.mjs game5/game-engine.test.mjs game5/authoritative-server.test.cjs game5/persistence.test.cjs
node --test
```

## 服务器部署

旧版房间只保存在房主浏览器中，无法迁移到协议 v3。部署前应结束旧 game5 对局。

```text
sudo install -d -o tablegame -g tablegame -m 700 /var/lib/tablegame/game5
sudo systemctl edit tablegame@game5
```

```ini
[Service]
Environment=GAME5_DB_PATH=/var/lib/tablegame/game5/game5.sqlite
Environment=PORT=8791
```

```text
cd /srv/tablegame
git pull --ff-only origin main
node --test game5/rules.test.mjs game5/game-engine.test.mjs game5/authoritative-server.test.cjs game5/persistence.test.cjs
sudo systemctl daemon-reload
sudo systemctl restart tablegame@game5
curl http://127.0.0.1:8791/api/ready
curl http://127.0.0.1:8791/api/config
```

接口应显示 `protocolVersion: 3`、`authorityMode: "server"`、`persistence: "sqlite"` 和 `durable: true`。
