(function () {
  const shared = self.AutoLoginConfig;

  if (!shared) {
    return;
  }

  const executionState = {
    lastUrl: location.href,
    appliedRuleIds: new Set()
  };
  let lastObservedUrl = location.href;
  let scheduledRunTimerId = null;

  function log(ruleName, message, extra) {
    const prefix = `[AutoLogin][${ruleName || "unknown"}]`;
    if (extra !== undefined) {
      console.info(prefix, message, extra);
      return;
    }

    console.info(prefix, message);
  }

  function syncExecutionState() {
    if (executionState.lastUrl === location.href) {
      return;
    }

    executionState.lastUrl = location.href;
    executionState.appliedRuleIds.clear();
  }

  function wasApplied(rule) {
    syncExecutionState();
    return executionState.appliedRuleIds.has(rule.id);
  }

  function markApplied(rule) {
    syncExecutionState();
    executionState.appliedRuleIds.add(rule.id);
  }

  function clearApplied(rule) {
    syncExecutionState();
    executionState.appliedRuleIds.delete(rule.id);
  }

  function resetAppliedState() {
    executionState.lastUrl = location.href;
    executionState.appliedRuleIds.clear();
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

  function scheduleAutoRun(reason) {
    if (scheduledRunTimerId) {
      clearTimeout(scheduledRunTimerId);
    }

    scheduledRunTimerId = setTimeout(() => {
      scheduledRunTimerId = null;
      log("system", `检测到${reason}，重新评估自动登录。`);
      runForCurrentPage(false).catch((error) => {
        console.warn("[AutoLogin] 重新评估自动登录失败：", error);
      });
    }, 0);
  }

  function handleUrlChange() {
    if (lastObservedUrl === location.href) {
      return;
    }

    lastObservedUrl = location.href;
    resetAppliedState();
    scheduleAutoRun("同 tab 页面切换");
  }

  function installNavigationWatchers() {
    window.addEventListener("hashchange", handleUrlChange);
    window.addEventListener("popstate", handleUrlChange);
    window.addEventListener("pageshow", (event) => {
      if (!event.persisted) {
        return;
      }

      lastObservedUrl = location.href;
      resetAppliedState();
      scheduleAutoRun("页面恢复");
    });

    ["pushState", "replaceState"].forEach((methodName) => {
      const original = history[methodName];
      if (typeof original !== "function") {
        return;
      }

      history[methodName] = function () {
        const result = original.apply(this, arguments);
        queueMicrotask(handleUrlChange);
        return result;
      };
    });
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

  installNavigationWatchers();
  runForCurrentPage(false).catch((error) => {
    console.warn("[AutoLogin] 初始化失败：", error);
  });
})();
