# game18 · 犯人在跳舞

第三版基础规则的服务器权威数字版，支持3～8人、5/10分比赛、SQLite恢复和旁观模式。

## 本地启动

```bash
node game18/signal-server.js
```

默认访问 `http://127.0.0.1:8804/`。

## 服务器环境变量

```ini
PORT=8804
GAME18_DB_PATH=/var/lib/tablegame/game18/game18.sqlite
SPECTATORS_ENABLED=1
SPECTATOR_LIMIT=10
```

正式环境由 Nginx 通过 `https://criminal.zillionx.xyz/` 反向代理到 `http://127.0.0.1:8804`。前端只使用同源 `/api/` 路径。

## 测试

```bash
node --test game18/*.test.mjs game18/*.test.cjs
```

