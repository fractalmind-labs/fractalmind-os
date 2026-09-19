# 如何知道 Agent 剩余多少额度？

## 核心问题

**当前**：agent-calendar 只能检测"额度用完"（二值状态）
**期望**：知道"还剩多少额度"（量化估算）

## 技术挑战

### 为什么不能直接查询剩余额度？

大多数 API Provider **不提供剩余额度查询接口**：

| Provider | 额度查询接口 | 说明 |
|----------|-------------|------|
| Anthropic | ❌ 无 | 只在 429 错误时返回重置时间 |
| OpenAI | ��� 有 | 但需要 dashboard API key，不适合 agent 使用 |
| Google | ❌ 无 | 只在触发限制后返回 |
| MiniMax | ❌ 无 | 无公开接口 |

**结论**：只能通过**间接估算**来获取剩余额度

---

## 解决方案

### 方案对比

| 方案 | 准确性 | 实现难度 | 实时性 | 推荐度 |
|------|--------|----------|--------|--------|
| **1. 历史模式估算** | ⭐⭐⭐ | ⭐ 简单 | ⭐⭐ 中 | ✅ 推荐 |
| **2. Agent 自计数** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ 复杂 | ⭐⭐⭐ 高 | ⚠️ 需改 Agent 代码 |
| **3. 中间代理拦截** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ 极难 | ⭐⭐⭐⭐⭐ 实时 | ❌ 架构复杂 |
| **4. Provider API** | ⭐⭐⭐⭐⭐ | ⭐⭐ 中 | ⭐⭐⭐⭐⭐ 实时 | ⚠️ 仅部分支持 |

---

## 推荐方案：历史模式估算

### 工作原理

```
历史数据 → 识别模式 → 推断当前 → 估算剩余
   ↓            ↓          ↓          ↓
429 事件   →  平均周期  →  当前位置  →  剩余量
```

### 核心逻辑

#### 1. 记录 429 事件

每次检测到 429 错误时记录：

```json
{
  "timestamp": "2026-01-05T02:10:53Z",
  "event_type": "429",
  "reset_time": "2026-01-05T07:12:05Z",
  "error_message": "API Error 429..."
}
```

#### 2. 计算使用模式

从历史数据中计算：

```python
# 最近 30 天的 429 事件
events = [
    {"timestamp": "2026-01-05T02:10:53Z"},  # 今天 02:10
    {"timestamp": "2026-01-04T21:15:30Z"},  # 昨天 21:15
    {"timestamp": "2026-01-04T12:30:00Z"},  # 昨天 12:30
    ...
]

# 计算：平均多少小时达到一次限制
avg_hours_to_limit = 4.5  # 从 10 次事件计算得出
```

#### 3. 估算当前状态

```python
# 距离上次重置过去了多久
last_reset = "2026-01-05T00:00:00Z"  # 假设每天 0 点重置
now = "2026-01-05T14:30:00Z"
hours_since_reset = 14.5

# 根据历史模式估算
if hours_since_reset < avg_hours_to_limit:
    usage_percentage = (hours_since_reset / avg_hours_to_limit) * 100
    remaining = daily_limit * (1 - usage_percentage/100)
else:
    # 可能已经接近或达到限制
    remaining = 0
```

---

## 实际实现

### 已创建的模块

**文件**：`.agent/skills/agent-calendar/scripts/quota_tracker.py`

**功能**：
1. **记录事件**：每次检测到 429 时自动记录
2. **历史查询**：查询最近 N 天的额度事件
3. **状态估算**：基于历史数据估算当前剩余额度

**使用示例**：

```python
from quota_tracker import QuotaTracker, format_quota_status

tracker = QuotaTracker()

# 检测到 429 时自动记录
# tracker.record_429_event('EMP_0007', reset_time, error_msg)

# 估算当前状态
status = tracker.estimate_quota_status(
    agent_id='EMP_0007',
    provider='anthropic',
    model='claude-sonnet-4'
)

# 输出：
{
    'status': 'warning',
    'estimated_remaining': 50000,    # 剩余 ~50k tokens
    'estimated_limit': 100000,       # 日限额 100k
    'usage_percentage': 50,          # 已用 50%
    'confidence': 'medium',          # 估算置信度
    'next_reset': datetime(...),     # 下次重置时间
    'reason': 'Reset 14.5h ago, estimating 50000/100000 used'
}

# 格式化显示
print(format_quota_status(status))
# 输出：⚠️ 50,000 left (50% used)
```

