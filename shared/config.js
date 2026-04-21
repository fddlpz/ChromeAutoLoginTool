(function (global) {
  const STORAGE_KEY = "autoLoginConfigState";
  const SESSION_KEY = "_autoLoginCryptoKey";
  const DECRYPT_ERROR_CODE = "AUTO_LOGIN_DECRYPT_FAILED";
  const DEFAULT_STATE = {
    enabled: true,
    rules: [],
    crypto: null
  };

  let _cryptoKey = null;

  function createId() {
    return `rule_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }

  function normalizeText(value, fallback) {
    if (value === undefined || value === null) {
      return fallback || "";
    }
    return String(value).trim();
  }

  function normalizeNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  function normalizePatterns(value) {
    if (Array.isArray(value)) {
      return value.map((item) => normalizeText(item)).filter(Boolean);
    }
    return normalizeText(value)
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function normalizeExtraFields(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => ({
        selector: normalizeText(item && item.selector),
        value: item && item.value !== undefined && item.value !== null ? String(item.value) : ""
      }))
      .filter((item) => item.selector);
  }

  function normalizeRule(rule) {
    const source = rule || {};
    return {
      id: normalizeText(source.id) || createId(),
      name: normalizeText(source.name) || "未命名规则",
      enabled: source.enabled !== false,
      urlPatterns: normalizePatterns(source.urlPatterns || source.urlPattern),
      usernameSelector: normalizeText(source.usernameSelector),
      usernameValue: source.usernameValue !== undefined && source.usernameValue !== null ? source.usernameValue : "",
      usernameHint: normalizeText(source.usernameHint),
      passwordSelector: normalizeText(source.passwordSelector),
      passwordValue: source.passwordValue !== undefined && source.passwordValue !== null ? source.passwordValue : "",
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

  function normalizeState(state) {
    const source = state || {};
    return {
      enabled: source.enabled !== false,
      rules: Array.isArray(source.rules) ? source.rules.map(normalizeRule) : [],
      crypto: source.crypto || null
    };
  }

  function hasCrypto() {
    return !!(global.AutoLoginCrypto && typeof global.AutoLoginCrypto.deriveKey === "function");
  }

  async function getCryptoKey() {
    if (_cryptoKey) return _cryptoKey;
    if (!hasCrypto()) return null;
    try {
      const session = await chrome.storage.session.get(SESSION_KEY);
      if (session[SESSION_KEY]) {
        _cryptoKey = await global.AutoLoginCrypto.importKeyRaw(session[SESSION_KEY]);
        return _cryptoKey;
      }
    } catch (e) {
      console.warn("[AutoLogin] 从 session 恢复加密密钥失败:", e);
    }
    return null;
  }

  async function setCryptoKey(key) {
    _cryptoKey = key;
    if (!key) {
      try { await chrome.storage.session.remove(SESSION_KEY); } catch (e) {}
      return;
    }
    if (!hasCrypto()) return;
    try {
      const raw = await global.AutoLoginCrypto.exportKeyRaw(key);
      await chrome.storage.session.set({ [SESSION_KEY]: raw });
    } catch (e) {
      console.warn("[AutoLogin] 保存加密密钥到 session 失败:", e);
    }
  }

  async function clearCryptoKey() {
    _cryptoKey = null;
    try { await chrome.storage.session.remove(SESSION_KEY); } catch (e) {}
  }

  async function getStoredState() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return normalizeState(result[STORAGE_KEY] || DEFAULT_STATE);
  }

  async function getState() {
    const normalized = await getStoredState();
    const key = await getCryptoKey();
    if (normalized.crypto && key && hasCrypto()) {
      try {
        return await global.AutoLoginCrypto.decryptState(normalized, key);
      } catch (e) {
        const error = new Error("Failed to decrypt encrypted state with the current master password.");
        error.code = DECRYPT_ERROR_CODE;
        error.cause = e;
        throw error;
        console.warn("[AutoLogin] 解密状态失败，可能主口令不正确:", e);
      }
    }
    return normalized;
  }

  async function saveState(state) {
    let normalized = normalizeState(state);
    const key = await getCryptoKey();
    if (key && hasCrypto()) {
      try {
        normalized = await global.AutoLoginCrypto.encryptState(normalized, key);
      } catch (e) {
        console.warn("[AutoLogin] 加密状态失败:", e);
      }
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
    return normalized;
  }

  async function setEnabled(enabled) {
    const state = await getState();
    state.enabled = !!enabled;
    return saveState(state);
  }

  async function upsertRule(rule) {
    const state = await getState();
    const normalized = normalizeRule(rule);
    const existingIndex = state.rules.findIndex((item) => item.id === normalized.id);
    if (existingIndex >= 0) {
      state.rules.splice(existingIndex, 1, normalized);
    } else {
      state.rules.unshift(normalized);
    }
    return saveState(state);
  }

  async function deleteRule(ruleId) {
    const state = await getState();
    state.rules = state.rules.filter((item) => item.id !== ruleId);
    return saveState(state);
  }

  function wildcardToRegExp(pattern) {
    const raw = normalizeText(pattern);
    if (!raw) {
      return null;
    }
    const escaped = raw.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i");
  }

  function matchesUrl(rule, url) {
    if (!rule || rule.enabled === false) {
      return false;
    }
    return normalizePatterns(rule.urlPatterns).some((pattern) => {
      const matcher = wildcardToRegExp(pattern);
      return matcher ? matcher.test(url) : false;
    });
  }

  function findMatchingRule(rules, url) {
    return (Array.isArray(rules) ? rules : []).find((rule) => matchesUrl(rule, url)) || null;
  }

  global.AutoLoginConfig = {
    STORAGE_KEY,
    SESSION_KEY,
    DECRYPT_ERROR_CODE,
    DEFAULT_STATE,
    createId,
    normalizeRule,
    normalizeState,
    getStoredState,
    getState,
    saveState,
    setEnabled,
    upsertRule,
    deleteRule,
    wildcardToRegExp,
    matchesUrl,
    findMatchingRule,
    getCryptoKey,
    setCryptoKey,
    clearCryptoKey,
    hasCrypto
  };
})(self);
