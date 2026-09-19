#!/usr/bin/env python3
"""
Qwen Cloud Video Analyzer
Analyzes UI recordings using Alibaba Cloud DashScope API

Usage:
    DASHSCOPE_API_KEY=sk-xxx python qwen-analyze-video.py <video-path>
"""

import os
import sys
import json
import base64
import time
from pathlib import Path
from openai import OpenAI

ANALYSIS_PROMPT = """Analyze this UI animation recording in extreme detail. Extract:

## 1. Visual Theme & Colors
- Background colors (hex codes)
- Text colors and hierarchy
- Accent colors and their usage
- Gradients and transparency values

## 2. Animated Elements
For each animated element, provide:
- Element description (e.g., "price number", "chart line", "button")
- Animation type (fade, slide, scale, rotate, color change)
- Duration (milliseconds)
- Easing function (linear, ease-out, cubic-bezier with values)
- Trigger (on load, on hover, on scroll, continuous loop)

## 3. Layout & Spacing
- Container dimensions
- Padding and margins (px)
- Grid/flexbox patterns
- Responsive breakpoints (if visible)

## 4. Typography
- Font families
- Font sizes (px/rem)
- Font weights
- Line heights
- Letter spacing

## 5. Interactive States
- Hover effects (color, transform, shadow)
- Click/active states
- Focus indicators
- Loading states

## 6. Data Visualization (if present)
- Chart type (line, area, bar, candlestick)
- Color scheme
- Axis labels and formatting
- Tooltip design
- Real-time update patterns

## 7. Micro-interactions
- Button press animations
- Number rolling/counting effects
- Smooth scrolling behavior
- Cursor interactions

Format your response as structured JSON with precise measurements. Be extremely detailed - every pixel and millisecond matters for pixel-perfect replication."""


def analyze_video(video_path: str, api_key: str, region: str = 'cn') -> dict:
    """Analyze video using Qwen VL Plus model"""

    video_file = Path(video_path)
    if not video_file.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    print(f"📹 Reading video: {video_path}")
    with open(video_path, 'rb') as f:
        video_data = f.read()

    video_base64 = base64.b64encode(video_data).decode('utf-8')
    video_size_mb = len(video_data) / 1024 / 1024
    print(f"📦 Video size: {video_size_mb:.2f} MB")

    # Region-specific endpoints
    endpoints = {
        'cn': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        'intl': 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        'us': 'https://dashscope-us.aliyuncs.com/compatible-mode/v1'
    }

    client = OpenAI(
        api_key=api_key,
        base_url=endpoints.get(region, endpoints['cn'])
    )
    print(f"🌍 Using {region} region: {endpoints.get(region, endpoints['cn'])}")

    print('🚀 Sending to Qwen VL Plus...')
    start_time = time.time()

    try:
        completion = client.chat.completions.create(
            model="qwen-vl-plus",
            messages=[
                {
                    'role': 'user',
                    'content': [
                        {
                            'type': 'video',
                            'video': f'data:video/webm;base64,{video_base64}'
                        },
                        {
                            'type': 'text',
                            'text': ANALYSIS_PROMPT
                        }
                    ]
                }
            ],
            temperature=0.1,  # Low temperature for consistent analysis
        )

        duration = time.time() - start_time
        print(f"✅ Analysis complete ({duration:.1f}s)")

        return {
            'analysis': completion.choices[0].message.content,
            'metadata': {
                'model': completion.model,
                'usage': {
                    'prompt_tokens': completion.usage.prompt_tokens,
                    'completion_tokens': completion.usage.completion_tokens,
                    'total_tokens': completion.usage.total_tokens
                },
                'duration_seconds': round(duration, 1),
                'video_size_mb': round(video_size_mb, 2)
            }
        }

    except Exception as e:
        print(f"❌ API Error: {e}")
        raise


def main():
    if len(sys.argv) < 2:
        print("Usage: DASHSCOPE_API_KEY=sk-xxx python qwen-analyze-video.py <video-path>")
        sys.exit(1)

    video_path = sys.argv[1]
    api_key = os.getenv('DASHSCOPE_API_KEY')

    if not api_key:
        print("Error: DASHSCOPE_API_KEY environment variable not set")
        print("Get your API key: https://www.alibabacloud.com/help/model-studio/get-api-key")
        sys.exit(1)

    try:
        result = analyze_video(video_path, api_key)

        print('\n' + '=' * 80)
        print('ANALYSIS RESULT')
        print('=' * 80 + '\n')
        print(result['analysis'])
        print('\n' + '=' * 80)
        print('METADATA')
        print('=' * 80)
        print(json.dumps(result['metadata'], indent=2))

        # Save to file
        output_path = Path(video_path).with_suffix('') / '-qwen-analysis.json'
        output_path = str(video_path).rsplit('.', 1)[0] + '-qwen-analysis.json'
        with open(output_path, 'w') as f:
            json.dump(result, f, indent=2)
        print(f"\n💾 Saved to: {output_path}")

    except Exception as e:
        print(f"Fatal error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
