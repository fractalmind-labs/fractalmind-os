#!/usr/bin/env python3

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False


DEFAULT_DEVICE = "127.0.0.1:5555"
DEFAULT_MODEL_URL = "http://127.0.0.1:1234/v1"
DEFAULT_MODEL_NAME = "qwen/qwen3-vl-8b"


@dataclass
class CmdResult:
    ok: bool
    command: List[str]
    stdout: str
    stderr: str
    returncode: int


def _run(cmd: Sequence[str], timeout_s: int) -> CmdResult:
    try:
        p = subprocess.run(
            list(cmd),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
            timeout=timeout_s,
        )
        return CmdResult(
            ok=p.returncode == 0,
            command=list(cmd),
            stdout=(p.stdout or b"").decode("utf-8", errors="replace"),
            stderr=(p.stderr or b"").decode("utf-8", errors="replace"),
            returncode=p.returncode,
        )
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b"").decode("utf-8", errors="replace") if hasattr(e, "stdout") else ""
        err = (e.stderr or b"").decode("utf-8", errors="replace") if hasattr(e, "stderr") else ""
        return CmdResult(ok=False, command=list(cmd), stdout=out, stderr=err + "\nTIMEOUT", returncode=124)


def _run_bytes(cmd: Sequence[str], timeout_s: int) -> Tuple[int, bytes, bytes]:
    p = subprocess.run(
        list(cmd),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout_s,
    )
    return p.returncode, p.stdout or b"", p.stderr or b""


def _adb_base(adb: str, device: str) -> List[str]:
    return [adb, "-s", device]


def get_accurate_screen_info(adb: str, device: str, screenshot_path: Optional[str] = None) -> dict:
    """获取精确屏幕信息，优先使用截图尺寸"""

    # 方法1：从截图获取精确尺寸（最准确）
    if screenshot_path and os.path.exists(screenshot_path) and PIL_AVAILABLE:
        try:
            with Image.open(screenshot_path) as img:
                actual_width, actual_height = img.size
                print(f"✅ 从截图获取精确尺寸: {actual_width}x{actual_height}", file=sys.stderr)
                # 从截图获取尺寸后，继续获取密度信息
                density = get_screen_density_via_adb(adb, device)
                return {
                    "width": actual_width,
                    "height": actual_height,
                    "density": density,
                    "aspect_ratio": actual_width / actual_height,
                    "source": "screenshot"
                }
        except Exception as e:
            print(f"⚠️ 从截图获取尺寸失败: {e}", file=sys.stderr)

    # 方法2：使用ADB命令（备用方案）
    try:
        width, height = get_screen_size_via_adb(adb, device)
        density = get_screen_density_via_adb(adb, device)
        return {
            "width": width,
            "height": height,
            "density": density,
            "aspect_ratio": width / height,
            "source": "adb"
        }
    except Exception as e:
        print(f"⚠️ ADB获取屏幕信息失败: {e}", file=sys.stderr)
        # 方法3：使用默认值
        return {
            "width": 1080,
            "height": 2400,
            "density": 420,
            "aspect_ratio": 1080 / 2400,
            "source": "default"
        }


def get_screen_size_via_adb(adb: str, device: str) -> Tuple[int, int]:
    """通过ADB获取屏幕尺寸"""
    base = _adb_base(adb, device)

    # 方法1：wm size 命令
    cmd_res = _run(base + ["shell", "wm", "size"], timeout_s=10)
    if cmd_res.ok:
        # 输出格式: Physical size: 1080x2400
        match = re.search(r'Physical size: (\d+)x(\d+)', cmd_res.stdout)
        if match:
            width, height = int(match.group(1)), int(match.group(2))
            return width, height

    # 方法2：dumpsys window displays 命令
    cmd_res = _run(base + ["shell", "dumpsys", "window", "displays"], timeout_s=10)
    width, height = parse_display_info(cmd_res.stdout)
    if width != 1080 or height != 2400:  # 如果不是默认值，说明解析成功
        return width, height

    # 方法3：dumpsys window 命令
    cmd_res = _run(base + ["shell", "dumpsys", "window"], timeout_s=10)
    match = re.search(r'mUnrestrictedScreen=\((\d+),(\d+)\)', cmd_res.stdout)
    if match:
        return int(match.group(1)), int(match.group(2))

    # 返回默认值
    return 1080, 2400


