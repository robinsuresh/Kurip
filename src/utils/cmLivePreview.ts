import {
  EditorState,
  RangeSetBuilder,
  SelectionRange,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import {
  isImagePlaceholderUrl,
  parseMarkdownImage,
  serializeMarkdownImage,
  serializeMarkdownTable,
} from './editorCommands';
import {
  getCachedLocalImage,
  isLocalMediaUrl,
  resolveLocalImageUrl,
  saveLocalImageFile,
} from './localMedia';

const setTableColWidthsEffect = StateEffect.define<{ from: number; widths: number[] | null }>();

const tableWidthsField = StateField.define<Map<number, number[]>>({
  create() {
    return new Map();
  },
  update(map, tr) {
    let next = map;
    if (tr.docChanged && map.size > 0) {
      const remapped = new Map<number, number[]>();
      map.forEach((widths, pos) => {
        const mapped = tr.changes.mapPos(pos, -1, 1);
        if (mapped !== null) {
          remapped.set(mapped, widths);
        }
      });
      next = remapped;
    }
    for (const effect of tr.effects) {
      if (effect.is(setTableColWidthsEffect)) {
        const copy = new Map(next);
        if (effect.value.widths) {
          copy.set(effect.value.from, effect.value.widths);
        } else {
          copy.delete(effect.value.from);
        }
        next = copy;
      }
    }
    return next;
  },
});

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly bracketFrom: number
  ) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.bracketFrom === this.bracketFrom;
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.checked;
    input.className = 'cm-obs-checkbox';
    input.setAttribute('aria-label', this.checked ? 'Mark task incomplete' : 'Mark task complete');
    input.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        changes: {
          from: this.bracketFrom,
          to: this.bracketFrom + 3,
          insert: this.checked ? '[ ]' : '[x]',
        },
      });
    });
    return input;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-obs-bullet';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = '•';
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class HrWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement('span');
    hr.className = 'cm-obs-hr';
    hr.setAttribute('aria-hidden', 'true');
    return hr;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class CalloutIconWidget extends WidgetType {
  constructor(readonly calloutType: string) {
    super();
  }

  eq(other: CalloutIconWidget): boolean {
    return other.calloutType === this.calloutType;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = `cm-obs-callout-icon cm-obs-callout-icon-${this.calloutType}`;
    span.setAttribute('aria-hidden', 'true');

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    const path = document.createElementNS(svgNS, 'path');
    if (this.calloutType === 'tip') {
      path.setAttribute(
        'd',
        'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4'
      );
    } else if (this.calloutType === 'warning' || this.calloutType === 'danger') {
      path.setAttribute(
        'd',
        'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4M12 17h.01'
      );
    } else {
      path.setAttribute('d', 'M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z');
    }
    svg.appendChild(path);
    span.appendChild(svg);
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class CodeFenceHeaderWidget extends WidgetType {
  constructor(readonly lang: string) {
    super();
  }

  eq(other: CodeFenceHeaderWidget): boolean {
    return other.lang === this.lang;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-obs-code-fence-label';
    span.textContent = this.lang || 'code';
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class CodeFenceFooterWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-obs-code-fence-end';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class TableWidget extends WidgetType {
  constructor(
    readonly headers: string[],
    readonly rows: string[][],
    readonly tableFrom: number,
    readonly tableTo: number,
    readonly savedWidths: number[] | null,
    readonly callbacks: Pick<LivePreviewCallbacks, 'onMoveBlockAtPos' | 'onDeleteBlockAtPos'>
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return (
      other.tableFrom === this.tableFrom &&
      other.tableTo === this.tableTo &&
      JSON.stringify(other.headers) === JSON.stringify(this.headers) &&
      JSON.stringify(other.rows) === JSON.stringify(this.rows) &&
      JSON.stringify(other.savedWidths) === JSON.stringify(this.savedWidths)
    );
  }

  updateDOM(dom: HTMLElement): boolean {
    if (dom.dataset.editing === '1' || dom.contains(document.activeElement)) {
      dom.dataset.tableFrom = String(this.tableFrom);
      dom.dataset.tableTo = String(this.tableTo);
      return true;
    }
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-obs-table-widget';
    wrap.dataset.tableFrom = String(this.tableFrom);
    wrap.dataset.tableTo = String(this.tableTo);

    const localHeaders = this.headers.map((h) => h.trim());
    const localRows = this.rows.map((r) => r.map((c) => c.trim()));
    let colWidths: number[] | null =
      this.savedWidths && this.savedWidths.length === localHeaders.length
        ? [...this.savedWidths]
        : null;
    let focusedCell: HTMLElement | null = null;

    const commitTable = () => {
      const from = Number(wrap.dataset.tableFrom);
      const to = Number(wrap.dataset.tableTo);
      const nextMd = serializeMarkdownTable(localHeaders, localRows);
      wrap.dataset.tableTo = String(from + nextMd.length);
      view.dispatch({
        changes: { from, to, insert: nextMd },
      });
    };

    const persistWidths = (widths: number[] | null) => {
      wrap.dataset.editing = '1';
      view.dispatch({
        effects: setTableColWidthsEffect.of({
          from: Number(wrap.dataset.tableFrom),
          widths: widths ? [...widths] : null,
        }),
      });
      delete wrap.dataset.editing;
    };

    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'cm-obs-table-scroll';

    const table = document.createElement('table');
    const colgroup = document.createElement('colgroup');
    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    const tbody = document.createElement('tbody');
    const resizerLayer = document.createElement('div');
    resizerLayer.className = 'cm-obs-table-resizers';

    const applyColWidths = () => {
      while (colgroup.children.length < localHeaders.length) {
        colgroup.appendChild(document.createElement('col'));
      }
      while (colgroup.children.length > localHeaders.length) {
        colgroup.lastElementChild?.remove();
      }
      const cols = Array.from(colgroup.children) as HTMLTableColElement[];
      if (colWidths && colWidths.length === localHeaders.length) {
        table.style.tableLayout = 'fixed';
        const total = colWidths.reduce((sum, w) => sum + w, 0);
        table.style.width = `${total}px`;
        wrap.style.width = `${total + 2}px`;
        wrap.style.maxWidth = 'calc(100% - 12px)';
        cols.forEach((col, i) => {
          col.style.width = `${colWidths![i]}px`;
        });
      } else {
        table.style.tableLayout = '';
        table.style.width = '';
        wrap.style.width = '';
        wrap.style.maxWidth = '';
        cols.forEach((col) => {
          col.style.width = '';
        });
      }
    };

    const positionResizerHandles = () => {
      const ths = Array.from(trHead.children) as HTMLElement[];
      const handles = Array.from(resizerLayer.children) as HTMLElement[];
      const tableHeight = table.offsetHeight;
      if (tableHeight > 0) {
        resizerLayer.style.height = `${tableHeight}px`;
      }
      ths.forEach((th, idx) => {
        const handle = handles[idx];
        if (!handle) return;
        const left = th.offsetLeft + th.offsetWidth - 4;
        handle.style.left = `${Math.max(0, left)}px`;
      });
    };

    const rebuildResizerHandles = () => {
      resizerLayer.innerHTML = '';
      localHeaders.forEach((_, colIdx) => {
        const handle = document.createElement('div');
        handle.className = 'cm-obs-table-col-resizer';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.setAttribute('aria-label', `Resize column ${colIdx + 1}`);
        handle.tabIndex = 0;
        handle.title = 'Drag to resize column (double-click to reset)';

        handle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const ths = Array.from(trHead.children) as HTMLElement[];
          if (ths.length !== localHeaders.length) return;
          const startWidths = ths.map((th) =>
            Math.max(64, Math.round(th.getBoundingClientRect().width))
          );
          const startX = e.clientX;
          colWidths = [...startWidths];
          applyColWidths();
          positionResizerHandles();
          handle.classList.add('is-resizing');
          document.body.style.cursor = 'col-resize';

          const onMove = (moveEvent: MouseEvent) => {
            if (!colWidths) return;
            const delta = moveEvent.clientX - startX;
            colWidths[colIdx] = Math.max(64, Math.round(startWidths[colIdx] + delta));
            applyColWidths();
            positionResizerHandles();
          };

          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            handle.classList.remove('is-resizing');
            document.body.style.cursor = '';
            persistWidths(colWidths);
          };

          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        });

        handle.addEventListener('dblclick', (e) => {
          e.preventDefault();
          e.stopPropagation();
          colWidths = null;
          applyColWidths();
          window.requestAnimationFrame(positionResizerHandles);
          persistWidths(null);
        });

        handle.addEventListener('keydown', (e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          e.stopPropagation();
          const ths = Array.from(trHead.children) as HTMLElement[];
          if (!colWidths || colWidths.length !== localHeaders.length) {
            colWidths = ths.map((th) =>
              Math.max(64, Math.round(th.getBoundingClientRect().width))
            );
          }
          const step = e.key === 'ArrowRight' ? 16 : -16;
          colWidths[colIdx] = Math.max(64, colWidths[colIdx] + step);
          applyColWidths();
          positionResizerHandles();
          persistWidths(colWidths);
        });

        resizerLayer.appendChild(handle);
      });
      window.requestAnimationFrame(positionResizerHandles);
    };

    const getCellsGrid = (): HTMLElement[][] => {
      const grid: HTMLElement[][] = [];
      const hRow = Array.from(thead.querySelectorAll('th')) as HTMLElement[];
      if (hRow.length) grid.push(hRow);
      tbody.querySelectorAll('tr').forEach((tr) => {
        grid.push(Array.from(tr.querySelectorAll('td')) as HTMLElement[]);
      });
      return grid;
    };

    const refreshHeaderPlaceholders = () => {
      Array.from(trHead.querySelectorAll('th')).forEach((el, idx) => {
        el.dataset.placeholder = `Column ${idx + 1}`;
      });
    };

    const focusCell = (rIdx: number, cIdx: number) => {
      const grid = getCellsGrid();
      const target = grid[rIdx]?.[cIdx];
      if (!target) return;
      focusedCell = target;
      target.focus();
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    };

    const syncActionButtonStates = () => {
      delRowBtn.disabled = localRows.length === 0;
      delColBtn.disabled = localHeaders.length <= 1;
    };

    const stripSyntaxForCell = (raw: string) =>
      raw
        .trim()
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1');

    const bindCellEvents = (cell: HTMLElement, isHeader: boolean) => {
      cell.contentEditable = 'true';
      cell.spellcheck = false;
      cell.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });
      cell.addEventListener('focus', () => {
        focusedCell = cell;
      });
      cell.addEventListener('input', () => {
        const rawText = cell.textContent ?? '';
        if (rawText === '' && cell.innerHTML !== '') {
          cell.innerHTML = '';
        }
        cell.dataset.empty = rawText.trim() === '' ? 'true' : 'false';

        const tr = cell.closest('tr');
        const colIdx = tr ? Array.from(tr.children).indexOf(cell) : 0;
        if (colIdx < 0) return;

        if (isHeader) {
          localHeaders[colIdx] = rawText;
        } else if (tr) {
          const rIdx = Array.from(tbody.children).indexOf(tr);
          if (rIdx >= 0) {
            if (!localRows[rIdx]) localRows[rIdx] = [];
            localRows[rIdx][colIdx] = rawText;
          }
        }
        commitTable();
      });
      cell.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
          e.preventDefault();
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(cell);
            sel.removeAllRanges();
            sel.addRange(range);
          }
          return;
        }
        const tr = cell.closest('tr');
        const colIndex = tr ? Array.from(tr.children).indexOf(cell) : 0;
        const gridRow = isHeader ? 0 : (tr ? Array.from(tbody.children).indexOf(tr) : 0) + 1;
        const grid = getCellsGrid();
        const totalRows = grid.length;
        const totalCols = localHeaders.length;

        if (e.key === 'Tab') {
          e.preventDefault();
          let nextR = gridRow;
          let nextC = colIndex + (e.shiftKey ? -1 : 1);
          if (nextC >= totalCols) {
            nextC = 0;
            nextR++;
          } else if (nextC < 0) {
            nextC = totalCols - 1;
            nextR--;
          }
          if (nextR >= 0 && nextR < totalRows) {
            focusCell(nextR, nextC);
          } else if (nextR >= totalRows) {
            const blankRow = Array.from({ length: totalCols }, () => '');
            localRows.push(blankRow);
            tbody.appendChild(buildBodyRow(blankRow));
            syncActionButtonStates();
            wrap.dataset.editing = '1';
            focusCell(totalRows, 0);
            commitTable();
            delete wrap.dataset.editing;
          }
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (gridRow + 1 < totalRows) {
            focusCell(gridRow + 1, colIndex);
          } else {
            const blankRow = Array.from({ length: totalCols }, () => '');
            localRows.push(blankRow);
            tbody.appendChild(buildBodyRow(blankRow));
            syncActionButtonStates();
            wrap.dataset.editing = '1';
            focusCell(totalRows, colIndex);
            commitTable();
            delete wrap.dataset.editing;
          }
        } else if (e.key === 'ArrowDown') {
          if (gridRow + 1 < totalRows) {
            e.preventDefault();
            focusCell(gridRow + 1, colIndex);
          }
        } else if (e.key === 'ArrowUp') {
          if (gridRow - 1 >= 0) {
            e.preventDefault();
            focusCell(gridRow - 1, colIndex);
          }
        }
      });
    };

    const createHeaderCell = (value: string, cIdx: number) => {
      const th = document.createElement('th');
      const clean = stripSyntaxForCell(value);
      th.textContent = clean;
      th.dataset.placeholder = `Column ${cIdx + 1}`;
      th.dataset.empty = clean === '' ? 'true' : 'false';
      bindCellEvents(th, true);
      return th;
    };

    const createBodyCell = (value: string) => {
      const td = document.createElement('td');
      const clean = stripSyntaxForCell(value);
      td.textContent = clean;
      td.dataset.placeholder = 'Value';
      td.dataset.empty = clean === '' ? 'true' : 'false';
      bindCellEvents(td, false);
      return td;
    };

    const buildBodyRow = (row: string[]) => {
      const tr = document.createElement('tr');
      for (let c = 0; c < localHeaders.length; c++) {
        tr.appendChild(createBodyCell(row[c] || ''));
      }
      return tr;
    };

    localHeaders.forEach((h, cIdx) => {
      trHead.appendChild(createHeaderCell(h, cIdx));
    });
    thead.appendChild(trHead);
    table.appendChild(colgroup);
    table.appendChild(thead);

    localRows.forEach((row) => {
      tbody.appendChild(buildBodyRow(row));
    });
    table.appendChild(tbody);
    applyColWidths();
    rebuildResizerHandles();
    scrollContainer.appendChild(table);
    scrollContainer.appendChild(resizerLayer);
    wrap.appendChild(scrollContainer);

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => positionResizerHandles());
      ro.observe(table);
    }

    // Table structure & block controls bar
    const actions = document.createElement('div');
    actions.className = 'cm-obs-table-actions';

    const leftGroup = document.createElement('div');
    leftGroup.className = 'cm-obs-table-actions-group';

    const addRowBtn = document.createElement('button');
    addRowBtn.type = 'button';
    addRowBtn.textContent = '+ Row';
    addRowBtn.setAttribute('aria-label', 'Add table row');
    addRowBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    addRowBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const newIdx = localRows.length;
      const blankRow = Array.from({ length: localHeaders.length }, () => '');
      localRows.push(blankRow);
      tbody.appendChild(buildBodyRow(blankRow));
      syncActionButtonStates();
      wrap.dataset.editing = '1';
      focusCell(newIdx + 1, 0);
      commitTable();
      delete wrap.dataset.editing;
      window.requestAnimationFrame(positionResizerHandles);
    });

    const addColBtn = document.createElement('button');
    addColBtn.type = 'button';
    addColBtn.textContent = '+ Column';
    addColBtn.setAttribute('aria-label', 'Add table column');
    addColBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    addColBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const newColIdx = localHeaders.length;
      localHeaders.push('');
      localRows.forEach((r) => r.push(''));
      if (colWidths) {
        colWidths.push(140);
      }
      trHead.appendChild(createHeaderCell('', newColIdx));
      Array.from(tbody.querySelectorAll('tr')).forEach((tr) => {
        tr.appendChild(createBodyCell(''));
      });
      applyColWidths();
      rebuildResizerHandles();
      syncActionButtonStates();
      wrap.dataset.editing = '1';
      focusCell(0, newColIdx);
      commitTable();
      if (colWidths) {
        view.dispatch({
          effects: setTableColWidthsEffect.of({
            from: Number(wrap.dataset.tableFrom),
            widths: [...colWidths],
          }),
        });
      }
      delete wrap.dataset.editing;
    });

    const delRowBtn = document.createElement('button');
    delRowBtn.type = 'button';
    delRowBtn.textContent = '− Row';
    delRowBtn.className = 'cm-obs-table-btn-danger';
    delRowBtn.setAttribute('aria-label', 'Delete table row');
    delRowBtn.title = 'Delete active or last row';
    delRowBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    delRowBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (localRows.length === 0) return;

      let targetRowIdx = localRows.length - 1;
      if (focusedCell && focusedCell.tagName === 'TD') {
        const tr = focusedCell.closest('tr');
        const idx = tr ? Array.from(tbody.children).indexOf(tr) : -1;
        if (idx >= 0) targetRowIdx = idx;
      }

      localRows.splice(targetRowIdx, 1);
      tbody.children[targetRowIdx]?.remove();
      syncActionButtonStates();
      wrap.dataset.editing = '1';
      const nextGridRow =
        localRows.length > 0 ? Math.min(targetRowIdx + 1, localRows.length) : 0;
      focusCell(nextGridRow, 0);
      commitTable();
      delete wrap.dataset.editing;
    });

    const delColBtn = document.createElement('button');
    delColBtn.type = 'button';
    delColBtn.textContent = '− Column';
    delColBtn.className = 'cm-obs-table-btn-danger';
    delColBtn.setAttribute('aria-label', 'Delete table column');
    delColBtn.title = 'Delete active or last column';
    delColBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    delColBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (localHeaders.length <= 1) return;

      let targetColIdx = localHeaders.length - 1;
      if (focusedCell) {
        const tr = focusedCell.closest('tr');
        const idx = tr ? Array.from(tr.children).indexOf(focusedCell) : -1;
        if (idx >= 0 && idx < localHeaders.length) targetColIdx = idx;
      }

      localHeaders.splice(targetColIdx, 1);
      localRows.forEach((r) => r.splice(targetColIdx, 1));
      if (colWidths) {
        colWidths.splice(targetColIdx, 1);
      }
      trHead.children[targetColIdx]?.remove();
      Array.from(tbody.querySelectorAll('tr')).forEach((tr) => {
        tr.children[targetColIdx]?.remove();
      });
      refreshHeaderPlaceholders();
      applyColWidths();
      rebuildResizerHandles();
      syncActionButtonStates();
      wrap.dataset.editing = '1';
      focusCell(0, Math.min(targetColIdx, localHeaders.length - 1));
      commitTable();
      if (colWidths) {
        view.dispatch({
          effects: setTableColWidthsEffect.of({
            from: Number(wrap.dataset.tableFrom),
            widths: [...colWidths],
          }),
        });
      }
      delete wrap.dataset.editing;
    });

    leftGroup.appendChild(addRowBtn);
    leftGroup.appendChild(addColBtn);
    leftGroup.appendChild(delRowBtn);
    leftGroup.appendChild(delColBtn);

    const rightGroup = document.createElement('div');
    rightGroup.className = 'cm-obs-table-actions-group';

    const createIconBtn = (
      ariaLabel: string,
      title: string,
      pathD: string,
      onClick: () => void,
      extraClass = ''
    ) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-label', ariaLabel);
      btn.title = title;
      if (extraClass) btn.className = extraClass;
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '13');
      svg.setAttribute('height', '13');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      const p = document.createElementNS(svgNS, 'path');
      p.setAttribute('d', pathD);
      svg.appendChild(p);
      btn.appendChild(svg);
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      return btn;
    };

    rightGroup.appendChild(
      createIconBtn('Move table up', 'Move table up', 'M12 19V5M5 12l7-7 7 7', () => {
        this.callbacks.onMoveBlockAtPos?.(Number(wrap.dataset.tableFrom), 'up');
      })
    );
    rightGroup.appendChild(
      createIconBtn('Move table down', 'Move table down', 'M12 5v14M19 12l-7 7-7-7', () => {
        this.callbacks.onMoveBlockAtPos?.(Number(wrap.dataset.tableFrom), 'down');
      })
    );
    rightGroup.appendChild(
      createIconBtn(
        'Delete table',
        'Delete table block',
        'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6',
        () => {
          this.callbacks.onDeleteBlockAtPos?.(Number(wrap.dataset.tableFrom));
        },
        'cm-obs-table-btn-danger'
      )
    );

    actions.appendChild(leftGroup);
    actions.appendChild(rightGroup);
    wrap.appendChild(actions);
    syncActionButtonStates();

    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function createImageActionSvg(pathD: string): SVGSVGElement {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '13');
  svg.setAttribute('height', '13');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS(svgNS, 'path');
  p.setAttribute('d', pathD);
  svg.appendChild(p);
  return svg;
}

