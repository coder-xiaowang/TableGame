# game（速速破译）服务端权威版本

本目录已经从“房主浏览器保存完整状态并裁判”改为服务端权威模式。浏览器只提交 `configure`、`start`、`submitWord`、`question`、`answer`、`guess`、`skip`、`end` 等意图；`server/game-engine.mjs` 校验身份和阶段并生成每名玩家各自的脱敏视图。

## 本地运行

在仓库根目录执行：

```bash
node game/signal-server.js
```

默认监听 `8787`，浏览器访问 `http://localhost:8787`。可通过环境变量修改端口和数据库路径：

```bash
PORT=8787 GAME_DB_PATH=/var/lib/tablegame/game/game.sqlite node game/signal-server.js
```

Windows PowerShell 示例：

```powershell
$env:PORT=8787
$env:GAME_DB_PATH="D:\tablegame-data\game\game.sqlite"
node game/signal-server.js
```

数据库父目录会自动创建。默认开发数据库位于 `game/.data/game.sqlite`，已被 `.gitignore` 排除。

## 旁观模式与词语保密

旁观者可以查看玩家状态、行动顺序、公开提问、已经提交的回答、问答日志和结算结果，但不会收到任何玩家当前的答案词或陷阱词，也不会收到收词阶段的提交内容。这样可以防止正式玩家通过第二台设备旁观来查看自己的词。附加提示或禁问信息以及结算后已经进入公开日志的内容仍按游戏原规则公开。准备阶段可以换席；进入收词或正式游戏阶段后锁定席位。

## 测试

```bash
node --test game/rules.test.mjs game/game-engine.test.mjs game/authoritative-server.test.cjs game/persistence.test.cjs game/spectator-mode.test.cjs
```

测试覆盖规则与隐藏信息、HTTP/SSE 联机、服务器权限、玩家自定义词保密，以及 SQLite 重启恢复和操作去重。

## 服务器部署要点

- 保留 `game` 和仓库根目录的 `shared`，二者必须一起更新。
- systemd 服务可以继续使用实例模板名称 `tablegame@game`；该游戏默认端口仍是 `8787`。如果服务器上的其他游戏已经占用 8787，必须沿用现有规划，通过 `PORT` 给本服务分配一个未占用的独立端口。
- 推荐将 `GAME_DB_PATH` 指向 `/var/lib/tablegame/game/game.sqlite`，不要把运行时数据库放进 Git 仓库。
- Nginx 反向代理应把该游戏路径转发到 `127.0.0.1:<本服务实际端口>`，并为 SSE 关闭代理缓冲、延长读取超时。
- 更新后执行 `sudo systemctl restart tablegame@game`，再检查 `/api/health` 与 `/api/ready`。
- 在该实例环境中加入 `SPECTATORS_ENABLED=1` 和 `SPECTATOR_LIMIT=10` 后，旁观入口才会真正开放。

健康检查示例：

```bash
curl -fsS http://127.0.0.1:8787/api/health
curl -fsS http://127.0.0.1:8787/api/ready
```

`/api/ready` 应返回 `ready: true`、`persistence: "sqlite"` 和 `protocolVersion: 3`。
