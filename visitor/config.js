/* 由 tools/gen_keys.py 生成，勿手改。
 * submitUrl 指向已部署的 Cloudflare Worker（见 worker/wrangler.toml）。
 * publicKey 为 RSA 公钥 JWK，可公开；对应私钥在 keys/private.pem，仅本机保存。 */
window.WM_CONFIG = {
  submitUrl: "https://wemins-visitor.pages.dev/api/submit",
  publicKey: {
  "kty": "RSA",
  "n": "pv3P69x6xjneD4uNGVW2ZlOpGAzmOCdthpp2aTta1I4jucHJVUawwZZbTXymB9XSXM-r4aWlKgkdbQZ_RLjuZOVExPaWsh7_WxA7hQG0k59MIHIYSwstm_TvUzsariXzA05EqytFK2kJ7w5rCvOHXutIDXct7cEtgoLGEWX9LJkqQzRFfK6WL8t-hAtY2_cckghhChVMGuCbkYRTKRb6iJLJKefj0Wz19S5O06B6u1Hy6gUUh2oxYTE3GO8rK3FG7kp6faaahabNYVRu4-jlbIp22LT9ePszOA7LKgMZ0ohNTPcNjkorovnHHGYTqF8GEe7RbJAr7gEnxPmujq1lrrc_cY_jroIVBMnlf18i6p1-8xXXc_3JlqAQaWEy_ixF39xNREo_XAn18UHK1kd1dnYASVl7AzhcVhX9QIxiww5q7s6XIEY9695bpt3q_M8z5znCE9R4QoR70RR-ijzo1_EcJIcei8mzUjmjwPZLLfaHW2TzTaRNEjqtxmMEujmJ",
  "e": "AQAB",
  "alg": "RSA-OAEP-256",
  "use": "enc",
  "kid": "wemins-2026"
},
  collector: "威敏斯仪器"
};
