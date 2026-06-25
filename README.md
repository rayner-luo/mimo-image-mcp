# MIMO Image Recognition MCP

一个调用小米 MIMO 多模态模型进行图片理解的 MCP Server

## 重要说明

本 MCP 的作用是在不中断 MIMO 2.5 Pro 主模型对话上下文的前提下，通过 MCP 工具调用 MIMO 2.5 模型单独完成图片识别任务。

它不会让 MIMO 2.5 Pro 模型本身具备多模态图片理解能力；图片理解由本 MCP 背后的 MIMO 2.5 模型完成，再把识别结果返回给主对话模型继续推理。

该 MCP 支持：

- 本地图片路径识别
- 网络图片 URL 识别
- Agent 自定义提示词
- API Key、请求地址、模型名称通过 MCP 启动配置传入
- 支持通过 npx 运行
- 支持本地源码运行

## 功能说明

本项目会向 MCP 客户端暴露一个工具：

### `understand_image`

用于调用 MIMO 多模态模型理解图片。

支持的输入方式：

- `image_path`: 单张本地图片路径
- `image_url`: 单张网络图片 URL
- `image_paths`: 多张本地图片路径
- `image_urls`: 多张网络图片 URL
- `prompt`：由 Agent 自己决定的图片理解任务
- `system_prompt`：可选系统提示词
- `temperature`：输出随机性
- `max_tokens`：最大输出长度

### 建议写入 `CLAUDE.md`

为了让 Claude 在图片识别、OCR、截图分析等任务中稳定调用本 MCP，建议在项目的 `CLAUDE.md` 中加入类似说明：

```markdown
## ⚠️ 模型多模态限制与图像处理规范（核心）

1. **禁止直接处理图片：**
   当前运行的模型（mimo-v2.5-pro）为纯文本模型，**不支持多模态输入**。严禁将任何图片文件（包括截图、本地图片）作为图像输入直接发送给模型，否则会导致系统报错崩溃。

2. **识图任务强制路由至 MCP：**
   当遇到任何需要“看图、识别图片、检查页面视觉布局、UI核对”的任务时（例如使用 `chrome-devtools` 截取了页面），模型**必须且只能**调用 `mimo_image_mcp` 工具。

3. **具体执行链条（以 chrome-devtools 为例）：**
   - 步骤 1：调用工具进行页面访问或截图，将图片保存到本地临时路径（例如 `screenshot.png`）。
   - 步骤 2：**绝对不要**读取图片内容发给模型。
   - 步骤 3：直接调用 `mimo_image_mcp`，将刚才保存的图片本地路径或参数传给它。
   - 步骤 4：接收该 MCP 返回的**纯文本识别报告**，并基于该文本报告回答用户的布局问题。
```

---

## 安装方式一：通过 npx 使用

如果你只是想使用这个 MCP，推荐使用这种方式。

MCP 配置示例：

```json
{
  "mcpServers": {
    "mimo-image-mcp": {
      "command": "npx",
      "args": ["-y", "mimo-image-mcp"],
      "env": {
        "MIMO_API_KEY": "用户自己的 API Key",
        "MIMO_API_BASE": "https://token-plan-cn.xiaomimimo.com/v1",
        "MIMO_MODEL": "mimo-v2.5"
      }
    }
  }
}
```

配置项说明：

| 配置项          | 说明                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| `MIMO_API_KEY`  | 你的 MIMO API Key                                                                                    |
| `MIMO_API_BASE` | MIMO API 请求地址，通常为 `https://api.xiaomimimo.com/v1`或`https://token-plan-cn.xiaomimimo.com/v1` |
| `MIMO_MODEL`    | 要调用的 MIMO 模型名称，例如 `mimo-v2.5`                                                             |

## 安装方式二：本地源码运行

如果你想修改源码或参与开发，可以使用本地源码方式。

### 1. 克隆项目

```bash
git clone https://github.com/rayner-luo/mimo-image-mcp.git
cd mimo-image-mcp
```

### 2. 安装依赖

```bash
npm install
```

### 3. MCP 配置示例

```json
{
  "mcpServers": {
    "mimo-image-mcp": {
      "command": "node",
      "args": ["<你的项目路径>/src/index.mjs"],
      "env": {
        "MIMO_API_KEY": "你的 MIMO API Key",
        "MIMO_API_BASE": "https://token-plan-cn.xiaomimimo.com/v1",
        "MIMO_MODEL": "mimo-v2.5"
      }
    }
  }
}
```

请把 `<你的项目路径>` 改成你自己本地项目的真实路径。

---

## 本地调试

可以使用 MCP Inspector 调试：

```bash
npm run inspector
```

如果能看到：

```text
understand_image
```

说明 MCP Server 启动成功。

如果你想在 MCP Inspector 中实际调用 MIMO 接口，可以在当前终端临时设置：

### Windows PowerShell

```powershell
$env:MIMO_API_KEY="你的 MIMO API Key"
$env:MIMO_API_BASE="https://api.xiaomimimo.com/v1"
$env:MIMO_MODEL="mimo-v2.5"

npm run inspector
```

---

## License

MIT
