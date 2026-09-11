# 《间谍危机》服务器权威状态机

```text
lobby
  └─ start → secretReveal
                 ├─ 全员确认
                 └─ 30秒超时兜底
                          ↓
                     questioning ←─────────────────────┐
                      │   │   │                        │
        选择对象/回答接棒   │   └─ 间谍猜地点 → roundEnd
                          │
                          ├─ 主动指认 → accusationVote
                          │                 ├─ 非全票 ──┘
                          │                 └─ 全票 → roundEnd
                          │
                          └─ 8分钟耗尽 → timeoutNomination
                                              │
                                     提名 ────┤
                                     跳过     ↓
                                       timeoutVote
                                         ├─ 非全票 → 下一位提名者
                                         ├─ 全票 → roundEnd
                                         └─ 全部机会耗尽 → roundEnd

roundEnd
  ├─ 未满5轮 → nextRound → secretReveal
  └─ 第5轮 → 公布比赛优胜者
```

## 阶段约束

- `secretReveal`：只有正式玩家可以确认自己的秘密档案；旁观者不能操作。
- `questioning`：只有当前提问者能选择对象，只有当前回答者能确认完成；服务端禁止立即反问上一位提问者。
- `accusationVote`：保存问答现场和剩余时间，暂停8分钟倒计时；被指认者不能投票，其他人必须全票赞成。
- `timeoutNomination`：只接受当前提名者的选择；不允许间谍猜地点。
- `timeoutVote`：被提名者不能投票，未提交或反对均不能形成全票。
- `roundEnd`：公开地点、间谍和所有地点身份，统一结算分数。

所有动作均通过共享权威服务的 `expectedVersion` 与 `actionId` 防止过期请求和重复提交。绝对截止时间随房间快照写入SQLite，进程恢复后继续由服务端处理超时。
