import './styles/tableExtended.css';

const ENHANCED_ATTR = 'data-gpte-enhanced';
const ORIG_INDEX_ATTR = 'data-gpte-original-index';
const COL_ATTR = 'data-gpte-col';
const SORTABLE_CLASS = 'gpte-sortable';
const SORTED_ASC_CLASS = 'gpte-sorted-asc';
const SORTED_DESC_CLASS = 'gpte-sorted-desc';
const FILTER_BAR_ATTR = 'data-gpte-filter-bar';
const FILTER_FOOTER_ATTR = 'data-gpte-filter-footer';
const NO_FILTER_ATTR = 'data-no-filter';
const NO_STICKY_ATTR = 'data-no-sticky';
const ROW_ODD_CLASS = 'gpte-row-odd';
const ROW_EVEN_CLASS = 'gpte-row-even';
const MARK_CLASS = 'gpte-mark';
const COPY_BTN_ATTR = 'data-gpte-copy-btn';
const COPY_CLASS_OK = 'gpte-copy-ok';
const COPY_CLASS_FAIL = 'gpte-copy-fail';
const COPY_FEEDBACK_MS = 2000;
const SVG_NS = 'http://www.w3.org/2000/svg';
type CopyBtnState = 'copy' | 'ok-csv' | 'ok-md' | 'ok-json' | 'fail';

// GROWI のナビバー要素を検索するセレクタ候補（上から順に試す）
const NAVBAR_SELECTORS = [
  '#grw-contextual-sub-nav',       // GROWI v7+ contextual sub-navigation
  '[data-testid="grw-contextual-sub-nav"]',
  '.grw-app-header',
  '.grw-navigation-header',
  'nav.navbar.fixed-top',
  'nav.navbar.sticky-top',
];

type SortDir = 'asc' | 'desc' | 'none';
type ColType = 'number' | 'date' | 'string';

interface FilterRefs {
  bar: HTMLDivElement;
  footer: HTMLDivElement;
  handler: () => void;
  copyBtn?: HTMLButtonElement;
  copyHandler?: (e: MouseEvent) => void;
  copyTimerId?: number;
}

const tableListeners = new WeakMap<HTMLTableElement, (e: MouseEvent) => void>();
const filterRefs = new WeakMap<HTMLTableElement, FilterRefs>();

function findNavbarEl(): HTMLElement | null {
  for (const selector of NAVBAR_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el && el.offsetHeight > 0) return el;
  }
  return null;
}

function getNavbarHeight(): number {
  return findNavbarEl()?.offsetHeight ?? 0;
}

function isHiddenContext(): boolean {
  const path = location.pathname;
  if (path === '/admin' || path.startsWith('/admin/')) return true;
  if (
    location.hash === '#edit' ||
    path.endsWith('/edit') ||
    document.body.classList.contains('editing') ||
    document.body.classList.contains('grw-editor-mode') ||
    document.body.classList.contains('modal-open')
  ) return true;
  return false;
}

function updateFilterFooter(footer: HTMLDivElement, query: string, visible: number, total: number): void {
  if (!query) {
    footer.hidden = true;
    return;
  }
  footer.hidden = false;
  footer.textContent = `${visible} / ${total} 件`;
}

function restripeRows(table: HTMLTableElement): void {
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  let visibleIdx = 0;
  for (const row of Array.from(tbody.querySelectorAll<HTMLTableRowElement>(':scope > tr'))) {
    if (row.style.display === 'none') continue;
    const isOdd = visibleIdx % 2 === 0;
    row.classList.toggle(ROW_ODD_CLASS, isOdd);
    row.classList.toggle(ROW_EVEN_CLASS, !isOdd);
    visibleIdx++;
  }
}

function unwrapHighlights(table: HTMLTableElement): void {
  const marks = Array.from(table.querySelectorAll<HTMLElement>(`tbody mark.${MARK_CLASS}`));
  const parents = new Set<Node>();
  for (const mark of marks) {
    if (mark.parentNode) parents.add(mark.parentNode);
    mark.replaceWith(...Array.from(mark.childNodes));
  }
  for (const parent of parents) {
    (parent as Element).normalize();
  }
}

