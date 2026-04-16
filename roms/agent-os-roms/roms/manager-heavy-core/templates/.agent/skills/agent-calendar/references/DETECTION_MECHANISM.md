# Agent Calendar - 额度检测机制说明

## 问题：如何知道 Agent 什么时候额度用完，什么时候继续可用？

### 答案：通过解析 tmux 会话中的 API 错误消息

---

## 检测流程

### 1. 捕获 Tmux 会话输出

```python
def capture_tmux_output(session_name: str, lines: int = 100) -> Optional[str]:
    """从 tmux 会话捕获最近的输出"""
    result = subprocess.run(
        ['tmux', 'capture-pane', '-p', '-t', session_name, '-S', f'-{lines}'],
        capture_output=True, text=True
    )
    return result.stdout
```

**实际操作**：
```bash
# 等同于命令行
tmux capture-pane -p -t agent-emp-0006 -S -100
```

---

### 2. 识别 429 错误和重置时间

#### 实际错误消息示例

从 EMP_0006 的 tmux 会话中捕获���的真实错误：

```
⎿ API Error: 429
    {"error":{"code":"1308","message":"Usage limit
    reached for 5 hour. Your limit will reset at
    2026-01-05 07:12:05"},"request_id":"20260105053538006"}
```

#### 正则表达式匹配

```python
patterns = [
    r'Usage limit reached.*?reset at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})',
    r'limit will reset at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})',
    r'"message":"Usage limit.*?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})',
]
```

**匹配结果**：
- 输入：`Usage limit reached for 5 hour. Your limit will reset at 2026-01-05 07:12:05`
- 匹配到：`2026-01-05 07:12:05`

---

### 3. 解析重置时间

```python
reset_str = "2026-01-05 07:12:05"
reset_time = datetime.strptime(reset_str, '%Y-%m-%d %H:%M:%S')
reset_time = reset_time.replace(tzinfo=timezone.utc)
```

**解析结果**：
- `reset_time` = `datetime(2026, 1, 5, 7, 12, 5, tzinfo=timezone.utc)`

---

### 4. 计算等待时间

```python
now = datetime.now(timezone.utc)
wait_seconds = int((reset_time - now).total_seconds())
wait_seconds = max(0, wait_seconds)  # 确保不为负数
```

**实际计算**：
- 当前时间：`2026-01-05 02:30:00 UTC`
- 重置时间：`2026-01-05 07:12:05 UTC`
- 等待秒数：`07:12:05 - 02:30:00 = 16,125 秒`
- 格式化显示：`~4h 29m`

---

### 5. 状态判断

```python
if state_info['state'] == AgentState.QUOTA_EXHAUSTED:
    if wait_seconds > 0:
        # 仍然在额度限制中
        display = f"⚠️ 429 - ~{format_wait_time(wait_seconds)} until reset"
    else:
        # 额度已恢复
        display = "✅ Available (quota reset)"
```

---

## 检测准确性分析

### ✅ 优点

1. **直接读取 API 错误**：从 tmux 会话直接捕获真实 API 响应
2. **精确的重置时间**：API 返回明确的重置时间戳
3. **实时检测**：每次运行 `calendar` 命令都会重新检测
4. **无状态设计**：不需要持久化存储，完全基于当前 tmux 输出

### ⚠️ 局限性

1. **依赖 tmux**：Agent 必须在 tmux 会话中运行
2. **只能检测显示的错误**：如果错误消息滚出屏幕，可能检测不到
3. **需要 Agent 活跃**：Agent 会话必须存在且可读
4. **Provider 依赖**：不同 API Provider 的错误格式可能不同

---

## 不同 Provider 的错误格式

### Anthropic Claude (429 Error)

```
API Error: 429 {"error":{"code":"1308","message":"Usage limit reached for 5 hour.
Your limit will reset at 2026-01-05 07:12:05"}}
```

**解析结果**：
- Reset: `2026-01-05 07:12:05`
- Wait: ~4h 30m

### OpenAI (假设格式)

```
Error: 429 {"error":{"message":"You exceeded your current quota,
please check your plan and billing details. quota_reset_time: 2026-01-05 12:00:00"}}
```

**需要添加正则**：
```python
r'quota_reset_time[:\s]+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})'
```

### Generic (无重置时间)

```
Rate limit exceeded. Please try again later.
```

**解析结果**：
- Reset: `None`
- Display: "⚠️ Quota exhausted (unknown reset time)"

---

## 实际使用示例

### 场景 1：Agent 刚刚达到限制

```bash
$ python3 .agent/skills/agent-calendar/scripts/main.py show EMP_0006
```

**输出**：
```
Current Status: ⚠️ Quota Exhausted

Quota Details:
  • Error: API Error 429 - Usage limit reached
  • Reset Time: 2026-01-05 07:12:05
  • Wait Time: ~4h 30m
```

**解释**：
- API 刚刚返回 429 错误
- 从错误消息中解析出重置时间：`07:12:05`
- 当前时间 `02:42:05`，计算出还需等待 `4h 30m`

---

### 场景 2：额度即将恢复

**30 分钟后再次运行**：
```bash
$ python3 .agent/skills/agent-calendar/scripts/main.py show EMP_0006
```

**输出**：
```
Current Status: ⚠️ Quota Exhausted

Quota Details:
  • Reset Time: 2026-01-05 07:12:05
  • Wait Time: ~4h 0m  # 减少了 30 分钟
```