def get_screen_density_via_adb(adb: str, device: str) -> int:
    """通过ADB获取屏幕密度"""
    base = _adb_base(adb, device)

    density_res = _run(base + ["shell", "wm", "density"], timeout_s=10)
    if density_res.ok:
        # 输出格式: Physical density: 420
        density_match = re.search(r'Physical density: (\d+)', density_res.stdout)
        if density_match:
            return int(density_match.group(1))

    return 420  # 默认值


def get_screen_info(adb: str, device: str) -> dict:
    """获取设备屏幕信息（保持向后兼容）"""
    return get_accurate_screen_info(adb, device)


def convert_relative_to_absolute(rel_x: int, rel_y: int, screen_width: int, screen_height: int) -> Tuple[int, int]:
    """
    将相对坐标(0-999)转换为绝对像素坐标

    Args:
        rel_x: 相对X坐标 (0-999)
        rel_y: 相对Y坐标 (0-999)
        screen_width: 屏幕宽度(像素)
        screen_height: 屏幕高度(像素)

    Returns:
        (abs_x, abs_y): 绝对像素坐标
    """
    # 边界检查（采用 Open-AutoGLM 风格：0-999，避免 1000 映射到 width/height 越界）
    rel_x = max(0, min(999, rel_x))
    rel_y = max(0, min(999, rel_y))

    # 转换为绝对坐标
    abs_x = int(rel_x / 1000 * screen_width)
    abs_y = int(rel_y / 1000 * screen_height)

    return abs_x, abs_y


def convert_absolute_to_relative(abs_x: int, abs_y: int, screen_width: int, screen_height: int) -> Tuple[int, int]:
    """
    将绝对像素坐标转换为相对坐标(0-999)

    Args:
        abs_x: 绝对X坐标(像素)
        abs_y: 绝对Y坐标(像素)
        screen_width: 屏幕宽度(像素)
        screen_height: 屏幕高度(像素)

    Returns:
        (rel_x, rel_y): 相对坐标 (0-999)
    """
    # 边界检查
    abs_x = max(0, min(screen_width - 1, abs_x))
    abs_y = max(0, min(screen_height - 1, abs_y))

    # 转换为相对坐标
    rel_x = int(abs_x * 1000 / screen_width)
    rel_y = int(abs_y * 1000 / screen_height)

    return rel_x, rel_y


def validate_coordinates(x: int, y: int, screen_width: int, screen_height: int) -> Tuple[int, int, bool]:
    """
    验证并修正坐标

    Args:
        x: X坐标
        y: Y坐标
        screen_width: 屏幕宽度
        screen_height: 屏幕高度

    Returns:
        (valid_x, valid_y, was_corrected): 修正后的坐标和是否被修正的标志
    """
    original_x, original_y = x, y

    # 边界修正
    valid_x = max(0, min(screen_width - 1, x))
    valid_y = max(0, min(screen_height - 1, y))

    # 软边界检查（避免过于边缘的坐标）
    safe_margin_x = screen_width * 0.05  # 5% 边界
    safe_margin_y_top = screen_height * 0.1  # 顶部10%为状态栏
    safe_margin_y_bottom = screen_height * 0.1  # 底部10%为导航栏

    # 软边界警告（但不强制修正）
    warnings = []
    if x < safe_margin_x or x > screen_width - safe_margin_x:
        warnings.append(f"X坐标接近屏幕边缘: {x}")
    if y < safe_margin_y_top:
        warnings.append(f"Y坐标接近状态栏区域: {y}")
    if y > screen_height - safe_margin_y_bottom:
        warnings.append(f"Y坐标接近导航栏区域: {y}")

    was_corrected = (original_x != valid_x or original_y != valid_y)

    if warnings:
        print(f"⚠️ 坐标警告: {'; '.join(warnings)}", file=sys.stderr)

    return valid_x, valid_y, was_corrected


