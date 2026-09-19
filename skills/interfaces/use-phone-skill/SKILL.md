---
name: use-phone
description: 本地 Android 手机/模拟器控制与屏幕查看（ADB + 可选本地视觉模型）。仅提供两个脚本：phone_control.py 与 phone_view.py。
license: MIT
---

# Use-Phone

该技能只提供三个脚本：

- `scripts/phone_control.py`：手机/模拟器操作（ADB 指令封装）
- `scripts/phone_view.py`：基于截图的屏幕查看（可选调用本地视觉模型做描述）
- `scripts/chinese_input.py`：中文文本输入解决方案（剪贴板广播方法）

## 工作流（Flowchart）

```mermaid
flowchart TD
  A[调用者] --> B[phone_control.py 或 phone_view.py]
  B -->|控制| C[ADB 执行 tap/swipe/key/text/app]
  C -->|默认: --wait 1.5s| D[智能等待]
  C -->|可选: --wait X| D
  C -->|可选: --wait 0| D
  D --> E[动态超时管理]
  E -->|剩余超时计算| F[phone_view.py describe]
  B -->|查看| F
  F --> G[截图 + 精确坐标(0-999) + AI分析]
  G --> H[输出: 文本 或 JSON]
  subgraph "超时管理"
    I[总超时: 130秒] --> J[操作耗时]
    J --> K[等待时间]
    K --> L[AI分析时间]
  end
```

## 前置条件

1. 本机已安装 `adb`
2. Android 设备/模拟器已开启 ADB 调试，并可通过 `--device` 访问（默认 `127.0.0.1:5555`）
3. （推荐）LM Studio 运行中，并提供 OpenAI 兼容接口（默认 `http://127.0.0.1:1234/v1`）
4. （推荐）使用支持视觉的AI模型，如：
   - **推荐**: `qwen/qwen3-vl-8b` (坐标准确性高，支持中文)
   - 可选: `microsoft_fara-7b` (兼容性好)
   - 其他支持视觉的模型

## 用法

### 1) 手机操作：phone_control.py

先看帮助：

```bash
python3 scripts/phone_control.py --help
```

示例：

```bash
python3 scripts/phone_control.py connect
python3 scripts/phone_control.py tap 540 960
python3 scripts/phone_control.py swipe 540 1500 540 600 --duration 300
python3 scripts/phone_control.py text "hello world"
python3 scripts/phone_control.py key back
python3 scripts/phone_control.py app wechat

# 默认会自动查看屏幕内容（auto-view 默认启用，默认等待1.5秒）
python3 scripts/phone_control.py tap 540 960
python3 scripts/phone_control.py app settings

# 自定义等待时间（覆盖默认的1.5秒）
python3 scripts/phone_control.py --wait 3 tap 540 960  # 等待3秒
python3 scripts/phone_control.py --wait 0.5 swipe 540 800 540 400  # 快速动画
python3 scripts/phone_control.py --wait 0 app settings  # 立即查看

# 如需关闭自动查看：
python3 scripts/phone_control.py --no-auto-view tap 540 960

# 调整总超时时间（默认130秒）
python3 scripts/phone_control.py --timeout 180 app x  # 3分钟超时
```

#### 高级用法

**智能等待**：`--wait` 参数控制UI响应后的等待时间：

```bash
# 默认等待1.5秒（适合大多数操作）
python3 scripts/phone_control.py tap 540 960

# 立即查看（覆盖默认等待）
python3 scripts/phone_control.py --wait 0 tap 540 960

# 快速动画（短等待）
python3 scripts/phone_control.py --wait 0.5 swipe 540 800 540 400

# 应用启动（长等待）
python3 scripts/phone_control.py --wait 3 app x

# 页面导航（中等等待）
python3 scripts/phone_control.py --wait 2.5 tap 540 960
```

**参数说明**：
- `--wait SECONDS`：等待时间（秒），支持小数（默认：1.5）
- 范围限制：0-60 秒
- 在操作执行后、屏幕分析前等待
- 动态超时管理：总超时时间会自动减去等待和操作时间

**使用场景建议**：
- **默认操作**：使用默认1.5秒（适合大部分UI操作）
- **应用启动**：`--wait 2-3` （等待应用完全加载）
- **页面导航**：`--wait 1-2` （等待页面渲染完成）
- **动画效果**：`--wait 0.3-0.8` （等待动画结束）
- **即时响应**：`--wait 0` （立即分析，适用于静态界面）

**focus参数组合使用**：
```bash
# 关注点 + 坐标检测
python3 scripts/phone_view.py describe --focus "分析所有按钮"

# 关注点 + JSON输出
python3 scripts/phone_view.py describe --focus "提取所有文本" --json

# 关注点 + 坐标保存
python3 scripts/phone_view.py describe --focus "输入框分析" --save-coords

# 复杂关注点 + 所有功能
python3 scripts/phone_view.py describe --focus "分析右上角区域内的错误信息" --with-coords --coords-format json
# 如需关闭坐标输出：
python3 scripts/phone_view.py describe --no-coords
```

### 2) 屏幕查看：phone_view.py

截图保存路径（输出文件路径）：

```bash
python3 scripts/phone_view.py capture
```

截图并用本地视觉模型描述当前屏幕：

