(function (global) {
  const STORAGE_KEY = "autoLoginConfigState";
  const DEFAULT_STATE = {
    enabled: true,
    rules: []
  };

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
      return value
        .map((item) => normalizeText(item))
        .filter(Boolean);
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
      usernameValue: source.usernameValue !== undefined && source.usernameValue !== null ? String(source.usernameValue) : "",
      passwordSelector: normalizeText(source.passwordSelector),
      passwordValue: source.passwordValue !== undefined && source.passwordValue !== null ? String(source.passwordValue) : "",
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
      rules: Array.isArray(source.rules) ? source.rules.map(normalizeRule) : []
    };
  }

  async function getState() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return normalizeState(result[STORAGE_KEY] || DEFAULT_STATE);
  }

  async function saveState(state) {
    const normalized = normalizeState(state);
    await chrome.storage.local.set({
      [STORAGE_KEY]: normalized
    });
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
    DEFAULT_STATE,
    createId,
    normalizeRule,
    normalizeState,
    getState,
    saveState,
    setEnabled,
    upsertRule,
    deleteRule,
    wildcardToRegExp,
    matchesUrl,
    findMatchingRule
  };
})(self);