function highlightMatches(table: HTMLTableElement, tokens: string[]): void {
  if (tokens.length === 0) return;
  const lowerTokens = tokens.map(t => t.toLowerCase());

  const tbody = table.querySelector('tbody');
  if (!tbody) return;

  const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>(':scope > tr')).filter(
    r => r.style.display !== 'none'
  );

  for (const row of rows) {
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
        if (parent.classList.contains(MARK_CLASS)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('thead')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) textNodes.push(node as Text);

    for (const textNode of textNodes) {
      const text = textNode.nodeValue ?? '';
      const lower = text.toLowerCase();

      // 全トークンのマッチ位置を収集
      const ranges: [number, number][] = [];
      for (const token of lowerTokens) {
        let from = 0;
        let pos: number;
        while ((pos = lower.indexOf(token, from)) !== -1) {
          ranges.push([pos, pos + token.length]);
          from = pos + token.length;
        }
      }
      if (ranges.length === 0) continue;

      // start 昇順ソートし重なりをマージ
      ranges.sort((a, b) => a[0] - b[0]);
      const merged: [number, number][] = [ranges[0]];
      for (let i = 1; i < ranges.length; i++) {
        const last = merged[merged.length - 1];
        if (ranges[i][0] <= last[1]) {
          last[1] = Math.max(last[1], ranges[i][1]);
        } else {
          merged.push(ranges[i]);
        }
      }

      // 末尾から先頭の順に splitText → mark で wrap
      let current: Text = textNode;
      for (let i = merged.length - 1; i >= 0; i--) {
        const [start, end] = merged[i];
        const after = current.splitText(end);
        const middle = current.splitText(start);
        const mark = document.createElement('mark');
        mark.className = MARK_CLASS;
        mark.appendChild(middle);
        after.parentNode!.insertBefore(mark, after);
        current = after;
      }
    }
  }
}