```bash
# 使用推荐的qwen模型（坐标准确性最高）
python3 scripts/phone_view.py describe --model-name qwen/qwen3-vl-8b

# 使用兼容模型
python3 scripts/phone_view.py describe --model-name microsoft_fara-7b

# 直接使用（默认已改为qwen/qwen3-vl-8b）
python3 scripts/phone_view.py describe
```

### 3) 中文输入：chinese_input.py

**问题说明**：ADB `input text` 命令只支持ASCII字符，无法直接输入中文等Unicode字符。

**解决方案**：使用剪贴板广播方法绕过输入法限制。

#### 基本用法

```bash
# 使用剪贴板方法输入中文（推荐）
python3 scripts/chinese_input.py --text "马斯克最新推文分析" --method clipboard

# 智能输入（自动选择最佳方法）
python3 scripts/chinese_input.py --text "混合内容Mixed123" --method smart

# 测试所有输入方法
python3 scripts/chinese_input.py --text "测试中文" --method all
```

#### 高级用法

```bash
# 指定设备
python3 scripts/chinese_input.py --device 127.0.0.1:5555 --text "你好世界"

# 只输出不执行
python3 scripts/chinese_input.py --text "测试文本" --dry-run

# 调试模式显示详细输出
python3 scripts/chinese_input.py --text "测试" --method all --verbose
```

#### 中文输入方法说明

**剪贴板方法（推荐）**：
- 兼容性最强，支持所有Android版本
- 无需特定输入法
- 适用于纯中文和混合文本

**Unicode方法**：
- 适用于系统级输入
- 需要Android 8.0+支持
- 部分特殊字符可能不支持

**智能混合方法**：
- 根据内容自动选择最佳输入方式
- ASCII字符直接输入，中文使用剪贴板
- 性能最优

#### 集成使用

```bash
# 配合phone_control.py使用
python3 scripts/chinese_input.py --text "搜索关键词"
python3 scripts/phone_control.py tap 540 200  # 点击搜索框
python3 scripts/phone_control.py key back      # 返回
```

#### 增强功能

**屏幕描述与坐标检测**：获取可点击元素的精确坐标：

```bash
# 默认会输出坐标信息（with-coords 默认启用）
python3 scripts/phone_view.py describe

# JSON格式输出坐标
python3 scripts/phone_view.py describe --coords-format json

# 保存坐标到文件
python3 scripts/phone_view.py describe --save-coords
```

**关注点参数**：`--focus` 参数让AI关注特定内容，完全通用灵活：

```bash
# 文本提取
python3 scripts/phone_view.py describe --focus "提取所有中文文本内容"

# 错误检测
python3 scripts/phone_view.py describe --focus "识别所有错误信息和警告提示"

# 坐标区域分析
python3 scripts/phone_view.py describe --focus "分析区域 (100,200,500,600) 内的所有元素"

# UI元素分析
python3 scripts/phone_view.py describe --focus "分析所有按钮的状态和功能"

# 位置分析
python3 scripts/phone_view.py describe --focus "分析顶部导航栏的设计和交互"

# 自定义关注点
python3 scripts/phone_view.py describe --focus "用户提出的任何具体关注点"
```

> 注意：`--focus` 仅适用于 `phone_view.py describe`（它会被直接拼接到视觉模型的提示词里）。

**智能等待机制**：根据场景设置等待时间，确保UI稳定后再分析：

```bash
# 配合 auto-view 使用智能等待
python3 scripts/phone_control.py --wait 2 tap 540 960
```

## 性能优化与改进

### 坐标系统优化
- **相对坐标系统**：所有坐标严格限制在0-999范围内
- **跨设备兼容**：基于屏幕比例而非绝对像素，适配不同分辨率
- **坐标准确性**：推荐使用`qwen/qwen3-vl-8b`模型，确保坐标精度

### 超时管理机制
- **默认超时**：130秒（从60秒提升）
- **动态分配**：操作耗时 + 等待时间 + AI分析时间
- **智能计算**：自动扣除操作和等待时间，剩余时间用于AI分析
- **最低保障**：确保AI分析至少有10秒处理时间

### 等待策略优化
- **默认等待**：1.5秒（从0秒提升）
- **场景适配**：根据操作类型自动选择合适的等待时间
- **UI稳定性**：确保屏幕分析在界面完全渲染后进行

### 推荐配置
```bash
# 生产环境推荐设置
export DEFAULT_MODEL="qwen/qwen3-vl-8b"  # 最佳坐标准确性
export DEFAULT_TIMEOUT=130               # 充足的处理时间
export DEFAULT_WAIT=1.5                 # 合理的UI等待时间
```

### 故障排除
1. **auto-view超时**：增加`--timeout`参数或使用`--wait 0`减少等待时间
2. **坐标不准确**：确保使用推荐的AI模型
3. **连接问题**：检查ADB设备和IP地址配置
4. **中文输入失败**：
   - 确保设备已连接并开启ADB调试
   - 检查应用是否支持剪贴板粘贴
   - 某些应用可能禁用剪贴板访问，可尝试切换到其他输入法
   - 使用`--verbose`参数查看详细错误信息

### 技术限制说明
- **ADB输入限制**：`adb shell input text`只支持ASCII字符，无法直接输入Unicode字符
- **权限要求**：剪贴板广播需要系统权限，部分Android版本可能需要手动授权
- **应用兼容性**：个别应用（如银行类App）可能禁用剪贴板功能作为安全措施
- **字符编码**：确保终端和系统支持UTF-8编码以正确处理中文字符

