(function () {
  const shared = self.AutoLoginConfig;
  const crypto = self.AutoLoginCrypto;

  const dom = {
    form: document.getElementById("ruleForm"),
    formTitle: document.getElementById("formTitle"),
    globalEnabled: document.getElementById("globalEnabled"),
    ruleStats: document.getElementById("ruleStats"),
    ruleList: document.getElementById("ruleList"),
    exportButton: document.getElementById("exportButton"),
    importButton: document.getElementById("importButton"),
    importFile: document.getElementById("importFile"),
    resetButton: document.getElementById("resetButton"),
    cryptoPanel: document.getElementById("cryptoPanel"),
    cryptoSetup: document.getElementById("cryptoSetup"),
    cryptoUnlock: document.getElementById("cryptoUnlock"),
    cryptoActive: document.getElementById("cryptoActive"),
    cryptoChange: document.getElementById("cryptoChange"),
    masterPassword: document.getElementById("masterPassword"),
    masterPasswordConfirm: document.getElementById("masterPasswordConfirm"),
    setupCryptoButton: document.getElementById("setupCryptoButton"),
    unlockPassword: document.getElementById("unlockPassword"),
    unlockButton: document.getElementById("unlockButton"),
    disableCryptoButton: document.getElementById("disableCryptoButton"),
    relockButton: document.getElementById("relockButton"),
    changePasswordButton: document.getElementById("changePasswordButton"),
    currentPassword: document.getElementById("currentPassword"),
    newPassword: document.getElementById("newPassword"),
    confirmChangePasswordButton: document.getElementById("confirmChangePasswordButton"),
    cancelChangePasswordButton: document.getElementById("cancelChangePasswordButton"),
    fields: {
      id: document.getElementById("ruleId"),
      name: document.getElementById("name"),
      urlPatterns: document.getElementById("urlPatterns"),
      usernameSelector: document.getElementById("usernameSelector"),
      usernameValue: document.getElementById("usernameValue"),
      usernameHint: document.getElementById("usernameHint"),
      passwordSelector: document.getElementById("passwordSelector"),
      passwordValue: document.getElementById("passwordValue"),
      passwordHint: document.getElementById("passwordHint"),
      submitSelector: document.getElementById("submitSelector"),
      formSelector: document.getElementById("formSelector"),
      alreadyLoggedInSelector: document.getElementById("alreadyLoggedInSelector"),
      extraFields: document.getElementById("extraFields"),
      waitTimeoutMs: document.getElementById("waitTimeoutMs"),
      submitDelayMs: document.getElementById("submitDelayMs"),
      notes: document.getElementById("notes"),
      enabled: document.getElementById("enabled"),
      autoSubmit: document.getElementById("autoSubmit")
    }
  };

  let currentState = shared.DEFAULT_STATE;

  function showToast(message) {
    const existing = document.querySelector(".toast");
    if (existing) {
      existing.remove();
    }
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 2400);
  }

  function isDecryptError(error) {
    return !!(error && error.code === shared.DECRYPT_ERROR_CODE);
  }

  async function getStoredStateForCrypto() {
    if (typeof shared.getStoredState === "function") {
      return shared.getStoredState();
    }
    const raw = await chrome.storage.local.get(shared.STORAGE_KEY);
    return shared.normalizeState(raw[shared.STORAGE_KEY] || shared.DEFAULT_STATE);
  }

  function parseExtraFields(text) {
    const raw = String(text || "").trim();
    if (!raw) return [];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error("高级附加字段必须是合法 JSON 数组");
    }
    if (!Array.isArray(parsed)) {
      throw new Error("高级附加字段必须是数组");
    }
    return parsed.map((item) => ({
      selector: String(item.selector || "").trim(),
      value: item.value !== undefined && item.value !== null ? String(item.value) : ""
    }));
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function resetForm() {
    dom.form.reset();
    dom.formTitle.textContent = "新增规则";
    dom.fields.id.value = "";
    dom.fields.waitTimeoutMs.value = "15000";
    dom.fields.submitDelayMs.value = "400";
    dom.fields.enabled.checked = true;
    dom.fields.autoSubmit.checked = true;
    dom.fields.extraFields.value = "";
    dom.fields.usernameHint.value = "";
    dom.fields.passwordHint.value = "";
  }

  function fillForm(rule) {
    dom.formTitle.textContent = `编辑规则：${rule.name}`;
    dom.fields.id.value = rule.id;
    dom.fields.name.value = rule.name;
    dom.fields.urlPatterns.value = rule.urlPatterns.join("\n");
    dom.fields.usernameSelector.value = rule.usernameSelector;
    dom.fields.usernameValue.value = rule.usernameValue;
    dom.fields.usernameHint.value = rule.usernameHint || "";
    dom.fields.passwordSelector.value = rule.passwordSelector;
    dom.fields.passwordValue.value = rule.passwordValue;
    dom.fields.passwordHint.value = rule.passwordHint || "";
    dom.fields.submitSelector.value = rule.submitSelector || "";
    dom.fields.formSelector.value = rule.formSelector || "";
    dom.fields.alreadyLoggedInSelector.value = rule.alreadyLoggedInSelector || "";
    dom.fields.extraFields.value = rule.extraFields.length ? JSON.stringify(rule.extraFields, null, 2) : "";
    dom.fields.waitTimeoutMs.value = String(rule.waitTimeoutMs);
    dom.fields.submitDelayMs.value = String(rule.submitDelayMs);
    dom.fields.notes.value = rule.notes || "";
    dom.fields.enabled.checked = rule.enabled !== false;
    dom.fields.autoSubmit.checked = rule.autoSubmit !== false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function collectFormData() {
    const urlPatterns = dom.fields.urlPatterns.value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!urlPatterns.length) {
      throw new Error("至少填写一个目标 URL 模式");
    }
    return shared.normalizeRule({
      id: dom.fields.id.value || shared.createId(),
      name: dom.fields.name.value,
      urlPatterns,
      usernameSelector: dom.fields.usernameSelector.value,
      usernameValue: dom.fields.usernameValue.value,
      usernameHint: dom.fields.usernameHint.value,
      passwordSelector: dom.fields.passwordSelector.value,
      passwordValue: dom.fields.passwordValue.value,
      passwordHint: dom.fields.passwordHint.value,
      submitSelector: dom.fields.submitSelector.value,
      formSelector: dom.fields.formSelector.value,
      alreadyLoggedInSelector: dom.fields.alreadyLoggedInSelector.value,
      extraFields: parseExtraFields(dom.fields.extraFields.value),
      waitTimeoutMs: dom.fields.waitTimeoutMs.value,
      submitDelayMs: dom.fields.submitDelayMs.value,
      notes: dom.fields.notes.value,
      enabled: dom.fields.enabled.checked,
      autoSubmit: dom.fields.autoSubmit.checked
    });
  }

  function describePatterns(rule) {
    return rule.urlPatterns.map((pattern) => `<code>${escapeHtml(pattern)}</code>`).join("<br>");
  }

  function renderRules(rules) {
    dom.ruleStats.textContent = `${rules.length} 条规则`;
    if (!rules.length) {
      dom.ruleList.className = "rule-list empty";
      dom.ruleList.innerHTML = "<p>还没有规则，先在左侧新增一条吧。</p>";
      return;
    }
    dom.ruleList.className = "rule-list";
    dom.ruleList.innerHTML = "";
    rules.forEach((rule) => {
      const item = document.createElement("article");
      item.className = "rule-item";
      item.innerHTML = `
        <div class="rule-top">
          <div>
            <h3>${escapeHtml(rule.name)}</h3>
            <div class="rule-badges">
              <span class="badge ${rule.enabled ? "enabled" : "disabled"}">${rule.enabled ? "已启用" : "已停用"}</span>
              <span class="badge">${rule.autoSubmit ? "自动提交" : "仅填充"}</span>
            </div>
          </div>
          <div class="rule-actions">
            <button class="secondary" type="button" data-action="edit" data-id="${rule.id}">编辑</button>
            <button class="secondary" type="button" data-action="duplicate" data-id="${rule.id}">复制</button>
            <button class="ghost" type="button" data-action="delete" data-id="${rule.id}">删除</button>
          </div>
        </div>
        <div class="rule-meta">
          <div><strong>URL 模式：</strong><br>${describePatterns(rule)}</div>
          <div><strong>账号：</strong> <code>${escapeHtml(rule.usernameSelector)}</code>${rule.usernameHint ? ` <span class="hint-tag">hint: ${escapeHtml(rule.usernameHint)}</span>` : ""}</div>
          <div><strong>密码：</strong> <code>${escapeHtml(rule.passwordSelector)}</code>${rule.passwordHint ? ` <span class="hint-tag">hint: ${escapeHtml(rule.passwordHint)}</span>` : ""}</div>
          <div><strong>提交：</strong> <code>${escapeHtml(rule.submitSelector || rule.formSelector || "自动推断")}</code></div>
          <div><strong>等待/延迟：</strong> ${rule.waitTimeoutMs}ms / ${rule.submitDelayMs}ms</div>
          ${rule.notes ? `<div><strong>备注：</strong> ${escapeHtml(rule.notes)}</div>` : ""}
        </div>
      `;
      dom.ruleList.appendChild(item);
    });
  }

  async function loadState() {
    try {
      currentState = await shared.getState();
    } catch (error) {
      if (!isDecryptError(error)) {
        throw error;
      }
      await shared.clearCryptoKey();
      currentState = await getStoredStateForCrypto();
    }
    dom.globalEnabled.checked = currentState.enabled !== false;
    renderRules(currentState.rules);
  }

  async function handleSave(event) {
    event.preventDefault();
    try {
      const rule = collectFormData();
      currentState = await shared.upsertRule(rule);
      renderRules(currentState.rules);
      resetForm();
      showToast("规则已保存");
    } catch (error) {
      alert(error.message || "保存失败");
    }
  }

  async function handleRuleAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const ruleId = button.dataset.id;
    const rule = currentState.rules.find((item) => item.id === ruleId);
    if (!rule) return;

    if (action === "edit") {
      fillForm(rule);
      return;
    }
    if (action === "duplicate") {
      currentState = await shared.upsertRule({
        ...rule,
        id: shared.createId(),
        name: `${rule.name}（副本）`
      });
      renderRules(currentState.rules);
      showToast("已复制规则");
      return;
    }
    if (action === "delete") {
      if (!window.confirm(`确认删除规则"${rule.name}"吗？`)) return;
      currentState = await shared.deleteRule(rule.id);
      renderRules(currentState.rules);
      if (dom.fields.id.value === rule.id) resetForm();
      showToast("规则已删除");
    }
  }

  async function handleExport() {
    const state = await shared.getState();
    const hasCrypto = !!state.crypto;
    const exportEncrypted = hasCrypto ? window.confirm("当前已启用加密。\n点「确定」导出加密配置（需要主口令才能导入）。\n点「取消」导出明文配置（敏感信息将暴露）") : false;

    let exportState;
    if (hasCrypto && exportEncrypted) {
      exportState = await shared.getState();
    } else {
      const raw = await chrome.storage.local.get(shared.STORAGE_KEY);
      exportState = raw[shared.STORAGE_KEY] || shared.DEFAULT_STATE;
    }

    const blob = new Blob([JSON.stringify(exportState, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportEncrypted ? "auto-login-config-encrypted.json" : "auto-login-config.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const importedState = parsed.rules ? shared.normalizeState(parsed) : shared.normalizeState({ rules: parsed });

      if (importedState.crypto && !confirm("导入的配置已加密。导入后会覆盖当前所有规则，是否继续？")) {
        return;
      }
      if (!importedState.crypto && !confirm("导入会覆盖当前所有规则，是否继续？")) {
        return;
      }

      await shared.saveState(importedState);
      if (importedState.crypto) {
        await shared.clearCryptoKey();
      }
      currentState = await shared.getState();
      renderRules(currentState.rules);
      dom.globalEnabled.checked = currentState.enabled !== false;
      resetForm();
      refreshCryptoUI();
      showToast("配置导入成功");
    } catch (error) {
      alert(error.message || "导入失败");
    } finally {
      event.target.value = "";
    }
  }

  function setCryptoVisible(visible) {
    if (visible) {
      dom.cryptoPanel.style.display = "block";
    } else {
      dom.cryptoPanel.style.display = "none";
    }
  }

  function showCryptoSection(section) {
    dom.cryptoSetup.style.display = section === "setup" ? "flex" : "none";
    dom.cryptoUnlock.style.display = section === "unlock" ? "flex" : "none";
    dom.cryptoActive.style.display = section === "active" ? "flex" : "none";
    dom.cryptoChange.style.display = section === "change" ? "flex" : "none";
  }

  async function refreshCryptoUI() {
    if (!crypto) {
      setCryptoVisible(false);
      return;
    }
    setCryptoVisible(true);
    const state = await getStoredStateForCrypto();
    const hasCryptoConfig = !!state.crypto;
    let key = await shared.getCryptoKey();

    if (hasCryptoConfig && key) {
      try {
        await shared.getState();
      } catch (error) {
        if (!isDecryptError(error)) {
          throw error;
        }
        await shared.clearCryptoKey();
        key = null;
      }
    }

    if (!hasCryptoConfig) {
      showCryptoSection("setup");
    } else if (key) {
      showCryptoSection("active");
    } else {
      showCryptoSection("unlock");
    }
  }

  async function handleSetupCrypto() {
    const pwd = dom.masterPassword.value;
    const confirm = dom.masterPasswordConfirm.value;
    if (!pwd) {
      alert("请输入主口令");
      return;
    }
    if (pwd !== confirm) {
      alert("两次输入的主口令不一致");
      return;
    }
    if (pwd.length < 6) {
      alert("主口令长度至少为 6 位");
      return;
    }

    try {
      const salt = crypto.generateSalt();
      const key = await crypto.deriveKey(pwd, salt);
      await shared.setCryptoKey(key);

      currentState = await shared.getState();
      currentState.crypto = { salt };
      await shared.saveState(currentState);

      dom.masterPassword.value = "";
      dom.masterPasswordConfirm.value = "";
      showToast("加密已启用");
      refreshCryptoUI();
    } catch (error) {
      alert("启用加密失败：" + (error.message || "未知错误"));
    }
  }

  async function handleUnlock() {
    const pwd = dom.unlockPassword.value;
    if (!pwd) {
      alert("请输入主口令");
      return;
    }
    try {
      const state = await getStoredStateForCrypto();
      if (!state.crypto || !state.crypto.salt) {
        alert("未检测到加密配置");
        return;
      }
      const key = await crypto.deriveKey(pwd, state.crypto.salt);
      await shared.setCryptoKey(key);
      try {
        currentState = await shared.getState();
      } catch (error) {
        await shared.clearCryptoKey();
        throw error;
      }
      renderRules(currentState.rules);

      dom.unlockPassword.value = "";
      showToast("已解锁");
      refreshCryptoUI();
    } catch (error) {
      alert("解锁失败，主口令可能不正确");
    }
  }

  async function handleRelock() {
    await shared.clearCryptoKey();
    currentState = await shared.getState();
    renderRules(currentState.rules);
    showToast("已锁定");
    refreshCryptoUI();
  }

  async function handleDisableCrypto() {
    if (!confirm("关闭加密会将所有敏感信息以明文存储，且不可逆。\n建议先导出备份。是否继续？")) {
      return;
    }
    try {
      const state = await getStoredStateForCrypto();
      const key = await shared.getCryptoKey();
      if (state.crypto && !key) {
        alert("请先解锁才能关闭加密");
        return;
      }
      await shared.clearCryptoKey();
      state.crypto = null;
      await shared.saveState(state);
      currentState = await shared.getState();
      renderRules(currentState.rules);
      showToast("加密已关闭");
      refreshCryptoUI();
    } catch (error) {
      alert("关闭加密失败：" + (error.message || "未知错误"));
    }
  }

  async function handleChangePassword() {
    showCryptoSection("change");
  }

  async function handleConfirmChangePassword() {
    const current = dom.currentPassword.value;
    const next = dom.newPassword.value;
    if (!current || !next) {
      alert("请输入当前主口令和新主口令");
      return;
    }
    if (next.length < 6) {
      alert("新主口令长度至少为 6 位");
      return;
    }

    try {
      const state = await getStoredStateForCrypto();
      if (!state.crypto || !state.crypto.salt) {
        alert("未启用加密");
        return;
      }
      const oldKey = await crypto.deriveKey(current, state.crypto.salt);
      await shared.setCryptoKey(oldKey);
      let decryptedState;
      try {
        decryptedState = await shared.getState();
      } catch (error) {
        await shared.clearCryptoKey();
        throw error;
      }

      const newSalt = crypto.generateSalt();
      const newKey = await crypto.deriveKey(next, newSalt);
      await shared.setCryptoKey(newKey);

      decryptedState.crypto = { salt: newSalt };
      try {
        await shared.saveState(decryptedState);
      } catch (error) {
        await shared.clearCryptoKey();
        throw error;
      }

      dom.currentPassword.value = "";
      dom.newPassword.value = "";
      currentState = decryptedState;
      renderRules(currentState.rules);
      showToast("主口令已更换");
      refreshCryptoUI();
    } catch (error) {
      alert("更换主口令失败，请确认当前主口令正确");
    }
  }

  function handleCancelChangePassword() {
    dom.currentPassword.value = "";
    dom.newPassword.value = "";
    refreshCryptoUI();
  }

  dom.form.addEventListener("submit", handleSave);
  dom.ruleList.addEventListener("click", handleRuleAction);
  dom.exportButton.addEventListener("click", handleExport);
  dom.importButton.addEventListener("click", () => dom.importFile.click());
  dom.importFile.addEventListener("change", handleImportFile);
  dom.resetButton.addEventListener("click", resetForm);
  dom.globalEnabled.addEventListener("change", async () => {
    currentState = await shared.setEnabled(dom.globalEnabled.checked);
    showToast(dom.globalEnabled.checked ? "扩展已启用" : "扩展已停用");
  });

  dom.setupCryptoButton.addEventListener("click", handleSetupCrypto);
  dom.unlockButton.addEventListener("click", handleUnlock);
  dom.relockButton.addEventListener("click", handleRelock);
  dom.disableCryptoButton.addEventListener("click", handleDisableCrypto);
  dom.changePasswordButton.addEventListener("click", handleChangePassword);
  dom.confirmChangePasswordButton.addEventListener("click", handleConfirmChangePassword);
  dom.cancelChangePasswordButton.addEventListener("click", handleCancelChangePassword);

  resetForm();
  loadState().catch((error) => { alert(error.message || "初始化失败"); });
  refreshCryptoUI();
})();
