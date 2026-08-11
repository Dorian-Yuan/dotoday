/**
 * icon-config.js —— SVG 图标配置（DoToday v0.1.0）
 *
 * 铅笔线条风图标集：stroke 描边、stroke-width 1.8、圆角端点、
 * viewBox 24、currentColor（随文本颜色自动变化）。
 * 接口定义见计划文档 5.3 节。
 */

/**
 * 统一 SVG 包裹：线条描边 + currentColor
 * fill 参数控制填充色：默认 "none"（空心描边）；实心图标传 "currentColor"。
 * 注意：fill 必须写在标签内（HTML 重复属性会取第一个值，不能靠拼接覆盖）。
 */
function svg(inner, fill = "none") {
  return `<svg viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/** 铅笔线条风图标集（20 个） */
export const ICONS = {
  /** 日历 */
  calendar: svg(`
    <rect x="3.5" y="5" width="17" height="15.5" rx="2"/>
    <path d="M3.5 9.5h17"/>
    <path d="M8.2 3.2v3M15.8 3.2v3"/>
    <path d="M7.5 14h2v2h-2zM12 14h2v2h-2zM16.5 14h2v2h-2zM7.5 18h2v2h-2zM12 18h2v2h-2z"/>
  `),

  /** 空星（描边） */
  star: svg(
    `<path d="M12 3.8l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>`
  ),

  /** 填充星（评分选中态）：实心填充 */
  starFill: svg(
    `<path d="M12 3.8l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>`,
    "currentColor"
  ),

  /** 加号 */
  plus: svg(`<path d="M12 5v14M5 12h14"/>`),

  /** 铅笔（编辑） */
  edit: svg(`
    <path d="M4.5 19.5V16.5L16.5 4.5a2.1 2.1 0 0 1 3 3L7.5 19.5z"/>
    <path d="M15.5 5.5l3 3"/>
  `),

  /** 垃圾桶（删除） */
  trash: svg(`
    <path d="M5.5 7h13"/>
    <path d="M9.5 7V4.5h5V7"/>
    <path d="M7.8 7l.6 12.5h7.2L16.2 7"/>
    <path d="M10.2 10.8v5M13.8 10.8v5"/>
  `),

  /** 放大镜（搜索） */
  search: svg(`
    <path d="M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13"/>
    <path d="M19.5 19.5l-4.3-4.3"/>
  `),

  /** 漏斗（筛选） */
  filter: svg(`<path d="M4 6.5h16M7.5 12h9M10.5 17.5h3"/>`),

  /** 标签 */
  tag: svg(`
    <path d="M4.5 4.5h6.5l9 9-6.5 6.5-9-9z"/>
    <path d="M8.3 7a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 1 0 0-2.6"/>
  `),

  /** 齿轮（设置） */
  settings: svg(`
    <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 1 0 0-7.6"/>
    <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.4 5.4l1.8 1.8M16.8 16.8l1.8 1.8M18.6 5.4l-1.8 1.8M7.2 16.8l-1.8 1.8"/>
  `),

  /** 柱状图（统计） */
  chart: svg(`<path d="M5 20V12M11 20V4.5M17 20V8.5M3.5 20h17"/>`),

  /** 导出（上箭头出箱） */
  export: svg(`<path d="M12 15.5V4.5M6.8 9.8L12 4.5l5.2 5.3M4.5 20h15"/>`),

  /** 导入（下箭头入箱） */
  import: svg(`<path d="M12 4.5v11M6.8 10.2L12 15.5l5.2-5.3M4.5 20h15"/>`),

  /** 备份（软盘） */
  backup: svg(`
    <path d="M5 4.5h10L19.5 9v10.5h-14.5z"/>
    <path d="M15 4.5V9h4.5"/>
    <path d="M7.5 14.5h9V20h-9z"/>
  `),

  /** 同步（循环箭头） */
  sync: svg(`
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/>
    <path d="M19.5 3.8V8.3h-4.5"/>
  `),

  /** 左箭头 */
  chevronLeft: svg(`<path d="M14.8 5.8L8.6 12l6.2 6.2"/>`),

  /** 右箭头 */
  chevronRight: svg(`<path d="M9.2 5.8L15.4 12l-6.2 6.2"/>`),

  /** 关闭（叉） */
  close: svg(`<path d="M6 6l12 12M18 6L6 18"/>`),

  /** 对勾 */
  check: svg(`<path d="M4.5 12.5l5 5L19.5 6.5"/>`),

  /** 空态（纸张 + 铅笔线） */
  empty: svg(`
    <path d="M5.5 3.5h8.8l4.2 4.2V20.5h-13z"/>
    <path d="M14.3 3.5V7.7h4.2"/>
    <path d="M8.5 12.5h7M8.5 15.8h5M8.5 19.1h3"/>
  `),
};
