# No Thanks! 联机版

game9 已升级为协议 v3 的可持久化服务端权威样板：完整牌局、动作校验、随机洗牌、回合推进、权威倒计时和玩家视图均由 Node.js 服务执行，并使用 SQLite 保存房间。浏览器只提交操作意图、显示服务器返回的个人视图。

在项目根目录运行：

```text
node game9/signal-server.js
```

然后打开 `http://localhost:8795/`。如需更换端口，可以在启动前设置 `PORT` 环境变量。

game9 使用 Node.js 内置的 `node:sqlite`，部署前应使用 Node.js 24 或确认当前版本支持该模块：

```text
node -e "require('node:sqlite'); console.log('SQLite ready')"
```

本地开发默认数据库为 `game9/.data/game9.sqlite`，该目录已被 Git 忽略。线上必须通过 `GAME9_DB_PATH` 将运行数据放在 Git 仓库之外，例如：

```text
GAME9_DB_PATH=/var/lib/tablegame/game9/game9.sqlite node game9/signal-server.js
```

## 权威模式

- `server/game-engine.mjs`：纯游戏规则、完整状态、动作校验、超时结算和视图裁剪。
- `../shared/server/start-authoritative-game-server.js`：HTTP、SSE、身份会话、房间状态、动作版本、去重和服务端计时。
- `../shared/server/sqlite-room-store.js`：房间快照的 SQLite 持久化、结构版本校验和健康检查。
- `../shared/client/authoritative-room-client.js`：浏览器创建/恢复房间、提交动作、接收权威视图。
- `app.js`：只维护当前个人视图并渲染界面，不再保存完整游戏状态。

所有玩家（包括房主）都通过 `POST /api/actions` 提交动作。服务端完成校验和状态变更后，通过 SSE 向每名玩家发送裁剪后的 `view`。房主离线或刷新不会清空 Node 进程中的牌局；使用原房间号和浏览器中保存的身份重新加入即可恢复。

运行中的房间同时保留在内存和 SQLite 中。每次玩家动作和服务端超时都在持久化成功后才广播；Node 或云服务器重启后会恢复房间、身份、操作去重记录和权威倒计时。网络连接本身不会持久化，服务恢复后所有玩家先显示为离线，浏览器使用原身份重新连接即可。

如果服务恢复时发现行动期限已经过去，只结算当前玩家的一次超时操作，下一位玩家会获得完整的 30 秒，不会因为服务器停机而连续处罚多位玩家。

空房间在全部玩家离线两小时后由服务端清理。

## 测试

在项目根目录运行：

```text
node --test shared/server/room-store.test.cjs shared/server/authoritative-persistence.test.cjs game9/rules.test.js game9/game-engine.test.mjs game9/authoritative-server.test.cjs game9/persistence.test.cjs
```

## 首次部署持久化版本

第一阶段的内存房间无法从旧进程迁入 SQLite，因此首次升级时仍需确认没有正在进行的 game9 对局。先确认 systemd 服务使用的用户：

```text
systemctl show tablegame@game9 -p User -p Group
```

假设服务用户和组都是 `tablegame`，创建仓库外的数据目录：

```text
sudo install -d -o tablegame -g tablegame -m 700 /var/lib/tablegame/game9
sudo systemctl edit tablegame@game9
```

在编辑器中加入：

```ini
[Service]
Environment=GAME9_DB_PATH=/var/lib/tablegame/game9/game9.sqlite
```

然后更新、测试并重启：

```text
cd /srv/tablegame
git pull --ff-only
node -e "require('node:sqlite'); console.log('SQLite ready')"
node --test shared/server/room-store.test.cjs shared/server/authoritative-persistence.test.cjs game9/rules.test.js game9/game-engine.test.mjs game9/authoritative-server.test.cjs game9/persistence.test.cjs
sudo systemctl daemon-reload
sudo systemctl restart tablegame@game9
sudo systemctl status tablegame@game9 --no-pager
curl http://127.0.0.1:8795/api/ready
curl http://127.0.0.1:8795/api/config
```

`/api/ready` 应返回 `ready: true` 和 `persistence: "sqlite"`，`/api/config` 应返回 `durable: true`。首次持久化版本上线后，后续正常重启会恢复有效房间。

数据库目录权限为 `700`，数据库文件会自动设为 `600`，恢复凭证不会写入日志。备份时应先停止 game9，再复制整个数据目录，完成后立即启动服务，避免只复制 SQLite 主文件而遗漏 WAL 数据：

```text
sudo systemctl stop tablegame@game9
sudo cp -a /var/lib/tablegame/game9 /var/backups/game9-$(date +%F-%H%M%S)
sudo systemctl start tablegame@game9
```

## 本版规则

- 3–7 人，数字牌 3–35，开局秘密移除 9 张。
- 3–5 人每人 11 枚筹码，6 人 9 枚，7 人 7 枚。
- 支付一枚筹码拒绝当前牌，或拿下当前牌及其所有筹码。
- 拿牌后由同一玩家继续面对下一张牌。
- 连续数字只计算最小数字，剩余每枚筹码抵扣 1 分。
- 单局最低分获胜，同分并列获胜。
- 每次行动 30 秒，超时自动拿牌。
- 游戏开始后不能移出玩家；掉线玩家保留座位并可恢复身份。
