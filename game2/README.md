# game2（我话你猜）服务端权威版本

game2 已从“房主浏览器保存状态并裁判”改为协议 v3 的服务端权威模式。浏览器只提交落座、描述、猜词和房主管理操作；`server/game-engine.mjs` 负责抽成语、权限校验、答案匹配、队伍轮换、计分、结算和逐玩家视图脱敏。

## 本地运行

在仓库根目录执行：

```text
node game2/signal-server.js
```

默认访问 `http://localhost:8787`。本地数据库位于 `game2/.data/game2.sqlite`，该目录已被 Git 忽略。服务使用 Node.js 内置 SQLite，推荐 Node.js 24：

```text
node -e "require('node:sqlite'); console.log('SQLite ready')"
```

可通过环境变量覆盖运行参数：

```text
PORT=8788 GAME2_DB_PATH=/var/lib/tablegame/game2/game2.sqlite node game2/signal-server.js
```

如果 8787 已被其他桌游占用，必须使用服务器现有端口规划，为 game2 配置独立的 `PORT`。

## 权威与隐藏信息

- `idioms.js`：约 7000 条服务端成语数据。
- `rules.mjs`：文本标准化、座位角色、洗牌和抽牌纯规则。
- `server/game-engine.mjs`：大厅、座位、队伍、回合、比分、掉线和逐玩家视图。
- `../shared/server/start-authoritative-game-server.js`：HTTP、SSE、身份、版本检查、操作去重和持久化。
- `app.js`：只保存当前玩家收到的权威视图，不包含裁判状态。

所有队长可看到当前答案，所有队员和未落座玩家看不到；房主没有额外答案权限。完整成语牌堆始终留在服务端。游戏结束后最后一题答案公开。

## 旁观模式与秘密边界

game2 已接入共享旁观系统。旁观者可以查看队伍席位、比分、已经提交的描述、猜词记录和公开结果，但进行中的成语答案始终隐藏；只有大局结束后最后一题答案才公开。房间玩家身份与队伍席位是两层独立概念：旁观者进入玩家席后仍需选择队伍席位，玩家转入旁观席时会同时释放原队伍席位。游戏开始后锁定两层席位。

## 测试

```text
node --test game2/rules.test.mjs game2/game-engine.test.mjs game2/authoritative-server.test.cjs game2/persistence.test.cjs game2/spectator-mode.test.cjs
```

测试覆盖成语数据、落座和权限、队长/队员差异化视图、轮换计分、掉线恢复、HTTP/SSE 联机、SQLite 重启恢复和操作去重。

## 首次部署

旧版房间只存在于房主浏览器，无法迁移。切换前应确认没有正在进行的 game2 对局。假设 systemd 服务用户为 `tablegame`：

```text
sudo install -d -o tablegame -g tablegame -m 700 /var/lib/tablegame/game2
sudo systemctl edit tablegame@game2
```

加入以下配置；`PORT` 使用你当前为 game2 分配的独立端口：

```ini
[Service]
Environment=GAME2_DB_PATH=/var/lib/tablegame/game2/game2.sqlite
Environment=PORT=8788
Environment=SPECTATORS_ENABLED=1
Environment=SPECTATOR_LIMIT=10
```

更新并重启：

```text
cd /srv/tablegame
git pull --ff-only origin main
node --test game2/rules.test.mjs game2/game-engine.test.mjs game2/authoritative-server.test.cjs game2/persistence.test.cjs game2/spectator-mode.test.cjs
sudo systemctl daemon-reload
sudo systemctl restart tablegame@game2
sudo systemctl status tablegame@game2 --no-pager
curl -fsS http://127.0.0.1:8788/api/health
curl -fsS http://127.0.0.1:8788/api/ready
curl -fsS http://127.0.0.1:8788/api/config
```

Nginx 中 game2 的反向代理目标必须与实际 `PORT` 一致，并继续为 SSE 使用关闭代理缓冲和较长读取超时的配置。`/api/ready` 应报告 `ready: true`、`persistence: "sqlite"`、`durable: true` 和 `protocolVersion: 3`。