def parse_relative_coordinates_from_text(description: str, screen_info: dict) -> List[dict]:
    """
    从文本描述中解析相对坐标信息

    Args:
        description: 视觉模型输出的文本描述
        screen_info: 屏幕信息，用于坐标转换

    Returns:
        包含相对坐标的元素列表
    """
    elements = []

    # 匹配相对坐标模式：🎯 相对坐标：(500, 300)
    rel_coord_pattern = r'🎯 相对坐标：\((\d+),\s*(\d+)\)'
    # 匹配绝对坐标模式：🎯 坐标：(540, 300) - 向后兼容
    abs_coord_pattern = r'🎯 坐标：\((\d+),\s*(\d+)\)'
    # 匹配命令模式：python3 scripts/phone_control.py tap
    command_pattern = r'💻 命令：([^📝\n]+)'
    # 匹配元素描述：**搜索框**
    element_pattern = r'\*\*(.+?)\*\*'
    # 匹配优先级：(高优先级)
    priority_pattern = r'\((高|中|低)优先级\)'

    lines = description.split('\n')
    current_element = {}

    for line in lines:
        # 查找元素标题行（数字开头，包含**）
        if re.match(r'^\d+\.', line.strip()) and '**' in line:
            # 保存前一个元素（如果有）
            if current_element:
                elements.append(current_element)

            # 提取元素描述
            element_match = re.search(r'\*\*(.+?)\*\*', line)
            priority_match = re.search(priority_pattern, line)

            current_element = {
                'description': element_match.group(1) if element_match else line.strip(),
                'type': 'unknown',
                'priority': 'medium'
            }

            if priority_match:
                priority_map = {'高': 'high', '中': 'medium', '低': 'low'}
                current_element['priority'] = priority_map.get(priority_match.group(1), 'medium')

        # 优先匹配相对坐标
        elif '🎯 相对坐标：' in line and current_element:
            coord_match = re.search(rel_coord_pattern, line)
            if coord_match:
                rel_x, rel_y = int(coord_match.group(1)), int(coord_match.group(2))
                current_element['relative_coordinates'] = {
                    'x': rel_x,
                    'y': rel_y
                }
                # 同时计算绝对坐标供使用
                abs_x, abs_y = convert_relative_to_absolute(rel_x, rel_y, screen_info['width'], screen_info['height'])
                current_element['coordinates'] = {
                    'x': abs_x,
                    'y': abs_y
                }

        # 向后兼容：绝对坐标
        elif '🎯 坐标：' in line and current_element and 'coordinates' not in current_element:
            coord_match = re.search(abs_coord_pattern, line)
            if coord_match:
                abs_x, abs_y = int(coord_match.group(1)), int(coord_match.group(2))
                # 转换为相对坐标
                rel_x, rel_y = convert_absolute_to_relative(abs_x, abs_y, screen_info['width'], screen_info['height'])
                current_element['coordinates'] = {
                    'x': abs_x,
                    'y': abs_y
                }
                current_element['relative_coordinates'] = {
                    'x': rel_x,
                    'y': rel_y
                }

        elif '💻 命令：' in line and current_element:
            cmd_match = re.search(command_pattern, line)
            if cmd_match:
                current_element['command'] = cmd_match.group(1).strip()

    # 添加最后一个元素
    if current_element:
        elements.append(current_element)

    return elements


def parse_display_info(dumpsys_output: str) -> Tuple[int, int]:
    """从dumpsys输出中解析屏幕信息"""
    # 简单的解析逻辑，可根据需要扩展
    import re
    # 查找类似 "init=1080x2400" 的模式
    match = re.search(r'init=(\d+)x(\d+)', dumpsys_output)
    if match:
        return int(match.group(1)), int(match.group(2))
    return 1080, 2400  # 默认值


def capture_screenshot(adb: str, device: str, timeout_s: int, output_path: Optional[str] = None) -> str:
    if output_path is None:
        fd, output_path = tempfile.mkstemp(prefix="phone_screen_", suffix=".png")
        os.close(fd)

    base = _adb_base(adb, device)

    # Preferred: stream png via exec-out.
    try:
        rc, out, err = _run_bytes(base + ["exec-out", "screencap", "-p"], timeout_s=timeout_s)
        if rc == 0 and out:
            with open(output_path, "wb") as f:
                f.write(out)
            return output_path
    except FileNotFoundError:
        raise RuntimeError(f"adb not found at '{adb}'")
    except subprocess.TimeoutExpired:
        pass

    # Fallback: write to device then pull.
    remote = f"/sdcard/phone_screen_{int(time.time())}.png"
    r1 = _run(base + ["shell", "screencap", "-p", remote], timeout_s=timeout_s)
    if not r1.ok:
        raise RuntimeError(f"Failed to capture screenshot: {r1.stderr.strip() or r1.stdout.strip()}")
    r2 = _run(base + ["pull", remote, output_path], timeout_s=timeout_s)
    _run(base + ["shell", "rm", "-f", remote], timeout_s=timeout_s)
    if not r2.ok:
        raise RuntimeError(f"Failed to pull screenshot: {r2.stderr.strip() or r2.stdout.strip()}")
    return output_path


