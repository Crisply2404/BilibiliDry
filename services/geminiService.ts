import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult, ContentType, LogicType } from "../types";

// This simulates the "Planner" agent breaking down the content.
export const analyzeTranscriptWithGemini = async (transcript: string): Promise<AnalysisResult> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key missing");
  }

  const ai = new GoogleGenAI({ apiKey });

  const systemInstruction = `
    你是一个 B 站视频“脱水”与知识挖掘 Agent (Planner)。
    你的目标是分析视频字幕，识别“干货”（高信息密度）与“注水”（废话/开场/结尾），并将内容重构为逻辑积木（背景、问题、解决方案、案例）。
    
    1. 将内容划分为带有开始/结束时间的片段。
    2. 为“干货程度”分配一个置信度分数 (0-1)。
    3. 创建逻辑积木来组合这些见解。
    4. **所有输出必须使用中文。**
  `;

  const prompt = `分析以下字幕内容:\n\n"${transcript.substring(0, 10000)}..."`; // Truncate for demo safety

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      systemInstruction: systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          overallSummary: { type: Type.STRING },
          segments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                startTime: { type: Type.NUMBER },
                endTime: { type: Type.NUMBER },
                type: { type: Type.STRING, enum: ["DRY", "WATER"] },
                confidence: { type: Type.NUMBER },
                summary: { type: Type.STRING }
              }
            }
          },
          logicBlocks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, enum: ["BACKGROUND", "PROBLEM", "SOLUTION", "CASE"] },
                title: { type: Type.STRING },
                description: { type: Type.STRING }
              }
            }
          }
        }
      }
    }
  });

  const data = JSON.parse(response.text || "{}");

  // Post-process to ensure IDs and matching types
  return {
    videoId: "demo_vid_" + Date.now(),
    title: data.title || "未命名分析",
    totalDuration: data.segments ? data.segments[data.segments.length - 1].endTime : 600,
    processedAt: new Date().toISOString(),
    overallSummary: data.overallSummary || "暂无摘要。",
    segments: (data.segments || []).map((s: any, idx: number) => ({
      ...s,
      id: `seg_${idx}`,
      type: s.type as ContentType
    })),
    logicBlocks: (data.logicBlocks || []).map((b: any, idx: number) => ({
      ...b,
      id: `block_${idx}`,
      type: b.type as LogicType,
      relatedSegments: [] // Simplified for this demo
    }))
  };
};

// Mock data to use if no API key or for instant demo
export const getMockAnalysis = (): AnalysisResult => {
  return {
    videoId: "BV1x7411L7Q",
    title: "深度解析 React Server Components (RSC)",
    totalDuration: 540, // 9 minutes
    processedAt: new Date().toISOString(),
    overallSummary: "本视频详细讲解了从 CSR 到 SSR 再到 RSC 的演变过程，重点介绍了 RSC 如何在减少 Bundle 体积的同时提升数据加载效率。",
    segments: [
      { id: '1', startTime: 0, endTime: 45, type: ContentType.WATER, confidence: 0.1, summary: "开场白与求三连提醒" },
      { id: '2', startTime: 45, endTime: 120, type: ContentType.DRY, confidence: 0.9, summary: "客户端渲染 (CSR) 的性能瓶颈" },
      { id: '3', startTime: 120, endTime: 180, type: ContentType.WATER, confidence: 0.3, summary: "关于网速慢的趣事（注水）" },
      { id: '4', startTime: 180, endTime: 300, type: ContentType.DRY, confidence: 0.95, summary: "Server Components 如何向客户端序列化数据" },
      { id: '5', startTime: 300, endTime: 360, type: ContentType.DRY, confidence: 0.85, summary: "与 Next.js getServerSideProps 的对比" },
      { id: '6', startTime: 360, endTime: 450, type: ContentType.WATER, confidence: 0.2, summary: "读用户评论与互动问答" },
      { id: '7', startTime: 450, endTime: 540, type: ContentType.DRY, confidence: 0.88, summary: "未来路线图与总结" },
    ],
    logicBlocks: [
      { id: 'l1', type: LogicType.BACKGROUND, title: "渲染技术的演变", description: "从 PHP 到 jQuery 再到 React CSR 的发展历程。", relatedSegments: ['2'] },
      { id: 'l2', type: LogicType.PROBLEM, title: "瀑布流请求问题 (Waterfall)", description: "在 useEffect 中获取数据会导致布局抖动和 TTI 变慢。", relatedSegments: ['2'] },
      { id: 'l3', type: LogicType.SOLUTION, title: "服务端组件 (RSC)", description: "组件在服务器运行，发送 HTML/JSON，依赖项不计入 Bundle 体积。", relatedSegments: ['4', '5'] },
      { id: 'l4', type: LogicType.CASE, title: "电商列表页加载优化", description: "展示使用 RSC 后产品列表加载速度提升 40% 的案例。", relatedSegments: ['7'] },
    ]
  };
};