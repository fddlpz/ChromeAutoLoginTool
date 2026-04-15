(function () {
  const shared = self.AutoLoginConfig;
  const dom = {
    globalEnabled: document.getElementById("globalEnabled"),
    currentUrl: document.getElementById("currentUrl"),
    matchedRule: document.getElementById("matchedRule"),
    statusHint: document.getElementById("statusHint"),
    rerunButton: document.getElementById("rerunButton"),
    openOptionsButton: document.getElementById("openOptionsButton")
  };

  let activeTab = null;
  let matchedRule = null;

  function setHint(message) {
    dom.statusHint.textContent = message;
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    return tabs[0] || null;
  }

  async function refreshView() {
    const [state, tab] = await Promise.all([
      shared.getState(),
      getActiveTab()
    ]);

    activeTab = tab;
    dom.globalEnabled.checked = state.enabled !== false;

    if (!tab || !tab.url) {
      dom.currentUrl.textContent = "无法读取当前标签页 URL";
      dom.matchedRule.textContent = "无";
      dom.rerunButton.disabled = true;
      setHint("请切换到普通网页标签页再使用。");
      return;
    }

    dom.currentUrl.textContent = tab.url;
    matchedRule = shared.findMatchingRule(state.rules, tab.url);

    if (!state.enabled) {
      dom.matchedRule.textContent = "扩展已全局停用";
      dom.rerunButton.disabled = true;
      setHint("开启扩展后，进入目标页面会自动执行。");
      return;
    }

    if (!matchedRule) {
      dom.matchedRule.textContent = "当前页面没有匹配到规则";
      dom.rerunButton.disabled = true;
      setHint("如果这是登录页，可以去配置页新增一条规则。");
      return;
    }

    dom.matchedRule.textContent = `${matchedRule.name}${matchedRule.enabled ? "" : "（规则已停用）"}`;
    dom.rerunButton.disabled = !matchedRule.enabled;
    setHint(matchedRule.enabled ? "进入页面时会自动执行，也可以手动再执行一次。" : "这条规则已停用，请先去配置页开启。");
  }

  async function rerunOnTab() {
    if (!activeTab || !activeTab.id || !matchedRule) {
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(activeTab.id, {
        type: "auto-login:rerun"
      });

      if (!response || response.ok === false) {
        throw new Error(response && response.message ? response.message : "执行失败");
      }

      setHint(`规则“${response.ruleName || matchedRule.name}”已执行，状态：${response.status}`);
    } catch (error) {
      setHint(`手动执行失败：${error.message || "请刷新页面后重试"}`);
    }
  }

  dom.globalEnabled.addEventListener("change", async () => {
    await shared.setEnabled(dom.globalEnabled.checked);
    await refreshView();
  });

  dom.rerunButton.addEventListener("click", rerunOnTab);
  dom.openOptionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

  refreshView().catch((error) => {
    dom.currentUrl.textContent = "初始化失败";
    dom.matchedRule.textContent = "无";
    setHint(error.message || "请重新打开弹窗");
  });
})();
