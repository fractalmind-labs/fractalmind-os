#!/usr/bin/env node

/**
 * Qwen Cloud Video Analyzer
 * Analyzes UI recordings using Alibaba Cloud DashScope API
 *
 * Usage:
 *   DASHSCOPE_API_KEY=sk-xxx node scripts/qwen-analyze-video.js <video-path>
 */

import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

const ANALYSIS_PROMPT = `Analyze this UI animation recording in extreme detail. Extract:

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

Format your response as structured JSON with precise measurements. Be extremely detailed - every pixel and millisecond matters for pixel-perfect replication.`;

async function analyzeVideo(videoPath, apiKey) {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  console.log(`📹 Reading video: ${videoPath}`);
  const videoBuffer = fs.readFileSync(videoPath);
  const videoBase64 = videoBuffer.toString('base64');
  const videoSize = (videoBuffer.length / 1024 / 1024).toFixed(2);
  console.log(`📦 Video size: ${videoSize} MB`);

  const client = new OpenAI({
    apiKey: apiKey,
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
  });

  console.log('🚀 Sending to Qwen VL Plus...');
  const startTime = Date.now();

  try {
    const response = await client.chat.completions.create({
      model: 'qwen-vl-plus',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'video',
              video: `data:video/webm;base64,${videoBase64}`
            },
            {
              type: 'text',
              text: ANALYSIS_PROMPT
            }
          ]
        }
      ],
      temperature: 0.1, // Low temperature for consistent, precise analysis
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Analysis complete (${duration}s)`);

    return {
      analysis: response.choices[0].message.content,
      metadata: {
        model: response.model,
        usage: response.usage,
        duration_seconds: parseFloat(duration),
        video_size_mb: parseFloat(videoSize)
      }
    };
  } catch (error) {
    console.error('❌ API Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    throw error;
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const videoPath = process.argv[2];
  const apiKey = process.env.DASHSCOPE_API_KEY;

  if (!videoPath) {
    console.error('Usage: DASHSCOPE_API_KEY=sk-xxx node qwen-analyze-video.js <video-path>');
    process.exit(1);
  }

  if (!apiKey) {
    console.error('Error: DASHSCOPE_API_KEY environment variable not set');
    console.error('Get your API key: https://www.alibabacloud.com/help/model-studio/get-api-key');
    process.exit(1);
  }

  analyzeVideo(videoPath, apiKey)
    .then(result => {
      console.log('\n' + '='.repeat(80));
      console.log('ANALYSIS RESULT');
      console.log('='.repeat(80) + '\n');
      console.log(result.analysis);
      console.log('\n' + '='.repeat(80));
      console.log('METADATA');
      console.log('='.repeat(80));
      console.log(JSON.stringify(result.metadata, null, 2));

      // Save to file
      const outputPath = videoPath.replace(/\.(webm|mp4)$/, '-qwen-analysis.json');
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
      console.log(`\n💾 Saved to: ${outputPath}`);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { analyzeVideo };
