/**
 * form.js —— 添加 / 编辑记录表单（DoToday v0.1.1）
 *
 * 底部弹出表单：日期（自定义面板 + 快捷按钮）→ 时间（滚轮，可清除）→
 * 评分（可清除）→ 标签（多选 + 新建）→ 备注（500 字限制）。
 * 仅日期必填；禁止未来日期；编辑回填；有内容关闭需确认。
 * 保存成功后通过 bus.emit("records-changed") 通知入口刷新日历记录标记。
 */

import { $, $$, esc, pad2, dateFullCN, setBodyLock, bus } from "./common.js";
import { uiState } from "./state.js";
import { DateUtils } from "../pure/date-utils.js";
import { DataModule } from "../data.js";
import { LoggerModule } from "../logger.js";
import { LIMITS } from "../config.js";
import { showToast } from "./toast.js";
import { openDatePicker } from "./date-picker.js";
import { openTimeWheel, closeTimeWheel } from "./time-wheel.js";
import { ICONS } from "../icon-config.js";

/* ============ 表单状态 ============ */
let formDate = "";        // "YYYY-MM-DD"
let formTime = null;      // "HH:mm" 或 null
let formRating = null;    // 1-5 或 null
let formTags = [];        // 已选标签名数组
let formInitSnapshot = ""; // 打开表单时的字段快照（用于关闭确认）
let editingId = null;     // 编辑中的记录 id（null = 新建）

/* ============ 打开 / 关闭 ============ */

/** 打开表单：新建传 null，编辑传记录对象（回填） */
export function openForm(record = null) {
  editingId = record ? record.id : null;
  $("#form-title").textContent = record ? "编辑记录" : "添加记录";

  // 日期：编辑回填记录日期；新增默认 = 首页日历当前选中日期（未选中才回退今天）
  // 禁止未来日期由面板内禁用保证
  const today = DateUtils.todayStr();
  formDate = record ? record.date : uiState.selectedDate || today;
  renderFormDate();

  // 时间
  formTime = record ? record.time : null;
  updateTimeText();

  // 评分
  formRating = record ? record.rating : null;
  renderFormStars();

  // 标签
  formTags = record && Array.isArray(record.tags) ? record.tags.slice() : [];
  renderTagPick();
  $("#f-tag-input").value = "";

  // 备注（限制与计数统一由 config 常量驱动，HTML 不再硬编码）
  const note = $("#f-note");
  note.maxLength = LIMITS.NOTE_MAX_LEN;
  note.value = record ? record.note || "" : "";
  $("#f-note-max").textContent = String(LIMITS.NOTE_MAX_LEN);
  $("#f-note-count").textContent = String(note.value.length);

  // 关闭确认条复位
  $("#form-confirm").hidden = true;

  // 记录初始快照（判断是否有内容修改）
  formInitSnapshot = snapshotForm();

  // 滑入显示
  $("#sheet-mask").hidden = false;
  $("#form-sheet").hidden = false;
  requestAnimationFrame(() => {
    $("#sheet-mask").classList.add("open");
    $("#form-sheet").classList.add("open");
  });
  setBodyLock(true);
}

/** 关闭表单（滑出动画后隐藏） */
export function closeForm() {
  $("#form-confirm").hidden = true;
  closeTimeWheel();
  $("#sheet-mask").classList.remove("open");
  $("#form-sheet").classList.remove("open");
  setTimeout(() => {
    $("#form-sheet").hidden = true;
    $("#sheet-mask").hidden = true;
  }, 220);
  setBodyLock(false);
}

/** 请求关闭：有未保存内容时先确认 */
function requestCloseForm() {
  if (isFormDirty()) {
    $("#form-confirm").hidden = false;
    return;
  }
  closeForm();
}

/** 表单字段快照（比较是否有修改） */
function snapshotForm() {
  return JSON.stringify({
    date: formDate,
    time: formTime,
    rating: formRating,
    tags: formTags.slice().sort(),
    note: $("#f-note").value,
  });
}

function isFormDirty() {
  return snapshotForm() !== formInitSnapshot;
}

/* ============ 日期字段 ============ */

/** 渲染表单日期：显示框文本 + 快捷按钮高亮 + 今日提示 */
function renderFormDate() {
  $("#f-date-text").textContent = dateFullCN(formDate);
  updateQuickChips();
  updateDateHint();
}

/** 日期提示：今天已有 N 条记录 */
function updateDateHint() {
  const el = $("#f-date-hint");
  const today = DateUtils.todayStr();
  if (formDate === today) {
    const n = DataModule.getRecordsByDate(today).length;
    el.textContent = n > 0 ? `今天已有 ${n} 条记录，可继续添加` : "";
    el.className = "field-hint" + (n > 0 ? " warn" : "");
  } else {
    el.textContent = "";
    el.className = "field-hint";
  }
}

/** 日期快捷按钮高亮（今天 / 昨天 / 前天） */
function updateQuickChips() {
  const today = DateUtils.todayStr();
  $$(".date-quick .chip").forEach((ch) => {
    const n = ch.dataset.quick === "today" ? 0 : Number(ch.dataset.quick);
    ch.classList.toggle("on", formDate === DateUtils.addDays(today, n));
  });
}

/** 字段错误提示（2.2 秒后自动消除） */
function markFieldError(name, msg) {
  const field = $(`.field[data-field="${name}"]`);
  if (field) field.classList.add("error");
  const hint = $("#f-date-hint");
  hint.textContent = msg;
  hint.className = "field-hint warn";
  setTimeout(() => {
    if (field) field.classList.remove("error");
    if (hint.textContent === msg) {
      hint.textContent = "";
      hint.className = "field-hint";
    }
  }, 2200);
}

