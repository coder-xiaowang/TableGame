# 快艇骰子联机版

game3 使用协议 v3 的可持久化服务端权威模式。五颗骰子的随机结果、保留状态、回合推进、计分表、快艇奖励和最终排名都由 Node.js 服务校验并保存，浏览器只提交操作和显示权威视图。

## 本地启动

在项目根目录运行：

```text
node game3/signal-server.js
```

默认端口为 `8787`，可使用 `PORT` 修改。本地数据库默认为 `game3/.data/game3.sqlite`，该目录已被 Git 忽略。

服务使用 Node.js 内置 SQLite，推荐 Node.js 24：

```text
node -e "require('node:sqlite'); console.log('SQLite ready')"
```

## 权威结构

- `rules.mjs`：纯计分规则、计分表和总分计算。
- `server/game-engine.mjs`：大厅、玩家、权威骰子、回合、掉线处理和视图。
- `../shared/server/start-authoritative-game-server.js`：HTTP、SSE、会话、动作去重和持久化流程。
- `app.js`：只保存当前权威视图和计分表查看选择。

游戏没有回合倒计时。当前玩家主动掉线时，服务端会清空其未完成的投掷并跳到下一名在线玩家；服务重启不视为普通掉线，恢复后会保留原当前玩家和未完成投掷。

## 测试

```text
node --test game3/rules.test.mjs game3/game-engine.test.mjs game3/authoritative-server.test.cjs game3/persistence.test.cjs shared/server/room-store.test.cjs shared/server/authoritative-persistence.test.cjs
```

## 首次部署

旧版房间由房主浏览器保存，无法迁入服务端。首次切换前应确认没有进行中的 game3 对局。假设 systemd 服务用户为 `tablegame`：

```text
sudo install -d -o tablegame -g tablegame -m 700 /var/lib/tablegame/game3
sudo systemctl edit tablegame@game3
```

加入：

```ini
[Service]
Environment=GAME3_DB_PATH=/var/lib/tablegame/game3/game3.sqlite
```

部署：

```text
cd /srv/tablegame
git pull --ff-only origin main
node -e "require('node:sqlite'); console.log('SQLite ready')"
node --test game3/rules.test.mjs game3/game-engine.test.mjs game3/authoritative-server.test.cjs game3/persistence.test.cjs shared/server/room-store.test.cjs shared/server/authoritative-persistence.test.cjs
sudo systemctl daemon-reload
sudo systemctl restart tablegame@game3
sudo systemctl status tablegame@game3 --no-pager
curl http://127.0.0.1:8787/api/ready
curl http://127.0.0.1:8787/api/config
```

接口应报告 `protocolVersion: 3`、`persistence: "sqlite"` 和 `durable: true`。线上端口如果由 systemd 的 `PORT` 环境变量覆盖，应使用实际端口检查。
