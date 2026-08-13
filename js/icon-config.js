/**
 * icon-config.js —— SVG 图标配置（DoToday v0.11.0）
 *
 * Lucide 标准线性图标（内联、零 CDN）：viewBox 24、stroke-width 2、
 * stroke-linecap/linejoin round、currentColor（随文本颜色自动变化）。
 * fill 参数控制填充色：默认 "none"（空心描边）；实心图标传 "currentColor"。
 * 注意：fill 必须写在标签内（HTML 重复属性会取第一个值，不能靠拼接覆盖）。
 */

/**
 * 统一 SVG 包裹：线条描边 + currentColor
 * @param {string} inner 图标 inner 元素
 * @param {string} [fill] 填充色（默认 none 空心；实心传 currentColor）
 */
function svg(inner, fill = "none") {
  return `<svg viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/** Lucide star path（闭合星形；fill=currentColor 即实心） */
const STAR_PATH =
  '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>';

/** Lucide 标准线性图标集（20 个，内联零 CDN） */
export const ICONS = {
  /** 日历 */
  calendar: svg(`
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="M8 2v3"/>
    <path d="M16 2v3"/>
    <path d="M3 9h18"/>
  `),

  /** 空星（描边） */
  star: svg(STAR_PATH),

  /** 填充星（评分选中态）：Lucide star 闭合路径 + 实心填充 */
  starFill: svg(STAR_PATH, "currentColor"),

  /** 加号 */
  plus: svg(`<path d="M5 12h14"/><path d="M12 5v14"/>`),

  /** 铅笔（编辑） */
  edit: svg(`
    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>
    <path d="m15 5 4 4"/>
  `),

  /** 垃圾桶（删除，trash-2） */
  trash: svg(`
    <path d="M10 11v6"/>
    <path d="M14 11v6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
    <path d="M3 6h18"/>
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
  `),

  /** 放大镜（搜索） */
  search: svg(`
    <path d="m21 21-4.34-4.34"/>
    <circle cx="11" cy="11" r="8"/>
  `),

  /** 漏斗（筛选） */
  filter: svg(`<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>`),

  /** 标签 */
  tag: svg(`
    <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/>
    <circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>
  `),

  /** 齿轮（设置） */
  settings: svg(`
    <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/>
    <circle cx="12" cy="12" r="3"/>
  `),

  /** 柱状图（统计，chart-column） */
  chart: svg(`
    <path d="M3 3v16a2 2 0 0 0 2 2h16"/>
    <path d="M18 17V9"/>
    <path d="M13 17V5"/>
    <path d="M8 17v-3"/>
  `),

  /** 导出（下载） */
  export: svg(`
    <path d="M12 15V3"/>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <path d="m7 10 5 5 5-5"/>
  `),

  /** 导入（上传） */
  import: svg(`
    <path d="M12 3v12"/>
    <path d="m17 8-5-5-5 5"/>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
  `),

  /** 备份（database-backup） */
  backup: svg(`
    <ellipse cx="12" cy="5" rx="9" ry="3"/>
    <path d="M3 12a9 3 0 0 0 5 2.69"/>
    <path d="M21 9.3V5"/>
    <path d="M3 5v14a9 3 0 0 0 6.47 2.88"/>
    <path d="M12 12v4h4"/>
    <path d="M13 20a5 5 0 0 0 9-3 4.5 4.5 0 0 0-4.5-4.5c-1.33 0-2.54.54-3.41 1.41L12 16"/>
  `),

  /** 同步（refresh-cw） */
  sync: svg(`
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
    <path d="M21 3v5h-5"/>
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
    <path d="M8 16H3v5"/>
  `),

  /** 左箭头 */
  chevronLeft: svg(`<path d="m15 18-6-6 6-6"/>`),

  /** 右箭头 */
  chevronRight: svg(`<path d="m9 18 6-6-6-6"/>`),

  /** 关闭（叉，x） */
  close: svg(`<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`),

  /** 对勾 */
  check: svg(`<path d="M20 6 9 17l-5-5"/>`),

  /** 空态（inbox 收件箱） */
  empty: svg(`
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
  `),
};
