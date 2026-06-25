#!/usr/bin/env node

import { readFileSync, statSync, existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { homedir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── 配置加载 ───────────────────────────────────────────────

function loadMimoSettings() {
  const apiKey = process.env.MIMO_API_KEY;
  const apiBase = process.env.MIMO_API_BASE;
  const model = process.env.MIMO_MODEL;

  const missing = [];
  if (!apiKey) missing.push("MIMO_API_KEY");
  if (!apiBase) missing.push("MIMO_API_BASE");
  if (!model) missing.push("MIMO_MODEL");

  if (missing.length > 0) {
    throw new Error(
      "MIMO MCP 缺少必要配置：" +
        missing.join(", ") +
        "\n请在 MCP 启动配置的 env 字段中填写 API Key、请求地址和模型名称。",
    );
  }

  return {
    apiKey,
    apiBase: apiBase.replace(/\/+$/, ""),
    model,
  };
}

// ─── URL 构建 ───────────────────────────────────────────────

function buildChatCompletionsUrl(apiBase) {
  apiBase = apiBase.replace(/\/+$/, "");
  if (apiBase.endsWith("/chat/completions")) {
    return apiBase;
  }
  return apiBase + "/chat/completions";
}

// ─── MIME 类型推断 ──────────────────────────────────────────

const MIME_MAP = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function guessMimeType(filePath) {
  const ext = extname(filePath).toLowerCase();
  const mime = MIME_MAP[ext];

  if (!mime) {
    throw new Error(
      "无法识别图片类型：" +
        ext +
        "。请使用 jpg、jpeg、png、webp 或 gif 图片。",
    );
  }

  return mime;
}

// ─── 本地图片转 Data URL ────────────────────────────────────

function expandHome(filePath) {
  if (filePath.startsWith("~")) {
    return filePath.replace("~", homedir());
  }
  return filePath;
}

function localImageDataUrl(imagePath) {
  const expanded = expandHome(imagePath);
  const absPath = resolve(expanded);

  if (!existsSync(absPath)) {
    throw new Error("图片不存在：" + absPath);
  }

  const stat = statSync(absPath);
  if (!stat.isFile()) {
    throw new Error("路径不是文件：" + absPath);
  }

  const maxSizeMb = 20;
  const fileSizeMb = stat.size / 1024 / 1024;
  if (fileSizeMb > maxSizeMb) {
    throw new Error(
      "图片过大：" +
        fileSizeMb.toFixed(2) +
        " MB。当前工具限制为 " +
        maxSizeMb +
        " MB 以内。",
    );
  }

  const mime = guessMimeType(absPath);
  const buffer = readFileSync(absPath);
  const encoded = buffer.toString("base64");

  return "data:" + mime + ";base64," + encoded;
}

// ─── URL 校验 ───────────────────────────────────────────────

function validateImageUrl(imageUrl) {
  if (
    !imageUrl.startsWith("http://") &&
    !imageUrl.startsWith("https://") &&
    !imageUrl.startsWith("data:image/")
  ) {
    throw new Error(
      "image_url 必须是 http、https 或 data:image/...;base64,... 格式。",
    );
  }
  return imageUrl;
}

// ─── 图片 URL 列表构建 ──────────────────────────────────────

function buildImageUrls({ imagePath, imageUrl, imagePaths, imageUrls }) {
  const result = [];

  if (imagePath) {
    result.push(localImageDataUrl(imagePath));
  }
  if (imagePaths) {
    for (const p of imagePaths) {
      result.push(localImageDataUrl(p));
    }
  }
  if (imageUrl) {
    result.push(validateImageUrl(imageUrl));
  }
  if (imageUrls) {
    for (const u of imageUrls) {
      result.push(validateImageUrl(u));
    }
  }

  if (result.length === 0) {
    throw new Error(
      "必须至少传入一张图片：image_path、image_url、image_paths 或 image_urls。",
    );
  }

  const maxImages = 6;
  if (result.length > maxImages) {
    throw new Error(
      "一次最多支持 " +
        maxImages +
        " 张图片，当前传入了 " +
        result.length +
        " 张。",
    );
  }

  return result;
}

// ─── 调用 MIMO API ──────────────────────────────────────────

async function callMimoImageApi({
  imageUrlValues,
  prompt,
  systemPrompt,
  temperature,
  maxTokens,
}) {
  if (!prompt.trim()) {
    throw new Error("prompt 不能为空。");
  }
  if (temperature < 0) {
    throw new Error("temperature 不能小于 0。");
  }
  if (maxTokens <= 0) {
    throw new Error("max_tokens 必须大于 0。");
  }

  const settings = loadMimoSettings();
  const endpoint = buildChatCompletionsUrl(settings.apiBase);

  const messages = [];

  if (systemPrompt && systemPrompt.trim()) {
    messages.push({ role: "system", content: systemPrompt });
  }

  const content = imageUrlValues.map((url) => ({
    type: "image_url",
    image_url: { url },
  }));

  content.push({ type: "text", text: prompt });

  messages.push({ role: "user", content });

  const payload = {
    model: settings.model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  const headers = {
    "api-key": settings.apiKey,
    "Content-Type": "application/json",
  };

  let response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch (exc) {
    return (
      "MIMO API 请求失败。\n" +
      "请求地址：" +
      endpoint +
      "\n" +
      "模型名称：" +
      settings.model +
      "\n" +
      "错误信息：" +
      exc.message
    );
  }

  if (response.status >= 400) {
    const body = await response.text().catch(() => "(无法读取响应体)");
    return (
      "MIMO API 调用失败。\n" +
      "HTTP 状态码：" +
      response.status +
      "\n" +
      "请求地址：" +
      endpoint +
      "\n" +
      "模型名称：" +
      settings.model +
      "\n" +
      "响应内容：" +
      body
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    const body = await response.text().catch(() => "(无法读取响应体)");
    return (
      "MIMO API 返回内容不是合法 JSON。\n" +
      "HTTP 状态码：" +
      response.status +
      "\n" +
      "响应内容：" +
      body
    );
  }

  try {
    return data.choices[0].message.content;
  } catch {
    return "MIMO API 返回了非预期格式：\n" + JSON.stringify(data, null, 2);
  }
}

// ─── MCP Server ─────────────────────────────────────────────

const server = new McpServer({
  name: "mimo-image-mcp",
  version: "1.0.0",
});

// ─── Tool: understand_image ─────────────────────────────────

const understandImageDescription = [
  "Use this tool for ALL image understanding tasks.",
  "",
  "This tool calls Xiaomi MIMO multimodal model to inspect and understand images.",
  "Whenever the user asks to read, understand, describe, compare, OCR, extract text from,",
  "analyze, classify, or answer questions about an image, screenshot, photo, UI capture,",
  "chart, poster, document image, receipt, label, or any visual file, you MUST call this tool",
  "before giving a final answer.",
  "",
  "调用小米 MIMO 多模态模型理解图片。",
  "",
  "CRITICAL: This is the ONLY tool allowed to open, read, or see image files (.png, .jpg, .webp).",
  "If you have a file path pointing to an image, DO NOT use Read, cat, or any file-reading",
  "shell commands.",
  "Using standard file-read tools on binary images will cause a system crash.",
  "Always use this tool to look at or open an image.",
  "",
  "支持单图和多图。Agent 应根据当前任务自己填写 prompt。",
  "",
  "Args:",
  "    prompt: Agent 自己决定的图片理解任务",
  "    image_path: 单张本地图片路径",
  "    image_url: 单张网络图片 URL 或 data:image base64",
  "    image_paths: 多张本地图片路径",
  "    image_urls: 多张网络图片 URL",
  "    system_prompt: 可选系统提示词",
  "    temperature: 输出随机性，越低越稳定",
  "    max_tokens: 最大输出长度",
  "",
  "Returns:",
  "    MIMO 模型返回的图片理解结果。",
].join("\n");

server.tool(
  "understand_image",
  understandImageDescription,
  {
    prompt: z.string().describe("Agent 自己决定的图片理解任务"),
    image_path: z.string().optional().describe("单张本地图片路径"),
    image_url: z
      .string()
      .optional()
      .describe("单张网络图片 URL 或 data:image base64"),
    image_paths: z.array(z.string()).optional().describe("多张本地图片路径"),
    image_urls: z.array(z.string()).optional().describe("多张网络图片 URL"),
    system_prompt: z.string().optional().describe("可选系统提示词"),
    temperature: z.number().default(0.2).describe("输出随机性，越低越稳定"),
    max_tokens: z.number().int().default(12000).describe("最大输出长度"),
  },
  async (args) => {
    const imageUrlValues = buildImageUrls({
      imagePath: args.image_path,
      imageUrl: args.image_url,
      imagePaths: args.image_paths,
      imageUrls: args.image_urls,
    });

    const result = await callMimoImageApi({
      imageUrlValues,
      prompt: args.prompt,
      systemPrompt: args.system_prompt,
      temperature: args.temperature,
      maxTokens: args.max_tokens,
    });

    return { content: [{ type: "text", text: result }] };
  },
);

// ─── Resource: mimo://config ────────────────────────────────

server.resource("mimo-config", "mimo://config", async () => {
  const settings = loadMimoSettings();
  const apiKey = settings.apiKey;

  let maskedKey;
  if (apiKey.length >= 10) {
    maskedKey = apiKey.slice(0, 6) + "..." + apiKey.slice(-4);
  } else {
    maskedKey = "已设置，但长度较短，不展示";
  }

  const text =
    "MIMO_API_BASE=" +
    settings.apiBase +
    "\n" +
    "MIMO_MODEL=" +
    settings.model +
    "\n" +
    "MIMO_API_KEY=" +
    maskedKey +
    "\n";

  return {
    contents: [{ uri: "mimo://config", mimeType: "text/plain", text }],
  };
});

// ─── 启动 ───────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MIMO MCP 启动失败:", err.message);
  process.exit(1);
});