---

## 估算准确性

### 准确性等级

| 等级 | 条件 | 预期误差 |
|------|------|----------|
| **High** | 最近 24h 内发生过 429 | ±10% |
| **Medium** | 最近 7 天内发生过 429 | ±30% |
| **Low** | 无历史记录或 >30 天前 | ±50%+ |

### 影响因素

#### ✅ 提高准确性的因素

1. **频繁的 429 事件**：更多数据点 = 更准确
2. **规律的使用模式**：每天相似的工作负载
3. **已知的限额**：准确的日限额配置

#### ⚠️ 降低准确性的因素

1. **不规律的使用**：有时高负载，有时低负载
2. **长时间无 429**：无法校准估算
3. **多任务混合**：不同任务的 token 消耗差异大

---

## 使用场景

### 场景 1：Agent 刚达到额度

```bash
$ python3 .agent/skills/agent-calendar/scripts/main.py show EMP_0007
```

**输出**：
```
Current Status: ⚠️ Quota Exhausted

Quota Details:
  • Estimated Remaining: 0 tokens
  • Daily Limit: 100,000 tokens
  • Usage: 100% (exhausted)
  • Reset Time: 2026-01-05 07:12:05
  • Wait Time: ~4h 30m
```

### 场景 2：Agent 使用一半额度

```bash
$ python3 .agent/skills/agent-calendar/scripts/main.py show EMP_0004
```

**输出**：
```
Current Status: ✅ Working

Quota Details:
  • Estimated Remaining: ~50,000 tokens
  • Daily Limit: 100,000 tokens
  • Usage: 50% (estimated)
  • Confidence: Medium
  • Reason: Reset 12h ago, historical pattern shows 50% usage

⚠️ Warning: Approaching 50% daily limit
```

### 场景 3：无可用的历史数据

```bash
$ python3 .agent/skills/agent-calendar/scripts/main.py show EMP_0010
```

**输出**：
```
Current Status: ✅ Working

Quota Details:
  • Estimated Remaining: Unknown
  • Daily Limit: 100,000 tokens (configured)
  • Usage: Unknown (no history)
  • Confidence: Low
  • Reason: No quota events recorded in last 30 days

💡 Tip: Use Agent for heavy tasks to build usage pattern
```

---

## 集成到现有系统

### 更新 status_detector.py

在 `detect_agent_state()` 函数中集成：

```python
from quota_tracker import QuotaTracker

def detect_agent_state(agent_id: str, agent_config: Dict) -> Dict:
    # ... 现有代码 ...

    # 检测到 429 时记录事件
    if quota_info:
        reset_time, error_msg = quota_info
        tracker = QuotaTracker()
        tracker.record_429_event(agent_id, reset_time, error_msg)

    # 添加额度估算信息
    quota_tracker = QuotaTracker()
    quota_status = quota_tracker.estimate_quota_status(
        agent_id=agent_id,
        provider=extract_provider(agent_config),
        model=extract_model(agent_config)
    )

    result['quota_estimate'] = quota_status
    return result
```

### 更新 calendar 显示

```python
def cmd_calendar(args):
    states = get_all_agent_states()

    for emp_id, state in states.items():
        quota = state.get('quota_estimate', {})

        if quota.get('estimated_remaining') is not None:
            remaining = quota['estimated_remaining']
            percentage = quota['usage_percentage']
            info = f"~{remaining:,} left ({percentage}%)"
        else:
            info = "Unknown usage"

        print(f"{emp_id} | {info}")
```

---

## 配置已知的限额

### 更新 quota_tracker.py

根据你的实际使用情况配置：

```python
def _get_known_limits(self, provider: str, model: str) -> Dict:
    limits = {
        'anthropic': {
            # 根据你的实际套餐配置
            'claude-sonnet-4': {
                'daily': 500000,      # 日限额
                'monthly': 15000000   # 月限额
            },
            'claude-opus-4': {
                'daily': 200000,
                'monthly': 6000000
            },
            # 添加你使用的模型
        },
        'mini-max': {
            'minimax-m2.1-free': {
                'daily': 200000,  # 免费版限额
                'monthly': 6000000
            }
        },
        # 添加其他 providers
    }
    return limits.get(provider, {}).get(model, {'daily': 100000})
```

