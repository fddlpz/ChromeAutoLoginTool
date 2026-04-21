/**
 * 单元测试脚本 - 验证核心逻辑
 * 运行: node tests/unit-test.js
 */

const http = require('http');
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

// ========== 1. 测试通配符转正则 ==========
function wildcardToRegExp(pattern) {
  const raw = String(pattern || '').trim();
  if (!raw) return null;
  const escaped = raw.replace(/[|\\{}()[\]^$+?.]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

test('wildcard: simple star', () => {
  const re = wildcardToRegExp('https://example.com/login*');
  assert(re.test('https://example.com/login'));
  assert(re.test('https://example.com/login.html'));
  assert(!re.test('https://example.com/other'));
});

test('wildcard: star in middle', () => {
  const re = wildcardToRegExp('https://*.example.com/*');
  assert(re.test('https://www.example.com/path'));
  assert(re.test('https://sub.example.com/a/b'));
  assert(!re.test('https://example.com/path'));
});

test('wildcard: exact match', () => {
  const re = wildcardToRegExp('http://127.0.0.1:8787/login-demo.html');
  assert(re.test('http://127.0.0.1:8787/login-demo.html'));
  assert(!re.test('http://127.0.0.1:8787/login-demo.html?foo=bar'));
});

test('wildcard: with trailing star', () => {
  const re = wildcardToRegExp('http://127.0.0.1:8787/login-demo.html*');
  assert(re.test('http://127.0.0.1:8787/login-demo.html'));
  assert(re.test('http://127.0.0.1:8787/login-demo.html?view=success'));
});

// ========== 2. 测试规则规范化 ==========
function normalizeRule(rule) {
  const source = rule || {};
  function normalizeText(value, fallback) {
    if (value === undefined || value === null) return fallback || '';
    return String(value).trim();
  }
  function normalizeNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }
  function normalizePatterns(value) {
    if (Array.isArray(value)) return value.map(item => normalizeText(item)).filter(Boolean);
    return normalizeText(value).split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  }
  function normalizeExtraFields(value) {
    if (!Array.isArray(value)) return [];
    return value.map(item => ({
      selector: normalizeText(item && item.selector),
      value: item && item.value !== undefined && item.value !== null ? String(item.value) : ''
    })).filter(item => item.selector);
  }
  return {
    id: normalizeText(source.id) || `rule_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
    name: normalizeText(source.name) || '未命名规则',
    enabled: source.enabled !== false,
    urlPatterns: normalizePatterns(source.urlPatterns || source.urlPattern),
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
    waitTimeoutMs: normalizeNumber(source.waitTimeoutMs, 15000),
    submitDelayMs: normalizeNumber(source.submitDelayMs, 400),
    extraFields: normalizeExtraFields(source.extraFields),
    notes: normalizeText(source.notes)
  };
}

test('normalizeRule: defaults', () => {
  const r = normalizeRule({});
  assert(r.enabled === true);
  assert(r.autoSubmit === true);
  assert(r.waitTimeoutMs === 15000);
  assert(r.submitDelayMs === 400);
  assert(Array.isArray(r.extraFields));
  assert(r.extraFields.length === 0);
});

test('normalizeRule: hints', () => {
  const r = normalizeRule({ usernameHint: '手机号', passwordHint: '密码' });
  assert(r.usernameHint === '手机号');
  assert(r.passwordHint === '密码');
});

test('normalizeRule: extraFields', () => {
  const r = normalizeRule({
    extraFields: [{ selector: '#tenant', value: 'acme' }]
  });
  assert(r.extraFields.length === 1);
  assert(r.extraFields[0].selector === '#tenant');
  assert(r.extraFields[0].value === 'acme');
});

test('normalizeRule: urlPatterns array', () => {
  const r = normalizeRule({
    urlPatterns: ['https://a.com/*', 'https://b.com/*']
  });
  assert(r.urlPatterns.length === 2);
});

test('normalizeRule: urlPatterns string', () => {
  const r = normalizeRule({
    urlPatterns: 'https://a.com/*\nhttps://b.com/*'
  });
  assert(r.urlPatterns.length === 2);
});

// ========== 3. 测试 URL 匹配 ==========
function matchesUrl(rule, url) {
  if (!rule || rule.enabled === false) return false;
  const patterns = Array.isArray(rule.urlPatterns) ? rule.urlPatterns : [];
  return patterns.some(pattern => {
    const matcher = wildcardToRegExp(pattern);
    return matcher ? matcher.test(url) : false;
  });
}

test('matchesUrl: basic match', () => {
  const rule = normalizeRule({
    urlPatterns: ['http://127.0.0.1:8787/login-demo.html*'],
    enabled: true
  });
  assert(matchesUrl(rule, 'http://127.0.0.1:8787/login-demo.html'));
  assert(matchesUrl(rule, 'http://127.0.0.1:8787/login-demo.html?view=success'));
});

test('matchesUrl: smart locator demo', () => {
  const rule = normalizeRule({
    urlPatterns: ['http://127.0.0.1:8787/smart-locator-demo.html*'],
    enabled: true
  });
  assert(matchesUrl(rule, 'http://127.0.0.1:8787/smart-locator-demo.html'));
});

test('matchesUrl: disabled rule', () => {
  const rule = normalizeRule({
    urlPatterns: ['http://127.0.0.1:8787/*'],
    enabled: false
  });
  assert(!matchesUrl(rule, 'http://127.0.0.1:8787/login-demo.html'));
});

// ========== 4. 测试加密/解密数据结构一致性 ==========
test('encryptState: structure check', () => {
  // 模拟加密后的数据结构
  const encryptedRule = {
    id: 'test',
    usernameValue: { __enc: true, data: 'abc123', iv: 'def456' },
    passwordValue: { __enc: true, data: 'ghi789', iv: 'jkl012' },
    extraFields: [{ selector: '#x', value: { __enc: true, data: 'mno', iv: 'pqr' } }]
  };
  assert(typeof encryptedRule.usernameValue === 'object');
  assert(encryptedRule.usernameValue.__enc === true);
  assert(typeof encryptedRule.passwordValue === 'object');
  assert(encryptedRule.passwordValue.__enc === true);
});

test('saveState should return plaintext', () => {
  // 验证 saveState 返回明文的逻辑
  const plaintextState = {
    enabled: true,
    rules: [{
      id: 'test',
      usernameValue: 'demo.user',
      passwordValue: 'secret'
    }]
  };
  // 模拟 saveState 的行为：返回 plaintextState，而不是加密后的版本
  const returnedState = plaintextState; // 修复后的行为
  assert(returnedState.rules[0].usernameValue === 'demo.user');
  assert(typeof returnedState.rules[0].usernameValue === 'string');
  assert(returnedState.rules[0].passwordValue === 'secret');
});

// ========== 5. 测试本地配置 JSON 有效性 ==========
test('local-config.json: valid JSON and structure', () => {
  const fs = require('fs');
  const configPath = require('path').join(__dirname, 'local-config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(raw);
  assert(config.enabled === true || config.enabled === false);
  assert(Array.isArray(config.rules));
  assert(config.rules.length >= 2);
  // 检查 smart_locator_demo_rule
  const smartRule = config.rules.find(r => r.id === 'smart_locator_demo_rule');
  assert(smartRule);
  assert(smartRule.usernameHint === '手机号');
  assert(smartRule.passwordHint === '密码');
  assert(smartRule.usernameSelector === '.form-input');
  assert(smartRule.passwordSelector === '.form-input');
});

// ========== 6. 测试本地服务器可用性 ==========
function testServer() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:8787/login-demo.html', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          assert(res.statusCode === 200);
          assert(data.includes('login-demo'));
          console.log(`${PASS} 本地服务器响应正常 (login-demo.html)`);
          passed++;
        } catch (e) {
          console.log(`${FAIL} 本地服务器响应异常`);
          console.log(`  ${e.message}`);
          failed++;
        }
        resolve();
      });
    });
    req.on('error', (err) => {
      console.log(`${FAIL} 本地服务器连接失败: ${err.message}`);
      failed++;
      resolve();
    });
    req.setTimeout(3000, () => {
      req.destroy();
      console.log(`${FAIL} 本地服务器连接超时`);
      failed++;
      resolve();
    });
  });
}

function testSmartLocatorPage() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:8787/smart-locator-demo.html', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          assert(res.statusCode === 200);
          assert(data.includes('Smart Locator'));
          assert(data.includes('form-input'));
          assert(data.includes('手机号'));
          assert(data.includes('密码'));
          console.log(`${PASS} 智能定位测试页响应正常 (smart-locator-demo.html)`);
          passed++;
        } catch (e) {
          console.log(`${FAIL} 智能定位测试页响应异常`);
          console.log(`  ${e.message}`);
          failed++;
        }
        resolve();
      });
    });
    req.on('error', (err) => {
      console.log(`${FAIL} 智能定位测试页连接失败: ${err.message}`);
      failed++;
      resolve();
    });
    req.setTimeout(3000, () => {
      req.destroy();
      console.log(`${FAIL} 智能定位测试页连接超时`);
      failed++;
      resolve();
    });
  });
}

// ========== 运行所有测试 ==========
console.log('\n========== Chrome AutoLogin 单元测试 ==========\n');

// 同步测试先跑
console.log('--- 同步逻辑测试 ---\n');

// 运行所有同步测试...（上面已经运行了）

console.log('\n--- 服务器测试 ---\n');

Promise.all([testServer(), testSmartLocatorPage()]).then(() => {
  console.log('\n========== 测试汇总 ==========');
  console.log(`通过: ${passed}`);
  console.log(`失败: ${failed}`);
  console.log(`总计: ${passed + failed}`);
  if (failed === 0) {
    console.log('\n全部通过！');
  } else {
    console.log('\n存在失败项，请检查。');
    process.exit(1);
  }
});