**解释**：
- 每次运行都重新计算等待时间
- 显示最新的倒计时

---

### 场景 3：额度已恢复

**超过重置时间后运行**：
```bash
$ python3 .agent/skills/agent-calendar/scripts/main.py show EMP_0006
```

**可能的结果**：

**情况 A**：Agent 仍在运行，但错误消息已消失
```
Current Status: ✅ Working
# Agent 恢复正常工作
```

**情况 B**：tmux 中仍有旧的错误消息
```
Current Status: ⚠️ Quota Exhausted
  • Wait Time: ~0s
# 需要手动检查或发送测试请求
```

**建议**：发送测试请求确认额度恢复
```bash
python3 .agent/skills/agent-manager/scripts/main.py send EMP_0006 "ping"
tmux send-keys -t agent-emp-0006 Enter
```

---

## 如何验证额度恢复

### 方法 1：自动检测（推荐）

```bash
# 运行 calendar 查看
python3 .agent/skills/agent-calendar/scripts/main.py calendar --state quota-exhausted
```

**预期**：如果该 Agent 不再出现在列表中，说明额度已恢复

### 方法 2：发送测试消息

```bash
# 发送简单测试消息
python3 .agent/skills/agent-manager/scripts/main.py send EMP_0006 "test"
tmux send-keys -t agent-emp-0006 Enter

# 等待几秒后检查
sleep 5
python3 .agent/skills/agent-calendar/scripts/main.py show EMP_0006
```

**预期**：如果返回 `✅ Working` 而非 `⚠️ Quota Exhausted`，说明已恢复

### 方法 3：重启 Agent

```bash
# 停止 agent
python3 .agent/skills/agent-manager/scripts/main.py stop EMP_0006

# 启动 agent
python3 .agent/skills/agent-manager/scripts/main.py start EMP_0006

# 检查状态
python3 .agent/skills/agent-calendar/scripts/main.py show EMP_0006
```

---

## 技术细节

### 为什么使用 Tmux？

1. **非侵入性**：不需要修改 Agent 代码
2. **实时性**：直接读取当前输出，无需额外 API
3. **可靠性**：Tmux 会话持久化，即使 Agent 崩溃也能看到最后的错误

### 为什么不用持久化存储？

**当前设计**：每次运行时实时检测 tmux 输出

**优点**：
- 无需维护历史数据库
- 总是最新的状态
- 简单可靠

**可能的改进**（未来）：
- 记录历史额度使用模式
- 预测何时会达到限制
- 提前告警

---

## 常见问题

### Q1：为什么显示 "Quota exhausted (unknown reset time)"？

**原因**：
- 检测到 429 错误，但无法从错误消息中解析出重置时间

**可能情况**：
- Provider 的错误格式不匹配任何正则表达式
- 错误消息中确实没有包含重置时间

**解决方法**：
1. 手动检查 tmux 会话：`tmux attach -t agent-emp-0006`
2. 添加新的正则表达式匹配该 Provider 的格式
3. 联系 Provider 查询额度重置时间

---

### Q2：检测到的重置时间不准确？

**原因**：
- 时区问题：API 返回的时间可能不是 UTC
- 时间格式解析错误

**解决方法**：
1. 检查代码中的时区处理：`reset_time.replace(tzinfo=timezone.utc)`
2. 添加更多时间格式支持
3. 打印原始错误消息进行调试

---

### Q3：Agent 状态显示 "Working" 但实际额度用完了？

**原因**：
- 错误消息已经滚出屏幕（tmux capture-pane 只捕获最近 100 行）
- Agent 还没有尝试调用 API

**解决方法**：
```bash
# 增加捕获行数
tmux capture-pane -p -t agent-emp-0006 -S -500

# 或者搜索更多历史
tmux capture-pane -p -t agent-emp-0006 -S -1000 | grep -i "429\|limit"
```

---

## 未来改进

### 1. 主动检测

**当前**：被动检测错误消息
**改进**：定期发送轻量级 ping 请求测试额度

```python
def test_quota(agent_id: str) -> bool:
    """发送测试请求检查额度是否恢复"""
    send_message(agent_id, "ping")
    time.sleep(2)
    output = capture_tmux_output(f"agent-{agent_id}")
    return "429" not in output
```

### 2. 自动恢复提醒

```python
def monitor_quota_reset(agent_id: str, reset_time: datetime):
    """监控并在额度恢复时通知"""
    while datetime.now() < reset_time:
        time.sleep(300)  # 每 5 分钟检查一次
    else:
        notify(f"✅ {agent_id} quota has reset!")
```

### 3. 历史趋势分析

```python
def analyze_quota_history(agent_id: str, days: int = 7):
    """分析历史额度使用模式"""
    # 记录每次 429 错误的时间
    # 计算平均达到限制的时间
    # 预测下次可能的限制时间
```

---

## 总结

**检测核心**：解析 tmux 会话中的 API 429 错误消息

**关键信息**：
1. `429` 状态码 = 额度用完
2. `reset at 2026-01-05 07:12:05` = 重置时间
3. `reset_time - now` = 等待时长

**准确性**：基于 API 返回的真实数据，不是估算

**限制**：只能检测最近显示的错误，需要 Agent 在 tmux 中运行

**改进方向**：主动测试、历史分析、自动提醒
