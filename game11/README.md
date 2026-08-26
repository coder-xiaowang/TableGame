# 截码战联机版

game11 使用协议 v3 的可持久化服务端权威模式。队伍与座位、关键词和密码牌洗牌、传讯者轮换、提示校验、猜码权限、私密草稿、截获/误传判定、最终裁决和倒计时均由 Node.js 服务端管理。

## 本地启动

在项目根目录运行：

```text
node game11/signal-server.js
```

打开 `http://localhost:8797/`。可使用 `PORT` 修改端口；本地数据库默认为 `game11/.data/game11.sqlite`，该目录已被 Git 忽略。

服务使用 Node.js 内置 SQLite，推荐 Node.js 24：

```text
node -e "require('node:sqlite'); console.log('SQLite ready')"
```

## 逐玩家秘密视图

服务器不会构造一份房主视图和一份普通玩家视图，而是为每个 `viewerId` 单独执行视图生成：

- 每名玩家只收到本队四个关键词，结算后才收到双方关键词。
- 只有当前传讯者在提示阶段收到本轮密码；猜码阶段重新隐藏，揭晓后公开。
- 己方破译者与对方拦截者分别只收到自己的合法草稿。
- 每名玩家只收到自己的历史提示集合，供本地即时校验；其他玩家的集合完全省略。
- 房主只拥有开始、结束等管理权限，不获得额外秘密信息。
- 密码牌堆、尚未公开的双方答案和最终裁决答案永不发送到客户端。

浏览器 `app.js` 只保存服务器发给当前会话的最新视图，不能访问完整房间状态。

## 当前计时

- 编写提示：150 秒。
- 猜码及最终裁决：100 秒。
- 揭晓展示：8 秒。

掉线不会暂停服务端计时。超时提示、锁定最后合法草稿和阶段推进均由服务器执行。

## 测试

```text
node --test game11/rules.test.js game11/game-engine.test.mjs game11/authoritative-server.test.cjs game11/persistence.test.cjs shared/server/room-store.test.cjs shared/server/authoritative-persistence.test.cjs
```

## 首次部署

旧房间由房主浏览器保存，不能迁入权威服务器。首次切换前应确认没有进行中的 game11 对局。假设 systemd 服务用户为 `tablegame`：

```text
sudo install -d -o tablegame -g tablegame -m 700 /var/lib/tablegame/game11
sudo systemctl edit tablegame@game11
```

加入：

```ini
[Service]
Environment=PORT=8797
Environment=GAME11_DB_PATH=/var/lib/tablegame/game11/game11.sqlite
```

部署：

```text
cd /srv/tablegame
git pull --ff-only origin main
node -e "require('node:sqlite'); console.log('SQLite ready')"
node --test game11/rules.test.js game11/game-engine.test.mjs game11/authoritative-server.test.cjs game11/persistence.test.cjs shared/server/room-store.test.cjs shared/server/authoritative-persistence.test.cjs
sudo systemctl daemon-reload
sudo systemctl restart tablegame@game11
sudo systemctl status tablegame@game11 --no-pager
curl http://127.0.0.1:8797/api/ready
curl http://127.0.0.1:8797/api/config
```

接口应报告 `protocolVersion: 3`、`actionSeconds: 150`、`persistence: "sqlite"` 和 `durable: true`。
