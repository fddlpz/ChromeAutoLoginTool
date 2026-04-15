(function () {
  const shared = self.AutoLoginConfig;

  if (!shared) {
    return;
  }

  const SESSION_PREFIX = "__auto_login_done__:";

  function log(ruleName, message, extra) {
    const prefix = `[AutoLogin][${ruleName || "unknown"}]`;
    if (extra !== undefined) {
      console.info(prefix, message, extra);
      return;
    }

    console.info(prefix, message);
  }

  function buildSessionKey(rule) {
    return `${SESSION_PREFIX}${rule.id}:${location.href}`;
  }

  function wasApplied(rule) {
    try {
      return sessionStorage.getItem(buildSessionKey(rule)) === "1";
    } catch (error) {
      return false;
    }
  }

  function markApplied(rule) {
    try {
      sessionStorage.setItem(buildSessionKey(rule), "1");
    } catch (error) {
      log(rule.name, "无法写入 sessionStorage，忽略去重标记。");
    }
  }

  function clearApplied(rule) {
    try {
      sessionStorage.removeItem(buildSessionKey(rule));
    } catch (error) {
      log(rule.name, "无法清理 sessionStorage 标记。");
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function query(selector) {
    if (!selector) {
      return null;
    }

    try {
      return document.querySelector(selector);
    } catch (error) {
      console.warn("[AutoLogin] 无效选择器：", selector, error);
      return null;
    }
  }

  function isAlreadyLoggedIn(rule) {
    return !!(rule.alreadyLoggedInSelector && query(rule.alreadyLoggedInSelector));
  }

  function resolveValueSetter(element) {
    if (element instanceof HTMLTextAreaElement) {
      return Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    }

    if (element instanceof HTMLInputElement) {
      return Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    }

    if (element instanceof HTMLSelectElement) {
      return Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    }

    return null;
  }

  function fillElementValue(element, value) {
    if (!element) {
      return false;
    }

    element.focus();

    if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
      element.checked = Boolean(value) && value !== "false";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    const descriptor = resolveValueSetter(element);
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();
    return true;
  }

  function fillBySelector(selector, value) {
    const element = query(selector);
    return fillElementValue(element, value);
  }

  function waitForFields(selectors, timeoutMs) {
    const filteredSelectors = selectors.filter(Boolean);

    if (!filteredSelectors.length) {
      return Promise.resolve();
    }

    function hasAllFields() {
      return filteredSelectors.every((selector) => query(selector));
    }

    if (hasAllFields()) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (hasAllFields()) {
          observer.disconnect();
          clearTimeout(timerId);
          resolve();
        }
      });

      const timerId = setTimeout(() => {
        observer.disconnect();
        reject(new Error("登录表单等待超时"));
      }, timeoutMs);

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    });
  }

  function submitRule(rule) {
    const submitButton = query(rule.submitSelector);
    if (submitButton) {
      submitButton.click();
      return "button";
    }

    const passwordField = query(rule.passwordSelector);
    const usernameField = query(rule.usernameSelector);
    const form = query(rule.formSelector) || (passwordField && passwordField.form) || (usernameField && usernameField.form);

    if (form && typeof form.requestSubmit === "function") {
      form.requestSubmit();
      return "requestSubmit";
    }

    if (form && typeof form.submit === "function") {
      form.submit();
      return "submit";
    }

    return "none";
  }

  async function applyRule(rule, options) {
    const force = options && options.force === true;

    if (!force && wasApplied(rule)) {
      log(rule.name, "当前会话已执行过，跳过重复提交。");
      return {
        ok: true,
        status: "skipped"
      };
    }

    if (isAlreadyLoggedIn(rule)) {
      markApplied(rule);
      log(rule.name, "检测到已登录状态，跳过自动登录。");
      return {
        ok: true,
        status: "already-logged-in"
      };
    }

    await waitForFields(
      [rule.usernameSelector, rule.passwordSelector].concat(rule.extraFields.map((item) => item.selector)),
      rule.waitTimeoutMs
    );

    fillBySelector(rule.usernameSelector, rule.usernameValue);
    fillBySelector(rule.passwordSelector, rule.passwordValue);
    rule.extraFields.forEach((item) => {
      fillBySelector(item.selector, item.value);
    });

    markApplied(rule);
    log(rule.name, "已完成表单填充。");

    if (!rule.autoSubmit) {
      return {
        ok: true,
        status: "filled"
      };
    }

    await sleep(rule.submitDelayMs);
    const submitStrategy = submitRule(rule);
    log(rule.name, "已触发提交。", submitStrategy);

    return {
      ok: true,
      status: "submitted",
      submitStrategy
    };
  }

  async function runForCurrentPage(force) {
    const state = await shared.getState();
    if (!state.enabled) {
      return {
        ok: true,
        status: "extension-disabled"
      };
    }

    const rule = shared.findMatchingRule(state.rules, location.href);
    if (!rule) {
      return {
        ok: true,
        status: "no-match"
      };
    }

    if (force) {
      clearApplied(rule);
    }

    try {
      const result = await applyRule(rule, { force: !!force });
      return Object.assign(result, { ruleName: rule.name });
    } catch (error) {
      console.warn("[AutoLogin] 自动登录执行失败：", error);
      return {
        ok: false,
        status: "error",
        message: error && error.message ? error.message : "执行失败",
        ruleName: rule.name
      };
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "auto-login:rerun") {
      return undefined;
    }

    runForCurrentPage(true)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          status: "error",
          message: error && error.message ? error.message : "执行失败"
        });
      });

    return true;
  });

  runForCurrentPage(false).catch((error) => {
    console.warn("[AutoLogin] 初始化失败：", error);
  });
})();
