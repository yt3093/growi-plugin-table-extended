import './styles/tableExtended.css';

const ENHANCED_ATTR = 'data-gpte-enhanced';
const ORIG_INDEX_ATTR = 'data-gpte-original-index';
const COL_ATTR = 'data-gpte-col';
const SORTABLE_CLASS = 'gpte-sortable';
const SORTED_ASC_CLASS = 'gpte-sorted-asc';
const SORTED_DESC_CLASS = 'gpte-sorted-desc';

type SortDir = 'asc' | 'desc' | 'none';
type ColType = 'number' | 'date' | 'string';

const tableListeners = new WeakMap<HTMLTableElement, (e: MouseEvent) => void>();

function isHiddenContext(): boolean {
  const path = location.pathname;
  if (path === '/admin' || path.startsWith('/admin/')) return true;
  if (
    location.hash === '#edit' ||
    path.endsWith('/edit') ||
    document.body.classList.contains('editing') ||
    document.body.classList.contains('grw-editor-mode')
  ) return true;
  return false;
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
}

function cleanupTable(table: HTMLTableElement): void {
  const tbody = table.querySelector('tbody');
  if (tbody) {
    const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>(':scope > tr'));
    rows.sort((a, b) =>
      parseInt(a.getAttribute(ORIG_INDEX_ATTR) ?? '0', 10) -
      parseInt(b.getAttribute(ORIG_INDEX_ATTR) ?? '0', 10)
    );
    const frag = document.createDocumentFragment();
    for (const row of rows) {
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
  table.classList.remove('gpte-enhanced');
}

function scanAndEnhance(): void {
  if (isHiddenContext()) return;
  document.querySelectorAll<HTMLTableElement>('table').forEach(table => {
    if (isEligible(table)) enhanceTable(table);
  });
}

export function createTableExtended(): { mount(): void; unmount(): void } {
  let observer: MutationObserver | null = null;
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
          shouldScan = true;
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