def _post_json(url: str, payload: Dict[str, Any], timeout_s: int) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            data = resp.read()
            return json.loads(data.decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code} calling {url}: {err_body}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Failed to connect to {url}: {e}")


def describe_screenshot(
    image_path: str,
    model_url: str,
    model_name: str,
    prompt: str,
    timeout_s: int,
    max_tokens: int,
    temperature: float,
) -> str:
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")

    payload = {
        "model": model_name,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{b64}"},
                    },
                ],
            }
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    data = _post_json(model_url.rstrip("/") + "/chat/completions", payload, timeout_s=timeout_s)
    try:
        return data["choices"][0]["message"]["content"]
    except Exception:
        raise RuntimeError(f"Unexpected response shape: {json.dumps(data, ensure_ascii=False)[:2000]}")


DEFAULT_PROMPT = (
    "You are viewing an Android phone screenshot. "
    "Describe what is on the screen, list the most important visible UI elements (buttons, tabs, input fields), "
    "and suggest 1-3 possible next actions a user might take. "
    "If you can infer likely labels (e.g., 'Search', 'Cancel'), include them. "
    "Answer in Chinese."
)


def create_relative_coordinate_prompt(base_prompt: str, screen_info: dict) -> str:
    """创建使用相对坐标系统的增强prompt"""

    return f"""
{base_prompt}

**额外任务：识别可点击元素并输出相对坐标信息**

**极其重要：严格使用相对坐标系统**
- **坐标范围：严格限制在 0-999 之间 (绝对不能超过999)**
- ** (0,0) = 屏幕左上角，(999,999) = 屏幕右下角**
- **示例：屏幕中心的按钮坐标约为 (500, 500)**
- **注意：(999,999) 已经是右下角边缘，坐标绝对不能大于999**
- **请完全忽略绝对像素坐标，只使用0-999的相对坐标系统**

**请识别所有可交互元素并提供以下信息：**
1. 元素类型（按钮、输入框、链接、标签等）
2. 相对坐标 (严格限制在0-999范围内)
3. 元素的重要性排序（高/中/低）
4. 直接可执行的相对坐标命令

**输出格式（自然语言描述 + 结构化相对坐标信息）：**

【屏幕描述部分】
（使用原有格式描述屏幕内容和可见元素）

【可交互元素部分】
1. 🔥 **搜索框** (高优先级)
   🎯 相对坐标：(500, 150) // 屏幕中上区域
   💻 命令：python3 scripts/phone_control.py tap --relative 500 150
   📝 说明：点击搜索框开始搜索

2. ⭐ **Trending标签** (中优先级)
   🎯 相对坐标：(300, 200) // 相对位置
   💻 命令：python3 scripts/phone_control.py tap --relative 300 200
   📝 说明：查看热门趋势内容

**最终检查规则：**
- 在输出每个坐标前，必须检查：0 ≤ x ≤ 999 且 0 ≤ y ≤ 999
- 如果某个元素的坐标超出999，必须将其调整为999或更小的值
- 例如：屏幕最右侧的元素应该是x=990而不是x=1045

【推荐操作序列】
💡 建议操作序列（使用相对坐标）：
- 搜索特定内容：python3 scripts/phone_control.py tap --relative 500 150 → python3 scripts/phone_control.py text "搜索内容"
- 查看热门：python3 scripts/phone_control.py tap --relative 300 200

**相对坐标区域参考（严格遵循0-999范围）：**
- 状态栏区域：y < 70 (顶部7%区域)
- 主要内容区域：100 < y < 850 (中间75%区域)
- 底部导航栏区域：y > 900 (底部10%区域)
- 左右安全边界：x > 50 且 x < 950 (避免过于边缘)
- 中心区域：400 < x < 600 且 300 < y < 700 (屏幕中央三分之一区域)

**坐标精度要求（严格约束）：**
- **所有坐标值必须在 0-999 范围内**
- 使用相对坐标确保跨设备兼容性
- 避免过于接近边缘的坐标（<50 或 >950）
- 考虑手指点击的容错性，优先选择元素中心区域
- 小按钮使用更精确的坐标，大按钮可以使用稍宽松的坐标
- **检查：坐标值绝对不能超过999，这是硬性限制**
"""


