(function (global) {
  const ENC_PREFIX = "__enc:";
  const ALGO = "AES-GCM";
  const KEY_LEN = 256;
  const SALT_LEN = 16;
  const IV_LEN = 12;
  const ITERATIONS = 100000;

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function generateSalt() {
    const bytes = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    return arrayBufferToBase64(bytes.buffer);
  }

  function generateIV() {
    const bytes = crypto.getRandomValues(new Uint8Array(IV_LEN));
    return arrayBufferToBase64(bytes.buffer);
  }

  async function deriveKey(password, saltBase64) {
    const salt = base64ToArrayBuffer(saltBase64);
    const encoder = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: new Uint8Array(salt), iterations: ITERATIONS, hash: "SHA-256" },
      passwordKey,
      { name: ALGO, length: KEY_LEN },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encrypt(plaintext, key) {
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const ciphertext = await crypto.subtle.encrypt(
      { name: ALGO, iv },
      key,
      encoder.encode(plaintext)
    );
    return {
      data: arrayBufferToBase64(ciphertext),
      iv: arrayBufferToBase64(iv.buffer)
    };
  }

  async function decrypt(encObj, key) {
    if (!encObj || typeof encObj !== "object" || !encObj.__enc) {
      return encObj;
    }
    const iv = new Uint8Array(base64ToArrayBuffer(encObj.iv));
    const ciphertext = base64ToArrayBuffer(encObj.data);
    const decrypted = await crypto.subtle.decrypt(
      { name: ALGO, iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  }

  function isEncrypted(value) {
    return value && typeof value === "object" && value.__enc === true;
  }

  function wrapEncrypted(data, iv) {
    return { __enc: true, data, iv };
  }

  async function encryptRule(rule, key) {
    if (!key) return rule;
    const clone = JSON.parse(JSON.stringify(rule));
    const fields = [
      { path: "usernameValue" },
      { path: "passwordValue" }
    ];
    for (const f of fields) {
      const val = clone[f.path];
      if (val && typeof val === "string" && val.length > 0 && !isEncrypted(val)) {
        const enc = await encrypt(val, key);
        clone[f.path] = wrapEncrypted(enc.data, enc.iv);
      }
    }
    if (Array.isArray(clone.extraFields)) {
      for (let i = 0; i < clone.extraFields.length; i++) {
        const val = clone.extraFields[i].value;
        if (val && typeof val === "string" && val.length > 0 && !isEncrypted(val)) {
          const enc = await encrypt(val, key);
          clone.extraFields[i].value = wrapEncrypted(enc.data, enc.iv);
        }
      }
    }
    return clone;
  }

  async function decryptRule(rule, key) {
    if (!key) return rule;
    const clone = JSON.parse(JSON.stringify(rule));
    const fields = ["usernameValue", "passwordValue"];
    for (const path of fields) {
      if (isEncrypted(clone[path])) {
        clone[path] = await decrypt(clone[path], key);
      }
    }
    if (Array.isArray(clone.extraFields)) {
      for (let i = 0; i < clone.extraFields.length; i++) {
        if (isEncrypted(clone.extraFields[i].value)) {
          clone.extraFields[i].value = await decrypt(clone.extraFields[i].value, key);
        }
      }
    }
    return clone;
  }

  async function encryptState(state, key) {
    if (!key || !state || !Array.isArray(state.rules)) return state;
    const rules = [];
    for (const rule of state.rules) {
      rules.push(await encryptRule(rule, key));
    }
    return { ...state, rules };
  }

  async function decryptState(state, key) {
    if (!key || !state || !Array.isArray(state.rules)) return state;
    const rules = [];
    for (const rule of state.rules) {
      rules.push(await decryptRule(rule, key));
    }
    return { ...state, rules };
  }

  async function exportKeyRaw(key) {
    const raw = await crypto.subtle.exportKey("raw", key);
    return arrayBufferToBase64(raw);
  }

  async function importKeyRaw(base64Key) {
    const raw = base64ToArrayBuffer(base64Key);
    return crypto.subtle.importKey(
      "raw",
      raw,
      { name: ALGO },
      false,
      ["encrypt", "decrypt"]
    );
  }

  global.AutoLoginCrypto = {
    ALGO,
    generateSalt,
    generateIV,
    deriveKey,
    encrypt,
    decrypt,
    isEncrypted,
    encryptRule,
    decryptRule,
    encryptState,
    decryptState,
    exportKeyRaw,
    importKeyRaw,
    wrapEncrypted
  };
})(self);
