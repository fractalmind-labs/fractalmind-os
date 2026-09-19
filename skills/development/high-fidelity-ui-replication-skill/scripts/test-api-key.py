#!/usr/bin/env python3
"""Test DashScope API key with simple text completion"""

import os
import sys
from openai import OpenAI

def test_api_key(api_key, region='intl'):
    endpoints = {
        'intl': 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        'cn': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        'us': 'https://dashscope-us.aliyuncs.com/compatible-mode/v1'
    }

    base_url = endpoints.get(region, endpoints['intl'])
    client = OpenAI(
        api_key=api_key,
        base_url=base_url
    )

    print(f"🔑 Testing API key with {region} endpoint ({base_url})...")
    try:
        response = client.chat.completions.create(
            model="qwen-plus",
            messages=[
                {"role": "user", "content": "Say 'API key works!'"}
            ]
        )
        print(f"✅ Success: {response.choices[0].message.content}")
        print(f"📊 Tokens used: {response.usage.total_tokens}")
        return True
    except Exception as e:
        print(f"❌ Failed: {e}")
        return False

if __name__ == '__main__':
    api_key = os.getenv('DASHSCOPE_API_KEY') or (sys.argv[1] if len(sys.argv) > 1 else None)
    if not api_key:
        print("Usage: python test-api-key.py <api-key> [region]")
        print("Regions: intl (default), cn, us")
        sys.exit(1)

    region = sys.argv[2] if len(sys.argv) > 2 else 'intl'

    # Try all regions if first fails
    if not test_api_key(api_key, region):
        print("\n🔄 Trying other regions...")
        for r in ['cn', 'intl', 'us']:
            if r != region:
                print()
                if test_api_key(api_key, r):
                    break