def create_enhanced_prompt(base_prompt: str, screen_info: dict) -> str:
    """创建包含坐标信息的增强prompt（保持向后兼容）"""
    return create_relative_coordinate_prompt(base_prompt, screen_info)


def parse_coordinates_from_text(description: str) -> List[dict]:
    """从文本描述中解析坐标信息（启发式方法）"""
    elements = []

    # 匹配坐标模式：(540, 300)
    coord_pattern = r'🎯 坐标：\((\d+),\s*(\d+)\)'
    # 匹配命令模式：python3 scripts/phone_control.py tap
    command_pattern = r'💻 命令：([^📝\n]+)'
    # 匹配元素描述：**搜索框**
    element_pattern = r'\*\*(.+?)\*\*'
    # 匹配优先级：(高优先级)
    priority_pattern = r'\((高|中|低)优先级\)'

    lines = description.split('\n')
    current_element = {}

    for line in lines:
        # 查找元素标题行（数字开头，包含**）
        if re.match(r'^\d+\.', line.strip()) and '**' in line:
            # 保存前一个元素（如果有）
            if current_element:
                elements.append(current_element)

            # 提取元素描述
            element_match = re.search(r'\*\*(.+?)\*\*', line)
            priority_match = re.search(priority_pattern, line)

            current_element = {
                'description': element_match.group(1) if element_match else line.strip(),
                'type': 'unknown',
                'priority': 'medium'
            }

            if priority_match:
                priority_map = {'高': 'high', '中': 'medium', '低': 'low'}
                current_element['priority'] = priority_map.get(priority_match.group(1), 'medium')

        elif '🎯 坐标：' in line and current_element:
            coord_match = re.search(coord_pattern, line)
            if coord_match:
                current_element['coordinates'] = {
                    'x': int(coord_match.group(1)),
                    'y': int(coord_match.group(2))
                }

        elif '💻 命令：' in line and current_element:
            cmd_match = re.search(command_pattern, line)
            if cmd_match:
                current_element['command'] = cmd_match.group(1).strip()

    # 添加最后一个元素
    if current_element:
        elements.append(current_element)

    return elements


