# Can't Stop 联机版

game10 使用协议 v3 的可持久化服务端权威模式。首位玩家、物理骰子随机种子和最终骰面、合法组合、临时与永久进度、路线占领、回合推进以及 30 秒超时均由 Node.js 服务端裁决。浏览器只提交操作、复播物理骰子动画并显示权威视图。

## 本地启动

在项目根目录运行：

```text
node game10/signal-server.js
```

打开 `http://localhost:8796/`。可使用 `PORT` 修改端口；本地数据库默认为 `game10/.data/game10.sqlite`，该目录已被 Git 忽略。

服务使用 Node.js 内置 SQLite，推荐 Node.js 24：

```text
node -e "require('node:sqlite'); console.log('SQLite ready')"
```

## 权威结构

- `rules.js`：路线长度、骰子配对、合法组合、推进和扎营纯规则。
- `dice-physics.js`：浏览器动画与服务端共用的确定性 Rapier 模拟。
- `server/game-engine.mjs`：大厅、回合阶段、物理骰面、超时、胜负和公开视图。
- `../shared/server/start-authoritative-game-server.js`：HTTP、SSE、会话、动作去重和持久化流程。
- `app.js`：只保存最新权威视图与本地动画缓存。

服务器同步运行物理模拟并保存最终骰面。浏览器用相同种子复播轨迹；不支持 WebGL 的设备只隐藏三维动画，不影响服务器上的投掷结果和游戏流程。

## 测试

```text
node --test game10/rules.test.js game10/dice-physics.test.js game10/game-engine.test.mjs game10/authoritative-server.test.cjs game10/persistence.test.cjs shared/server/room-store.test.cjs shared/server/authoritative-persistence.test.cjs
```

## 首次部署

协议 v2 的旧房间由房主浏览器保存，不能迁入权威服务器。首次切换前应确认没有进行中的 game10 对局。假设 systemd 服务用户为 `tablegame`：

```text
sudo install -d -o tablegame -g tablegame -m 700 /var/lib/tablegame/game10
sudo systemctl edit tablegame@game10
```

加入：

```ini
[Service]
Environment=GAME10_DB_PATH=/var/lib/tablegame/game10/game10.sqlite
```

部署：

```text
cd /srv/tablegame
git pull --ff-only origin main
node -e "require('node:sqlite'); console.log('SQLite ready')"
node --test game10/rules.test.js game10/dice-physics.test.js game10/game-engine.test.mjs game10/authoritative-server.test.cjs game10/persistence.test.cjs shared/server/room-store.test.cjs shared/server/authoritative-persistence.test.cjs
sudo systemctl daemon-reload
sudo systemctl restart tablegame@game10
sudo systemctl status tablegame@game10 --no-pager
curl http://127.0.0.1:8796/api/ready
curl http://127.0.0.1:8796/api/config
```

接口应报告 `protocolVersion: 3`、`actionSeconds: 30`、`persistence: "sqlite"` 和 `durable: true`。线上端口如被 systemd 的 `PORT` 覆盖，应使用实际端口检查。
