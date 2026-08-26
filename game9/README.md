# No Thanks! 联机版

game9 已升级为协议 v3 的服务端权威样板：完整牌局、动作校验、随机洗牌、回合推进、权威倒计时和玩家视图均由 Node.js 服务保存并执行。浏览器只提交操作意图、显示服务器返回的个人视图。

在项目根目录运行：

```text
node game9/signal-server.js
```

然后打开 `http://localhost:8795/`。如需更换端口，可以在启动前设置 `PORT` 环境变量。

## 权威模式

- `server/game-engine.mjs`：纯游戏规则、完整状态、动作校验、超时结算和视图裁剪。
- `../shared/server/start-authoritative-game-server.js`：HTTP、SSE、身份会话、房间状态、动作版本、去重和服务端计时。
- `../shared/client/authoritative-room-client.js`：浏览器创建/恢复房间、提交动作、接收权威视图。
- `app.js`：只维护当前个人视图并渲染界面，不再保存完整游戏状态。

所有玩家（包括房主）都通过 `POST /api/actions` 提交动作。服务端完成校验和状态变更后，通过 SSE 向每名玩家发送裁剪后的 `view`。房主离线或刷新不会清空 Node 进程中的牌局；使用原房间号和浏览器中保存的身份重新加入即可恢复。

当前权威状态仍存放在 Node 进程内存中，因此重启 game9 服务或云服务器仍会清空进行中的房间。持久化是下一阶段工作。

空房间在全部玩家离线两小时后由服务端清理。

## 测试

在项目根目录运行：

```text
node --test game9/rules.test.js game9/game-engine.test.mjs game9/authoritative-server.test.cjs
```

升级线上服务时会清空旧的 v2 房间。请确认没有正在进行的 game9 对局，再拉取代码并重启：

```text
cd /srv/tablegame
git pull --ff-only
node --test game9/rules.test.js game9/game-engine.test.mjs game9/authoritative-server.test.cjs
sudo systemctl restart tablegame@game9
sudo systemctl status tablegame@game9 --no-pager
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
