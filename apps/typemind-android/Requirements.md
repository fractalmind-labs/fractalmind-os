# TypeMind - AI专用Android输入法需求文档

## 1. 项目背景

### 当前问题
AI（如Clawdbot）通过ADB控制Android设备时，无法直接输入中文等Unicode字符：
- `adb shell input text "你好"` - 只支持ASCII字符
- 剪贴板方法 - 需要长按+粘贴，不稳定
- Unicode编码 - 部分设备不支持

### 目标
开发一个AI专用的Android输入法，通过广播接口接收指令，直接将文本插入到当前应用。

---

## 2. 核心功能需求

### 2.1 文本输入
**优先级：P0（必须）**

| 功能 | 描述 | 示例 |
|------|------|------|
| 基础文本输入 | 接收广播，插入文本到光标位置 | `adb shell "am broadcast -a ai.input.TEXT --es text '你好'"` |
| 多行文本支持 | 支持换行符 | `--es text "第一行\n第二行"` |
| 混合内容 | 支持中文、英文、符号混合 | `--es text "Hello世界！"` |

**实现要求**：
- 使用 `InputConnection.commitText()` 直接插入
- 不依赖剪贴板
- 不需要点击操作

### 2.2 发送功能
**优先级：P0（必须）**

| 功能 | 描述 | 示例 |
|------|------|------|
| 发送当前输入 | 模拟发送按键（Enter或Send） | `adb shell "am broadcast -a ai.input.SEND"` |
| 智能发送 | 如果输入框有内容则发送 | - |

**实现要求**：
- 检测当前焦点是否是输入框
- 发送前验证有内容
- 支持两种发送方式：KEYCODE_ENTER 和 app-specific SEND

### 2.3 清空功能
**优先级：P1（重要）**

| 功能 | 描述 | 示例 |
|------|------|------|
| 清空输入框 | 删除当前输入的所有内容 | `adb shell "am broadcast -a ai.input.CLEAR"` |

### 2.4 光标控制
**优先级：P1（重要）**

| 功能 | 描述 | 示例 |
|------|------|------|
| 移动光标 | 上下左右移动 | `adb shell "am broadcast -a ai.input.CURSOR --es direction 'left'"` |
| 选择文本 | 选择指定长度文本 | `adb shell "am broadcast -a ai.input.SELECT --es length '5'"` |

---

## 3. API设计

### 3.1 广播接口

所有操作通过Android广播完成，无需特殊权限。

#### 文本输入
```bash
adb shell "am broadcast -a ai.input.TEXT --es text 'Hello世界'"
```

**参数**：
- `text` (string, 必需) - 要输入的文本

#### 发送消息
```bash
adb shell "am broadcast -a ai.input.SEND"
```

**参数**：无

#### 清空输入
```bash
adb shell "am broadcast -a ai.input.CLEAR"
```

**参数**：无

#### 光标控制
```bash
adb shell "am broadcast -a ai.input.CURSOR --es direction 'left' --es steps '5'"
```

**参数**：
- `direction` (string, 可选) - 方向：`left`, `right`, `up`, `down`
- `steps` (int, 可选) - 移动步数，默认1

#### 批量操作
```bash
adb shell "am broadcast -a ai.input.BATCH --esa commands 'text:你好|send|text:第二行'"
```

**参数**：
- `commands` (string array, 必需) - 命令序列，用`|`分隔

---

## 4. 技术架构

### 4.1 组件结构
```
ClawdInput/
├── app/
│   ├── src/main/java/com/clawd/input/
│   │   ├── ClawdInputService.java    # 主输入法服务
│   │   ├── AIInputReceiver.java      # 广播接收器
│   │   ├── InputHandler.java        # 输入处理逻辑
│   │   └── TextUtils.java          # 文本工具类
│   └── res/                       # 资源文件
├── scripts/
│   ├── clawd_input.py              # Python封装（给AI用）
│   └── install.sh                # 安装脚本
├── docs/
│   ├── API.md                     # API文档
│   └── INTEGRATION.md             # 集成指南
└── README.md
```

