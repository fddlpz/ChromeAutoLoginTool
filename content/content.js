(function () {
  const shared = self.AutoLoginConfig;

  if (!shared) {
    return;
  }

  // 尝试从 session storage 恢复加密密钥
  (async function restoreCryptoKey() {
    try {
      const session = await chrome.storage.session.get(shared.SESSION_KEY);
      if (session[shared.SESSION_KEY] && self.AutoLoginCrypto) {
        const key = await self.AutoLoginCrypto.importKeyRaw(session[shared.SESSION_KEY]);
        shared.setCryptoKey(key);
      }
    } catch (e) {
      console.warn("[AutoLogin] 恢复加密密钥失败:", e);
    }
  })();

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

  // ═══════════════════════════════════════════════════════════
  // 智能元素定位器（Smart Locator）
  // 当选择器不唯一或失效时，通过元素语义属性进行分层定位
  // ═══════════════════════════════════════════════════════════
  const SmartLocator = {
    USERNAME_HINTS: [
      "账号", "用户名", "手机号", "邮箱", "user", "phone", "email",
      "account", "login", "name", "mobile", "会员名", "账户", "account name"
    ],
    PASSWORD_HINTS: [
      "密码", "password", "pass", "passwd", "验证码", "code",
      "通行码", "verification", "captcha"
    ],
    SUBMIT_HINTS: [
      "登录", "提交", "login", "sign in", "signin", "submit",
      "进入", "确认", "登入", "log in"
    ],

    /** 检查元素是否匹配用户自定义提示 */
    matchesHint(element, hint) {
      if (!hint) return false;
      const h = hint.toLowerCase();
      const text = [
        element.placeholder,
        element.getAttribute("aria-label"),
        element.title,
        element.name,
        element.id,
        element.className,
        element.getAttribute("autocomplete"),
        element.textContent
      ].join(" ").toLowerCase();
      return text.includes(h);
    },

    /** 对元素进行多维度评分 */
    scoreElement(element, type) {
      let score = 0;
      const hints = type === "password" ? this.PASSWORD_HINTS :
                    type === "submit" ? this.SUBMIT_HINTS :
                    this.USERNAME_HINTS;

      const attrs = [
        element.placeholder,
        element.getAttribute("aria-label"),
        element.title,
        element.name,
        element.id,
        element.className,
        element.getAttribute("autocomplete"),
        element.getAttribute("data-placeholder")
      ].join(" ").toLowerCase();

      for (const hint of hints) {
        const hl = hint.toLowerCase();
        if (attrs.includes(hl)) score += 2;
      }

      // 精确属性匹配（权重更高）
      const placeholder = (element.placeholder || "").toLowerCase();
      const ariaLabel = (element.getAttribute("aria-label") || "").toLowerCase();
      const title = (element.title || "").toLowerCase();
      for (const hint of hints) {
        const hl = hint.toLowerCase();
        if (placeholder === hl) score += 5;
        if (ariaLabel === hl) score += 5;
        if (title === hl) score += 3;
      }

      // type 匹配
      if (type === "password" && element.type === "password") score += 4;
      if (type === "username" && ["text", "email", "tel"].includes(element.type)) score += 2;
      if (type === "submit" && (element.type === "submit" || element.tagName === "BUTTON")) score += 3;

      // autocomplete 标准属性
      const auto = element.getAttribute("autocomplete");
      if (type === "username" && auto && (auto.includes("username") || auto.includes("email"))) score += 5;
      if (type === "password" && auto && auto.includes("password")) score += 5;

      // 可见性
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.top >= 0) score += 1;

      // 可交互性
      if (!element.disabled && !element.readOnly) score += 1;

      return score;
    },

    /**
     * 核心定位函数
     * @param {string} selector  用户配置的选择器（可选）
     * @param {string} type      'username' | 'password' | 'submit'
     * @param {string} hint      可选的用户自定义提示文本
     * @returns {{element: Element, strategy: string, confidence: number} | null}
     */
    locate(selector, type, hint) {
      // L1: 选择器唯一匹配
      if (selector) {
        try {
          const all = document.querySelectorAll(selector);
          if (all.length === 1) {
            return { element: all[0], strategy: "selector-unique", confidence: 1.0 };
          }
          if (all.length > 1) {
            // 选择器匹配多个元素 → 评分筛选最优
            const scored = Array.from(all).map((el) => ({
              el,
              score: this.scoreElement(el, type) + (this.matchesHint(el, hint) ? 10 : 0)
            }));
            scored.sort((a, b) => b.score - a.score);
            if (scored[0].score > 3) {
              return {
                element: scored[0].el,
                strategy: "selector-multi-scored",
                confidence: Math.min(0.95, 0.6 + scored[0].score * 0.05)
              };
            }
          }
        } catch (e) {
          console.warn("[AutoLogin] 选择器无效:", selector, e);
        }
      }

      // L2: 全局推断（遍历页面所有候选元素）
      let candidates;
      if (type === "submit") {
        candidates = Array.from(document.querySelectorAll('input[type="submit"], button, [role="button"], [type="button"]'));
      } else {
        candidates = Array.from(document.querySelectorAll("input, textarea, select"));
      }

      const scored = candidates.map((el) => ({
        el,
        score: this.scoreElement(el, type) + (this.matchesHint(el, hint) ? 10 : 0)
      }));
      scored.sort((a, b) => b.score - a.score);

      if (scored.length > 0 && scored[0].score > 4) {
        return {
          element: scored[0].el,
          strategy: "global-inference",
          confidence: Math.min(0.85, 0.4 + scored[0].score * 0.05)
        };
      }

      // L3: 最终回退（选择器的第一个匹配）
      if (selector) {
        try {
          const first = document.querySelector(selector);
          if (first) {
            return { element: first, strategy: "selector-fallback", confidence: 0.3 };
          }
        } catch (e) {}
      }

      return null;
    }
  };

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

  /**
   * 智能填充：根据选择器 + 类型提示定位元素并填充值
   */
  function smartFill(selector, value, type, hint) {
    const result = SmartLocator.locate(selector, type, hint);
    if (!result) {
      console.warn("[AutoLogin] 无法定位元素:", type, selector);
      return false;
    }
    if (result.confidence < 0.5) {
      console.warn("[AutoLogin] 元素定位置信度较低:", type, result.strategy, result.confidence, "hint=", hint);
    }
    log("smartFill", `定位策略: ${result.strategy}, 置信度: ${result.confidence.toFixed(2)}, type: ${type}`);
    return fillElementValue(result.element, value);
  }

  /**
   * 智能等待：等待所有配置的目标元素可被定位
   * @param {Array<{selector?: string, type?: string, hint?: string}>} configs
   */
  function waitForSmartLocator(configs, timeoutMs) {
    const filtered = configs.filter((c) => c.selector || c.type);
    if (!filtered.length) {
      return Promise.resolve();
    }

    function hasAllFields() {
      return filtered.every((c) => SmartLocator.locate(c.selector, c.type, c.hint));
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
    // 尝试智能定位提交按钮
    const submitResult = SmartLocator.locate(rule.submitSelector, "submit", null);
    if (submitResult && submitResult.element) {
      if (submitResult.confidence < 0.5) {
        console.warn("[AutoLogin] 提交按钮定位置信度较低:", submitResult.strategy, submitResult.confidence);
      }
      submitResult.element.click();
      return submitResult.strategy;
    }

    // 回退：通过表单提交
    const passwordResult = SmartLocator.locate(rule.passwordSelector, "password", rule.passwordHint);
    const usernameResult = SmartLocator.locate(rule.usernameSelector, "username", rule.usernameHint);
    const form = query(rule.formSelector) ||
      (passwordResult && passwordResult.element && passwordResult.element.form) ||
      (usernameResult && usernameResult.element && usernameResult.element.form);

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

    await waitForSmartLocator(
      [
        { selector: rule.usernameSelector, type: "username", hint: rule.usernameHint },
        { selector: rule.passwordSelector, type: "password", hint: rule.passwordHint }
      ].concat(rule.extraFields.map((item) => ({ selector: item.selector }))),
      rule.waitTimeoutMs
    );

    smartFill(rule.usernameSelector, rule.usernameValue, "username", rule.usernameHint);
    smartFill(rule.passwordSelector, rule.passwordValue, "password", rule.passwordHint);
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

    // 如果配置已加密但值未被解密，跳过执行防止填入 [object Object]
    if (state.crypto && (typeof rule.usernameValue === "object" || typeof rule.passwordValue === "object")) {
      console.warn("[AutoLogin] 配置已加密但未正确解锁，跳过自动登录。");
      return {
        ok: true,
        status: "locked"
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
