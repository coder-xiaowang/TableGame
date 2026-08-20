# TableGame 公共客户端层

这个目录只提供与具体桌游规则无关的浏览器公共能力。现有 `game` 到 `game8` 没有接入或修改。

## 模块

- `client/room-client.js`：创建/加入房间、SSE、消息分派、在线状态、动作、视图和踢人。
- `client/session-store.js`：按游戏和房间隔离的断线恢复身份。
- `client/protocol.js`：HTTP、协议版本以及公共消息类型。
- `client/sse-channel.js`：SSE 生命周期和初次连接超时。
- `client/host-timer.js`：房主权威计时器和客户端显示倒计时。
- `client/ui.js`：少量无主题 DOM 工具。
- `client/utils.js`：ID、房间号、昵称、转义、洗牌和日志工具。
- `styles/base.css`：可选的最小公共样式。

公共层不维护游戏 `state`，也不实现动作校验、阶段推进、隐私视图、胜负结算或游戏界面。

## 新游戏接入示例

```js
import {
  createRoomClient,
  createSessionStore,
  MESSAGE_KINDS
} from "/shared/client/index.js";

const sessions = createSessionStore({ gameId: "game9" });
const room = createRoomClient({
  protocolVersion: 2,
  sessionStore: sessions,
  onStatus(status) {
    // 更新连接提示
  },
  handlers: {
    onHello(playerId, payload) {
      // 房主校验大厅状态及容量，然后加入游戏自己的 state
    },
    onPresence(playerId, connected) {
      // 房主更新游戏自己的 player.connected
    },
    onAction(playerId, action) {
      // 房主执行游戏自己的动作校验和状态推进
    },
    onView(view) {
      // 客端保存 guestView 并 render
    },
    onRejected(message) {},
    onKicked() {}
  }
});

await room.createRoom({ name: "房主" });
await room.joinRoom({ code: "ABCD", name: "玩家" });
room.submitAction({ type: "game-specific-action" });
```

房主广播时仍由游戏实现隐私裁剪：

```js
for (const player of state.players) {
  if (!player.isHost) {
    await room.sendView(player.id, buildView(player.id));
  }
}
```

## 静态文件路径

公共模块使用原生 ES Modules。新游戏的静态服务器需要把本目录显式暴露为 `/shared/`。当前共享信令服务器仍只提供各游戏目录内的静态文件，因此在正式接入 game9 时，需要增加一个受限的 `/shared/` 静态挂载；本次抽取没有修改现有服务器。

不要允许任意 `..` 路径访问项目根目录，只应把这个 `shared` 目录作为明确的只读静态目录。

## 约束

1. 随机发牌、掷骰和状态修改只在房主执行。
2. 客端只发送意图，房主必须重新校验动作。
3. `sendView` 的内容必须先由游戏自己的 `buildView(viewerId)` 裁剪。
4. `protocolVersion` 必须与该游戏 `signal-server.js` 传给共享服务器的版本一致。
5. 房主计时器负责推进规则；客户端倒计时只负责显示。

## 自检

在项目根目录运行：

```text
node --test shared/test/shared-client.test.js
```