### 4.2 核心类设计

#### ClawdInputService.java
```java
public class ClawdInputService extends InputMethodService {
    private InputConnection currentInputConnection;

    @Override
    public void onStartInputView(EditorInfo info, boolean restarting) {
        // 初始化输入法
    }

    @Override
    public void onStartInput(CharSequence text, int cursorPos) {
        // 保存输入连接
        currentInputConnection = getCurrentInputConnection();
    }

    @Override
    public boolean commitText(CharSequence text, int newCursorPosition) {
        // 提交文本到当前应用
        return super.commitText(text, newCursorPosition);
    }

    // 提供输入连接给接收器使用
    public InputConnection getInputConnection() {
        return currentInputConnection;
    }
}
```

#### AIInputReceiver.java
```java
public class AIInputReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        ClawdInputService service = ClawdInputService.getInstance();

        switch (intent.getAction()) {
            case "ai.input.TEXT":
                String text = intent.getStringExtra("text");
                service.commitText(text, 1);
                break;

            case "ai.input.SEND":
                service.sendCurrentInput();
                break;

            case "ai.input.CLEAR":
                service.clearInput();
                break;

            case "ai.input.CURSOR":
                String direction = intent.getStringExtra("direction");
                int steps = intent.getIntExtra("steps", 1);
                service.moveCursor(direction, steps);
                break;
        }
    }
}
```

### 4.3 权限需求

```xml
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
```

---

## 5. 非功能需求

### 5.1 性能
- 文本插入延迟 < 100ms
- 支持最大文本长度 10,000 字符
- 内存占用 < 50MB

### 5.2 可靠性
- 广播接收成功率 > 99%
- 不依赖网络连接
- 失败时提供错误回调

### 5.3 兼容性
- 最低Android版本：API 21 (Android 5.0)
- 推荐版本：API 28 (Android 9.0) 或更高
- 支持输入法框架标准接口

### 5.4 易用性
- 安装后自动启为默认输入法
- 提供状态指示（是否激活）
- 支持通过ADB快速切换

---

## 6. 使用场景

### 6.1 微信中文输入
```bash
# 输入中文消息
adb shell "am broadcast -a ai.input.TEXT --es text '大家好，我是小白！'"
adb shell "am broadcast -a ai.input.SEND"
```

### 6.2 批量消息
```bash
# 发送多条消息
adb shell "am broadcast -a ai.input.BATCH --esa commands 'text:第一条|send|text:第二条|send'"
```

### 6.3 表情输入
```bash
# 输入表情（直接支持Unicode）
adb shell "am broadcast -a ai.input.TEXT --es text '😊🎉'"
```

### 6.4 混合内容
```bash
# 中英混合
adb shell "am broadcast -a ai.input.TEXT --es text 'Pandas are active at 9-10am 🐼'"
adb shell "am broadcast -a ai.input.SEND"
```

---

## 7. Python封装需求

### 7.1 基本接口
```python
#!/usr/bin/env python3
# clawd_input.py

import argparse
import subprocess

def broadcast(action, **kwargs):
    """发送广播到ClawdInput"""
    cmd = f'adb -s {device} shell "am broadcast -a ai.input.{action}"'
    for key, value in kwargs.items():
        cmd += f' --{key} \'{value}\''
    subprocess.run(cmd, shell=True)

# 文本输入
def text_input(device, text):
    broadcast('TEXT', es=text)

# 发送
def send(device):
    broadcast('SEND')

# 清空
def clear(device):
    broadcast('CLEAR')

# 命令行接口
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", default="127.0.0.1:5555")
    parser.add_argument("--text", help="输入文本")
    parser.add_argument("--send", action="store_true", help="发送")
    parser.add_argument("--clear", action="store_true", help="清空")

    args = parser.parse_args()

    if args.text:
        text_input(args.device, args.text)
    if args.clear:
        clear(args.device)
    if args.send:
        send(args.device)
```

### 7.2 使用示例
```bash
# 基础使用
python3 clawd_input.py --device 127.0.0.1:5555 --text "你好"
python3 clawd_input.py --device 127.0.0.1:5555 --send

# 一条命令完成
python3 clawd_input.py --device 127.0.0.1:5555 --text "大家好" --send
```

