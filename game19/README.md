# game19 · BANG!

经典基础版 BANG! 的服务器权威数字实现，支持4～7名玩家、旁观席、断线重连和SQLite恢复。

规则口径见 [RULES.md](RULES.md)，状态机与隐私边界见 [STATE_MACHINE.md](STATE_MACHINE.md)。本项目不使用官方卡图，页面卡牌由文字、花色和CSS生成。

## 本地启动

```bash
node game19/signal-server.js
```

默认访问 `http://127.0.0.1:8805/`。

## 服务器环境变量

```ini
PORT=8805
GAME19_DB_PATH=/var/lib/tablegame/game19/game19.sqlite
SPECTATORS_ENABLED=1
SPECTATOR_LIMIT=10
```

正式环境由Nginx通过独立HTTPS子域名反向代理至 `http://127.0.0.1:8805`。客户端只使用同源 `/api/` 与 `/shared/` 路径，不写死域名或公网端口。

## 测试

```bash
node --test game19/*.test.mjs game19/*.test.cjs
```

服务器接入前还应以4人和7人各完成一轮真实设备验收，重点覆盖身份胜负、濒死互救、杀手斯拉布双闪、灾星珍妮替代牌、幸运公爵双判定、炸药传递和手机吸附操作区。