/* ============ 时间字段 ============ */

/** 时间显示（未填写为弱化占位） */
function updateTimeText() {
  const el = $("#f-time-text");
  if (formTime) {
    el.textContent = formTime;
    el.classList.remove("placeholder");
  } else {
    el.textContent = "未填写";
    el.classList.add("placeholder");
  }
}

/* ============ 评分星星（可清除：再点同一颗取消） ============ */
function renderFormStars() {
  const wrap = $("#f-stars");
  wrap.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = i <= formRating ? "on" : "";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(i <= formRating));
    b.setAttribute("aria-label", `${i} 星`);
    b.innerHTML = i <= formRating ? ICONS.starFill : ICONS.star;
    b.addEventListener("click", () => {
      formRating = formRating === i ? null : i; // 可清除
      renderFormStars();
    });
    wrap.appendChild(b);
  }
  $("#f-rating-clear").hidden = !formRating;
}

/* ============ 标签多选 + 新建（自动配色由数据层处理） ============ */
function renderTagPick() {
  const wrap = $("#f-tags");
  const tags = DataModule.getTags();
  if (!tags.length) {
    wrap.innerHTML = `<span class="tag-empty">还没有标签，输入新标签回车创建</span>`;
    return;
  }
  wrap.innerHTML = "";
  for (const t of tags) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tag-chip" + (formTags.includes(t.name) ? " on" : "");
    b.innerHTML = `<i class="tag-dot" style="--tag-color:${t.color}" aria-hidden="true"></i>${esc(t.name)}`;
    b.addEventListener("click", () => {
      const i = formTags.indexOf(t.name);
      if (i >= 0) formTags.splice(i, 1);
      else formTags.push(t.name);
      renderTagPick();
    });
    wrap.appendChild(b);
  }
}

async function createTag(name) {
  // 已存在 → 直接选中
  if (DataModule.getTags().some((t) => t.name === name)) {
    if (!formTags.includes(name)) {
      formTags.push(name);
      renderTagPick();
    }
    return;
  }
  try {
    await DataModule.addTag(name); // 数据层自动从色板配色
    formTags.push(name);
    renderTagPick();
  } catch (err) {
    LoggerModule.warn("创建标签失败: " + err.message);
    showToast("创建标签失败", { type: "error" });
  }
}

/* ============ 表单提交 ============ */
async function handleSubmit(e) {
  e.preventDefault();
  const date = formDate;

  // 仅日期必填（formDate 默认今天，保留防御校验）
  if (!date) {
    markFieldError("date", "请选择日期");
    return;
  }
  // 禁止未来日期（面板内已禁用，提交时双保险）
  if (date > DateUtils.todayStr()) {
    markFieldError("date", "不能选择未来日期");
    return;
  }

  const payload = {
    date,
    time: formTime,
    rating: formRating,
    tags: formTags.slice(),
    note: $("#f-note").value.trim(),
  };

  try {
    if (editingId) {
      await DataModule.updateRecord(editingId, payload);
      showToast("已保存修改");
    } else {
      await DataModule.addRecord(payload);
      showToast("已添加记录");
    }
    closeForm();
    bus.emit("records-changed"); // 通知入口刷新日历记录标记与列表
  } catch (err) {
    LoggerModule.error("保存记录失败", err && err.stack);
    showToast("保存失败，请重试", { type: "error" });
  }
}

/* ============ 事件绑定（由 app.js 启动时调用一次） ============ */
export function bindFormEvents() {
  // 关闭 / 确认 / 提交
  $("#sheet-mask").addEventListener("click", requestCloseForm);
  $("#form-cancel").addEventListener("click", requestCloseForm);
  $("#confirm-keep").addEventListener("click", () => {
    $("#form-confirm").hidden = true;
  });
  $("#confirm-discard").addEventListener("click", closeForm);
  $("#record-form").addEventListener("submit", handleSubmit);

  // 日期：快捷按钮（今天 / 昨天 / 前天）
  $(".date-quick").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const n = chip.dataset.quick === "today" ? 0 : Number(chip.dataset.quick);
    formDate = DateUtils.addDays(DateUtils.todayStr(), n);
    renderFormDate();
  });
  // 日期：点击显示框 → 打开自定义日历面板
  $("#f-date-btn").addEventListener("click", () => {
    openDatePicker({
      value: formDate,
      onChange: (d) => {
        formDate = d;
        renderFormDate();
      },
    });
  });

  // 时间：显示框点击切换滚轮面板
  $("#f-time-btn").addEventListener("click", () => {
    const panel = $("#wheel-panel");
    if (panel.hidden) {
      openTimeWheel({
        value: formTime,
        onConfirm: (t) => {
          formTime = t;
          updateTimeText();
        },
        onClear: () => {
          formTime = null;
          updateTimeText();
        },
      });
    } else {
      closeTimeWheel();
    }
  });

  // 评分清除
  $("#f-rating-clear").addEventListener("click", () => {
    formRating = null;
    renderFormStars();
  });

  // 新建标签（回车；长度限制由 config 常量驱动）
  $("#f-tag-input").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const name = e.target.value.trim();
    if (name) {
      createTag(name);
      e.target.value = "";
    }
  });

  // 备注字数
  $("#f-note").addEventListener("input", () => {
    $("#f-note-count").textContent = String($("#f-note").value.length);
  });
}
