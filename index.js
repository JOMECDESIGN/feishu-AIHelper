import 'dotenv/config';
import * as Lark from '@larksuiteoapi/node-sdk';
import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { bitableTools, setClient } from './bitable-tools.js';

// ---- 配置 ----
const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_TOKENS = 6000;
const CONVERSATION_TTL = 30 * 60 * 1000; // 30 分钟
const CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 分钟
const MESSAGE_DEDUP_TTL = 60 * 1000; // 60 秒
const processedMessages = new Map(); // Map<messageId, timestamp>

const baseConfig = {
  appId: process.env.APP_ID,
  appSecret: process.env.APP_SECRET,
  domain: process.env.BASE_DOMAIN,
};

const client = new Lark.Client(baseConfig);
setClient(client);

const wsClient = new Lark.WSClient(baseConfig);

const model = createOpenAICompatible({
  baseURL: process.env.OPENAI_BASE_URL,
  name: process.env.OPENAI_MODEL,
  apiKey: process.env.OPENAI_API_KEY,
}).chatModel(process.env.OPENAI_MODEL);

const SYSTEM_PROMPT = `你是一个飞书智能助手，擅长用简洁清晰的中文回答用户问题。

回复要求：
- 用中文回复，除非用户用其他语言提问
- 回复简洁精准，避免冗长
- 回复纯文本，不要使用 Markdown 格式
- 友好、热情、乐于助人

多维表格操作能力：
你现在连接了一个多维表格（Bitable），其中包含多个数据表。用户可以用自然语言让你操作数据。请遵循以下规则：

1. 当用户意图涉及数据查询/添加/修改/删除时，如果不确定有哪些表或不明确要在哪个表操作，先调用 list_tables 查看所有数据表
2. 所有操作工具都需要 table_name 参数。根据用户语义选择合适的表：提到船舶→船舶基础台账表，提到航次/任务→航次任务管理表，提到船员→船员与岗位配置表，提到设备/维保→设备与维保管理表，提到安全/合规/隐患→安全合规与隐患表，提到成本/费用→经营成本统计表
3. 操作前如果不确定字段名，先调用 list_fields 查看表结构和字段名称
4. 查询记录时使用 search_records，修改或删除记录前先用 search_records 找到对应的 record_id
5. 搜索结果中会显示每条记录的 record_id（方括号内），后续的更新/删除操作需要用到
6. 操作完成后用简洁的语言向用户汇报结果
7. 如果操作失败（如字段不存在），向用户解释原因并给出可用字段
8. 对于普通聊天（问候、闲聊、不涉及数据操作的问题），只回复文字，不调用任何工具

安全合规要求：
- 拒绝任何违法、有害、暴力、色情或不道德内容的请求
- 不帮助编写恶意代码、攻击工具或作弊方法
- 不处理或存储个人隐私数据（身份证号、银行卡号、密码等）
- 不提供医疗诊断、法律建议等需要专业资质的建议
- 遇到不确定的问题，诚实告知而非编造`;

// ---- Token 估算 ----
function estimateTokens(text) {
  let tokens = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 128) {
      tokens += 0.3; // ASCII
    } else if (code < 0x2000) {
      tokens += 0.7; // 中文/日韩
    } else {
      tokens += 0.5; // 其他 Unicode
    }
  }
  return Math.ceil(tokens);
}

function countHistoryTokens(history) {
  let total = estimateTokens(SYSTEM_PROMPT);
  for (const msg of history) {
    if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content);
    } else {
      total += estimateTokens(JSON.stringify(msg.content));
    }
  }
  return total;
}

// ---- 输入清洗 ----
function sanitizeInput(text) {
  return text
    .slice(0, MAX_MESSAGE_LENGTH)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // 去除控制字符（保留 \t \n）
    .trim();
}

// ---- 对话存储（带 TTL）----
const conversations = new Map();

function getConversation(chatId) {
  const now = Date.now();
  if (!conversations.has(chatId)) {
    conversations.set(chatId, { messages: [], lastAccess: now });
  }
  const conv = conversations.get(chatId);
  conv.lastAccess = now;
  return conv;
}

function trimHistory(history) {
  while (history.length > 0 && countHistoryTokens(history) > MAX_HISTORY_TOKENS) {
    history.splice(0, 2); // 每次删除最早一轮（user + assistant）
  }
}

// 闲置清理
setInterval(() => {
  const now = Date.now();
  for (const [chatId, conv] of conversations) {
    if (now - conv.lastAccess > CONVERSATION_TTL) {
      conversations.delete(chatId);
    }
  }
  for (const [msgId, ts] of processedMessages) {
    if (now - ts > MESSAGE_DEDUP_TTL) {
      processedMessages.delete(msgId);
    }
  }
}, CLEANUP_INTERVAL);

// ---- 消息发送 ----
async function sendReply(chatId, messageId, chatType, text) {
  console.log('[sendReply]', { chatId, messageId, chatType, text: text.slice(0, 50) });
  try {
    const content = JSON.stringify({ text });
    if (chatType === 'p2p') {
      const res = await client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: chatId, content, msg_type: 'text' },
      });
      console.log('[sendReply] p2p OK, message_id:', res.data?.message_id);
    } else {
      const res = await client.im.v1.message.reply({
        path: { message_id: messageId },
        data: { content, msg_type: 'text' },
      });
      console.log('[sendReply] reply OK, message_id:', res.data?.message_id);
    }
  } catch (e) {
    console.error('[sendReply] FAILED:', e.message);
    throw e;
  }
}

// ---- 事件处理 ----
const eventDispatcher = new Lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data) => {
    const {
      message: { chat_id, content, message_type, chat_type, message_id },
    } = data;

    if (processedMessages.has(message_id)) {
      return;
    }
    processedMessages.set(message_id, Date.now());

    // 消息类型校检
    if (message_type !== 'text') {
      await sendReply(chat_id, message_id, chat_type, '请发送文本消息');
      return;
    }

    // 解析文本
    let rawText = '';
    try {
      rawText = JSON.parse(content).text || '';
    } catch {
      return;
    }

    const userMessage = sanitizeInput(rawText);
    if (!userMessage) {
      return;
    }

    // 长度限制
    if (rawText.length > MAX_MESSAGE_LENGTH) {
      await sendReply(chat_id, message_id, chat_type, `消息过长，请控制在 ${MAX_MESSAGE_LENGTH} 字以内`);
      return;
    }

    const conv = getConversation(chat_id);

    // /clear 命令
    if (userMessage === '/clear') {
      conv.messages = [];
      await sendReply(chat_id, message_id, chat_type, '对话上下文已清除');
      return;
    }

    try {
      const messages = [...conv.messages, { role: 'user', content: userMessage }];

      const result = await generateText({
        model,
        system: SYSTEM_PROMPT,
        messages,
        tools: bitableTools,
        toolChoice: 'auto',
        maxSteps: 5,
      });
      const text = result.text;

      conv.messages = [...result.response.messages];
      trimHistory(conv.messages);

      await sendReply(chat_id, message_id, chat_type, text);
    } catch (error) {
      console.error('AI response error:', error);
      await sendReply(chat_id, message_id, chat_type, '抱歉，AI 服务暂时不可用，请稍后重试');
    }
  },
});

wsClient.start({ eventDispatcher });

console.log('AI Chat Bot started. WebSocket connected. Waiting for messages...');
