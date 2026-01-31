#!/usr/bin/env python3
"""
中文输入ADB工具脚本
支持多种方法在Android设备上输入中文
"""

import argparse
import sys
import subprocess
import tempfile
import os

def encode_text_for_adb(text: str) -> str:
    """
    编码文本以适用于ADB输入
    处理特殊字符和中文
    """
    # 将空格替换为ADB空格编码
    encoded = text.replace(" ", "%s")
    # 处理其他特殊字符
    encoded = (
        encoded.replace("%", "%25")
        .replace("\n", "%0A")
        .replace("\t", "%09")
        .replace("&", "\\&")
        .replace("<", "\\<")
        .replace(">", "\\>")
        .replace("\"", "\\\"")
        .replace("'", "\\'")
    )
    return encoded

def input_method_clipboard(device: str, text: str):
    """
    方法1: 通过剪贴板输入
    """
    try:
        # 设置剪贴板
        cmd_clipboard = f'adb -s {device} shell "am broadcast -a ADB_CLIPBOARD_TEXT --es text \'{text}\'"'
        subprocess.run(cmd_clipboard, shell=True, check=True)

        # 等待剪贴板设置完成
        import time
        time.sleep(0.5)

        # 模拟粘贴操作
        cmd_paste = f'adb -s {device} shell input keyevent KEYCODE_V'
        subprocess.run(cmd_paste, shell=True, check=True)

        print(f"✅ 通过剪贴板输入成功: {text}")
        return True
    except Exception as e:
        print(f"❌ 剪贴板方法失败: {e}")
        return False

def input_method_unicode(device: str, text: str):
    """
    方法2: Unicode编码输入
    """
    try:
        # 转换为Unicode编码点
        unicode_points = [f"0x{ord(c):04x}" for c in text]

        for point in unicode_points:
            cmd = f'adb -s {device} shell input unicode {point}'
            subprocess.run(cmd, shell=True, check=True)

        print(f"✅ Unicode编码输入成功: {text}")
        return True
    except Exception as e:
        print(f"❌ Unicode方法失败: {e}")
        return False

def input_method_text(device: str, text: str):
    """
    方法3: 标准text命令
    """
    try:
        encoded_text = encode_text_for_adb(text)
        cmd = f'adb -s {device} shell input text "{encoded_text}"'
        subprocess.run(cmd, shell=True, check=True)

        print(f"✅ 标准text输入成功: {text}")
        return True
    except Exception as e:
        print(f"❌ 标准text方法失败: {e}")
        return False

def input_method_virtual(device: str, text: str):
    """
    方法4: 虚拟键盘事件序列
    """
    try:
        # 对于"闲鱼"，尝试通过拼音输入法
        pinyin_map = {
            '闲': ['xian'],
            '鱼': ['yu']
        }

        for char, pinyin in pinyin_map.items():
            # 输入拼音
            for letter in pinyin[0]:
                keycode = f'KEYCODE_{letter.upper()}'
                cmd = f'adb -s {device} shell input keyevent {keycode}'
                subprocess.run(cmd, shell=True, check=True)

            # 选择候选字（通常是数字键1）
            cmd = f'adb -s {device} shell input keyevent KEYCODE_1'
            subprocess.run(cmd, shell=True, check=True)

        print(f"✅ 虚拟键盘输入成功: {text}")
        return True
    except Exception as e:
        print(f"❌ 虚拟键盘方法失败: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="ADB中文输入工具")
    parser.add_argument("--device", default="127.0.0.1:5555", help="ADB设备地址")
    parser.add_argument("--text", required=True, help="要输入的中文文本")
    parser.add_argument("--method", choices=["clipboard", "unicode", "text", "virtual", "all"],
                       default="all", help="输入方法")

    args = parser.parse_args()

    methods = []
    if args.method == "all":
        methods = [
            ("剪贴板", input_method_clipboard),
            ("Unicode", input_method_unicode),
            ("标准text", input_method_text),
            ("虚拟键盘", input_method_virtual)
        ]
    else:
        method_map = {
            "clipboard": ("剪贴板", input_method_clipboard),
            "unicode": ("Unicode", input_method_unicode),
            "text": ("标准text", input_method_text),
            "virtual": ("虚拟键盘", input_method_virtual)
        }
        methods = [method_map[args.method]]

    print(f"🔄 开始尝试输入中文: {args.text}")

    for name, method in methods:
        print(f"\n🔍 尝试{name}方法...")
        if method(args.device, args.text):
            print(f"✅ {name}方法成功！")
            return 0
        else:
            print(f"⚠️ {name}方法失败，尝试下一个...")

    print("❌ 所有方法都失败了")
    return 1

if __name__ == "__main__":
    sys.exit(main())