def save_coordinates_to_file(coords_data: dict, screen_info: dict, output_path: str) -> None:
    """保存坐标信息到文件"""
    data = {
        "timestamp": time.time(),
        "screen_info": screen_info,
        "coordinates": coords_data
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="phone_view.py",
        description="Capture phone screen and (optionally) describe it with a local vision-capable model.",
    )
    p.add_argument("--adb", default="adb", help="Path to adb (default: adb)")
    p.add_argument("--device", default=DEFAULT_DEVICE, help=f"ADB device serial (default: {DEFAULT_DEVICE})")
    p.add_argument("--timeout", type=int, default=120, help="ADB/model timeout in seconds (default: 120)")
    p.add_argument("--output", default=None, help="Output screenshot path (.png). If omitted, a temp file is used.")
    p.add_argument("--json", action="store_true", help="Print machine-readable JSON output")
    p.add_argument("--base64", action="store_true", help="Include base64 image in JSON output")

    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("capture", help="Capture screenshot to a file")

    desc = sub.add_parser("describe", help="Capture screenshot then describe it via local model")
    desc.add_argument("--model-url", default=DEFAULT_MODEL_URL, help=f"LM Studio/OpenAI-compatible base URL (default: {DEFAULT_MODEL_URL})")
    desc.add_argument("--model-name", default=DEFAULT_MODEL_NAME, help=f"Model name (default: {DEFAULT_MODEL_NAME})")
    desc.add_argument("--prompt", default=DEFAULT_PROMPT, help="Prompt for the vision model")
    desc.add_argument("--focus", help="Focus point for analysis (added to prompt directly)")
    desc.add_argument("--max-tokens", type=int, default=800, help="Max tokens for the response")
    desc.add_argument("--temperature", type=float, default=0.2, help="Sampling temperature")

    # 新增参数：坐标输出功能
    coords_group = desc.add_mutually_exclusive_group()
    coords_group.add_argument(
        "--with-coords",
        dest="with_coords",
        action="store_true",
        help="Include clickable coordinates in the output (default: enabled)",
    )
    coords_group.add_argument(
        "--no-coords",
        dest="with_coords",
        action="store_false",
        help="Disable clickable coordinates in the output",
    )
    desc.set_defaults(with_coords=True)
    desc.add_argument("--coords-format", choices=["text", "json"], default="text",
                     help="Output format for coordinates (default: text)")
    desc.add_argument("--save-coords", action="store_true",
                     help="Save coordinates to a separate file")

    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)

    try:
        path = capture_screenshot(args.adb, args.device, timeout_s=args.timeout, output_path=args.output)
    except Exception as e:
        print(str(e), file=sys.stderr)
        return 1

    result: Dict[str, Any] = {
        "ok": True,
        "device": args.device,
        "image_path": path,
    }

    if args.cmd == "capture":
        if args.json:
            if args.base64:
                with open(path, "rb") as f:
                    result["image_base64"] = base64.b64encode(f.read()).decode("ascii")
            print(json.dumps(result, ensure_ascii=False))
        else:
            print(path)
        return 0

    if args.cmd == "describe":
        # 获取屏幕信息（如果需要坐标）- 使用截图路径获取精确信息
        screen_info = None
        if args.with_coords:
            try:
                # 使用截图路径获取精确屏幕信息
                screen_info = get_accurate_screen_info(args.adb, args.device, path)
                print(f"📱 屏幕尺寸：{screen_info['width']}x{screen_info['height']} (来源: {screen_info['source']})", file=sys.stderr)
            except Exception as e:
                print(f"⚠️ 无法获取屏幕信息，使用默认值：{e}", file=sys.stderr)
                screen_info = {"width": 1080, "height": 2400, "density": 420, "source": "default"}

        # 构建最终prompt
        final_prompt = args.prompt

        # 如果有focus参数，直接拼接到prompt后面
        if hasattr(args, 'focus') and args.focus:
            final_prompt = f"{args.prompt}\n\n**特别关注：{args.focus}**"

        # 生成智能prompt
        if args.with_coords:
            enhanced_prompt = create_enhanced_prompt(final_prompt, screen_info)
            enhanced_max_tokens = args.max_tokens * 2  # 增加token限制
        else:
            enhanced_prompt = final_prompt
            enhanced_max_tokens = args.max_tokens

        try:
            desc = describe_screenshot(
                image_path=path,
                model_url=args.model_url,
                model_name=args.model_name,
                prompt=enhanced_prompt,
                timeout_s=args.timeout,
                max_tokens=enhanced_max_tokens,
                temperature=args.temperature,
            )
        except Exception as e:
            print(str(e), file=sys.stderr)
            return 2

        result["description"] = desc

        # 格式化输出
        if args.json:
            if args.base64:
                with open(path, "rb") as f:
                    result["image_base64"] = base64.b64encode(f.read()).decode("ascii")

            # 如果包含坐标信息，添加额外数据
            if args.with_coords:
                result["screen_info"] = screen_info
                # 使用新的相对坐标解析器
                result["clickable_elements"] = parse_relative_coordinates_from_text(desc, screen_info)

            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            # 文本格式输出
            output_text = desc

            # 如果需要JSON格式的坐标信息
            if args.with_coords and args.coords_format == "json":
                coords_data = parse_relative_coordinates_from_text(desc, screen_info)
                if coords_data:
                    coord_json = json.dumps(coords_data, ensure_ascii=False, indent=2)
                    output_text += f"\n\n🎯 **坐标信息 (JSON格式)：**\n```json\n{coord_json}\n```"

            print(output_text)

            # 保存坐标信息（可选）
            if args.with_coords and args.save_coords:
                coords_data = parse_relative_coordinates_from_text(desc, screen_info)
                if coords_data:
                    coords_file = f"screen_coords_{int(time.time())}.json"
                    save_coordinates_to_file({"elements": coords_data}, screen_info, coords_file)
                    print(f"💾 坐标信息已保存到：{coords_file}", file=sys.stderr)

        return 0

    print(f"Unknown command: {args.cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
