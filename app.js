/**
 * 威敏斯客户调研 · iPhone / PWA 应用逻辑
 *
 * 依赖：engine.js（纯评分引擎）、rules.json（唯一规则源）
 * 存储：localStorage（本机，不上传）；评分在保存时计算并持久化，读取不重算。
 */
(function () {
  "use strict";

  var STORE_RECORDS = "wm.records.v1";
  var STORE_COLLECTOR = "wm.collector.v1";

  var RULES = null;
  var state = {
    collector: "",
    researchType: "",
    workType: "",
    records: [],
    filter: "ALL",
    viewingId: null,
    sheetPick: ""
  };

  var recognition = null;
  var listeningButton = null;

  // ------------------------------------------------------------------ 工具
  function $(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toast(message, isError) {
    var el = $("toast");
    el.textContent = message;
    el.classList.toggle("is-error", !!isError);
    el.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      el.hidden = true;
    }, isError ? 3600 : 2200);
  }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      toast("本机存储已满或不可用，本次未保存", true);
      return false;
    }
  }

  function loadRules() {
    if (window.__WM_RULES__) return Promise.resolve(window.__WM_RULES__);
    return fetch("rules.json", { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .catch(function (err) {
        throw new Error("rules.json 读取失败：" + err.message);
      });
  }

  // ------------------------------------------------------------ 规则渲染
  function hydrateText() {
    var app = RULES.app || {};
    $("appName").textContent = app.name || "威敏斯客户调研";
    $("appSubtitle").textContent = [app.event, app.subtitle].filter(Boolean).join(" · ");
    document.title = app.name || "威敏斯客户调研";

    var collectorCfg = RULES.collector || {};
    document.querySelector(".collector-chip-label").textContent = collectorCfg.label || "采集人";
    $("sheetTitle").textContent = collectorCfg.switchTitle || "切换采集人";
    $("sheetHint").textContent = collectorCfg.hint || "";

    var fields = RULES.fields || {};

    function labelOf(key, fallbackLabel, required) {
      var node = document.querySelector('[for="' + key + '"]');
      if (!node) return;
      var label = (fields[key] && fields[key].label) || fallbackLabel;
      node.innerHTML = esc(label) + (required ? '<span class="req">*</span>' : "");
    }

    labelOf("unitName", "单位名称", true);
    labelOf("visitorName", "姓名", true);
    labelOf("phone", "手机号", true);
    labelOf("email", "邮箱", false);
    labelOf("expectation", (fields.expectation && fields.expectation.label) || "对产品期待", false);

    ["unitName", "visitorName", "phone", "email", "expectation"].forEach(function (key) {
      var input = $(key);
      var cfg = fields[key];
      if (!input || !cfg) return;
      input.placeholder = cfg.placeholder || "";
      if (cfg.maxLength) input.maxLength = cfg.maxLength;
    });

    $("unitNameHint").textContent = fields.unitName && fields.unitName.hint ? fields.unitName.hint : "";
    $("phoneHint").textContent = (fields.phone && fields.phone.validationHint) || "";
    $("expectationHint").textContent = (fields.expectation && fields.expectation.hint) || "";

    if (fields.expectation && fields.expectation.maxLength) {
      $("expectation").addEventListener("input", updateExpectationCounter);
      updateExpectationCounter();
    }

    var voiceHint = (RULES.voice && RULES.voice.prompt) || "点击麦克风说话";
    $("researchVoiceHint").textContent =
      (fields.researchDirection && fields.researchDirection.voiceHint) || voiceHint;
    $("workVoiceHint").textContent =
      (fields.workDirection && fields.workDirection.voiceHint) || voiceHint;

    var directionLabels = document.querySelectorAll("#surveyForm .card:nth-of-type(2) label");
    if (directionLabels.length >= 2) {
      directionLabels[0].innerHTML =
        esc((fields.researchDirection && fields.researchDirection.label) || "研究方向") +
        '<span class="req">*</span>';
      directionLabels[1].innerHTML =
        esc((fields.workDirection && fields.workDirection.label) || "工作方向") +
        '<span class="req">*</span>';
    }

    $("researchCustom").placeholder =
      (fields.researchDirection && fields.researchDirection.customPlaceholder) || "";
    $("workCustom").placeholder =
      (fields.workDirection && fields.workDirection.customPlaceholder) || "";
    $("collectorCustom").placeholder =
      (RULES.collector && RULES.collector.customPlaceholder) || "输入姓名";
  }

  function updateExpectationCounter() {
    var cfg = RULES.fields.expectation || {};
    var value = $("expectation").value || "";
    if (!cfg.maxLength) return;
    var text = value.length + " / " + cfg.maxLength;
    $("expectationHint").textContent = (cfg.hint || "") + "（" + text + "）";
  }

  function renderDirectionChips(containerId, config, selected) {
    var box = $(containerId);
    box.innerHTML = "";
    (config.options || []).forEach(function (option) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "chip" + (option === selected ? " is-selected" : "");
      button.textContent = option;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", option === selected ? "true" : "false");
      button.dataset.value = option;
      button.addEventListener("click", function () {
        var isCustom = option === (config.customValue || "自定义");
        if (containerId === "researchChips") {
          state.researchType = option;
          renderDirectionChips("researchChips", config, option);
          $("researchCustomBox").hidden = !isCustom;
          if (isCustom) $("researchCustom").focus();
        } else {
          state.workType = option;
          renderDirectionChips("workChips", config, option);
          $("workCustomBox").hidden = !isCustom;
          if (isCustom) $("workCustom").focus();
        }
        clearError();
      });
      box.appendChild(button);
    });
  }

  // --------------------------------------------------------------- 采集人
  function applyCollector(name) {
    state.collector = name;
    $("collectorName").textContent = name || "未选择";
    if (name) writeJSON(STORE_COLLECTOR, name);
    renderHistory();
  }

  function openCollectorSheet() {
    state.sheetPick = state.collector || (RULES.collector && RULES.collector.defaultName) || "";
    $("sheetBackdrop").hidden = false;
    renderCollectorChips();
    var customBox = $("collectorCustomBox");
    var customAllowed = !!(RULES.collector && RULES.collector.allowCustom !== false);
    $("collectorCustom").value = customAllowed ? state.sheetPick : "";
    customBox.hidden = !customAllowed;
    if (customAllowed) {
      $("collectorCustom").hidden = false;
      $("collectorCustom").value = state.sheetPick;
    }
  }

  function renderCollectorChips() {
    var box = $("collectorChips");
    box.innerHTML = "";
    (RULES.collectors || []).forEach(function (name) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "chip" + (name === state.sheetPick ? " is-selected" : "");
      button.textContent = name;
      button.dataset.value = name;
      button.addEventListener("click", function () {
        state.sheetPick = name;
        renderCollectorChips();
        $("collectorCustom").value = "";
      });
      box.appendChild(button);
    });
    if (!(RULES.collectors || []).length) {
      box.hidden = true;
    }
  }

  function confirmCollector() {
    var custom = ($("collectorCustom").value || "").trim();
    var chosen = custom || state.sheetPick;
    if (!chosen) {
      toast("请选择或输入采集人姓名", true);
      return;
    }
    applyCollector(chosen);
    $("sheetBackdrop").hidden = true;
    toast("当前采集人：" + chosen);
  }

  // ----------------------------------------------------------------- 语音
  function setupVoice() {
    var buttons = document.querySelectorAll("[data-voice-target]");
    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener("click", function () {
        startVoice(button);
      });
    });
  }

  function startVoice(button) {
    var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      toast((RULES.voice && RULES.voice.unavailableHint) || "本机语音识别不可用，请改用键盘输入", true);
      return;
    }
    var target = $(button.dataset.voiceTarget);
    if (!target) return;

    if (recognition && listeningButton === button) {
      recognition.stop();
      return;
    }
    if (recognition) {
      try { recognition.abort(); } catch (err) { /* 忽略 */ }
    }

    recognition = new Recognition();
    recognition.lang = (RULES.voice && RULES.voice.language) || "zh-CN";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    listeningButton = button;
    button.classList.add("is-listening");

    recognition.onresult = function (event) {
      var text = "";
      for (var i = event.resultIndex; i < event.results.length; i += 1) {
        text += event.results[i][0].transcript;
      }
      text = text.trim();
      if (!text) return;
      var current = target.value || "";
      var needsSpace = current && /[\w)]$/.test(current) && /^[\w(]/.test(text);
      target.value = current + (current && needsSpace ? " " : current ? "" : "") + text;
      target.dispatchEvent(new Event("input", { bubbles: true }));
    };

    recognition.onerror = function (event) {
      var message = event && event.error === "not-allowed"
        ? "未获得麦克风权限，请在 Safari 设置中允许"
        : "语音识别失败，请改用键盘输入";
      toast(message, true);
    };

    recognition.onend = function () {
      button.classList.remove("is-listening");
      if (listeningButton === button) listeningButton = null;
    };

    try {
      recognition.start();
    } catch (err) {
      button.classList.remove("is-listening");
      toast("无法启动语音识别", true);
    }
  }

  // --------------------------------------------------------------- 表单
  function clearError() {
    var box = $("formError");
    box.hidden = true;
    box.textContent = "";
  }

  function showError(message) {
    var box = $("formError");
    box.textContent = message;
    box.hidden = false;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function collectInput() {
    return {
      collector: state.collector,
      unitName: ($("unitName").value || "").trim(),
      visitorName: ($("visitorName").value || "").trim(),
      phone: ($("phone").value || "").trim(),
      email: ($("email").value || "").trim(),
      researchType: state.researchType,
      researchCustom: ($("researchCustom").value || "").trim(),
      workType: state.workType,
      workCustom: ($("workCustom").value || "").trim(),
      expectation: ($("expectation").value || "").trim()
    };
  }

  function resetForm(keepCollector) {
    $("surveyForm").reset();
    state.researchType = "";
    state.workType = "";
    $("researchCustomBox").hidden = true;
    $("workCustomBox").hidden = true;
    $("researchCustom").value = "";
    $("workCustom").value = "";
    renderDirectionChips("researchChips", RULES.fields.researchDirection, "");
    renderDirectionChips("workChips", RULES.fields.workDirection, "");
    clearError();
    updateExpectationCounter();
    if (!keepCollector) {
      $("collectorName").textContent = "未选择";
    }
  }

  function validate(input) {
    var fields = RULES.fields || {};
    if (!input.collector) return "请先选择采集人（点右上角姓名）";
    if (fields.unitName && fields.unitName.required && !input.unitName) return "请填写单位名称";
    if (fields.visitorName && fields.visitorName.required && !input.visitorName) return "请填写访客姓名";
    if (fields.researchDirection && fields.researchDirection.required && !input.researchType) {
      return "请选择研究方向";
    }
    if (fields.workDirection && fields.workDirection.required && !input.workType) {
      return "请选择工作方向";
    }
    var researchCustom = RULES.fields.researchDirection.customValue || "自定义";
    if (input.researchType === researchCustom && !input.researchCustom) {
      return "已选「自定义」，请填写具体研究方向";
    }
    var workCustom = RULES.fields.workDirection.customValue || "自定义";
    if (input.workType === workCustom && !input.workCustom) {
      return "已选「自定义」，请填写具体工作方向";
    }
    return "";
  }

  function onSubmit(event) {
    event.preventDefault();
    clearError();

    var input = collectInput();
    var error = validate(input);
    if (error) {
      showError(error);
      return;
    }

    var pattern = new RegExp(RULES.fields.phone.validationPattern);
    var phoneOk = pattern.test(input.phone);
    if (!phoneOk) {
      var message = input.phone
        ? "手机号格式异常（非 11 位大陆手机号），将按无效线索降级为 C 级。仍要保存吗？"
        : "未填手机号，将按无效线索降级为 C 级。仍要保存吗？";
      if (!window.confirm(message)) return;
    }

    var result = WMEngine.score(input, RULES);
    var record = {
      id: "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      collector: input.collector,
      unitName: input.unitName,
      visitorName: input.visitorName,
      phone: input.phone,
      email: input.email,
      researchType: input.researchType,
      researchCustom: input.researchType === (RULES.fields.researchDirection.customValue || "自定义")
        ? input.researchCustom
        : "",
      workType: input.workType,
      workCustom: input.workType === (RULES.fields.workDirection.customValue || "自定义")
        ? input.workCustom
        : "",
      expectation: input.expectation,
      fitScore: result.fitScore,
      fitTier: result.fitTier,
      intentScore: result.intentScore,
      intentTier: result.intentTier,
      priority: result.priority,
      rankScore: result.rankScore,
      evidence: result.evidence,
      phoneInvalid: result.phoneInvalid,
      createdAt: WMEngine.formatCreatedAt(new Date(), RULES)
    };

    state.records.unshift(record);
    if (!writeJSON(STORE_RECORDS, state.records)) {
      state.records.shift();
      return;
    }

    state.viewingId = record.id;
    showResult(record, true);
    updateBadge();
  }

  // --------------------------------------------------------------- 结果页
  function priorityLabel(grade) {
    return (RULES.priority.labels && RULES.priority.labels[grade]) || grade;
  }

  function showResult(record, isNew) {
    var container = $("view-result");
    var evidence = (record.evidence || []).length
      ? '<ul class="evidence-list">' +
        record.evidence.map(function (item) {
          return "<li>" + esc(item) + "</li>";
        }).join("") +
        "</ul>"
      : '<p class="field-hint">本次没有命中任何加分项，建议现场补充访客原话后重新录入。</p>';

    var advice = (RULES.priority.followUpAdvice && RULES.priority.followUpAdvice[record.priority]) || "";

    container.innerHTML =
      '<div class="result-hero">' +
        '<div class="result-grade">' + esc(record.priority) + "</div>" +
        "<div>" +
          "<h2>" + esc(priorityLabel(record.priority)) + "</h2>" +
          "<p>" + esc(record.visitorName) + " · " + esc(record.unitName) + "</p>" +
        "</div>" +
      "</div>" +
      '<div class="metric-grid">' +
        '<div class="metric">' +
          '<div class="metric-label">匹配度</div>' +
          '<div class="metric-value">' + esc(record.fitScore) + "</div>" +
          '<div class="metric-sub"><span class="badge badge-' + esc(record.priority) + '">' + esc(record.fitTier) + "</span></div>" +
        "</div>" +
        '<div class="metric">' +
          '<div class="metric-label">意向度</div>' +
          '<div class="metric-value">' + esc(record.intentScore) + "</div>" +
          '<div class="metric-sub"><span class="badge badge-' + esc(record.priority) + '">' + esc(record.intentTier) + "</span></div>" +
        "</div>" +
        '<div class="metric">' +
          '<div class="metric-label">排序分值</div>' +
          '<div class="metric-value">' + esc(Number(record.rankScore).toFixed(1)) + "</div>" +
          '<div class="metric-sub">同级内部排序</div>' +
        "</div>" +
      "</div>" +
      '<div class="card">' +
        '<h3 class="card-title">评分依据</h3>' + evidence +
      "</div>" +
      '<div class="card">' +
        '<h3 class="card-title">跟进建议</h3>' +
        '<div class="advice">' + esc(advice) + "</div>" +
      "</div>" +
      '<div class="card">' +
        '<h3 class="card-title">记录信息</h3>' +
        '<div class="stat-line"><span>采集人</span><b>' + esc(record.collector) + "</b></div>" +
        '<div class="stat-line"><span>手机号</span><b>' + esc(record.phone || "未填") + "</b></div>" +
        '<div class="stat-line"><span>邮箱</span><b>' + esc(record.email || "未填") + "</b></div>" +
        '<div class="stat-line"><span>研究方向</span><b>' + esc(WMEngine.researchLabel(record, RULES)) + "</b></div>" +
        '<div class="stat-line"><span>工作方向</span><b>' + esc(WMEngine.workLabel(record, RULES)) + "</b></div>" +
        '<div class="stat-line"><span>录入时间</span><b>' + esc(record.createdAt) + "</b></div>" +
      "</div>" +
      '<div class="actions">' +
        '<button class="btn btn-primary" type="button" id="resultNext">' +
          (isNew ? "继续录入下一位" : "返回记录列表") +
        "</button>" +
        '<button class="btn btn-ghost btn-block" type="button" id="resultDelete">删除这条</button>' +
      "</div>";

    container.classList.add("is-active");
    $("view-form").classList.remove("is-active");
    $("view-history").classList.remove("is-active");
    $("view-info").classList.remove("is-active");
    $("content").scrollTop = 0;

    $("resultNext").addEventListener("click", function () {
      if (isNew) {
        resetForm(true);
        switchView("form");
      } else {
        switchView("history");
      }
    });

    $("resultDelete").addEventListener("click", function () {
      if (!window.confirm("确认删除这条记录？删除后无法恢复。")) return;
      deleteRecord(record.id);
      toast("已删除");
      switchView("history");
    });
  }

  // --------------------------------------------------------------- 记录页
  function myRecords() {
    return state.records.filter(function (record) {
      return record.collector === state.collector;
    });
  }

  function deleteRecord(id) {
    state.records = state.records.filter(function (record) {
      return record.id !== id;
    });
    writeJSON(STORE_RECORDS, state.records);
    updateBadge();
    renderHistory();
  }

  function renderHistory() {
    var container = $("view-history");
    if (!container) return;
    var list = WMEngine.sortRecords(myRecords(), RULES);
    var filtered = state.filter === "ALL"
      ? list
      : list.filter(function (record) { return record.priority === state.filter; });

    var filters = ["ALL"].concat((RULES.priority.order || ["A", "B", "C"])).map(function (key) {
      var text = key === "ALL" ? "全部" : key + " 级";
      return '<button class="chip' + (state.filter === key ? " is-selected" : "") +
        '" type="button" data-filter="' + key + '">' + esc(text) + "</button>";
    }).join("");

    var body = filtered.length
      ? filtered.map(function (record) {
        return '<div class="record" data-id="' + esc(record.id) + '">' +
          '<div class="record-grade badge-' + esc(record.priority) + '">' + esc(record.priority) + "</div>" +
          '<div class="record-body">' +
            '<div class="record-top">' +
              '<span class="record-name">' + esc(record.visitorName) + "</span>" +
              '<span class="record-score">' + esc(Number(record.rankScore).toFixed(1)) + "</span>" +
            "</div>" +
            '<div class="record-company">' + esc(record.unitName) + "</div>" +
            '<div class="record-meta">' +
              "<span>匹配 " + esc(record.fitTier) + " / 意向 " + esc(record.intentTier) + "</span>" +
              "<span>" + esc(record.createdAt.slice(5, 16)) + "</span>" +
            "</div>" +
          "</div>" +
        "</div>";
      }).join("")
      : '<div class="empty"><span class="empty-icon">☐</span>还没有记录<br />填完一份点「保存并评分」就会出现在这里</div>';

    container.innerHTML =
      '<div class="history-head">' +
        "<div>" +
          '<div class="history-count"><strong>' + list.length + "</strong> 条 · " + esc(state.collector || "未选择采集人") + "</div>" +
          '<p class="field-hint">A ' + countOf(list, "A") + " · B " + countOf(list, "B") + " · C " + countOf(list, "C") + "</p>" +
        "</div>" +
        '<button class="btn btn-primary btn-block" style="max-width:150px" type="button" id="exportBtn">导出我的 CSV</button>' +
      "</div>" +
      '<div class="filter-row">' + filters + "</div>" +
      body;

    Array.prototype.forEach.call(container.querySelectorAll("[data-filter]"), function (button) {
      button.addEventListener("click", function () {
        state.filter = button.dataset.filter;
        renderHistory();
      });
    });

    Array.prototype.forEach.call(container.querySelectorAll(".record"), function (node) {
      node.addEventListener("click", function () {
        var record = state.records.filter(function (item) {
          return item.id === node.dataset.id;
        })[0];
        if (record) showResult(record, false);
      });
    });

    $("exportBtn").addEventListener("click", exportCsv);
  }

  function countOf(list, grade) {
    return list.filter(function (record) { return record.priority === grade; }).length;
  }

  function updateBadge() {
    var badge = $("historyBadge");
    var count = myRecords().length;
    badge.textContent = String(count);
    badge.hidden = count === 0;
  }

  // ---------------------------------------------------------------- 导出
  function exportCsv() {
    var list = WMEngine.sortRecords(myRecords(), RULES);
    if (!list.length) {
      toast("当前采集人还没有记录", true);
      return;
    }
    var csv = WMEngine.csvFor(list, RULES);
    var filename = WMEngine.csvFilename(state.collector, new Date(), RULES);
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });

    if (navigator.canShare && typeof File === "function") {
      try {
        var file = new File([blob], filename, { type: "text/csv" });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: filename }).catch(function () {
            downloadBlob(blob, filename);
          });
          return;
        }
      } catch (err) { /* 回退到下载 */ }
    }
    downloadBlob(blob, filename);
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    toast("已导出 " + filename);
  }

  // ---------------------------------------------------------------- 说明
  function renderInfo() {
    var info = RULES.infoPage || {};
    var fields = RULES.fields || {};
    var fit = RULES.fit || {};
    var intent = RULES.intent || {};
    var rank = RULES.rank || {};

    function tiersText(tiers) {
      return (tiers || []).map(function (item) {
        return item.tier + " ≥ " + item.min;
      }).join(" · ");
    }

    var steps = (info.usageSteps || []).map(function (step) {
      return "<li>" + esc(step.replace(/^\d+\.\s*/, "")) + "</li>";
    }).join("");

    var notes = (info.fieldNotes || []).map(function (item) {
      return "<li><strong>" + esc(item.field) + "：</strong>" + esc(item.note) + "</li>";
    }).join("");

    var ownership = (info.dataOwnership || []).map(function (item) {
      return "<li>" + esc(item) + "</li>";
    }).join("");

    var advice = Object.keys(RULES.priority.followUpAdvice || {}).map(function (grade) {
      return '<div class="stat-line"><span>' + esc(RULES.priority.labels[grade] || grade) + "</span></div>" +
        '<p class="field-hint">' + esc(RULES.priority.followUpAdvice[grade]) + "</p>";
    }).join("");

    $("view-info").innerHTML =
      '<div class="card">' +
        '<h3 class="card-title">使用步骤</h3>' +
        '<ol class="info-list" style="padding-left:0">' + steps + "</ol>" +
      "</div>" +
      '<div class="card">' +
        '<h3 class="card-title">字段说明</h3>' +
        '<ul class="info-list">' + notes + "</ul>" +
      "</div>" +
      '<div class="card">' +
        '<h3 class="card-title">评分规则</h3>' +
        '<div class="stat-line"><span>匹配度满分</span><b>' + esc(fit.fitMax) + "</b></div>" +
        '<div class="stat-line"><span>匹配度分档</span><b>' + esc(tiersText(fit.tiers)) + "</b></div>" +
        '<div class="stat-line"><span>意向度上限</span><b>' + esc(intent.intentCap) + "</b></div>" +
        '<div class="stat-line"><span>意向度分档</span><b>' + esc(tiersText(intent.tiers)) + "</b></div>" +
        '<div class="stat-line"><span>排序分值公式</span><b>匹配 ' + esc(rank.fitWeight) + "% + 意向 " + esc(rank.intentWeight) + "%</b></div>" +
        '<p class="field-hint">' + esc(info.scoringIntro || "") + "</p>" +
        '<p class="field-hint">' + esc(rank.note || "") + "</p>" +
      "</div>" +
      '<div class="card">' +
        '<h3 class="card-title">会后跟进</h3>' + advice +
      "</div>" +
      '<div class="card">' +
        '<h3 class="card-title">数据归属</h3>' +
        '<ul class="info-list">' + ownership + "</ul>" +
      "</div>" +
      '<p class="info-foot">' +
        esc(RULES.app.company) + " · " + esc(RULES.app.partner) + "<br />" +
        esc(RULES.app.event) + "<br />" +
        "v" + esc(RULES.app.version) + " · " + esc(fields.phone.note || "") +
      "</p>";
  }

  // ---------------------------------------------------------------- 视图
  function switchView(name) {
    ["form", "result", "history", "info"].forEach(function (key) {
      var view = $("view-" + key);
      if (!view) return;
      view.classList.toggle("is-active", key === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (tab) {
      tab.classList.toggle("is-active", tab.dataset.view === name);
    });
    $("content").scrollTop = 0;
    if (name === "history") {
      renderHistory();
      updateBadge();
    }
  }

  // ---------------------------------------------------------------- 启动
  function init() {
    loadRules()
      .then(function (rules) {
        RULES = rules;
        state.records = readJSON(STORE_RECORDS, []);
        if (!Array.isArray(state.records)) state.records = [];
        hydrateText();
        renderDirectionChips("researchChips", RULES.fields.researchDirection, "");
        renderDirectionChips("workChips", RULES.fields.workDirection, "");
        setupVoice();
        renderInfo();

        var saved = readJSON(STORE_COLLECTOR, "");
        if (saved) {
          applyCollector(saved);
        } else {
          applyCollector((RULES.collector && RULES.collector.defaultName) || "");
        }
        updateBadge();

        $("surveyForm").addEventListener("submit", onSubmit);
        $("clearBtn").addEventListener("click", function () {
          if (!window.confirm("清空当前已填内容？")) return;
          resetForm(true);
          toast("已清空");
        });
        $("collectorBtn").addEventListener("click", openCollectorSheet);
        $("sheetCancel").addEventListener("click", function () {
          $("sheetBackdrop").hidden = true;
        });
        $("sheetConfirm").addEventListener("click", confirmCollector);
        $("sheetBackdrop").addEventListener("click", function (event) {
          if (event.target === $("sheetBackdrop")) $("sheetBackdrop").hidden = true;
        });
        Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (tab) {
          tab.addEventListener("click", function () { switchView(tab.dataset.view); });
        });
        $("phone").addEventListener("input", function () {
          var pattern = new RegExp(RULES.fields.phone.validationPattern);
          var value = $("phone").value.trim();
          var hint = $("phoneHint");
          hint.classList.remove("is-warn", "is-ok");
          if (!value) {
            hint.textContent = RULES.fields.phone.validationHint || "";
          } else if (pattern.test(value)) {
            hint.textContent = "格式正确";
            hint.classList.add("is-ok");
          } else {
            hint.textContent = "格式看起来不对（应为 11 位大陆手机号）";
            hint.classList.add("is-warn");
          }
        });
        $("email").addEventListener("blur", function () {
          var value = $("email").value.trim();
          if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            toast("邮箱格式可能不对，请再确认一下", true);
          }
        });
        switchView("form");

        // 首次进入：让采集人先确认自己是谁（不能用 applyCollector 写入后的值判断）
        if (!saved) {
          openCollectorSheet();
        }

        if ("serviceWorker" in navigator && location.protocol !== "file:") {
          navigator.serviceWorker.register("service-worker.js").catch(function () { /* 离线缓存失败不影响使用 */ });
        }
      })
      .catch(function (err) {
        $("content").innerHTML =
          '<div class="card"><h3 class="card-title">启动失败</h3>' +
          '<p class="field-hint">' + esc(err.message) + "</p>" +
          '<p class="field-hint">请确认 rules.json 与页面在同一目录。若用「文件」App 直接打开，请改用随附的单文件离线版。</p></div>';
        $("saveBtn").disabled = true;
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
