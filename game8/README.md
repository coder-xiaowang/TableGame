# 璀璨宝石 · 宝可梦版

game8 已升级为协议 v3 的可持久化服务端权威模式。完整牌堆、市场、玩家资源、保留卡、回合推进、动作校验和胜负结算都由 Node.js 执行，浏览器只提交操作并渲染服务器为当前玩家生成的私密视图。

主要行动完成后，服务器会统一处理回合收尾：需要弃球或存在进化选项时等待玩家决定；没有剩余决定时自动结束回合，完成一次进化后也会自动切换到下一位训练家。

## 启动

```text
node game8/signal-server.js
```

默认访问地址为 `http://localhost:8794`。页面和联机客户端依赖 `/shared/`，因此不要直接双击 `index.html`。

本地开发数据库默认为 `game8/.data/game8.sqlite`，该目录已被 Git 忽略。线上应通过 `GAME8_DB_PATH` 把数据库放在仓库之外：

```text
GAME8_DB_PATH=/var/lib/tablegame/game8/game8.sqlite node game8/signal-server.js
```

服务使用 Node.js 内置 SQLite，推荐 Node.js 24。可用下面的命令预检：

```text
node -e "require('node:sqlite'); console.log('SQLite ready')"
```

## 测试

```text
node game8/test/rules.test.cjs
node --test game8/test/cards.test.cjs game8/game-engine.test.mjs game8/authoritative-server.test.cjs game8/persistence.test.cjs shared/server/room-store.test.cjs shared/server/authoritative-persistence.test.cjs shared/test/shared-client.test.js
```

## 结构

- `data/cards.json`：100 张基础卡牌的唯一数据源。
- `assets/cards/`：与基础牌库一一对应的 100 张卡面。
- `rules.js`：无 DOM 的独立规则引擎，同时支持浏览器和 Node。
- `server/game-engine.mjs`：服务端大厅、玩家身份、规则调用、权限和个人视图。
- `app.js`：只保存当前玩家视图和临时界面选择，不保存完整牌局。
- `signal-server.js`：使用公共权威服务器、SQLite 和协议版本 3。

SQLite 只保存动态牌局状态。100 张静态卡牌及其索引会在服务启动时从 `data/cards.json` 重新挂载，不会在每个房间快照里重复保存。牌库顺序永远不会发送到浏览器；从市场保留的明牌继续公开，其他玩家从牌堆暗中保留的卡只显示背面和所属等级。

## 首次上线

旧版房间只存在房主浏览器中，无法迁入新服务。首次切换前必须确认没有正在进行的 game8 对局。假设 systemd 服务用户为 `tablegame`：

```text
sudo install -d -o tablegame -g tablegame -m 700 /var/lib/tablegame/game8
sudo systemctl edit tablegame@game8
```

加入：

```ini
[Service]
Environment=GAME8_DB_PATH=/var/lib/tablegame/game8/game8.sqlite
```

部署与检查：

```text
cd /srv/tablegame
git pull --ff-only origin main
node -e "require('node:sqlite'); console.log('SQLite ready')"
node game8/test/rules.test.cjs
node --test game8/test/cards.test.cjs game8/game-engine.test.mjs game8/authoritative-server.test.cjs game8/persistence.test.cjs shared/server/room-store.test.cjs shared/server/authoritative-persistence.test.cjs
sudo systemctl daemon-reload
sudo systemctl restart tablegame@game8
sudo systemctl status tablegame@game8 --no-pager
curl http://127.0.0.1:8794/api/ready
curl http://127.0.0.1:8794/api/config
```

接口应报告 `persistence: "sqlite"`、`durable: true` 和 `protocolVersion: 3`。服务或云服务器重启后，有效房间会从 SQLite 恢复，玩家使用原浏览器身份重新连接即可继续。

卡牌数据与卡面经原作者授权，用于非商业学习交流。
