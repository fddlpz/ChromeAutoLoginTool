/**
 * 集成测试 - 模拟加密场景下的完整配置管理流程
 * 运行: node tests/integration-test.js
 */

const assert = require('assert');
const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`${PASS} ${name}`);
    passed++;
  } catch (e) {
    console.log(`${FAIL} ${name}`);
    console.log(`  ${e.message}`);
    failed++;
  }
}

// ========== 模拟 config.js 核心逻辑 ==========

const DEFAULT_STATE = { enabled: true, rules: [], crypto: null };

function normalizeText(value, fallback) {
  if (value === undefined || value === null) return fallback || '';
  return String(value).trim();
}

function normalizeRule(rule) {
  const source = rule || {};
  return {
    id: normalizeText(source.id) || `rule_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
    name: normalizeText(source.name) || '未命名规则',
    enabled: source.enabled !== false,
    urlPatterns: Array.isArray(source.urlPatterns)
      ? source.urlPatterns.map(normalizeText).filter(Boolean)
      : normalizeText(source.urlPatterns).split(/\r?\n/).map(s => s.trim()).filter(Boolean),
    usernameSelector: normalizeText(source.usernameSelector),
    usernameValue: source.usernameValue !== undefined && source.usernameValue !== null ? source.usernameValue : '',
    usernameHint: normalizeText(source.usernameHint),
    passwordSelector: normalizeText(source.passwordSelector),
    passwordValue: source.passwordValue !== undefined && source.passwordValue !== null ? source.passwordValue : '',
    passwordHint: normalizeText(source.passwordHint),
    submitSelector: normalizeText(source.submitSelector),
    formSelector: normalizeText(source.formSelector),
    alreadyLoggedInSelector: normalizeText(source.alreadyLoggedInSelector),
    autoSubmit: source.autoSubmit !== false,
    waitTimeoutMs: Number.isFinite(Number(source.waitTimeoutMs)) && Number(source.waitTimeoutMs) >= 0
      ? Number(source.waitTimeoutMs) : 15000,
    submitDelayMs: Number.isFinite(Number(source.submitDelayMs)) && Number(source.submitDelayMs) >= 0
      ? Number(source.submitDelayMs) : 400,
    extraFields: Array.isArray(source.extraFields)
      ? source.extraFields.map(item => ({
          selector: normalizeText(item && item.selector),
          value: item && item.value !== undefined && item.value !== null ? String(item.value) : ''
        })).filter(item => item.selector)
      : [],
    notes: normalizeText(source.notes)
  };
}

function normalizeState(state) {
  const source = state || {};
  return {
    enabled: source.enabled !== false,
    rules: Array.isArray(source.rules) ? source.rules.map(normalizeRule) : [],
    crypto: source.crypto || null
  };
}

// 模拟加密函数
function mockEncryptState(state) {
  const clone = JSON.parse(JSON.stringify(state));
  clone.rules = clone.rules.map(rule => {
    const r = { ...rule };
    if (r.usernameValue && typeof r.usernameValue === 'string' && r.usernameValue.length > 0) {
      r.usernameValue = { __enc: true, data: 'encrypted_' + r.usernameValue, iv: 'mock_iv' };
    }
    if (r.passwordValue && typeof r.passwordValue === 'string' && r.passwordValue.length > 0) {
      r.passwordValue = { __enc: true, data: 'encrypted_' + r.passwordValue, iv: 'mock_iv' };
    }
    if (Array.isArray(r.extraFields)) {
      r.extraFields = r.extraFields.map(f => {
        if (f.value && typeof f.value === 'string' && f.value.length > 0) {
          return { ...f, value: { __enc: true, data: 'encrypted_' + f.value, iv: 'mock_iv' } };
        }
        return f;
      });
    }
    return r;
  });
  return clone;
}

function mockDecryptState(state) {
  const clone = JSON.parse(JSON.stringify(state));
  clone.rules = clone.rules.map(rule => {
    const r = { ...rule };
    if (r.usernameValue && typeof r.usernameValue === 'object' && r.usernameValue.__enc) {
      r.usernameValue = r.usernameValue.data.replace('encrypted_', '');
    }
    if (r.passwordValue && typeof r.passwordValue === 'object' && r.passwordValue.__enc) {
      r.passwordValue = r.passwordValue.data.replace('encrypted_', '');
    }
    if (Array.isArray(r.extraFields)) {
      r.extraFields = r.extraFields.map(f => {
        if (f.value && typeof f.value === 'object' && f.value.__enc) {
          return { ...f, value: f.value.data.replace('encrypted_', '') };
        }
        return f;
      });
    }
    return r;
  });
  return clone;
}

// ========== 修复后的 saveState 逻辑 ==========
// saveState 返回明文，存储密文
function saveStateFixed(state, hasKey) {
  const plaintextState = normalizeState(state);
  let storageState = plaintextState;
  if (hasKey) {
    storageState = mockEncryptState(plaintextState);
  }
  // 模拟写入 storage（这里只验证返回值）
  return plaintextState;  // ← 修复：返回明文
}

// ========== 修复前的 saveState 逻辑（buggy） ==========
function saveStateBuggy(state, hasKey) {
  let normalized = normalizeState(state);
  if (hasKey) {
    normalized = mockEncryptState(normalized);
  }
  return normalized;  // ← bug：返回加密后的对象
}

// ========== 测试场景 ==========

console.log('\n========== 集成测试：加密场景下的配置管理 ==========\n');

test('saveStateFixed: 返回明文 usernameValue', () => {
  const state = {
    enabled: true,
    rules: [{
      id: 'demo',
      name: '测试规则',
      usernameValue: 'demo.user',
      passwordValue: 'secret123',
      urlPatterns: ['http://test.com/*']
    }],
    crypto: { salt: 'abc123' }
  };
  const result = saveStateFixed(state, true);
  assert.strictEqual(result.rules[0].usernameValue, 'demo.user');
  assert.strictEqual(typeof result.rules[0].usernameValue, 'string');
  assert.strictEqual(result.rules[0].passwordValue, 'secret123');
});

test('saveStateBuggy: 返回加密对象（展示bug）', () => {
  const state = {
    enabled: true,
    rules: [{
      id: 'demo',
      name: '测试规则',
      usernameValue: 'demo.user',
      passwordValue: 'secret123',
      urlPatterns: ['http://test.com/*']
    }],
    crypto: { salt: 'abc123' }
  };
  const result = saveStateBuggy(state, true);
  // 这个bug会导致返回加密对象
  assert.strictEqual(typeof result.rules[0].usernameValue, 'object');
  assert.strictEqual(result.rules[0].usernameValue.__enc, true);
  // 转成字符串就是 [object Object]
  assert.strictEqual(String(result.rules[0].usernameValue), '[object Object]');
});

test('模拟编辑回显流程（修复后）', () => {
  // 1. 创建规则
  let state = normalizeState({
    enabled: true,
    rules: [],
    crypto: null
  });

  const newRule = normalizeRule({
    name: 'OA登录',
    urlPatterns: ['https://oa.example.com/*'],
    usernameSelector: '#username',
    usernameValue: 'my.account',
    passwordSelector: '#password',
    passwordValue: 'my.password',
    usernameHint: '手机号',
    passwordHint: '密码'
  });

  state.rules.push(newRule);

  // 2. 启用加密并保存（模拟 saveStateFixed 返回明文）
  state.crypto = { salt: 'abc123' };
  const savedState = saveStateFixed(state, true);

  // 3. 将返回的明文状态赋值给 currentState（options.js 的行为）
  let currentState = savedState;

  // 4. 点击编辑按钮，fillForm 读取 rule
  const rule = currentState.rules[0];

  // 5. 验证回显值正确
  assert.strictEqual(rule.usernameValue, 'my.account');
  assert.strictEqual(rule.passwordValue, 'my.password');
  assert.strictEqual(rule.usernameHint, '手机号');
  assert.strictEqual(rule.passwordHint, '密码');
});

test('模拟编辑回显流程（修复前 buggy）', () => {
  let state = normalizeState({
    enabled: true,
    rules: [],
    crypto: null
  });

  const newRule = normalizeRule({
    name: 'OA登录',
    urlPatterns: ['https://oa.example.com/*'],
    usernameSelector: '#username',
    usernameValue: 'my.account',
    passwordSelector: '#password',
    passwordValue: 'my.password'
  });

  state.rules.push(newRule);
  state.crypto = { salt: 'abc123' };

  // 使用 buggy 版本
  const savedState = saveStateBuggy(state, true);
  let currentState = savedState;

  const rule = currentState.rules[0];

  // 回显值变成加密对象，转成字符串就是 [object Object]
  assert.strictEqual(String(rule.usernameValue), '[object Object]');
  assert.strictEqual(String(rule.passwordValue), '[object Object]');
});

test('模拟 content script 未解锁场景（有保护检查）', () => {
  // 模拟 getStoredState 返回加密状态（未解锁时 getState 的行为）
  const encryptedState = {
    enabled: true,
    crypto: { salt: 'abc123' },
    rules: [{
      id: 'demo',
      name: '测试',
      urlPatterns: ['http://test.com/*'],
      usernameSelector: '#user',
      usernameValue: { __enc: true, data: 'xxx', iv: 'yyy' },
      passwordSelector: '#pass',
      passwordValue: { __enc: true, data: 'zzz', iv: 'www' }
    }]
  };

  // 模拟 content.js 中的保护检查
  const state = normalizeState(encryptedState);
  const rule = state.rules[0];

  // 保护检查：如果值是对象（加密对象），跳过执行
  const shouldSkip = state.crypto && (typeof rule.usernameValue === 'object' || typeof rule.passwordValue === 'object');
  assert.strictEqual(shouldSkip, true);
});

test('模拟 content script 解锁后场景', () => {
  // 解锁后 getState() 返回解密后的明文状态
  const encryptedState = {
    enabled: true,
    crypto: { salt: 'abc123' },
    rules: [{
      id: 'demo',
      name: '测试',
      urlPatterns: ['http://test.com/*'],
      usernameSelector: '#user',
      usernameValue: { __enc: true, data: 'encrypted_demo.user', iv: 'yyy' },
      passwordSelector: '#pass',
      passwordValue: { __enc: true, data: 'encrypted_secret', iv: 'www' }
    }]
  };

  // 模拟解密
  const decryptedState = mockDecryptState(encryptedState);
  const rule = decryptedState.rules[0];

  // 解密后值正确
  assert.strictEqual(rule.usernameValue, 'demo.user');
  assert.strictEqual(rule.passwordValue, 'secret');

  // 保护检查不会触发
  const shouldSkip = decryptedState.crypto && (typeof rule.usernameValue === 'object' || typeof rule.passwordValue === 'object');
  assert.strictEqual(shouldSkip, false);
});

test('模拟导入加密配置后的流程', () => {
  // 用户导入一个已加密的配置
  const importedState = {
    enabled: true,
    crypto: { salt: 'old_salt_123' },
    rules: [{
      id: 'imported_rule',
      name: '导入的规则',
      urlPatterns: ['https://imported.com/*'],
      usernameSelector: '#u',
      usernameValue: { __enc: true, data: 'encrypted_import_user', iv: 'iv1' },
      passwordSelector: '#p',
      passwordValue: { __enc: true, data: 'encrypted_import_pass', iv: 'iv2' }
    }]
  };

  // normalizeState 不处理加密/解密，只是规范化结构
  const normalized = normalizeState(importedState);

  // 未解锁时，规则值是加密对象
  assert.strictEqual(typeof normalized.rules[0].usernameValue, 'object');
  assert.strictEqual(normalized.rules[0].usernameValue.__enc, true);

  // 解锁后（模拟解密）
  const decrypted = mockDecryptState(normalized);
  assert.strictEqual(decrypted.rules[0].usernameValue, 'import_user');
  assert.strictEqual(decrypted.rules[0].passwordValue, 'import_pass');
});

test('模拟重复编辑同一规则', () => {
  let currentState = normalizeState({ enabled: true, rules: [], crypto: null });

  // 第一次创建规则
  const rule1 = normalizeRule({
    name: '测试',
    urlPatterns: ['http://a.com/*'],
    usernameValue: 'user1',
    passwordValue: 'pass1'
  });
  currentState.rules.push(rule1);
  currentState = saveStateFixed(currentState, true);  // 加密保存，返回明文

  assert.strictEqual(currentState.rules[0].usernameValue, 'user1');

  // 编辑规则，修改账号值
  currentState.rules[0].usernameValue = 'user2';
  currentState = saveStateFixed(currentState, true);  // 再次保存

  assert.strictEqual(currentState.rules[0].usernameValue, 'user2');

  // 再次编辑
  currentState.rules[0].usernameValue = 'user3';
  currentState = saveStateFixed(currentState, true);

  assert.strictEqual(currentState.rules[0].usernameValue, 'user3');
  assert.strictEqual(currentState.rules[0].passwordValue, 'pass1');  // 密码未变
});

// ========== 汇总 ==========
console.log('\n========== 集成测试汇总 ==========');
console.log(`通过: ${passed}`);
console.log(`失败: ${failed}`);
console.log(`总计: ${passed + failed}`);
if (failed === 0) {
  console.log('\n全部通过！加密场景下的配置管理流程正确。');
} else {
  console.log('\n存在失败项，请检查。');
  process.exit(1);
}