---

## 未来的改进方向

### 1. 主动探测（更准确）

定期发送轻量级请求测试是否接近限制：

```python
def probe_quota(agent_id: str) -> bool:
    """发送测试请求检查额度状态"""
    test_prompt = "ping"
    response = send_request(agent_id, test_prompt)

    if '429' in response:
        return False  # 接近限制
    else:
        return True   # 仍有额度
```

### 2. Agent 自计数（最准确）

在 Agent 内部记录每次请求的 token 使用：

```python
# 在 Agent 代码中
class Agent:
    def __init__(self):
        self.tokens_used_today = 0
        self.daily_limit = get_daily_limit()

    def call_api(self, prompt):
        response = anthropic.messages.create(...)
        tokens = response.usage.input_tokens + response.usage.output_tokens

        self.tokens_used_today += tokens

        if self.tokens_used_today > self.daily_limit * 0.9:
            warn("Near quota limit")

        return response
```

**优势**：
- 100% 准确
- 实时更新

**劣势**：
- 需要修改 Agent 代码
- 不同 Provider 需要不同实现

### 3. API 中间代理（最完美）

搭建一个本地 API 代理服务：

```
Agent → Local Proxy → Anthropic API
         ↓
      记录所有请求
      计算实时额度
      返回给 agent-calendar
```

**优势**：
- 完全准确
- 实时监控
- 支持所有 Provider
- 可添加缓存、重试等功能

**劣势**：
- 架构复杂
- 需要额外的服务维护
- 增加延迟

---

## 快速开始

### 1. 启用额度估算

```bash
# 现有代码已包含 quota_tracker.py
# 下次检测到 429 时会自动记录
```

### 2. 查看估算结果

```bash
# 等待积累一些历史数据后
python3 .agent/skills/agent-calendar/scripts/main.py show EMP_0007
```

### 3. 手动测试 quota_tracker

```bash
cd .agent/skills/agent-calendar/scripts
python3 quota_tracker.py
```

---

## 总结

### 当前状态

- ✅ **已实现**：基础框架 (`quota_tracker.py`)
- ⏳ **待集成**：与 `status_detector.py` 集成
- ⏳ **待验证**：实际使用中验证准确性

### 估算准确性

| 场景 | 准确性 | 说明 |
|------|--------|------|
| 额度用完 | 100% | 直接来自 429 错误 |
| 额度恢复后 1-2h | ±20% | 基于历史模式 |
| 额度恢复后 6-12h | ±40% | 估算误差增大 |
| 无历史记录 | ❌ 无法估算 | 显示 "Unknown" |

### 最佳实践

1. **初期使用**：先让 Agent 积累 3-5 天的 429 事件历史
2. **定期校准**：每周验证一次估算准确性
3. **配置限额**：根据实际套餐更新 `_get_known_limits()`
4. **监控置信度**：注意 `confidence` 字段，低置信度时谨慎使用

---

## FAQ

### Q1：为什么不直接调用 Provider 的额度查询 API？

**A**：
1. 大多数 Provider（如 Anthropic）不提供此类 API
2. 有此 API 的（如 OpenAI）需要特殊的 dashboard key，不适合 Agent 使用
3. 需要额外的网络请求，增加延迟

### Q2：估算不准怎么办？

**A**：
1. 查看输出的 `confidence` 字段
2. 低置信度时显示估算范围而非具体数值
3. 积累更多历史数据以提高准确性
4. 考虑实施"主动探测"或"Agent 自计数"方案

### Q3：不同 Agent 使用同一 Provider，额度是共享的吗？

**A**：通常**不是**。每个 API key 有独立的额度。如果你的 Agents 共享同一个 API key，需要在 `quota_tracker.py` 中特殊处理：

```python
# 按 API key 而非 Agent ID 跟踪
def record_429_event(self, api_key: str, reset_time: datetime, agent_id: str):
    event = QuotaEvent(
        timestamp=datetime.now().isoformat(),
        event_type='429',
        reset_time=reset_time.isoformat(),
        agent_id=agent_id  # 记录是哪个 Agent 触发的
    )
    self._append_event(api_key, event)  # 按 key 存储
```
