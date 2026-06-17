import { tool } from 'ai';
import { z } from 'zod';
import { listTables, resolveTableId, getFields, validateFields, searchRecords, createRecord, updateRecord, deleteRecord } from './bitable-service.js';

let _client = null;
export function setClient(client) {
  _client = client;
}

async function resolveTable(tableName) {
  return resolveTableId(_client, tableName);
}

function formatRecords(items) {
  if (items.length === 0) return '没有找到匹配的记录';
  return items
    .map((item, i) => {
      const fields = Object.entries(item.fields || {})
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? JSON.stringify(v) : v}`)
        .join(', ');
      return `${i + 1}. [${item.record_id}] ${fields}`;
    })
    .join('\n');
}

function parseFieldValue(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if ((t.startsWith('[') || t.startsWith('{')) && (t.endsWith(']') || t.endsWith('}'))) {
    try { return JSON.parse(t); } catch { /* keep as string */ }
  }
  return v;
}

function formatFieldValue(v, type) {
  if (type === '人员') {
    if (typeof v === 'string' && v.trim()) return [{ name: v.trim() }];
  }
  if (type === '附件') {
    if (typeof v === 'string' && v.trim()) return [{ name: v.trim() }];
  }
  if (type === '多选') {
    if (typeof v === 'string' && v.trim()) return v.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
  }
  return v;
}

export const listTablesTool = tool({
  description: '列出多维表格中的所有数据表名称。当你不确定有哪些表可用时，应首先调用此工具。',
  parameters: z.object({}),
  execute: async () => {
    try {
      const tables = await listTables(_client);
      if (tables.length === 0) return '该多维表格中没有数据表';
      return tables.map((t) => `${t.name}`).join('\n');
    } catch (e) {
      return `获取表格列表失败: ${e.message}`;
    }
  },
});

export const listFieldsTool = tool({
  description: '列出指定数据表的所有字段名称和类型。需要提供 table_name。当你需要了解某个表的结构时调用此工具。',
  parameters: z.object({
    table_name: z.string().describe('要查看的数据表名称。可先通过 list_tables 获取可用表名'),
  }),
  execute: async ({ table_name }) => {
    try {
      const tableId = await resolveTable(table_name);
      const fields = await getFields(_client, tableId);
      if (fields.length === 0) return '该表格暂无字段';
      return fields.map((f) => `${f.name} (${f.type})`).join('\n');
    } catch (e) {
      return `获取字段列表失败: ${e.message}`;
    }
  },
});

export const searchRecordsTool = tool({
  description: '搜索/查询指定数据表中的记录。可以根据字段名和值过滤。不指定参数则返回全部记录。搜索前如果不确定字段名，先调用 list_fields。',
  parameters: z.object({
    table_name: z.string().describe('要搜索的数据表名称。可先通过 list_tables 获取可用表名'),
    field_name: z.string().optional().describe('要过滤的字段名称'),
    field_value: z.string().optional().describe('要搜索的字段值'),
    operator: z
      .enum(['is', 'isNot', 'contains', 'doesNotContain', 'isEmpty', 'isNotEmpty', 'isGreater', 'isGreaterEqual', 'isLess', 'isLessEqual'])
      .optional()
      .default('contains')
      .describe('过滤操作符'),
  }),
  execute: async ({ table_name, field_name, field_value, operator }) => {
    try {
      const tableId = await resolveTable(table_name);
      let filter;
      if (field_name && field_value !== undefined) {
        const v = await validateFields(_client, tableId, [field_name]);
        if (!v.valid) return `字段 '${field_name}' 不存在。可用字段: ${v.available.join(', ')}`;
        filter = { conjunction: 'and', conditions: [{ field_name, operator, value: [field_value] }] };
      }
      const result = await searchRecords(_client, tableId, { filter });
      return `找到 ${result.total} 条记录:\n${formatRecords(result.items)}`;
    } catch (e) {
      return `查询失败: ${e.message}`;
    }
  },
});

export const createRecordTool = tool({
  description: '在指定数据表中添加一条新记录。字段名必须与表中已有字段完全匹配。如果不确定字段名，先调用 list_fields。',
  parameters: z.object({
    table_name: z.string().describe('要添加记录的数据表名称'),
    fields: z.record(z.string(), z.any()).describe('字段名到值的映射，例如 {"姓名": "张三", "年龄": "25"}。附件等结构化字段可传 JSON 字符串'),
  }),
  execute: async ({ table_name, fields }) => {
    try {
      const tableId = await resolveTable(table_name);
      const names = Object.keys(fields);
      const v = await validateFields(_client, tableId, names);
      if (!v.valid) return `以下字段不存在: ${v.missing.join(', ')}。可用字段: ${v.available.join(', ')}`;
      const parsed = Object.fromEntries(Object.entries(fields).map(([k, val]) => [k, parseFieldValue(val)]));
      const formatted = Object.fromEntries(Object.entries(parsed).map(([k, val]) => [k, formatFieldValue(val, v.fieldMap[k])]));
      const record = await createRecord(_client, tableId, formatted);
      return `记录添加成功。record_id: ${record.record_id}`;
    } catch (e) {
      return `添加记录失败: ${e.message}`;
    }
  },
});

export const updateRecordTool = tool({
  description: '更新指定数据表中已存在的记录。需要提供记录ID和要更新的字段。通常先调用 search_records 获取 record_id。',
  parameters: z.object({
    table_name: z.string().describe('要更新记录的数据表名称'),
    record_id: z.string().describe('要更新的记录ID'),
    fields: z.record(z.string(), z.any()).describe('要更新的字段名到新值的映射。附件等结构化字段可传 JSON 字符串'),
  }),
  execute: async ({ table_name, record_id, fields }) => {
    try {
      const tableId = await resolveTable(table_name);
      const names = Object.keys(fields);
      const v = await validateFields(_client, tableId, names);
      if (!v.valid) return `以下字段不存在: ${v.missing.join(', ')}。可用字段: ${v.available.join(', ')}`;
      const parsed = Object.fromEntries(Object.entries(fields).map(([k, val]) => [k, parseFieldValue(val)]));
      const formatted = Object.fromEntries(Object.entries(parsed).map(([k, val]) => [k, formatFieldValue(val, v.fieldMap[k])]));
      await updateRecord(_client, tableId, record_id, formatted);
      return `记录 ${record_id} 更新成功`;
    } catch (e) {
      return `更新记录失败: ${e.message}`;
    }
  },
});

export const deleteRecordTool = tool({
  description: '删除指定数据表中的一条记录。需要提供记录ID。通常先调用 search_records 获取 record_id。',
  parameters: z.object({
    table_name: z.string().describe('要删除记录的数据表名称'),
    record_id: z.string().describe('要删除的记录ID'),
  }),
  execute: async ({ table_name, record_id }) => {
    try {
      const tableId = await resolveTable(table_name);
      await deleteRecord(_client, tableId, record_id);
      return `记录 ${record_id} 删除成功`;
    } catch (e) {
      return `删除记录失败: ${e.message}`;
    }
  },
});

export const bitableTools = {
  list_tables: listTablesTool,
  list_fields: listFieldsTool,
  search_records: searchRecordsTool,
  create_record: createRecordTool,
  update_record: updateRecordTool,
  delete_record: deleteRecordTool,
};
