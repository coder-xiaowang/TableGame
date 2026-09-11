# game20 · 局内人 INSIDER

Oink Games《INSIDER》基础玩法的服务器权威数字实现，支持4～8名玩家、外部语音交流、旁观席、断线重连和SQLite恢复。项目使用自建的300词中文题库，不包含官方卡图和完整官方题库。

规则口径见 [RULES.md](RULES.md)，权威阶段和隐私边界见 [STATE_MACHINE.md](STATE_MACHINE.md)。

## 本地启动

```bash
node game20/signal-server.js
```

默认访问 `http://127.0.0.1:8806/`。

## 服务器环境变量

```ini
PORT=8806
GAME20_DB_PATH=/var/lib/tablegame/game20/game20.sqlite
SPECTATORS_ENABLED=1
SPECTATOR_LIMIT=10
```

正式环境由Nginx通过独立HTTPS子域名反向代理至 `http://127.0.0.1:8806`。建议公开入口为 `https://insider.zillionx.xyz/`。客户端只使用同源路径，不写死域名或公网端口。

## 测试

```bash
node --test game20/*.test.mjs game20/*.test.cjs
```

服务器接入前至少使用4人和8人各完成一轮真实设备验收，覆盖：主持人与局内人答案可见性、猜词超时、普通/局内人分别成为猜中者、两轮投票、平票裁决、旁观者中途加入、断线恢复和手机玩家列表。
