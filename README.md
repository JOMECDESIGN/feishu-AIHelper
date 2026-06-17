# 飞书 AI 多维表格助手

通过飞书机器人用自然语言操作多维表格（Bitable），支持跨表查询、增删改查。

## 功能

- 用自然语言查询、添加、修改、删除多维表格数据
- 自动识别用户意图，选择正确的数据表
- 支持多张数据表跨表查询
- 基于 DeepSeek（或其他 OpenAI 兼容 API）的 AI 对话

## 快速启动

### 1. 环境要求

- Node.js >= 18
- 飞书企业自建应用（需开通长连接和 Bitable 权限）

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

复制 `.env.example` 为 `.env`，填入真实配置：

```bash
cp .env.example .env
```

`.env` 配置说明：

| 变量 | 说明 | 获取方式 |
|------|------|----------|
| `APP_ID` | 应用 ID | 飞书开发者后台 → 应用凭证 |
| `APP_SECRET` | 应用密钥 | 飞书开发者后台 → 应用凭证 |
| `BASE_DOMAIN` | API 域名 | `https://open.feishu.cn`（飞书）或 `https://open.larksuite.com`（Lark） |
| `APP_TOKEN` | 多维表格 ID | 多维表格 URL 中 `base/` 后的字符串 |
| `OPENAI_API_KEY` | AI API 密钥 | DeepSeek 或其他 OpenAI 兼容平台 |
| `OPENAI_MODEL` | 模型名称 | 如 `deepseek-chat` |
| `OPENAI_BASE_URL` | AI API 地址 | 如 `https://api.deepseek.com` |

### 4. 飞书应用权限配置

在飞书开发者后台为应用添加以下权限并**发布**：

- `im:message` — 接收和发送消息
- `im:message.p2p_msg:readonly` — 读取单聊消息
- `bitable:app` — 访问多维表格
- `base:table:read` — 读取数据表
- `base:field:read` — 读取字段
- `base:record:retrieve` — 读取记录
- `base:record:create` — 添加记录
- `base:record:update` — 更新记录
- `base:record:delete` — 删除记录

事件订阅方式选择**长连接**（WebSocket）。

### 5. 分享多维表格给应用

在飞书中打开多维表格 → 右上角**分享** → **添加协作者** → 搜索你的应用名称 → 添加并赋予可编辑权限。

### 6. 启动

```bash
npm run dev
```

看到 `ws client ready` 即表示连接成功。在飞书中给机器人发消息即可使用。

## 使用示例

| 输入 | 效果 |
|------|------|
| 有哪些表格 | 列出所有数据表 |
| 长江号今天在哪里 | 查询船舶位置 |
| 航次 H20260601 状态 | 查询航次任务状态 |
| 船员张三在不在船上 | 查询船员在船状态 |
| 添加一条记录，设备名称=xxx | 添加新记录 |
| 把 xxx 的状态改成 yyy | 更新记录 |

## 项目结构

```
.
├── index.js              # 主入口，WebSocket 事件处理
├── bitable-service.js    # 多维表格 API 封装（字段缓存、CRUD）
├── bitable-tools.js      # AI 工具定义（Zod 参数校验、执行逻辑）
├── package.json          # 依赖配置
├── .env.example          # 环境变量模板
└── .gitignore
```
