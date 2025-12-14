# Auto Draw.io

**AI驱动的图表创建工具 - 对话、绘制、可视化**

一个集成了 GenAI 能力的 Next.js Web应用，与draw.io图表无缝结合。通过自然语言命令和AI辅助可视化来创建、修改和增强图表。

## 目录
- [Auto Draw.io](#auto-drawio)
  - [示例](#示例)
  - [功能特性](#功能特性)
  - [快速开始](#快速开始)
    - [🐳 Docker 部署](#-docker-部署)
    - [💻 本地开发](#-本地开发)
  - [部署](#部署)
  - [多提供商支持](#多提供商支持)
  - [技术栈](#技术栈)
  - [项目结构](#项目结构)

## 示例

以下是一些示例提示词及其生成的图表：

<div align="center">
<table width="100%">
  <tr>
    <td colspan="2" valign="top" align="center">
      <strong>动画Transformer连接器</strong><br />
      <p><strong>提示词：</strong> 给我一个带有**动画连接器**的Transformer架构图。</p>
      <img src="./public/animated_connectors.svg" alt="带动画连接器的Transformer架构" width="480" />
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>GCP架构图</strong><br />
      <p><strong>提示词：</strong> 使用**GCP图标**生成一个GCP架构图。在这个图中，用户连接到托管在实例上的前端。</p>
      <img src="./public/gcp_demo.svg" alt="GCP架构图" width="480" />
    </td>
    <td width="50%" valign="top">
      <strong>AWS架构图</strong><br />
      <p><strong>提示词：</strong> 使用**AWS图标**生成一个AWS架构图。在这个图中，用户连接到托管在实例上的前端。</p>
      <img src="./public/aws_demo.svg" alt="AWS架构图" width="480" />
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>Azure架构图</strong><br />
      <p><strong>提示词：</strong> 使用**Azure图标**生成一个Azure架构图。在这个图中，用户连接到托管在实例上的前端。</p>
      <img src="./public/azure_demo.svg" alt="Azure架构图" width="480" />
    </td>
    <td width="50%" valign="top">
      <strong>猫咪素描</strong><br />
      <p><strong>提示词：</strong> 给我画一只可爱的猫。</p>
      <img src="./public/cat_demo.svg" alt="猫咪绘图" width="240" />
    </td>
  </tr>
</table>
</div>

## 功能特性

-   **LLM驱动的图表创建**：利用大语言模型通过自然语言命令直接创建和操作draw.io图表
-   **基于图像的图表复制**：上传现有图表或图像，让AI自动复制和增强
-   **PDF和文本文件上传**：上传PDF文档和文本文件，提取内容并从现有文档生成图表
-   **AI推理过程显示**：查看支持模型的AI思考过程（OpenAI o1/o3、Gemini、Claude等）
-   **图表历史记录**：全面的版本控制，跟踪所有更改，允许您查看和恢复AI编辑前的图表版本
-   **交互式聊天界面**：与AI实时对话来完善您的图表
-   **云架构图支持**：专门支持生成云架构图（AWS、GCP、Azure）
-   **动画连接器**：在图表元素之间创建动态动画连接器，实现更好的可视化效果

## 快速开始

### 🐳 Docker 部署

最简单的运行方式，适合生产环境和快速体验。

**前提条件：** 安装 [Docker](https://docs.docker.com/get-docker/)

```bash
# 克隆仓库
git clone https://github.com/aleck31/auto-draw-io
cd auto-draw-io

# 构建并运行
docker build -t auto-draw-io .
docker run -d -p 3000:3000 \
  -e AI_PROVIDER=openai \
  -e AI_MODEL=gpt-4o \
  -e OPENAI_API_KEY=your_api_key \
  auto-draw-io
```

或使用配置文件：
```bash
cp .env.example .env
# 编辑 .env 填写您的 LLM 配置
docker run -d -p 3000:3000 --env-file .env auto-draw-io
```

访问 [http://localhost:3000](http://localhost:3000) 开始使用。

> **离线部署：** 如果 `embed.diagrams.net` 被屏蔽，请参阅 [离线部署指南](./docs/offline-deployment.md)。

### 💻 本地开发

适合开发者进行代码修改和功能开发。

**前提条件：** Node.js 18+ 和 npm

```bash
# 1. 克隆仓库
git clone https://github.com/aleck31/auto-draw-io
cd auto-draw-io

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local 配置您的AI提供商

# 4. 启动开发服务器
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000) 开始开发。

**环境变量配置：**
- `AI_PROVIDER`：选择AI提供商（bedrock, openai, anthropic, google, openrouter）
- `AI_MODEL`：指定模型ID
- 添加对应的API密钥（详见[AI提供商配置](./docs/ai-providers.md)）
- `ACCESS_CODE_LIST`：访问密码（可选，推荐设置）

> **安全提醒：** 不设置 `ACCESS_CODE_LIST` 可能导致API密钥被滥用。

## 部署

### Vercel 部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Faleck31%2Fauto-draw-io)

1. 点击上方按钮或访问 [Vercel](https://vercel.com/new)
2. 导入此仓库
3. 在环境变量中配置您的AI提供商设置
4. 部署完成

### 其他平台

本项目是标准的 Next.js 应用，支持部署到任何支持 Node.js 的平台：

- **AWS/GCP/Azure**：使用容器服务部署 Docker 镜像
- **Railway**：连接 GitHub 仓库即可部署
- **Netlify**：支持 Next.js 静态导出
- **VPS**：使用 Docker 或 PM2 部署

详见 [Next.js 部署文档](https://nextjs.org/docs/app/building-your-application/deploying)。


## LLM Provider 支持

-   AWS Bedrock
-   OpenAI
-   Anthropic
-   Google AI
-   OpenRouter

除AWS Bedrock和OpenRouter外，其它 Provider 支持自定义端点。

📖 **[详细的提供商配置指南](./ai-providers.md)** - 查看各提供商的设置说明。

**模型要求**：此任务需要强大的模型能力，因为它涉及生成具有严格格式约束的长文本（draw.io XML）。推荐使用Claude Sonnet 4.5、GPT-4o、Gemini 2.0和DeepSeek V3/R1。

注意：`claude-sonnet-4-5` 已在带有AWS标志的draw.io图表上进行训练，因此如果您想创建AWS架构图，这是最佳选择。


## 技术栈

本应用使用以下技术：

-   **Next.js**：用于前端框架和路由
-   **Vercel AI SDK**（`ai` + `@ai-sdk/*`）：用于流式AI响应和多提供商支持
-   **react-drawio**：用于图表表示和操作

图表以XML格式表示，可在draw.io中渲染。AI处理您的命令并相应地生成或修改此XML。

## 项目结构

```
app/                  # Next.js App Router
  api/                # API 路由
    chat/             # 带AI工具的聊天API端点
    config/           # 配置API端点
  page.tsx            # 带DrawIO嵌入的主页面
  layout.tsx          # 应用布局
components/           # React组件
  chat-panel.tsx      # 带图表控制的聊天界面
  chat-input.tsx      # 带文件上传的用户输入组件
  chat-example-panel.tsx # 快速示例面板
  settings-dialog.tsx # 设置对话框（AI提供商配置）
  history-dialog.tsx  # 图表版本历史查看器
  ui/                 # UI基础组件（按钮、输入框、对话框等）
contexts/             # React上下文提供者
  diagram-context.tsx # 全局图表状态管理
lib/                  # 工具函数和辅助程序
  ai-providers.ts     # 多提供商AI配置（支持Bedrock、OpenAI等）
  ai-config.ts        # AI配置管理
  storage.ts          # 本地存储键管理
  system-prompts.ts   # 系统提示词
  cached-responses.ts # 缓存响应管理
  utils.ts            # XML处理和转换工具
public/               # 静态资源包括示例图片
docs/                 # 文档
```
