/* 浏览器端混合加密：AES-256-GCM 加密数据 + RSA-OAEP(SHA-256) 包裹数据密钥。
 * 公钥可公开；私钥只在本机 tools/pull_decrypt.py 中使用，仓库里只有密文。
 * 需要安全上下文：https 或 localhost。 */
(function (global) {
  "use strict";

  function b64(buf) {
    var bytes = new Uint8Array(buf);
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return global.btoa(s);
  }

  function toJwk(raw) {
    var jwk = JSON.parse(global.atob(raw));
    return jwk;
  }

  var ENVELOPE_VERSION = 1;
  var ALG_LABEL = "RSA-OAEP-256+A256GCM";

  function available() {
    return !!(global.crypto && global.crypto.subtle && global.crypto.subtle.encrypt);
  }

  /**
   * @param {object} payload 明文记录
   * @param {object} publicJwk RSA 公钥 JWK（含 kid 可选）
   * @returns {Promise<object>} 信封 { v, alg, kid, iv, key, data }
   */
  async function seal(payload, publicJwk) {
    if (!available()) throw new Error("浏览器不支持 WebCrypto，请用系统浏览器打开");
    var plain = new TextEncoder().encode(JSON.stringify(payload));

    var aes = await global.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 }, true, ["encrypt"]
    );
    var rawKey = await global.crypto.subtle.exportKey("raw", aes);
    var iv = global.crypto.getRandomValues(new Uint8Array(12));
    var data = await global.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, aes, plain);

    var pub = await global.crypto.subtle.importKey(
      "jwk", publicJwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]
    );
    var wrapped = await global.crypto.subtle.encrypt({ name: "RSA-OAEP" }, pub, rawKey);

    return {
      v: ENVELOPE_VERSION,
      alg: ALG_LABEL,
      kid: publicJwk.kid || "",
      iv: b64(iv),
      key: b64(wrapped),
      data: b64(data),
      // 仅用于仓库文件命名与运维排错，不含个人信息
      id: payload.id,
      at: payload.submittedAt
    };
  }

  global.WMVault = { seal: seal, available: available, toJwk: toJwk };
})(window);