function getCopyCellText(cell: Element, brReplacement: string): string {
  const clone = cell.cloneNode(true) as Element;
  for (const br of Array.from(clone.querySelectorAll('br'))) {
    br.replaceWith(brReplacement);
  }
  return (clone.textContent ?? '')
    .replace(/\s*\r?\n\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRows(table: HTMLTableElement, brReplacement: string): { header: string[]; rows: string[][] } {
  const thead = table.querySelector('thead');
  const header = thead
    ? Array.from(thead.querySelectorAll<HTMLTableCellElement>('tr > th')).map(th => getCopyCellText(th, brReplacement))
    : [];
  const tbody = table.querySelector('tbody');
  const bodyRows: string[][] = [];
  if (tbody) {
    for (const row of Array.from(tbody.querySelectorAll<HTMLTableRowElement>(':scope > tr'))) {
      if (row.style.display === 'none') continue;
      bodyRows.push(
        Array.from(row.querySelectorAll<HTMLTableCellElement>(':scope > td')).map(td => getCopyCellText(td, brReplacement))
      );
    }
  }
  return { header, rows: bodyRows };
}

function csvEscape(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCsv({ header, rows }: { header: string[]; rows: string[][] }): string {
  const lines: string[] = [];
  if (header.length) lines.push(header.map(csvEscape).join(','));
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  return lines.join('\n');
}

function mdEscape(v: string): string {
  return v.replace(/\|/g, '\\|');
}

function toMarkdown({ header, rows }: { header: string[]; rows: string[][] }): string {
  if (header.length === 0) return '';
  const lines: string[] = [];
  lines.push(`| ${header.map(mdEscape).join(' | ')} |`);
  lines.push(`| ${header.map(() => '---').join(' | ')} |`);
  for (const r of rows) {
    const padded = header.map((_, i) => mdEscape(r[i] ?? ''));
    lines.push(`| ${padded.join(' | ')} |`);
  }
  return lines.join('\n');
}

function getCopyCellTextJson(cell: Element): string {
  const clone = cell.cloneNode(true) as Element;
  const BR = '\x00';
  for (const br of Array.from(clone.querySelectorAll('br'))) br.replaceWith(BR);
  const raw = clone.textContent ?? '';
  return raw
    .split(BR)
    .map(s => s.replace(/\s*\r?\n\s*/g, ' ').replace(/\s+/g, ' ').trim())
    .join('\n');
}

function toJson(table: HTMLTableElement): string {
  const thead = table.querySelector('thead');
  const rawHeaders = thead
    ? Array.from(thead.querySelectorAll<HTMLTableCellElement>('tr > th')).map(th => getCopyCellText(th, ' '))
    : [];

  const tbody = table.querySelector('tbody');
  const bodyRows: string[][] = [];
  if (tbody) {
    for (const row of Array.from(tbody.querySelectorAll<HTMLTableRowElement>(':scope > tr'))) {
      if (row.style.display === 'none') continue;
      bodyRows.push(
        Array.from(row.querySelectorAll<HTMLTableCellElement>(':scope > td')).map(td => getCopyCellTextJson(td))
      );
    }
  }

  // ヘッダーを JSON キーに変換（空は col_N、重複は _2 サフィックス）
  const keyCount = new Map<string, number>();
  const keys = rawHeaders.map((h, i) => {
    const base = h || `col_${i + 1}`;
    const prev = keyCount.get(base) ?? 0;
    keyCount.set(base, prev + 1);
    return prev === 0 ? base : `${base}_${prev + 1}`;
  });

  // 列ごとに型を推定
  const colTypes: ColType[] = keys.map((_, colIdx) =>
    detectColumnType(bodyRows.map(row => row[colIdx] ?? ''))
  );

  const data = bodyRows.map(row => {
    const obj: Record<string, string | number | null> = {};
    keys.forEach((key, colIdx) => {
      const raw = row[colIdx] ?? '';
      if (raw === '') {
        obj[key] = null;
      } else if (colTypes[colIdx] === 'number') {
        const num = parseNumeric(raw);
        obj[key] = isNaN(num) ? raw : num;
      } else {
        obj[key] = raw;
      }
    });
    return obj;
  });

  return JSON.stringify(data, null, 2);
}

function createSvgEl(tag: string, attrs: Record<string, string>): Element {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function buildSvg(children: Array<{ tag: string; attrs: Record<string, string> }>): SVGSVGElement {
  const svg = createSvgEl('svg', {
    width: '15', height: '15', viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }) as SVGSVGElement;
  for (const { tag, attrs } of children) svg.appendChild(createSvgEl(tag, attrs));
  return svg;
}

function makeCopyIcon(): SVGSVGElement {
  return buildSvg([
    { tag: 'rect', attrs: { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' } },
    { tag: 'path', attrs: { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' } },
  ]);
}

function appendCheckBadge(svg: SVGSVGElement): void {
  svg.appendChild(createSvgEl('circle', {
    cx: '18', cy: '18', r: '5.5',
    stroke: 'currentColor', 'stroke-width': '1.5',
    class: 'gpte-copy-badge-bg',
  }));
  svg.appendChild(createSvgEl('path', {
    d: 'M15.5 18.2l1.8 1.8 3.2-3.5',
    stroke: 'currentColor', 'stroke-width': '1.8',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    fill: 'none',
  }));
}

function makeCsvOkIcon(): SVGSVGElement {
  const svg = buildSvg([
    { tag: 'rect', attrs: { x: '2', y: '2', width: '16', height: '16', rx: '1.5' } },
    { tag: 'path', attrs: { d: 'M2 7.5h16' } },
    { tag: 'path', attrs: { d: 'M2 12.5h16' } },
    { tag: 'path', attrs: { d: 'M7 2v16' } },
    { tag: 'path', attrs: { d: 'M13 2v16' } },
  ]);
  appendCheckBadge(svg);
  return svg;
}

function makeMdOkIcon(): SVGSVGElement {
  const svg = buildSvg([
    { tag: 'rect', attrs: { x: '2', y: '4', width: '16', height: '14', rx: '1.5' } },
    { tag: 'path', attrs: { d: 'M5 14V8l2.5 3 2.5-3v6' } },
    { tag: 'path', attrs: { d: 'M14 8v6m-1.8-1.8L14 14l1.8-1.8' } },
  ]);
  appendCheckBadge(svg);
  return svg;
}

function makeFailIcon(): SVGSVGElement {
  return buildSvg([
    { tag: 'path', attrs: { d: 'M18 6 6 18' } },
    { tag: 'path', attrs: { d: 'm6 6 12 12' } },
  ]);
}

function makeJsonOkIcon(): SVGSVGElement {
  const svg = buildSvg([
    { tag: 'path', attrs: { d: 'M6 2C5 2 4 2.8 4 4v4c0 1.2-1 1.8-2 2 1 .2 2 .8 2 2v4c0 1.2 1 2 2 2' } },
    { tag: 'path', attrs: { d: 'M14 2c1 0 2 .8 2 2v4c0 1.2 1 1.8 2 2-1 .2-2 .8-2 2v4c0 1.2-1 2-2 2' } },
  ]);
  appendCheckBadge(svg);
  return svg;
}

function makeFilterIcon(): SVGSVGElement {
  return buildSvg([
    { tag: 'path', attrs: { d: 'M3 4h18l-7 9v6l-4-2v-4z', 'stroke-linejoin': 'round' } },
  ]);
}

function setCopyBtnState(btn: HTMLButtonElement, state: CopyBtnState): void {
  while (btn.firstChild) btn.removeChild(btn.firstChild);
  btn.classList.remove(COPY_CLASS_OK, COPY_CLASS_FAIL);

  let icon: SVGSVGElement;
  let label: string;

  if (state === 'ok-csv') {
    icon = makeCsvOkIcon();
    label = 'CSV でクリップボードにコピーしました';
    btn.classList.add(COPY_CLASS_OK);
  } else if (state === 'ok-md') {
    icon = makeMdOkIcon();
    label = 'Markdown でクリップボードにコピーしました';
    btn.classList.add(COPY_CLASS_OK);
  } else if (state === 'ok-json') {
    icon = makeJsonOkIcon();
    label = 'JSON でクリップボードにコピーしました';
    btn.classList.add(COPY_CLASS_OK);
  } else if (state === 'fail') {
    icon = makeFailIcon();
    label = 'クリップボードへのコピーに失敗しました';
    btn.classList.add(COPY_CLASS_FAIL);
  } else {
    icon = makeCopyIcon();
    label = 'コピー (クリック: CSV / Shift+クリック: Markdown / Alt+クリック: JSON)';
  }

  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.appendChild(icon);
}

function flashCopyState(table: HTMLTableElement, btn: HTMLButtonElement, state: 'ok-csv' | 'ok-md' | 'ok-json' | 'fail'): void {
  const refs = filterRefs.get(table);
  if (refs?.copyTimerId !== undefined) window.clearTimeout(refs.copyTimerId);
  setCopyBtnState(btn, state);
  const id = window.setTimeout(() => {
    setCopyBtnState(btn, 'copy');
    if (refs) refs.copyTimerId = undefined;
  }, COPY_FEEDBACK_MS);
  if (refs) refs.copyTimerId = id;
}

function handleCopyClick(table: HTMLTableElement, btn: HTMLButtonElement, e: MouseEvent): void {
  let text: string;
  let successState: 'ok-csv' | 'ok-md' | 'ok-json';
  if (e.altKey) {
    text = toJson(table);
    successState = 'ok-json';
  } else if (e.shiftKey) {
    text = toMarkdown(extractRows(table, '<br>'));
    successState = 'ok-md';
  } else {
    text = toCsv(extractRows(table, ' '));
    successState = 'ok-csv';
  }
  navigator.clipboard.writeText(text).then(
    () => flashCopyState(table, btn, successState),
    (err) => {
      console.warn('[gpte] clipboard write failed:', err);
      flashCopyState(table, btn, 'fail');
    },
  );
}

function applyFilter(table: HTMLTableElement, query: string): void {
  const refs = filterRefs.get(table);
  const tbody = table.querySelector('tbody');
  if (!tbody || !refs) return;

  const tokens = query.trim().toLowerCase().split(/[\s　]+/).filter(Boolean);

  unwrapHighlights(table);

  let visible = 0;
  let total = 0;

  for (const row of Array.from(tbody.querySelectorAll<HTMLTableRowElement>(':scope > tr'))) {
    total++;
    if (tokens.length === 0) {
      row.style.display = '';
      visible++;
    } else {
      const text = (row.textContent ?? '').toLowerCase();
      const hit = tokens.every(t => text.includes(t));
      row.style.display = hit ? '' : 'none';
      if (hit) visible++;
    }
  }

  restripeRows(table);
  if (tokens.length > 0) highlightMatches(table, tokens);
  updateFilterFooter(refs.footer, query, visible, total);
}

function parseNumeric(s: string): number {
  return parseFloat(s.replace(/,/g, '').replace(/[^\d.\-+eE]/g, ''));
}

function detectColumnType(values: string[]): ColType {
  const nonEmpty = values.filter(v => v.trim() !== '');
  if (nonEmpty.length === 0) return 'string';
  if (nonEmpty.every(v => !isNaN(parseNumeric(v)))) return 'number';
  const dateRe = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/;
  if (nonEmpty.every(v => dateRe.test(v.trim()))) return 'date';
  return 'string';
}

function getCellText(row: HTMLTableRowElement, colIdx: number): string {
  const cell = row.cells[colIdx];
  return cell ? (cell.textContent ?? '').trim() : '';
}

function sortRows(table: HTMLTableElement, colIdx: number, dir: SortDir): void {
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>(':scope > tr'));

  if (dir === 'none') {
    rows.sort((a, b) =>
      parseInt(a.getAttribute(ORIG_INDEX_ATTR) ?? '0', 10) -
      parseInt(b.getAttribute(ORIG_INDEX_ATTR) ?? '0', 10)
    );
  } else {
    const colType = detectColumnType(rows.map(r => getCellText(r, colIdx)));
    rows.sort((a, b) => {
      const av = getCellText(a, colIdx);
      const bv = getCellText(b, colIdx);
      let cmp = 0;
      if (colType === 'number') {
        cmp = parseNumeric(av) - parseNumeric(bv);
      } else if (colType === 'date') {
        cmp = new Date(av.replace(/\//g, '-')).getTime() -
              new Date(bv.replace(/\//g, '-')).getTime();
      } else {
        cmp = av.localeCompare(bv, undefined, { sensitivity: 'base' });
      }
      return dir === 'asc' ? cmp : -cmp;
    });
  }

  const frag = document.createDocumentFragment();
  for (const row of rows) frag.appendChild(row);
  tbody.appendChild(frag);
  restripeRows(table);
}

function updateHeaderState(th: HTMLTableCellElement, dir: SortDir): void {
  th.classList.remove(SORTED_ASC_CLASS, SORTED_DESC_CLASS);
  if (dir === 'asc') {
    th.classList.add(SORTED_ASC_CLASS);
    th.setAttribute('aria-sort', 'ascending');
  } else if (dir === 'desc') {
    th.classList.add(SORTED_DESC_CLASS);
    th.setAttribute('aria-sort', 'descending');
  } else {
    th.setAttribute('aria-sort', 'none');
  }
}

function onHeaderClick(th: HTMLTableCellElement, table: HTMLTableElement): void {
  if (isHiddenContext()) return;

  const colIdx = parseInt(th.getAttribute(COL_ATTR) ?? '0', 10);
  const current = th.getAttribute('aria-sort');
  const next: SortDir =
    current === 'none' || !current ? 'asc'
    : current === 'ascending' ? 'desc'
    : 'none';

  const thead = table.querySelector('thead');
  if (thead) {
    thead.querySelectorAll<HTMLTableCellElement>(`th.${SORTABLE_CLASS}`).forEach(other => {
      if (other !== th) updateHeaderState(other, 'none');
    });
  }

  updateHeaderState(th, next);
  sortRows(table, colIdx, next);
}

function isEligible(table: HTMLTableElement): boolean {
  if (table.hasAttribute(ENHANCED_ATTR)) return false;
  if (table.hasAttribute('data-no-sort')) return false;
  const thead = table.querySelector('thead');
  if (!thead) return false;
  if (thead.querySelectorAll('th').length === 0) return false;
  return true;
}

function enhanceTable(table: HTMLTableElement): void {
  const thead = table.querySelector('thead');
  if (!thead) return;

  const tbody = table.querySelector('tbody');
  if (tbody) {
    Array.from(tbody.querySelectorAll<HTMLTableRowElement>(':scope > tr')).forEach((row, i) => {
      row.setAttribute(ORIG_INDEX_ATTR, String(i));
    });
  }

  Array.from(thead.querySelectorAll<HTMLTableCellElement>('th')).forEach((th, colIdx) => {
    th.setAttribute(COL_ATTR, String(colIdx));
    th.setAttribute('aria-sort', 'none');
    th.classList.add(SORTABLE_CLASS);
  });

  const handler = (e: MouseEvent) => {
    const th = (e.target as Element).closest<HTMLTableCellElement>(`th.${SORTABLE_CLASS}`);
    if (th && thead.contains(th)) onHeaderClick(th, table);
  };
  thead.addEventListener('click', handler);
  tableListeners.set(table, handler);

  table.setAttribute(ENHANCED_ATTR, '1');
  table.classList.add('gpte-enhanced');
  if (!table.hasAttribute(NO_STICKY_ATTR)) {
    table.classList.add('gpte-sticky-head');
    const navbarHeight = getNavbarHeight();
    if (navbarHeight > 0) {
      table.style.setProperty('--gpte-sticky-top', `${navbarHeight}px`);
    }
  }

  if (!table.hasAttribute(NO_FILTER_ATTR)) {
    const bar = document.createElement('div');
    bar.setAttribute(FILTER_BAR_ATTR, '1');

    const wrap = document.createElement('span');
    wrap.className = 'gpte-filter-input-wrap';

    const filterIcon = makeFilterIcon();
    filterIcon.classList.add('gpte-filter-icon');
    filterIcon.setAttribute('aria-hidden', 'true');
    wrap.appendChild(filterIcon);

    const input = document.createElement('input');
    input.type = 'search';
    input.setAttribute('aria-label', 'テーブルをフィルタ');
    wrap.appendChild(input);

    bar.appendChild(wrap);

    const footer = document.createElement('div');
    footer.setAttribute(FILTER_FOOTER_ATTR, '1');
    footer.setAttribute('aria-live', 'polite');
    footer.hidden = true;

    const filterHandler = () => applyFilter(table, input.value);
    input.addEventListener('input', filterHandler);

    filterRefs.set(table, { bar, footer, handler: filterHandler });

    if (typeof navigator.clipboard?.writeText === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute(COPY_BTN_ATTR, '1');
      setCopyBtnState(btn, 'copy');
      const copyHandler = (e: MouseEvent) => handleCopyClick(table, btn, e);
      btn.addEventListener('click', copyHandler);
      bar.appendChild(btn);
      const refs = filterRefs.get(table);
      if (refs) {
        refs.copyBtn = btn;
        refs.copyHandler = copyHandler;
      }
    }

    table.insertAdjacentElement('beforebegin', bar);
    table.insertAdjacentElement('afterend', footer);
  }

  restripeRows(table);
}

function cleanupTable(table: HTMLTableElement): void {
  unwrapHighlights(table);

  const refs = filterRefs.get(table);
  if (refs) {
    const input = refs.bar.querySelector<HTMLInputElement>('input');
    if (input) input.removeEventListener('input', refs.handler);
    if (refs.copyTimerId !== undefined) window.clearTimeout(refs.copyTimerId);
    if (refs.copyBtn && refs.copyHandler) {
      refs.copyBtn.removeEventListener('click', refs.copyHandler);
    }
    refs.bar.remove();
    refs.footer.remove();
    filterRefs.delete(table);
  }

  const tbody = table.querySelector('tbody');
  if (tbody) {
    const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>(':scope > tr'));
    rows.sort((a, b) =>
      parseInt(a.getAttribute(ORIG_INDEX_ATTR) ?? '0', 10) -
      parseInt(b.getAttribute(ORIG_INDEX_ATTR) ?? '0', 10)
    );
    const frag = document.createDocumentFragment();
    for (const row of rows) {
      row.style.display = '';
      row.classList.remove(ROW_ODD_CLASS, ROW_EVEN_CLASS);
      row.removeAttribute(ORIG_INDEX_ATTR);
      frag.appendChild(row);
    }
    tbody.appendChild(frag);
  }

  const thead = table.querySelector('thead');
  if (thead) {
    const handler = tableListeners.get(table);
    if (handler) {
      thead.removeEventListener('click', handler);
      tableListeners.delete(table);
    }
    thead.querySelectorAll<HTMLTableCellElement>('th').forEach(th => {
      th.classList.remove(SORTABLE_CLASS, SORTED_ASC_CLASS, SORTED_DESC_CLASS);
      th.removeAttribute('aria-sort');
      th.removeAttribute(COL_ATTR);
    });
  }

  table.removeAttribute(ENHANCED_ATTR);
  table.classList.remove('gpte-enhanced', 'gpte-sticky-head');
  table.style.removeProperty('--gpte-sticky-top');
}

function scanAndEnhance(): void {
  if (isHiddenContext()) return;
  document.querySelectorAll<HTMLTableElement>('table').forEach(table => {
    if (isEligible(table)) enhanceTable(table);
  });
}

export function createTableExtended(): { mount(): void; unmount(): void } {
  let observer: MutationObserver | null = null;
  let navbarObserver: ResizeObserver | null = null;
  let observerRafId: number | null = null;
  let scanRafId: number | null = null;

  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  function scheduleScan(): void {
    if (scanRafId !== null) return;
    scanRafId = requestAnimationFrame(() => {
      scanRafId = null;
      scanAndEnhance();
    });
  }

  function onNavigation(): void {
    requestAnimationFrame(() => {
      scheduleScan();
    });
  }

  function mount(): void {
    history.pushState = function (...args) {
      originalPushState(...args);
      window.dispatchEvent(new Event('growi-pte-navigate'));
    };
    history.replaceState = function (...args) {
      originalReplaceState(...args);
      window.dispatchEvent(new Event('growi-pte-navigate'));
    };

    window.addEventListener('popstate', onNavigation);
    window.addEventListener('hashchange', onNavigation);
    window.addEventListener('growi-pte-navigate', onNavigation);

    observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const node of Array.from(m.addedNodes)) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as Element;
              if (el.tagName === 'TABLE' || el.querySelector('table')) {
                shouldScan = true;
                break;
              }
            }
          }
        } else if (m.type === 'attributes') {
          if (isHiddenContext()) {
            document.querySelectorAll<HTMLTableElement>(`table[${ENHANCED_ATTR}]`).forEach(cleanupTable);
          } else {
            shouldScan = true;
          }
        }
        if (shouldScan) break;
      }

      if (!shouldScan) return;
      if (observerRafId !== null) return;
      observerRafId = requestAnimationFrame(() => {
        observerRafId = null;
        scheduleScan();
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    const navbarEl = findNavbarEl();
    if (navbarEl) {
      navbarObserver = new ResizeObserver(() => {
        const h = navbarEl.offsetHeight;
        document.querySelectorAll<HTMLTableElement>(
          `table[${ENHANCED_ATTR}].gpte-sticky-head`
        ).forEach(t => {
          if (h > 0) {
            t.style.setProperty('--gpte-sticky-top', `${h}px`);
          } else {
            t.style.removeProperty('--gpte-sticky-top');
          }
        });
      });
      navbarObserver.observe(navbarEl);
    }

    scheduleScan();
  }

  function unmount(): void {
    window.removeEventListener('popstate', onNavigation);
    window.removeEventListener('hashchange', onNavigation);
    window.removeEventListener('growi-pte-navigate', onNavigation);

    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;

    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (navbarObserver) {
      navbarObserver.disconnect();
      navbarObserver = null;
    }
    if (scanRafId !== null) {
      cancelAnimationFrame(scanRafId);
      scanRafId = null;
    }
    if (observerRafId !== null) {
      cancelAnimationFrame(observerRafId);
      observerRafId = null;
    }

    document.querySelectorAll<HTMLTableElement>(`table[${ENHANCED_ATTR}]`).forEach(cleanupTable);
  }

  return { mount, unmount };
}
