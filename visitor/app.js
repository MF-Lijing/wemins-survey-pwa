/* 访客自助登记页。数据加密后提交给 Cloudflare Worker，再由 Worker 写入公开仓库。
 * 无评分、无采集人切换：采集人固定为「威敏斯仪器」。 */
(function () {
  "use strict";

  var RULES = null;
  var CONFIG = window.WM_CONFIG || {};
  var QUEUE_KEY = "wm2.queue.v1";
  var DRAFT_KEY = "wm2.draft.v1";
  var COLLECTOR = "威敏斯仪器";

  var state = {
    researchType: "",
    researchCustom: "",
    workType: "",
    workCustom: "",
    sending: false
  };

  function $(id) { return document.getElementById(id); }
  function show(id) {
    ["view-form", "view-done", "view-queued", "view-unconfigured"].forEach(function (key) {
      var el = $(key);
      if (el) el.hidden = key !== id;
    });
    window.scrollTo(0, 0);
  }
  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function toast(msg, isError) {
    var el = $("formError");
    if (!msg) { el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.textContent = msg;
    el.style.color = isError === false ? "var(--ok)" : "var(--err)";
    if (isError === false) setTimeout(function () { el.hidden = true; }, 2200);
  }

  // ---------------------------------------------------------------- 渲染
  function hydrateText() {
    var app = RULES.app || {};
    var f = RULES.fields || {};
    if (app.name) {
      $("appTitle").textContent = app.name + (app.version ? " v" + app.version : "");
      document.title = app.name + " · 访客登记";
    }
    if (app.subtitle) $("appSubtitle").textContent = app.subtitle;
    if (f.unitName) {
      $("unitNameLabel").innerHTML = esc(f.unitName.label) + ' <span class="req">*</span>';
      $("unitName").placeholder = f.unitName.placeholder || "";
      $("unitNameHint").textContent = "";
    }
    if (f.visitorName) {
      $("visitorNameLabel").innerHTML = esc(f.visitorName.label) + ' <span class="req">*</span>';
      $("visitorName").placeholder = f.visitorName.placeholder || "";
    }
    if (f.phone) {
      $("phoneLabel").innerHTML = esc(f.phone.label) + ' <span class="req">*</span>';
      $("phone").placeholder = f.phone.placeholder || "";
      $("phoneHint").textContent = f.phone.validationHint || "";
    }
    if (f.email) {
      $("emailLabel").textContent = f.email.label;
      $("email").placeholder = f.email.placeholder || "";
      $("emailHint").textContent = "";
    }
    if (f.researchDirection) {
      $("researchLabel").innerHTML = esc(f.researchDirection.label) + ' <span class="req">*</span>';
      $("researchCustom").placeholder = f.researchDirection.customPlaceholder || "请填写";
    }
    if (f.workDirection) {
      $("workLabel").innerHTML = esc(f.workDirection.label) + ' <span class="req">*</span>';
      $("workCustom").placeholder = f.workDirection.customPlaceholder || "请填写";
    }
    if (f.expectation) {
      $("expectationLabel").textContent = f.expectation.label;
      $("expectation").placeholder = f.expectation.placeholder || "";
      $("expectationHint").textContent = f.expectation.hint || "";
      $("expectation").maxLength = f.expectation.maxLength || 300;
    }
    var collectorLabel = (RULES.collector && RULES.collector.label) || "采集人";
    $("privacyNote").textContent = "信息仅用于会后技术交流，不上传第三方平台。";
    $("footBrand").textContent = (app.company || "威敏斯仪器") + " · " + collectorLabel + "：" + COLLECTOR;
  }

  function renderChips(containerId, options, typeKey, customBoxId) {
    var box = $(containerId);
    box.innerHTML = options.map(function (opt) {
      var selected = state[typeKey] === opt;
      return '<button type="button" class="chip' + (selected ? " is-selected" : "") +
        '" data-option="' + esc(opt) + '">' + esc(opt) + "</button>";
    }).join("");
    Array.prototype.forEach.call(box.querySelectorAll(".chip"), function (chip) {
      chip.addEventListener("click", function () {
        var opt = chip.dataset.option;
        state[typeKey] = opt === state[typeKey] ? "" : opt;
        Array.prototype.forEach.call(box.querySelectorAll(".chip"), function (node) {
          node.classList.toggle("is-selected", node.dataset.option === state[typeKey]);
        });
        var isCustom = state[typeKey] === "自定义";
        $(customBoxId).hidden = !isCustom;
        if (isCustom) setTimeout(function () { $(customBoxId).querySelector("input").focus(); }, 60);
        saveDraft();
      });
    });
  }

  // ---------------------------------------------------------------- 草稿
  function collect() {
    return {
      unitName: $("unitName").value.trim(),
      visitorName: $("visitorName").value.trim(),
      phone: $("phone").value.trim(),
      email: $("email").value.trim(),
      researchType: state.researchType === "自定义" ? "自定义" : state.researchType,
      researchCustom: state.researchType === "自定义" ? $("researchCustom").value.trim() : "",
      workType: state.workType === "自定义" ? "自定义" : state.workType,
      workCustom: state.workType === "自定义" ? $("workCustom").value.trim() : "",
      expectation: $("expectation").value.trim()
    };
  }

  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(collect())); } catch (e) { /* 隐私模式忽略 */ }
  }

  function restoreDraft() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) { raw = null; }
    if (!raw) return;
    ["unitName", "visitorName", "phone", "email", "expectation"].forEach(function (key) {
      if (raw[key] && $(key)) $(key).value = raw[key];
    });
    if (raw.researchType) {
      state.researchType = raw.researchType;
      if (raw.researchType === "自定义") {
        $("researchCustomBox").hidden = false;
        $("researchCustom").value = raw.researchCustom || "";
      }
    }
    if (raw.workType) {
      state.workType = raw.workType;
      if (raw.workType === "自定义") {
        $("workCustomBox").hidden = false;
        $("workCustom").value = raw.workCustom || "";
      }
    }
    var opts = (RULES.fields.researchDirection || {}).options || [];
    renderChips("researchChips", opts, "researchType", "researchCustomBox");
    var wopts = (RULES.fields.workDirection || {}).options || [];
    renderChips("workChips", wopts, "workType", "workCustomBox");
  }

  // ---------------------------------------------------------------- 校验
  function validate(data) {
    if (!data.unitName) return "请填写单位名称";
    if (!data.visitorName) return "请填写姓名";
    var phonePattern = new RegExp((RULES.fields.phone || {}).validationPattern || "^1[3-9]\\d{9}$");
    if (!data.phone) return "请填写手机号";
    if (!phonePattern.test(data.phone)) return "请输入正确的 11 位手机号";
    if (data.email) {
      var emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
      if (!emailPattern.test(data.email)) return "邮箱格式不正确";
    }
    if (!data.researchType) return "请选择研究方向";
    if (data.researchType === "自定义" && !data.researchCustom) return "请填写研究方向";
    if (!data.workType) return "请选择工作方向";
    if (data.workType === "自定义" && !data.workCustom) return "请填写工作方向";
    return "";
  }

  // ---------------------------------------------------------------- 提交
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
    return String(Date.now()) + Math.random().toString(16).slice(2, 10);
  }

  function stamp() {
    var d = new Date();
    function p(n) { return n < 10 ? "0" + n : "" + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
      p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  async function post(envelope) {
    var resp = await fetch(CONFIG.submitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope)
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return resp.json();
  }

  function enqueue(envelope) {
    var queue = [];
    try { queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch (e) { queue = []; }
    queue.push(envelope);
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch (e) { /* 忽略 */ }
  }

  async function flushQueue() {
    var queue = [];
    try { queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch (e) { return; }
    if (!queue.length) return;
    var left = [];
    for (var i = 0; i < queue.length; i++) {
      try { await post(queue[i]); } catch (e) { left.push(queue[i]); }
    }
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(left)); } catch (e) { /* 忽略 */ }
  }

  async function submit(event) {
    if (event) event.preventDefault();
    if (state.sending) return;
    var data = collect();
    var error = validate(data);
    if (error) { toast(error); return; }
    toast("");

    if (!CONFIG.submitUrl || !CONFIG.publicKey) { show("view-unconfigured"); return; }

    var payload = {
      id: newId(),
      collector: COLLECTOR,
      source: "qr",
      unitName: data.unitName,
      visitorName: data.visitorName,
      phone: data.phone,
      email: data.email,
      researchType: data.researchType,
      researchCustom: data.researchCustom,
      workType: data.workType,
      workCustom: data.workCustom,
      expectation: data.expectation,
      submittedAt: stamp(),
      ua: navigator.userAgent.slice(0, 120)
    };

    state.sending = true;
    $("submitBtn").disabled = true;
    $("submitBtn").textContent = "提交中…";

    try {
      var envelope = await window.WMVault.seal(payload, CONFIG.publicKey);
      try {
        await post(envelope);
        try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* 忽略 */ }
        show("view-done");
      } catch (netErr) {
        enqueue(envelope);
        show("view-queued");
      }
    } catch (cryptoErr) {
      toast(cryptoErr.message || "加密失败，请用系统浏览器重试");
    } finally {
      state.sending = false;
      $("submitBtn").disabled = false;
      $("submitBtn").textContent = "提交";
    }
  }

  function resetForm() {
    $("surveyForm").reset();
    state.researchType = "";
    state.workType = "";
    $("researchCustomBox").hidden = true;
    $("workCustomBox").hidden = true;
    renderChips("researchChips", RULES.fields.researchDirection.options, "researchType", "researchCustomBox");
    renderChips("workChips", RULES.fields.workDirection.options, "workType", "workCustomBox");
    toast("");
    show("view-form");
  }

  // ---------------------------------------------------------------- 启动
  async function loadRules() {
    if (window.__WM_RULES__) return window.__WM_RULES__;
    var resp = await fetch("rules.json", { cache: "no-cache" });
    if (!resp.ok) throw new Error("规则加载失败");
    return resp.json();
  }

  async function init() {
    try {
      RULES = await loadRules();
    } catch (e) {
      document.body.innerHTML = '<p style="padding:32px;font-size:15px">页面加载失败，请检查网络后重试。</p>';
      return;
    }
    hydrateText();
    renderChips("researchChips", RULES.fields.researchDirection.options, "researchType", "researchCustomBox");
    renderChips("workChips", RULES.fields.workDirection.options, "workType", "workCustomBox");
    restoreDraft();

    if (!CONFIG.submitUrl || !CONFIG.publicKey) {
      show("view-unconfigured");
      return;
    }

    $("surveyForm").addEventListener("submit", submit);
    $("againBtn").addEventListener("click", resetForm);
    $("retryBtn").addEventListener("click", async function () {
      await flushQueue();
      show("view-done");
    });
    ["unitName", "visitorName", "phone", "email", "researchCustom", "workCustom", "expectation"].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener("input", saveDraft);
    });

    $("phone").addEventListener("input", function () {
      var pattern = new RegExp((RULES.fields.phone || {}).validationPattern || "^1[3-9]\\d{9}$");
      var value = $("phone").value.trim();
      var hint = $("phoneHint");
      hint.className = "hint";
      hint.textContent = (RULES.fields.phone || {}).validationHint || "";
      if (!value) return;
      if (pattern.test(value)) {
        hint.classList.add("ok");
        hint.textContent = "格式正确";
      }
    });

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) flushQueue();
    });
    window.addEventListener("online", flushQueue);
    flushQueue();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
