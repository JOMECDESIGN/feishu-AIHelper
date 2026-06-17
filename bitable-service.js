import 'dotenv/config';

const FIELD_CACHE_TTL = 5 * 60 * 1000;
const TABLE_LIST_CACHE_TTL = 60 * 60 * 1000;

const appToken = process.env.APP_TOKEN;
const fieldCacheMap = new Map();
let tableListCache = null;
let lastTableFetchTime = 0;

function requireConfig() {
  if (!appToken) {
    throw new Error('请先配置 APP_TOKEN');
  }
}

function typeLabel(type) {
  const map = { 1: '文本', 2: '数字', 3: '单选', 4: '多选', 5: '日期', 7: '复选框', 11: '附件', 13: '网址', 15: '公式', 17: '人员', 18: '创建时间', 19: '修改时间', 20: '自动编号', 21: '关联', 22: '地理位置', 23: '群聊', 1001: '创建人', 1002: '修改人' };
  return map[type] || `类型${type}`;
}

export async function listTables(client) {
  requireConfig();
  const now = Date.now();
  if (tableListCache && now - lastTableFetchTime < TABLE_LIST_CACHE_TTL) {
    return tableListCache;
  }

  const res = await client.bitable.appTable.list({
    path: { app_token: appToken },
    params: { page_size: 100 },
  });

  tableListCache = (res.data.items || []).map((item) => ({
    name: item.name,
    tableId: item.table_id,
  }));
  lastTableFetchTime = now;
  return tableListCache;
}

export async function resolveTableId(client, tableName) {
  const tables = await listTables(client);
  if (!tableName) {
    if (tables.length === 1) return tables[0].tableId;
    throw new Error(`请指定表格名称。可用表格: ${tables.map((t) => t.name).join(', ')}`);
  }
  const exact = tables.find((t) => t.name === tableName);
  if (exact) return exact.tableId;
  const fuzzy = tables.find((t) => t.name.includes(tableName));
  if (fuzzy) return fuzzy.tableId;
  throw new Error(`未找到表格 '${tableName}'。可用表格: ${tables.map((t) => t.name).join(', ')}`);
}

export async function getFields(client, tableId) {
  requireConfig();
  const now = Date.now();
  const cached = fieldCacheMap.get(tableId);
  if (cached && now - cached.timestamp < FIELD_CACHE_TTL) {
    return cached.fields;
  }

  const res = await client.bitable.appTableField.list({
    path: { app_token: appToken, table_id: tableId },
    params: { page_size: 100 },
  });

  const fields = (res.data.items || []).map((item) => ({
    name: item.field_name,
    type: typeLabel(item.type),
    id: item.field_id,
  }));
  fieldCacheMap.set(tableId, { fields, timestamp: now });
  return fields;
}

export async function validateFields(client, tableId, fieldNames) {
  const fields = await getFields(client, tableId);
  const names = new Set(fields.map((f) => f.name));
  const missing = fieldNames.filter((n) => !names.has(n));
  return missing.length > 0 ? { valid: false, missing, available: fields.map((f) => f.name) } : { valid: true };
}

export async function searchRecords(client, tableId, { filter, fieldNames } = {}) {
  requireConfig();
  const data = {};
  if (filter) data.filter = filter;
  if (fieldNames) data.field_names = fieldNames;

  const res = await client.bitable.appTableRecord.search({
    path: { app_token: appToken, table_id: tableId },
    data,
    params: { page_size: 50 },
  });

  const items = (res.data.items || []).map((item) => ({
    record_id: item.record_id,
    fields: item.fields,
  }));
  return { total: res.data.total || items.length, items };
}

export async function createRecord(client, tableId, fields) {
  requireConfig();
  const res = await client.bitable.appTableRecord.create({
    path: { app_token: appToken, table_id: tableId },
    data: { fields },
  });
  return { record_id: res.data.record.record_id, fields };
}

export async function updateRecord(client, tableId, recordId, fields) {
  requireConfig();
  await client.bitable.appTableRecord.update({
    path: { app_token: appToken, table_id: tableId, record_id: recordId },
    data: { fields },
  });
  return { record_id: recordId };
}

export async function deleteRecord(client, tableId, recordId) {
  requireConfig();
  await client.bitable.appTableRecord.delete({
    path: { app_token: appToken, table_id: tableId, record_id: recordId },
  });
  return { deleted: true };
}