class ImageWidget extends WidgetType {
  constructor(
    readonly alt: string,
    readonly url: string,
    readonly imageFrom: number,
    readonly imageTo: number,
    readonly callbacks: Pick<LivePreviewCallbacks, 'onMoveBlockAtPos' | 'onDeleteBlockAtPos'>,
    readonly width?: number,
    readonly height?: number
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return (
      other.imageFrom === this.imageFrom &&
      other.imageTo === this.imageTo &&
      other.alt === this.alt &&
      other.url === this.url &&
      other.width === this.width &&
      other.height === this.height
    );
  }

  updateDOM(dom: HTMLElement): boolean {
    if (dom.dataset.editing === '1' || dom.contains(document.activeElement)) {
      dom.dataset.imageFrom = String(this.imageFrom);
      dom.dataset.imageTo = String(this.imageTo);
      return true;
    }
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-obs-image-widget';
    wrap.dataset.imageFrom = String(this.imageFrom);
    wrap.dataset.imageTo = String(this.imageTo);

    let currentAlt = this.alt;
    let currentUrl = this.url;
    let currentWidth = this.width;
    let currentHeight = this.height;
    let isEditOpen = isImagePlaceholderUrl(currentUrl);
    let hasLoadError = false;

    const commitImage = (
      nextAlt: string,
      nextUrl: string,
      nextWidth?: number,
      nextHeight?: number,
      refocusCorner?: 'nw' | 'ne' | 'sw' | 'se'
    ) => {
      const from = Number(wrap.dataset.imageFrom);
      const to = Number(wrap.dataset.imageTo);
      const cleanW = nextWidth && nextWidth > 0 ? Math.round(nextWidth) : undefined;
      const cleanH = nextHeight && nextHeight > 0 ? Math.round(nextHeight) : undefined;
      const nextMd = serializeMarkdownImage(nextAlt, nextUrl, cleanW, cleanH);
      currentAlt = nextAlt;
      currentUrl = nextUrl;
      currentWidth = cleanW;
      currentHeight = cleanH;
      hasLoadError = false;
      isEditOpen = isImagePlaceholderUrl(nextUrl);
      wrap.dataset.imageTo = String(from + nextMd.length);
      if (!refocusCorner) {
        delete wrap.dataset.editing;
      }
      view.dispatch({
        changes: { from, to, insert: nextMd },
        selection: { anchor: from + nextMd.length },
      });
      renderContent();
      if (refocusCorner) {
        const nextHandle = body.querySelector(
          `[data-corner="${refocusCorner}"]`
        ) as HTMLElement | null;
        nextHandle?.focus();
      }
    };

    const handleFileUpload = async (file: File) => {
      if (!file.type.startsWith('image/')) return;
      const saved = await saveLocalImageFile(file);
      const preferredAlt =
        currentAlt && currentAlt.toLowerCase() !== 'alt' && currentAlt.toLowerCase() !== 'image'
          ? currentAlt
          : saved.alt;
      commitImage(preferredAlt, saved.url, undefined, undefined);
    };

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.className = 'sr-only';
    fileInput.setAttribute('aria-label', 'Choose local image file');
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) {
        void handleFileUpload(file);
      }
      fileInput.value = '';
    });

    const body = document.createElement('div');
    wrap.appendChild(fileInput);
    wrap.appendChild(body);

    const buildBlockControlGroup = () => {
      const group = document.createElement('div');
      group.className = 'cm-obs-image-controls-group';

      const makeBtn = (
        ariaLabel: string,
        title: string,
        pathD: string,
        onClick: () => void,
        extraClass = ''
      ) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-label', ariaLabel);
        btn.title = title;
        if (extraClass) btn.className = extraClass;
        btn.appendChild(createImageActionSvg(pathD));
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        });
        return btn;
      };

      group.appendChild(
        makeBtn('Move image up', 'Move image up', 'M12 19V5M5 12l7-7 7 7', () => {
          this.callbacks.onMoveBlockAtPos?.(Number(wrap.dataset.imageFrom), 'up');
        })
      );
      group.appendChild(
        makeBtn('Move image down', 'Move image down', 'M12 5v14M19 12l-7 7-7-7', () => {
          this.callbacks.onMoveBlockAtPos?.(Number(wrap.dataset.imageFrom), 'down');
        })
      );
      group.appendChild(
        makeBtn(
          'Delete image',
          'Delete image block',
          'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6',
          () => {
            this.callbacks.onDeleteBlockAtPos?.(Number(wrap.dataset.imageFrom));
          },
          'cm-obs-table-btn-danger'
        )
      );
      return group;
    };

    const renderContent = () => {
      body.innerHTML = '';

      if (isEditOpen || hasLoadError || isImagePlaceholderUrl(currentUrl)) {
        const placeholder = document.createElement('div');
        placeholder.className = 'cm-obs-image-placeholder';

        placeholder.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.stopPropagation();
          placeholder.classList.add('is-dragover');
        });
        placeholder.addEventListener('dragleave', (e) => {
          e.stopPropagation();
          placeholder.classList.remove('is-dragover');
        });
        placeholder.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          placeholder.classList.remove('is-dragover');
          const file = e.dataTransfer?.files?.[0];
          if (file && file.type.startsWith('image/')) {
            void handleFileUpload(file);
          }
        });

        const header = document.createElement('div');
        header.className = 'cm-obs-image-placeholder-header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'cm-obs-image-placeholder-title';
        titleWrap.appendChild(
          createImageActionSvg(
            'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm14 10-3.5-4.5a1 1 0 0 0-1.6 0L9 14l-1.5-2a1 1 0 0 0-1.6 0L4 14.5M9 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z'
          )
        );
        const labelSpan = document.createElement('span');
        labelSpan.textContent = hasLoadError
          ? `Could not load image (${currentUrl})`
          : isImagePlaceholderUrl(currentUrl)
          ? 'Embed Image'
          : 'Edit Image';
        titleWrap.appendChild(labelSpan);
        header.appendChild(titleWrap);
        header.appendChild(buildBlockControlGroup());
        placeholder.appendChild(header);

        const formRow = document.createElement('div');
        formRow.className = 'cm-obs-image-form';

        const uploadBtn = document.createElement('button');
        uploadBtn.type = 'button';
        uploadBtn.className = 'cm-obs-image-upload-btn';
        uploadBtn.textContent = 'Choose Local Image';
        uploadBtn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        uploadBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          fileInput.click();
        });

        const urlInput = document.createElement('input');
        urlInput.type = 'text';
        urlInput.className = 'cm-obs-image-input';
        urlInput.placeholder = 'Paste image URL or local path (/assets/...)';
        urlInput.setAttribute('aria-label', 'Image URL or path');
        urlInput.value = isImagePlaceholderUrl(currentUrl) ? '' : currentUrl;

        const altInput = document.createElement('input');
        altInput.type = 'text';
        altInput.className = 'cm-obs-image-input cm-obs-image-alt-input';
        altInput.placeholder = 'Alt text / caption';
        altInput.setAttribute('aria-label', 'Image alt text');
        altInput.value =
          currentAlt && currentAlt.toLowerCase() !== 'alt' ? currentAlt : '';

        const submitInputs = () => {
          const nextUrl = urlInput.value.trim();
          if (!nextUrl) return;
          const nextAlt = altInput.value.trim() || 'Image';
          commitImage(nextAlt, nextUrl, currentWidth, currentHeight);
        };

        [urlInput, altInput].forEach((input) => {
          input.addEventListener('mousedown', (e) => e.stopPropagation());
          input.addEventListener('focus', () => {
            wrap.dataset.editing = '1';
          });
          input.addEventListener('blur', () => {
            if (!wrap.contains(document.activeElement)) {
              delete wrap.dataset.editing;
            }
          });
          input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              submitInputs();
            } else if (e.key === 'Escape' && !isImagePlaceholderUrl(currentUrl)) {
              e.preventDefault();
              isEditOpen = false;
              delete wrap.dataset.editing;
              renderContent();
            }
          });
        });

        const embedBtn = document.createElement('button');
        embedBtn.type = 'button';
        embedBtn.className = 'cm-obs-image-embed-btn';
        embedBtn.textContent = 'Embed';
        embedBtn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        embedBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          submitInputs();
        });

        formRow.appendChild(uploadBtn);
        formRow.appendChild(urlInput);
        formRow.appendChild(altInput);
        formRow.appendChild(embedBtn);

        if (!isImagePlaceholderUrl(currentUrl) && !hasLoadError) {
          const cancelBtn = document.createElement('button');
          cancelBtn.type = 'button';
          cancelBtn.className = 'cm-obs-image-cancel-btn';
          cancelBtn.textContent = 'Cancel';
          cancelBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
          });
          cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            isEditOpen = false;
            delete wrap.dataset.editing;
            renderContent();
          });
          formRow.appendChild(cancelBtn);
        }

        placeholder.appendChild(formRow);
        body.appendChild(placeholder);
        return;
      }

      // Embedded Image Preview Card
      const figure = document.createElement('figure');
      figure.className = 'cm-obs-image-figure';

      const imgFrame = document.createElement('div');
      imgFrame.className = 'cm-obs-image-frame';

      const imgBox = document.createElement('div');
      imgBox.className = 'cm-obs-image-box';

      const img = document.createElement('img');
      img.className = 'cm-obs-image-el';
      img.alt = currentAlt || 'Embedded image';
      img.draggable = false;

      const sizeBadge = document.createElement('div');
      sizeBadge.className = 'cm-obs-image-size-badge';
      sizeBadge.setAttribute('aria-hidden', 'true');

      const applyBoxDimensions = (w?: number, h?: number) => {
        if (w && w > 0) {
          imgBox.style.width = `${Math.round(w)}px`;
          img.style.width = '100%';
        } else {
          imgBox.style.width = '';
          img.style.width = '';
        }
        if (h && h > 0) {
          imgBox.style.height = `${Math.round(h)}px`;
          img.style.height = '100%';
          img.style.maxHeight = 'none';
          img.style.objectFit = w && w > 0 ? 'fill' : 'contain';
        } else {
          imgBox.style.height = '';
          img.style.height = '';
          img.style.maxHeight = '';
          img.style.objectFit = '';
        }
      };

      applyBoxDimensions(currentWidth, currentHeight);

      const applySrc = (resolvedSrc: string | null) => {
        if (!resolvedSrc) {
          hasLoadError = true;
          renderContent();
          return;
        }
        img.src = resolvedSrc;
      };

      img.addEventListener('error', () => {
        if (!hasLoadError) {
          hasLoadError = true;
          renderContent();
        }
      });

      if (isLocalMediaUrl(currentUrl)) {
        const cached = getCachedLocalImage(currentUrl);
        if (cached) {
          applySrc(cached);
        } else {
          void resolveLocalImageUrl(currentUrl).then((resolved) => {
            if (body.isConnected) {
              applySrc(resolved);
            }
          });
        }
      } else {
        applySrc(currentUrl);
      }

      imgBox.appendChild(img);
      imgBox.appendChild(sizeBadge);

      const footer = document.createElement('div');
      footer.className = 'cm-obs-image-footer';

      const caption = document.createElement('span');
      caption.className = 'cm-obs-image-caption';
      caption.textContent =
        currentAlt && currentAlt.toLowerCase() !== 'alt' ? currentAlt : currentUrl;

      const rightActions = document.createElement('div');
      rightActions.className = 'cm-obs-image-actions-row';

      let sizeMetaEl: HTMLSpanElement | null = null;
      if (currentWidth || currentHeight) {
        sizeMetaEl = document.createElement('span');
        sizeMetaEl.className = 'cm-obs-image-size-meta';
        sizeMetaEl.textContent = `${currentWidth ?? 'auto'} × ${currentHeight ?? 'auto'}`;
        rightActions.appendChild(sizeMetaEl);

        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.textContent = 'Reset';
        resetBtn.setAttribute('aria-label', 'Reset image size');
        resetBtn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        resetBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          commitImage(currentAlt, currentUrl, undefined, undefined);
        });
        rightActions.appendChild(resetBtn);
      }

      const corners = [
        { key: 'nw', label: 'Resize image top-left corner', signX: -1, signY: -1 },
        { key: 'ne', label: 'Resize image top-right corner', signX: 1, signY: -1 },
        { key: 'sw', label: 'Resize image bottom-left corner', signX: -1, signY: 1 },
        { key: 'se', label: 'Resize image bottom-right corner', signX: 1, signY: 1 },
      ] as const;

      const getMaxImageWidth = () => {
        const containerW = wrap.parentElement?.clientWidth || view.dom.clientWidth || 740;
        return Math.max(160, containerW - 32);
      };

      for (const corner of corners) {
        const handle = document.createElement('div');
        handle.className = `cm-obs-image-resize-handle cm-obs-image-resize-${corner.key}`;
        handle.dataset.corner = corner.key;
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-label', corner.label);
        handle.setAttribute('aria-orientation', 'horizontal');
        handle.tabIndex = 0;
        handle.title = 'Drag corner to resize image (Hold Shift to lock aspect ratio, double-click to reset)';

        handle.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();

          const rect = imgBox.getBoundingClientRect();
          const startW = Math.max(64, rect.width || currentWidth || img.naturalWidth || 320);
          const startH = Math.max(48, rect.height || currentHeight || img.naturalHeight || 200);
          const startX = e.clientX;
          const startY = e.clientY;
          const maxW = getMaxImageWidth();

          let latestW = Math.round(startW);
          let latestH = Math.round(startH);
          let hasMoved = false;

          wrap.dataset.editing = '1';
          imgBox.classList.add('is-resizing');
          handle.classList.add('is-active');
          sizeBadge.textContent = `${latestW} × ${latestH}`;
          sizeBadge.classList.add('is-visible');

          const onMouseMove = (moveEv: MouseEvent) => {
            const dx = moveEv.clientX - startX;
            const dy = moveEv.clientY - startY;
            if (!hasMoved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
            hasMoved = true;
            latestW = Math.max(64, Math.min(maxW, Math.round(startW + corner.signX * dx)));
            if (moveEv.shiftKey && startW > 0 && startH > 0) {
              latestH = Math.max(48, Math.round(latestW * (startH / startW)));
            } else {
              latestH = Math.max(48, Math.round(startH + corner.signY * dy));
            }
            applyBoxDimensions(latestW, latestH);
            sizeBadge.textContent = `${latestW} × ${latestH}`;
            if (sizeMetaEl) {
              sizeMetaEl.textContent = `${latestW} × ${latestH}`;
            }
          };

          const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            imgBox.classList.remove('is-resizing');
            handle.classList.remove('is-active');
            sizeBadge.classList.remove('is-visible');
            if (hasMoved) {
              commitImage(currentAlt, currentUrl, latestW, latestH);
            } else {
              delete wrap.dataset.editing;
            }
          };

          window.addEventListener('mousemove', onMouseMove);
          window.addEventListener('mouseup', onMouseUp);
        });

        handle.addEventListener('dblclick', (e) => {
          e.preventDefault();
          e.stopPropagation();
          commitImage(currentAlt, currentUrl, undefined, undefined);
        });

        handle.addEventListener('keydown', (e) => {
          const step = e.shiftKey ? 32 : 16;
          if (
            e.key !== 'ArrowLeft' &&
            e.key !== 'ArrowRight' &&
            e.key !== 'ArrowUp' &&
            e.key !== 'ArrowDown'
          ) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          const rect = imgBox.getBoundingClientRect();
          const baseW = Math.round(currentWidth || rect.width || img.naturalWidth || 320);
          const baseH = Math.round(currentHeight || rect.height || img.naturalHeight || 200);
          const maxW = getMaxImageWidth();
          const deltaX = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
          const deltaY = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
          const nextW = Math.max(64, Math.min(maxW, baseW + deltaX));
          const nextH = Math.max(48, baseH + deltaY);
          commitImage(currentAlt, currentUrl, nextW, nextH, corner.key);
        });

        imgBox.appendChild(handle);
      }

      imgFrame.appendChild(imgBox);
      figure.appendChild(imgFrame);

      const replaceBtn = document.createElement('button');
      replaceBtn.type = 'button';
      replaceBtn.textContent = 'Upload';
      replaceBtn.setAttribute('aria-label', 'Replace with local image');
      replaceBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      replaceBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileInput.click();
      });

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Edit';
      editBtn.setAttribute('aria-label', 'Edit image URL or alt text');
      editBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      editBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        isEditOpen = true;
        wrap.dataset.editing = '1';
        renderContent();
      });

      rightActions.appendChild(replaceBtn);
      rightActions.appendChild(editBtn);
      rightActions.appendChild(buildBlockControlGroup());

      footer.appendChild(caption);
      footer.appendChild(rightActions);
      figure.appendChild(footer);
      body.appendChild(figure);
    };

    renderContent();
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class InlineImageWidget extends WidgetType {
  constructor(
    readonly alt: string,
    readonly url: string,
    readonly width?: number,
    readonly height?: number
  ) {
    super();
  }

  eq(other: InlineImageWidget): boolean {
    return (
      other.alt === this.alt &&
      other.url === this.url &&
      other.width === this.width &&
      other.height === this.height
    );
  }

  toDOM(): HTMLElement {
    const img = document.createElement('img');
    img.className = 'cm-obs-inline-image';
    img.alt = this.alt || 'Embedded image';
    img.title = this.alt || this.url;
    if (this.width && this.width > 0) {
      img.style.width = `${this.width}px`;
      img.style.maxWidth = '100%';
    }
    if (this.height && this.height > 0) {
      img.style.height = `${this.height}px`;
      img.style.maxHeight = 'none';
      img.style.objectFit = this.width ? 'fill' : 'contain';
    }
    if (isLocalMediaUrl(this.url)) {
      const cached = getCachedLocalImage(this.url);
      if (cached) {
        img.src = cached;
      } else {
        void resolveLocalImageUrl(this.url).then((resolved) => {
          if (resolved && img.isConnected) img.src = resolved;
        });
      }
    } else {
      img.src = this.url;
    }
    return img;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export interface LivePreviewCallbacks {
  getIsLivePreview: () => boolean;
  getExistingTitles: () => Set<string>;
  onOpenWikilink: (title: string) => void;
  onSelectTag: (tag: string) => void;
  onMoveBlockAtPos?: (pos: number, direction: 'up' | 'down') => void;
  onDeleteBlockAtPos?: (pos: number) => void;
}

interface DecoItem {
  from: number;
  to: number;
  isLine: boolean;
  deco: Decoration;
}

/**
 * True only when the cursor is strictly inside the inline token `(from, to)`,
 * or when a non-empty selection overlaps `[from, to]`.
 * Keeps `**bold**` rendered cleanly at line start and immediately upon finishing closing delimiters.
 */
function isInlineTokenTouched(
  ranges: readonly SelectionRange[],
  from: number,
  to: number
): boolean {
  for (const r of ranges) {
    if (r.empty) {
      if (r.from > from && r.from < to) return true;
    } else {
      if (r.from < to && r.to > from) return true;
    }
  }
  return false;
}

/**
 * True only when the cursor or selection sits inside the hidden syntax prefix `[from, from + prefixLen)`.
 */
function isCursorInPrefix(
  ranges: readonly SelectionRange[],
  lineFrom: number,
  prefixLen: number
): boolean {
  const prefixEnd = lineFrom + prefixLen;
  for (const r of ranges) {
    if (r.empty) {
      if (r.from > lineFrom && r.from < prefixEnd) return true;
    } else {
      if (r.from < prefixEnd && r.to > lineFrom) return true;
    }
  }
  return false;
}

function buildBlockDecorations(
  state: EditorState,
  callbacks: Pick<LivePreviewCallbacks, 'getIsLivePreview' | 'onMoveBlockAtPos' | 'onDeleteBlockAtPos'>
): DecorationSet {
  if (!callbacks.getIsLivePreview()) return Decoration.none;

  const doc = state.doc;
  const builder = new RangeSetBuilder<Decoration>();

  const parseRow = (row: string) =>
    row
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());

  let ln = 1;
  let inFence = false;
  while (ln <= doc.lines) {
    const lineObj = doc.line(ln);
    const lineText = lineObj.text.trim();

    if (!inFence && /^```([^\s`]*)\s*$/.test(lineText)) {
      inFence = true;
      ln++;
      continue;
    }
    if (inFence && /^```\s*$/.test(lineText)) {
      inFence = false;
      ln++;
      continue;
    }
    if (inFence) {
      ln++;
      continue;
    }

    // Markdown Table block
    if (
      lineText.startsWith('|') &&
      ln + 1 <= doc.lines &&
      /^\|?[\s:-]+\|[\s|:-]*$/.test(doc.line(ln + 1).text.trim())
    ) {
      const startLn = ln;
      const headers = parseRow(doc.line(ln).text);
      const rows: string[][] = [];
      ln += 2;
      while (ln <= doc.lines && doc.line(ln).text.trim().startsWith('|')) {
        rows.push(parseRow(doc.line(ln).text));
        ln++;
      }
      const endLn = ln - 1;
      const tableFrom = doc.line(startLn).from;
      const tableTo = doc.line(endLn).to;

      if (headers.length > 0) {
        const widthsMap = state.field(tableWidthsField, false);
        const savedWidths = widthsMap?.get(tableFrom) ?? null;
        builder.add(
          tableFrom,
          tableTo,
          Decoration.replace({
            widget: new TableWidget(headers, rows, tableFrom, tableTo, savedWidths, callbacks),
            block: true,
          })
        );
      }
      continue;
    }

    // Standalone Markdown Image block: `![alt](url)` or `![alt|WxH](url)`
    const imgParsed = parseMarkdownImage(lineText);
    if (imgParsed) {
      builder.add(
        lineObj.from,
        lineObj.to,
        Decoration.replace({
          widget: new ImageWidget(
            imgParsed.alt,
            imgParsed.url,
            lineObj.from,
            lineObj.to,
            callbacks,
            imgParsed.width,
            imgParsed.height
          ),
          block: true,
        })
      );
      ln++;
      continue;
    }

    ln++;
  }

  return builder.finish();
}

function buildLivePreviewDecorations(
  view: EditorView,
  callbacks: LivePreviewCallbacks
): DecorationSet {
  const isLive = callbacks.getIsLivePreview();
  const doc = view.state.doc;
  const existingTitles = callbacks.getExistingTitles();
  const selRanges = view.state.selection.ranges;

  const activeLines = new Set<number>();
  for (const range of selRanges) {
    const startLine = doc.lineAt(range.from).number;
    const endLine = doc.lineAt(range.to).number;
    for (let ln = startLine; ln <= endLine; ln++) {
      activeLines.add(ln);
    }
  }

  // Track fenced code blocks across the document (strict opening/closing fences)
  const codeBlockInfo = new Map<number, { role: 'open' | 'body' | 'close'; lang: string }>();
  let inFence = false;
  for (let ln = 1; ln <= doc.lines; ln++) {
    const trimmed = doc.line(ln).text.trim();
    if (!inFence && /^```([^\s`]*)\s*$/.test(trimmed)) {
      const openMatch = /^```([^\s`]*)\s*$/.exec(trimmed)!;
      inFence = true;
      codeBlockInfo.set(ln, { role: 'open', lang: openMatch[1] || '' });
    } else if (inFence && /^```\s*$/.test(trimmed)) {
      inFence = false;
      codeBlockInfo.set(ln, { role: 'close', lang: '' });
    } else if (inFence) {
      codeBlockInfo.set(ln, { role: 'body', lang: '' });
    }
  }

  // Track Obsidian callout blocks across the document
  const calloutLines = new Map<number, { type: string; isFirst: boolean; isLast: boolean }>();
  let currentCalloutType: string | null = null;
  for (let ln = 1; ln <= doc.lines; ln++) {
    if (codeBlockInfo.has(ln)) {
      currentCalloutType = null;
      continue;
    }
    const text = doc.line(ln).text;
    const headerMatch = /^>\s*\[!([a-zA-Z]+)\]/.exec(text.trim());
    if (headerMatch) {
      currentCalloutType = headerMatch[1].toLowerCase();
      calloutLines.set(ln, { type: currentCalloutType, isFirst: true, isLast: false });
    } else if (currentCalloutType && /^>\s?/.test(text.trim())) {
      calloutLines.set(ln, { type: currentCalloutType, isFirst: false, isLast: false });
    } else {
      if (currentCalloutType && ln > 1 && calloutLines.has(ln - 1)) {
        const prev = calloutLines.get(ln - 1)!;
        prev.isLast = true;
      }
      currentCalloutType = null;
    }
  }
  if (currentCalloutType && calloutLines.has(doc.lines)) {
    calloutLines.get(doc.lines)!.isLast = true;
  }

  const items: DecoItem[] = [];

  for (const { from: visFrom, to: visTo } of view.visibleRanges) {
    const startLine = doc.lineAt(visFrom).number;
    const endLine = doc.lineAt(visTo).number;

    for (let ln = startLine; ln <= endLine; ln++) {
      const line = doc.line(ln);
      const text = line.text;
      const isLineActive = activeLines.has(ln);

      // Fenced code block styling
      const fence = codeBlockInfo.get(ln);
      if (fence) {
        const roleClass =
          fence.role === 'open'
            ? 'cm-obs-codeblock-line cm-obs-codeblock-start'
            : fence.role === 'close'
            ? 'cm-obs-codeblock-line cm-obs-codeblock-end'
            : 'cm-obs-codeblock-line';
        items.push({
          from: line.from,
          to: line.from,
          isLine: true,
          deco: Decoration.line({ class: roleClass }),
        });

        if (isLive && !isLineActive && fence.role === 'open' && text.length > 0) {
          items.push({
            from: line.from,
            to: line.to,
            isLine: false,
            deco: Decoration.replace({ widget: new CodeFenceHeaderWidget(fence.lang) }),
          });
        } else if (isLive && !isLineActive && fence.role === 'close' && text.length > 0) {
          items.push({
            from: line.from,
            to: line.to,
            isLine: false,
            deco: Decoration.replace({ widget: new CodeFenceFooterWidget() }),
          });
        } else if (!isLive || isLineActive) {
          if (fence.role !== 'body') {
            items.push({
              from: line.from,
              to: line.to,
              isLine: false,
              deco: Decoration.mark({ class: 'cm-obs-syntax-muted' }),
            });
          }
        }
        continue;
      }

      // Headings (#, ##, ###)
      const headingMatch = /^(#{1,3})(\s+)(.*)$/.exec(text);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const markerLen = headingMatch[1].length + headingMatch[2].length;
        items.push({
          from: line.from,
          to: line.from,
          isLine: true,
          deco: Decoration.line({ class: `cm-obs-h${level}` }),
        });
        if (isLive && !isCursorInPrefix(selRanges, line.from, markerLen)) {
          items.push({
            from: line.from,
            to: line.from + markerLen,
            isLine: false,
            deco: Decoration.replace({}),
          });
        } else {
          items.push({
            from: line.from,
            to: line.from + headingMatch[1].length,
            isLine: false,
            deco: Decoration.mark({ class: 'cm-obs-syntax-muted' }),
          });
        }
      }

      // Horizontal Rule
      if (/^(-{3,}|\*{3,})$/.test(text.trim())) {
        if (isLive && !isLineActive && text.length > 0) {
          items.push({
            from: line.from,
            to: line.to,
            isLine: false,
            deco: Decoration.replace({ widget: new HrWidget() }),
          });
          continue;
        }
      }

      // Obsidian Callout block or standard Blockquote
      const calloutMeta = calloutLines.get(ln);
      if (calloutMeta) {
        const variant =
          calloutMeta.type === 'tip'
            ? 'cm-obs-callout-tip'
            : calloutMeta.type === 'warning' || calloutMeta.type === 'danger'
            ? 'cm-obs-callout-warn'
            : 'cm-obs-callout-note';
        const posClasses = [
          'cm-obs-callout-line',
          variant,
          calloutMeta.isFirst ? 'cm-obs-callout-start' : '',
          calloutMeta.isLast ? 'cm-obs-callout-end' : '',
        ]
          .filter(Boolean)
          .join(' ');

        items.push({
          from: line.from,
          to: line.from,
          isLine: true,
          deco: Decoration.line({ class: posClasses }),
        });

        const headerMatch = /^(>\s*\[!([a-zA-Z]+)\]\s*)(.*)$/.exec(text);
        if (headerMatch) {
          const prefixLen = headerMatch[1].length;
          if (isLive && !isCursorInPrefix(selRanges, line.from, prefixLen)) {
            items.push({
              from: line.from,
              to: line.from + prefixLen,
              isLine: false,
              deco: Decoration.replace({ widget: new CalloutIconWidget(calloutMeta.type) }),
            });
            if (headerMatch[3].length > 0) {
              items.push({
                from: line.from + prefixLen,
                to: line.to,
                isLine: false,
                deco: Decoration.mark({ class: 'cm-obs-callout-title' }),
              });
            }
          }
        } else {
          const quotePrefix = /^>\s?/.exec(text)?.[0] ?? '';
          if (quotePrefix && isLive && !isCursorInPrefix(selRanges, line.from, quotePrefix.length)) {
            items.push({
              from: line.from,
              to: line.from + quotePrefix.length,
              isLine: false,
              deco: Decoration.replace({}),
            });
          }
        }
      } else if (/^>\s?/.test(text)) {
        items.push({
          from: line.from,
          to: line.from,
          isLine: true,
          deco: Decoration.line({ class: 'cm-obs-quote-line' }),
        });
        const quotePrefix = /^>\s?/.exec(text)![0];
        if (isLive && !isCursorInPrefix(selRanges, line.from, quotePrefix.length)) {
          items.push({
            from: line.from,
            to: line.from + quotePrefix.length,
            isLine: false,
            deco: Decoration.replace({}),
          });
        }
      } else if (/^\|.+\|$/.test(text.trim())) {
        items.push({
          from: line.from,
          to: line.from,
          isLine: true,
          deco: Decoration.line({ class: 'cm-obs-table-line' }),
        });
      }

      // Task List (`  - [ ] text` or `  - [x] text`)
      const taskMatch = /^(\s*)([-*]\s+)(\[[ xX]\])(\s*)(.*)$/.exec(text);
      if (taskMatch) {
        const indentLen = taskMatch[1].length;
        const bulletLen = taskMatch[2].length;
        const isChecked = taskMatch[3].toLowerCase() === '[x]';
        const bracketFrom = line.from + indentLen + bulletLen;
        const prefixTotal = indentLen + bulletLen + 3;

        if (isChecked) {
          items.push({
            from: line.from,
            to: line.from,
            isLine: true,
            deco: Decoration.line({ class: 'cm-obs-task-done-line' }),
          });
        }

        if (isLive && !isCursorInPrefix(selRanges, line.from + indentLen, prefixTotal - indentLen)) {
          items.push({
            from: line.from + indentLen,
            to: bracketFrom,
            isLine: false,
            deco: Decoration.replace({}),
          });
          items.push({
            from: bracketFrom,
            to: bracketFrom + 3,
            isLine: false,
            deco: Decoration.replace({
              widget: new CheckboxWidget(isChecked, bracketFrom),
            }),
          });
        }
      } else {
        // Bullet List (`  - text` or `* text`)
        const bulletMatch = /^(\s*)([-*])(\s+)(.*)$/.exec(text);
        if (bulletMatch) {
          const indentLen = bulletMatch[1].length;
          const bulletFrom = line.from + indentLen;
          if (isLive && !isCursorInPrefix(selRanges, bulletFrom, 1)) {
            items.push({
              from: bulletFrom,
              to: bulletFrom + 1,
              isLine: false,
              deco: Decoration.replace({ widget: new BulletWidget() }),
            });
          } else {
            items.push({
              from: bulletFrom,
              to: bulletFrom + 1,
              isLine: false,
              deco: Decoration.mark({ class: 'cm-obs-syntax-muted' }),
            });
          }
        }
      }

      const hiddenIntervals: Array<[number, number]> = [];
      const overlaps = (s: number, e: number) =>
        hiddenIntervals.some(([hs, he]) => s < he && e > hs);

      // [[Wikilinks]]
      const wikiRegex = /\[\[([^[\]]+)\]\]/g;
      let wMatch: RegExpExecArray | null;
      while ((wMatch = wikiRegex.exec(text)) !== null) {
        const start = line.from + wMatch.index;
        const end = start + wMatch[0].length;
        const inner = wMatch[1];
        const pipeIdx = inner.indexOf('|');
        const targetTitle = (pipeIdx !== -1 ? inner.slice(0, pipeIdx) : inner)
          .split('#')[0]
          .trim();
        const exists = existingTitles.has(targetTitle.toLowerCase());
        const linkClass = exists ? 'cm-obs-wikilink' : 'cm-obs-wikilink-missing';
        const touched = isInlineTokenTouched(selRanges, start, end);

        if (isLive && !touched) {
          const prefixEnd = pipeIdx !== -1 ? start + 2 + pipeIdx + 1 : start + 2;
          items.push({ from: start, to: prefixEnd, isLine: false, deco: Decoration.replace({}) });
          items.push({
            from: prefixEnd,
            to: end - 2,
            isLine: false,
            deco: Decoration.mark({
              class: linkClass,
              attributes: { 'data-wikilink': targetTitle },
            }),
          });
          items.push({ from: end - 2, to: end, isLine: false, deco: Decoration.replace({}) });
        } else {
          items.push({
            from: start,
            to: end,
            isLine: false,
            deco: Decoration.mark({
              class: linkClass,
              attributes: { 'data-wikilink': targetTitle },
            }),
          });
        }
        hiddenIntervals.push([start, end]);
      }

      // Inline Markdown images ![alt](url) when embedded inside text
      const inlineImgRegex = /!\[([^[\]]*)\]\(([^)\s]+(?:\s+"[^"]*")?|)\)/g;
      let imgMatch: RegExpExecArray | null;
      while ((imgMatch = inlineImgRegex.exec(text)) !== null) {
        const start = line.from + imgMatch.index;
        const end = start + imgMatch[0].length;
        if (overlaps(start, end)) continue;
        const parsedImg = parseMarkdownImage(imgMatch[0]);
        if (!parsedImg) continue;
        const touched = isInlineTokenTouched(selRanges, start, end);
        if (isLive && !touched && !isImagePlaceholderUrl(parsedImg.url)) {
          items.push({
            from: start,
            to: end,
            isLine: false,
            deco: Decoration.replace({
              widget: new InlineImageWidget(
                parsedImg.alt,
                parsedImg.url,
                parsedImg.width,
                parsedImg.height
              ),
            }),
          });
        }
        hiddenIntervals.push([start, end]);
      }

      // Standard Markdown links [label](url)
      const extLinkRegex = /(?<!\!)\[([^[\]]+)\]\(([^)\s]+)\)/g;
      let eMatch: RegExpExecArray | null;
      while ((eMatch = extLinkRegex.exec(text)) !== null) {
        const start = line.from + eMatch.index;
        const end = start + eMatch[0].length;
        if (overlaps(start, end)) continue;
        const labelLen = eMatch[1].length;
        const url = eMatch[2];
        const touched = isInlineTokenTouched(selRanges, start, end);

        if (isLive && !touched) {
          items.push({ from: start, to: start + 1, isLine: false, deco: Decoration.replace({}) });
          items.push({
            from: start + 1,
            to: start + 1 + labelLen,
            isLine: false,
            deco: Decoration.mark({
              tagName: 'a',
              class: 'cm-obs-extlink',
              attributes: { href: url, target: '_blank', rel: 'noopener noreferrer', title: url },
            }),
          });
          items.push({
            from: start + 1 + labelLen,
            to: end,
            isLine: false,
            deco: Decoration.replace({}),
          });
        } else {
          items.push({
            from: start,
            to: end,
            isLine: false,
            deco: Decoration.mark({
              class: 'cm-obs-extlink',
              attributes: { title: url },
            }),
          });
        }
        hiddenIntervals.push([start, end]);
      }

      // `inline code`
      const codeRegex = /`([^`\n]+)`/g;
      let cMatch: RegExpExecArray | null;
      while ((cMatch = codeRegex.exec(text)) !== null) {
        const start = line.from + cMatch.index;
        const end = start + cMatch[0].length;
        if (overlaps(start, end)) continue;
        const touched = isInlineTokenTouched(selRanges, start, end);

        if (isLive && !touched) {
          items.push({ from: start, to: start + 1, isLine: false, deco: Decoration.replace({}) });
          items.push({
            from: start + 1,
            to: end - 1,
            isLine: false,
            deco: Decoration.mark({ class: 'cm-obs-inline-code' }),
          });
          items.push({ from: end - 1, to: end, isLine: false, deco: Decoration.replace({}) });
        } else {
          items.push({
            from: start,
            to: end,
            isLine: false,
            deco: Decoration.mark({ class: 'cm-obs-inline-code' }),
          });
        }
        hiddenIntervals.push([start, end]);
      }

      // **bold**
      const boldRegex = /\*\*([^*\n]+)\*\*/g;
      let bMatch: RegExpExecArray | null;
      while ((bMatch = boldRegex.exec(text)) !== null) {
        if (!bMatch[1].trim()) continue;
        const start = line.from + bMatch.index;
        const end = start + bMatch[0].length;
        if (overlaps(start, end)) continue;
        const touched = isInlineTokenTouched(selRanges, start, end);

        if (isLive && !touched) {
          items.push({ from: start, to: start + 2, isLine: false, deco: Decoration.replace({}) });
          items.push({
            from: start + 2,
            to: end - 2,
            isLine: false,
            deco: Decoration.mark({ class: 'cm-obs-bold' }),
          });
          items.push({ from: end - 2, to: end, isLine: false, deco: Decoration.replace({}) });
        } else {
          items.push({
            from: start,
            to: end,
            isLine: false,
            deco: Decoration.mark({ class: 'cm-obs-bold' }),
          });
        }
        hiddenIntervals.push([start, end]);
      }

      // ==highlight==
      const hlRegex = /==([^=\n]+)==/g;
      let hlMatch: RegExpExecArray | null;
      while ((hlMatch = hlRegex.exec(text)) !== null) {
        if (!hlMatch[1].trim()) continue;
        const start = line.from + hlMatch.index;
        const end = start + hlMatch[0].length;
        if (overlaps(start, end)) continue;
        const touched = isInlineTokenTouched(selRanges, start, end);

        if (isLive && !touched) {
          items.push({ from: start, to: start + 2, isLine: false, deco: Decoration.replace({}) });
          items.push({
            from: start + 2,
            to: end - 2,
            isLine: false,
            deco: Decoration.mark({ class: 'cm-obs-highlight' }),
          });
          items.push({ from: end - 2, to: end, isLine: false, deco: Decoration.replace({}) });
        } else {
          items.push({
            from: start,
            to: end,
            isLine: false,
            deco: Decoration.mark({ class: 'cm-obs-highlight' }),
          });
        }
        hiddenIntervals.push([start, end]);
      }

      // *italic*
      const italicRegex = /(?<!\*)\*([^*\n]+)\*(?!\*)/g;
      let iMatch: RegExpExecArray | null;
      while ((iMatch = italicRegex.exec(text)) !== null) {
        if (!iMatch[1].trim()) continue;
        const start = line.from + iMatch.index;
        const end = start + iMatch[0].length;
        if (overlaps(start, end)) continue;
        const touched = isInlineTokenTouched(selRanges, start, end);

        if (isLive && !touched) {
          items.push({ from: start, to: start + 1, isLine: false, deco: Decoration.replace({}) });
          items.push({
            from: start + 1,
            to: end - 1,
            isLine: false,
            deco: Decoration.mark({ class: 'cm-obs-italic' }),
          });
          items.push({ from: end - 1, to: end, isLine: false, deco: Decoration.replace({}) });
        } else {
          items.push({
            from: start,
            to: end,
            isLine: false,
            deco: Decoration.mark({ class: 'cm-obs-italic' }),
          });
        }
        hiddenIntervals.push([start, end]);
      }

      // #tags
      const tagRegex = /(?:^|\s)(#[a-zA-Z][a-zA-Z0-9_/-]*)/g;
      let tMatch: RegExpExecArray | null;
      while ((tMatch = tagRegex.exec(text)) !== null) {
        const full = tMatch[0];
        const tagToken = tMatch[1];
        const offsetInMatch = full.indexOf(tagToken);
        const start = line.from + tMatch.index + offsetInMatch;
        const end = start + tagToken.length;
        if (overlaps(start, end)) continue;
        if (headingMatch && start === line.from) continue;

        items.push({
          from: start,
          to: end,
          isLine: false,
          deco: Decoration.mark({
            class: 'cm-obs-tag',
            attributes: { 'data-tag': tagToken.slice(1).toLowerCase() },
          }),
        });
      }
    }
  }

  items.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    if (a.isLine !== b.isLine) return a.isLine ? -1 : 1;
    return a.to - b.to;
  });

  const builder = new RangeSetBuilder<Decoration>();
  let lastInlineEnd = -1;

  for (const item of items) {
    if (item.isLine) {
      builder.add(item.from, item.from, item.deco);
    } else {
      if (item.from < lastInlineEnd) continue;
      if (item.from <= item.to) {
        builder.add(item.from, item.to, item.deco);
        lastInlineEnd = item.to;
      }
    }
  }

  return builder.finish();
}

export function createObsidianLivePreviewExtension(callbacks: LivePreviewCallbacks) {
  const blockField = StateField.define<DecorationSet>({
    create(state) {
      return buildBlockDecorations(state, callbacks);
    },
    update(deco, tr) {
      if (
        tr.docChanged ||
        tr.selection ||
        tr.reconfigured ||
        tr.effects.some((e) => e.is(setTableColWidthsEffect))
      ) {
        return buildBlockDecorations(tr.state, callbacks);
      }
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildLivePreviewDecorations(view, callbacks);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildLivePreviewDecorations(update.view, callbacks);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );

  const isPosTouched = (view: EditorView, el: HTMLElement): boolean => {
    try {
      const pos = view.posAtDOM(el);
      return view.state.selection.ranges.some((r) =>
        r.empty ? r.from > pos && r.from < pos + el.textContent!.length : false
      );
    } catch {
      return false;
    }
  };

  const clickHandler = EditorView.domEventHandlers({
    mousedown: (event, view) => {
      const target = event.target as HTMLElement | null;
      if (!target) return false;

      const modClick = event.metaKey || event.ctrlKey;

      const wikiEl = target.closest('[data-wikilink]') as HTMLElement | null;
      if (wikiEl) {
        const title = wikiEl.getAttribute('data-wikilink');
        if (
          title &&
          (modClick || (callbacks.getIsLivePreview() && !event.altKey && !isPosTouched(view, wikiEl)))
        ) {
          event.preventDefault();
          callbacks.onOpenWikilink(title);
          return true;
        }
      }

      const tagEl = target.closest('[data-tag]') as HTMLElement | null;
      if (tagEl) {
        const tag = tagEl.getAttribute('data-tag');
        if (
          tag &&
          (modClick || (callbacks.getIsLivePreview() && !event.altKey && !isPosTouched(view, tagEl)))
        ) {
          event.preventDefault();
          callbacks.onSelectTag(tag);
          return true;
        }
      }

      return false;
    },
  });

  return [tableWidthsField, blockField, plugin, clickHandler];
}