---

## 8. 测试需求

### 8.1 单元测试
- 文本插入功能
- 光标移动功能
- 清空功能
- 边界条件（空文本、超长文本）

### 8.2 集成测试
- 在BlueStacks上测试
- 在真实Android设备上测试
- 与常见应用兼容性测试（微信、QQ、Telegram）

### 8.3 性能测试
- 连续输入100次无崩溃
- 大文本（10,000字符）处理时间
- 内存泄漏检查

---

## 9. 开发建议

### 9.1 开发工具
- Android Studio（推荐最新版本）
- Java JDK 11 或 Kotlin
- Gradle 8.0+

### 9.2 开发顺序
1. **MVP（1-2天）**
   - [ ] 创建输入法服务框架
   - [ ] 实现基础文本插入
   - [ ] 实现广播接收器
   - [ ] 基础测试

2. **完整功能（2-3天）**
   - [ ] 实现发送功能
   - [ ] 实现清空功能
   - [ ] 实现光标控制
   - [ ] Python封装脚本

3. **测试和优化（1天）**
   - [ ] BlueStacks测试
   - [ ] 真实设备测试
   - [ ] 性能优化
   - [ ] 文档编写

### 9.3 关键注意点
- ✅ **使用InputConnection** - 直接插入，不依赖剪贴板
- ✅ **广播接收器独立** - 不依赖输入法UI
- ✅ **权限最小化** - 只申请必要权限
- ✅ **错误处理** - 提供明确的错误信息
- ⚠️ **线程安全** - InputConnection可能在不同线程调用
- ⚠️ **状态管理** - 处理输入法激活/失活状态

---

## 10. 交付物

### 10.1 代码
- [ ] 完整的Android项目源码
- [ ] Python封装脚本
- [ ] 安装和配置脚本

### 10.2 文档
- [ ] README.md - 项目介绍和快速开始
- [ ] API.md - 完整API文档
- [ ] INTEGRATION.md - 集成指南
- [ ] CHANGELOG.md - 版本历史

### 10.3 测试
- [ ] 单元测试报告
- [ ] 集成测试报告
- [ ] 已测试设备列表

---

## 11. 优先级总结

| 功能 | 优先级 | 原因 |
|------|--------|------|
| 文本输入 | P0 | 核心需求 |
| 发送功能 | P0 | 微信等应用必需 |
| 广播接口 | P0 | AI调用基础 |
| Python封装 | P0 | AI易用性 |
| 清空功能 | P1 | 提升体验 |
| 光标控制 | P1 | 高级场景 |
| 批量操作 | P2 | 优化性能 |
| 表情支持 | P2 | 自然需求 |

---

## 12. 成功标准

### 12.1 功能
- ✅ 可以通过广播输入任意Unicode文本（包括中文）
- ✅ 可以发送输入的内容
- ✅ 支持混合内容（中英文、表情）
- ✅ 操作延迟 < 100ms

### 12.2 可靠性
- ✅ 在BlueStacks上稳定运行
- ✅ 在真实Android设备上测试通过
- ✅ 连续操作100次无崩溃

### 12.3 易用性
- ✅ Python封装脚本简单易用
- ✅ API文档完整清晰
- ✅ 安装流程简单（一键安装）

---

## 附录

### A. 参考资源
- [Android InputMethodService文档](https://developer.android.com/reference/android/view/inputmethod/InputMethodService)
- [InputConnection文档](https://developer.android.com/reference/android/view/inputmethod/InputConnection)
- [Broadcast文档](https://developer.android.com/guide/components/broadcasts)

### B. 类似项目
- FlorisBoard - 现代化开源输入法
- Hacker's Keyboard - 轻量级输入法
- OpenBoard - 简单易扩展的输入法

---

**文档版本**: v1.0
**创建日期**: 2026-01-31
**项目名称**: ClawdInput
**目标用户**: AI助手（如Clawdbot）通过ADB控制Android设备
