/**
 * 威敏斯客户采集系统系统 —— 评分引擎（iPhone / PWA 端）
 *
 * 纯函数，无 DOM 依赖，Node 可直接 require 做单元测试。
 * 所有规则来自 rules.json，本文件不含任何权重、关键词、阈值常量。
 * 行为合同见 shared/SCORING_SPEC.md，必须与 Android(Kotlin) / Excel(Python) 完全一致。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.WMEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function text(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  function containsIgnoreCase(haystack, needle) {
    if (!needle) return false;
    return text(haystack).toLowerCase().indexOf(String(needle).toLowerCase()) !== -1;
  }

  function roundHalfUp(value, digits) {
    var factor = Math.pow(10, digits === undefined ? 1 : digits);
    return Math.round(value * factor) / factor;
  }

  function tierFor(score, tiers) {
    if (!tiers || !tiers.length) throw new Error("rules 缺少分档定义");
    var ordered = tiers.slice().sort(function (a, b) {
      return Number(b.min) - Number(a.min);
    });
    for (var i = 0; i < ordered.length; i += 1) {
      if (score >= Number(ordered[i].min)) return String(ordered[i].tier);
    }
    return String(ordered[ordered.length - 1].tier);
  }

  function directionScore(directionType, directionCustom, spec, prefix) {
    var weights = spec.weights || {};
    if (Object.prototype.hasOwnProperty.call(weights, directionType)) {
      return {
        points: Number(weights[directionType]),
        evidence: [prefix + "命中: " + directionType]
      };
    }

    var customValue = spec.customValue || "自定义";
    if (directionType === customValue) {
      var hits = spec.customKeywordHits || {};
      var best = 0;
      var evidence = [];
      Object.keys(hits).forEach(function (keyword) {
        if (containsIgnoreCase(directionCustom, keyword)) {
          best = Math.max(best, Number(hits[keyword]));
          evidence.push(prefix + "自定义命中: " + keyword);
        }
      });
      return { points: best, evidence: evidence };
    }

    return { points: 0, evidence: [] };
  }

  function score(input, rules) {
    var fitCfg = rules.fit;
    var intentCfg = rules.intent;
    var rankCfg = rules.rank;

    var research = directionScore(
      text(input.researchType),
      text(input.researchCustom),
      fitCfg.researchDirection,
      "研究方向"
    );
    var work = directionScore(
      text(input.workType),
      text(input.workCustom),
      fitCfg.workDirection,
      "工作方向"
    );

    var fitMax = Number(fitCfg.fitMax);
    var fitScore = Math.min(research.points + work.points, fitMax);
    var fitTier = tierFor(fitScore, fitCfg.tiers);

    var evidence = research.evidence.concat(work.evidence);

    var expectation = text(input.expectation);
    var expectationPoints = 0;
    (intentCfg.expectationSignals || []).forEach(function (signal) {
      if (containsIgnoreCase(expectation, signal.word)) {
        expectationPoints += Number(signal.points);
        evidence.push("产品期待包含'" + signal.word + "'");
      }
    });
    expectationPoints = Math.min(expectationPoints, Number(intentCfg.expectationCap));

    if (text(input.email)) {
      expectationPoints += Number(intentCfg.emailPoints);
      evidence.push(String(intentCfg.emailEvidence));
    }

    var intentScore = Math.min(expectationPoints, Number(intentCfg.intentCap));
    var intentTier = tierFor(intentScore, intentCfg.tiers);

    var invalidCfg = intentCfg.invalidPhone || {};
    var phoneInvalid = false;
    if (invalidCfg.enabled) {
      var pattern = rules.fields.phone.validationPattern;
      var phone = text(input.phone);
      phoneInvalid = phone.length === 0 || !new RegExp(pattern).test(phone);
      if (phoneInvalid) {
        intentTier = String(invalidCfg.forceIntentTier);
        evidence.push(String(invalidCfg.evidence));
      }
    }

    var priority = String(rules.priority.matrix[fitTier + "|" + intentTier]);
    if (phoneInvalid) priority = String(invalidCfg.forceMaxPriority);

    var rankScore =
      (fitScore / fitMax) * Number(rankCfg.fitWeight) +
      (intentScore / Number(intentCfg.intentCap)) * Number(rankCfg.intentWeight);
    rankScore = roundHalfUp(rankScore, Number(rankCfg.roundTo || 1));
    rankScore = Math.max(Number(rankCfg.min || 0), Math.min(Number(rankCfg.max || 100), rankScore));

    return {
      fitScore: fitScore,
      fitTier: fitTier,
      intentScore: intentScore,
      intentTier: intentTier,
      priority: priority,
      rankScore: rankScore,
      evidence: evidence,
      phoneInvalid: phoneInvalid
    };
  }

  function directionLabel(directionType, directionCustom, rules, key) {
    var prefix = String((rules.csv && rules.csv.customPrefix) || "自定义:");
    var customValue = String((rules.fields[key] && rules.fields[key].customValue) || "自定义");
    if (directionType === customValue) {
      var custom = text(directionCustom);
      return custom ? prefix + custom : prefix.replace(/[:：]\s*$/, "");
    }
    return text(directionType);
  }

  function researchLabel(input, rules) {
    return directionLabel(text(input.researchType), text(input.researchCustom), rules, "researchDirection");
  }

  function workLabel(input, rules) {
    return directionLabel(text(input.workType), text(input.workCustom), rules, "workDirection");
  }

  function evidenceText(record, rules) {
    var sep = String((rules.csv && rules.csv.evidenceSeparator) || "|");
    return (record.evidence || []).join(sep);
  }

  function escapeCell(value) {
    var cell = value === null || value === undefined ? "" : String(value);
    if (/[",\r\n]/.test(cell)) {
      return '"' + cell.replace(/"/g, '""') + '"';
    }
    return cell;
  }

  function rankText(score) {
    var number = Number(score);
    if (isNaN(number)) return "";
    return number.toFixed(1);
  }

  function csvRow(record, rules) {
    var map = {
      "采集人": text(record.collector),
      "单位名称": text(record.unitName),
      "姓名": text(record.visitorName),
      "手机号": text(record.phone),
      "邮箱": text(record.email),
      "研究方向": researchLabel(record, rules),
      "工作方向": workLabel(record, rules),
      "对产品期待": text(record.expectation),
      "匹配度分档": text(record.fitTier),
      "意向度分档": text(record.intentTier),
      "综合优先级": text(record.priority),
      "排序分值": rankText(record.rankScore),
      "评分依据": evidenceText(record, rules),
      "录入时间": text(record.createdAt)
    };
    return (rules.csv.columns || []).map(function (column) {
      return map[String(column)] === undefined ? "" : map[String(column)];
    });
  }

  function csvFor(records, rules) {
    var newline = (rules.csv && rules.csv.newline) || "\r\n";
    var lines = [(rules.csv.columns || []).map(escapeCell).join(",")];
    (records || []).forEach(function (record) {
      lines.push(csvRow(record, rules).map(escapeCell).join(","));
    });
    var bom = rules.csv && rules.csv.bom === false ? "" : "\ufeff";
    return bom + lines.join(newline) + newline;
  }

  function pad(value, size) {
    var out = String(value);
    while (out.length < size) out = "0" + out;
    return out;
  }

  function formatDate(date, pattern) {
    var d = date instanceof Date ? date : new Date(date);
    return String(pattern || "yyyy-MM-dd HH:mm:ss")
      .replace(/yyyy/g, String(d.getFullYear()))
      .replace(/MM/g, pad(d.getMonth() + 1, 2))
      .replace(/dd/g, pad(d.getDate(), 2))
      .replace(/HH/g, pad(d.getHours(), 2))
      .replace(/mm/g, pad(d.getMinutes(), 2))
      .replace(/ss/g, pad(d.getSeconds(), 2));
  }

  function formatCreatedAt(date, rules) {
    return formatDate(date, (rules.csv && rules.csv.createdAtPattern) || "yyyy-MM-dd HH:mm:ss");
  }

  // UTF-8 字节（不依赖 TextEncoder，保证老 Safari 与 Node 结果一致）
  function utf8Bytes(str) {
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var low = str.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (low - 0xdc00);
          i++;
        }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function fnv1a32(str) {
    var bytes = utf8Bytes(String(str));
    var value = 0x811c9dc5;
    for (var i = 0; i < bytes.length; i++) {
      value ^= bytes[i];
      value = Math.imul(value, 0x01000193) >>> 0;
    }
    return value >>> 0;
  }

  function collectorCode(name, rules) {
    var raw = text(name) || "未命名";
    var codes = (rules && rules.collectorCodes) || {};
    if (Object.prototype.hasOwnProperty.call(codes, raw)) return String(codes[raw]);
    var prefix = (rules && rules.csv && rules.csv.unknownCollectorPrefix) || "u";
    var hex = fnv1a32(raw).toString(16);
    while (hex.length < 8) hex = "0" + hex;
    return prefix + hex;
  }

  function csvFilename(collector, date, rules) {
    var pattern = (rules.csv && rules.csv.filenamePattern) || "WMS_{collector}_{timestamp}.csv";
    return pattern
      .replace("{collector}", collectorCode(collector, rules))
      .replace("{timestamp}", formatDate(date || new Date(), (rules.csv && rules.csv.timestampPattern) || "yyyyMMdd-HHmm"));
  }

  function sortRecords(records, rules) {
    var order = (rules.priority && rules.priority.order) || ["A", "B", "C"];
    return (records || []).slice().sort(function (a, b) {
      var ai = order.indexOf(String(a.priority));
      var bi = order.indexOf(String(b.priority));
      if (ai < 0) ai = order.length;
      if (bi < 0) bi = order.length;
      if (ai !== bi) return ai - bi;
      var diff = Number(b.rankScore || 0) - Number(a.rankScore || 0);
      if (Math.abs(diff) > 0.001) return diff;
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
  }

  function tierClass(tier) {
    if (tier === "高") return "high";
    if (tier === "中") return "mid";
    return "low";
  }

  return {
    containsIgnoreCase: containsIgnoreCase,
    roundHalfUp: roundHalfUp,
    tierFor: tierFor,
    score: score,
    researchLabel: researchLabel,
    workLabel: workLabel,
    evidenceText: evidenceText,
    csvRow: csvRow,
    csvFor: csvFor,
    formatDate: formatDate,
    formatCreatedAt: formatCreatedAt,
    collectorCode: collectorCode,
    csvFilename: csvFilename,
    sortRecords: sortRecords,
    tierClass: tierClass
  };
});
