import { extend, remove, isNullOrUndefined, setStyleAttribute, removeClass, addClass } from '@syncfusion/ej2-base';
import { Query, Predicate } from '@syncfusion/ej2-data';
import { IRenderer, IGrid, LazyLoadArgs, LazyLoadGroupArgs, NotifyArgs, IRow } from '../base/interface';
import { ServiceLocator } from '../services/service-locator';
import { ContentRender } from './content-renderer';
import { ReturnType } from '../base/type';
import { PredicateModel } from '../base/grid-model';
import { Row } from '../models/row';
import { Column } from '../models/column';
import * as events from '../base/constant';
import { isRowEnteredInGrid, parentsUntil } from '../base/util';
import { Grid } from '../base/grid';
import { RowRenderer } from '../renderer/row-renderer';
import { CheckBoxFilterBase } from '../common/checkbox-filter-base';
import { GroupModelGenerator, GroupedData } from '../services/group-model-generator';
import { GroupSummaryModelGenerator, CaptionSummaryModelGenerator } from '../services/summary-model-generator';
import { AggregateColumnModel } from '../models/aggregate-model';
import { Cell } from '../models/cell';

/**
 * GroupLazyLoadRenderer is used to perform lazy load grouping
 * @hidden
 */
export class GroupLazyLoadRenderer extends ContentRender implements IRenderer {
    private locator: ServiceLocator;
    private groupGenerator: GroupModelGenerator;
    private summaryModelGen: GroupSummaryModelGenerator;
    private captionModelGen: CaptionSummaryModelGenerator;
    private rowRenderer: RowRenderer<Column>;

    constructor(parent: IGrid, locator?: ServiceLocator) {
        super(parent, locator);
        this.locator = locator;
        this.groupGenerator = new GroupModelGenerator(this.parent);
        this.summaryModelGen = new GroupSummaryModelGenerator(this.parent);
        this.captionModelGen = new CaptionSummaryModelGenerator(this.parent);
        this.rowRenderer = new RowRenderer<Column>(this.locator, null, this.parent);
        this.eventListener();
    }

    private childCount: number = 0;
    private scrollData: Row<Column>[] = [];
    private rowIndex: number;
    private rowObjectIndex: number;
    private isFirstChildRow: boolean = false;
    private uid1: string;
    private uid2: string;
    private uid3: string;
    private blockSize: number;
    private groupCache: { [x: number]: Row<Column>[] } = {};
    private startIndexes: { [x: number]: number[] } = {};
    private captionCounts: { [x: number]: number[] } = {};
    private rowsByUid: { [x: number]: Row<Column>[] } = {};
    private objIdxByUid: { [x: number]: Row<Column>[] } = {};
    private initialGroupCaptions: { [x: number]: Row<Column>[] } = {};
    private requestType: string[] = ['paging', 'columnstate', 'reorder', 'cancel', 'save', 'beginEdit', 'add', 'delete'];

    /** @hidden */
    public pageSize: number;
    /** @hidden */
    public cacheMode: boolean = false;
    /** @hidden */
    public cacheBlockSize: number = 5;
    /** @hidden */
    public ignoreAccent: boolean = this.parent.allowFiltering ? this.parent.filterSettings.ignoreAccent : false;
    /** @hidden */
    public allowCaseSensitive: boolean = false;

    private eventListener(): void {
        this.parent.addEventListener(events.actionBegin, this.actionBegin.bind(this));
        this.parent.addEventListener(events.actionComplete, this.actionComplete.bind(this));
        this.parent.on(events.initialEnd, this.setLazyLoadPageSize, this);
        this.parent.on(events.setGroupCache, this.setCache, this);
        this.parent.on(events.lazyLoadScrollHandler, this.scrollHandler, this);
        this.parent.on(events.columnVisibilityChanged, this.setVisible, this);
        this.parent.on(events.groupCollapse, this.collapseShortcut, this);
    }

    /** @hidden */
    public captionExpand(tr: HTMLTableRowElement): void {
        let page: number = this.parent.pageSettings.currentPage;
        let rowsObject: Row<Column>[] = this.groupCache[page];
        let uid: string = tr.getAttribute('data-uid');
        let oriIndex: number = this.getRowObjectIndexByUid(uid);
        let isRowExist: boolean = rowsObject[oriIndex + 1] ? rowsObject[oriIndex].indent < rowsObject[oriIndex + 1].indent : false;
        let data: Row<Column> = rowsObject[oriIndex];
        let key: { fields: string[], keys: string[] } = this.getGroupKeysAndFields(oriIndex, rowsObject);
        let e: LazyLoadGroupArgs = { captionRowElement: tr, groupInfo: data, enableCaching: true, cancel: false };
        this.parent.trigger(events.lazyLoadGroupExpand, e, (args: LazyLoadGroupArgs) => {
            if (args.cancel) {
                return;
            }
            args.keys = key.keys; args.fields = key.fields; args.rowIndex = tr.rowIndex;
            args.makeRequest = !args.enableCaching || !isRowExist;
            if (!args.enableCaching && isRowExist) {
                this.clearCache([uid]);
            }
            args.skip = 0;
            args.take = this.pageSize;
            data.isExpand = this.rowsByUid[page][data.uid].isExpand = true;
            this.captionRowExpand(args);
        });
    }

    /** @hidden */
    public captionCollapse(tr: HTMLTableRowElement): void {
        let cache: Row<Column>[] = this.groupCache[this.parent.pageSettings.currentPage];
        let rowIdx: number = tr.rowIndex;
        let uid: string = tr.getAttribute('data-uid');
        let captionIndex: number = this.getRowObjectIndexByUid(uid);
        let e: LazyLoadArgs = {
            captionRowElement: tr, groupInfo: cache[captionIndex], cancel: false
        };
        this.parent.trigger(events.lazyLoadGroupCollapse, e, (args: LazyLoadGroupArgs) => {
            if (args.cancel) {
                return;
            }
            args.isExpand = false;
            this.removeRows(captionIndex, rowIdx);
        });
    }

    /** @hidden */
    public setLazyLoadPageSize(): void {
        let scrollEle: Element = this.parent.getContent().firstElementChild;
        let blockSize: number = Math.floor((scrollEle as HTMLElement).offsetHeight / this.parent.getRowHeight()) - 1;
        this.pageSize = this.pageSize ? this.pageSize : blockSize * 3;
        this.blockSize = Math.ceil(this.pageSize / 2);
    }

    /** @hidden */
    public clearLazyGroupCache(): void {
        this.clearCache();
    }

    private clearCache(uids?: string[]): void {
        uids = uids ? uids : this.getInitialCaptionIndexes();
        let cache: Row<Column>[] = this.groupCache[this.parent.pageSettings.currentPage];
        if (uids.length) {
            for (let i: number = 0; i < uids.length; i++) {
                let capIdx: number = this.getRowObjectIndexByUid(uids[i]);
                let capRow: Row<Column> = cache[capIdx];
                if (!capRow) { continue; }
                if (this.captionCounts[this.parent.pageSettings.currentPage][capRow.uid]) {
                    for (let i: number = capIdx + 1; i < cache.length; i++) {
                        if (cache[i].indent === capRow.indent || cache[i].indent < capRow.indent) {
                            delete this.captionCounts[this.parent.pageSettings.currentPage][capRow.uid];
                            break;
                        }
                        if (cache[i].isCaptionRow) {
                            delete this.captionCounts[this.parent.pageSettings.currentPage][cache[i].uid];
                        }
                    }
                }
                if (capRow.isExpand) {
                    let tr: Element = this.parent.getRowElementByUID(capRow.uid);
                    if (!tr) { return; }
                    (this.parent as Grid).groupModule.expandCollapseRows(tr.querySelector('.e-recordplusexpand'));
                }
                let child: Row<Column>[] = this.getNextChilds(capIdx);
                if (!child.length) { continue; }
                let subChild: Row<Column>[] = [];
                if (child[child.length - 1].isCaptionRow) {
                    subChild = this.getChildRowsByParentIndex(cache.indexOf(child[child.length - 1]), false, false, null, true, true);
                }
                let start: number = cache.indexOf(child[0]);
                let end: number = subChild.length ? cache.indexOf(subChild[subChild.length - 1]) : cache.indexOf(child[child.length - 1]);
                cache.splice(start, end - (start - 1));
                this.refreshCaches();
            }
        }
    }

    private refreshCaches(): void {
        let page: number = this.parent.pageSettings.currentPage;
        let cache: Row<Column>[] = this.groupCache[page];
        this.rowsByUid = {};
        this.objIdxByUid = {};
        for (let i: number = 0; i < cache.length; i++) {
            this.maintainRows(cache[i], i);
        }
    }

    private getInitialCaptionIndexes(): string[] {
        let page: number = this.parent.pageSettings.currentPage;
        let uids: string[] = [];
        for (let i: number = 0; i < this.initialGroupCaptions[page].length; i++) {
            uids.push(this.initialGroupCaptions[page][i].uid);
        }
        return uids;
    }

    /** @hidden */
    public getRowObjectIndexByUid(uid: string): number {
        return this.objIdxByUid[this.parent.pageSettings.currentPage][uid] as number;
    }

    private collapseShortcut(args: { target: Element, collapse: boolean }): void {
        if (this.parent.groupSettings.columns.length &&
            args.target && parentsUntil(args.target, 'e-content') && args.target.parentElement.tagName === 'TR') {
            if (!args.collapse && parentsUntil(args.target, 'e-row')) {
                return;
            }
            let row: Element = args.target.parentElement;
            let uid: string = row.getAttribute('data-uid');
            if (args.collapse) {
                let rowObj: Row<Column> = this.getRowByUid(uid);
                let capRow: Row<Column> = this.getRowByUid(rowObj.parentUid);
                if (capRow.isCaptionRow && capRow.isExpand) {
                    let capEle: HTMLTableRowElement = this.getRowElementByUid(rowObj.parentUid);
                    (this.parent as Grid).groupModule.expandCollapseRows(capEle.cells[rowObj.indent - 1]);
                }
            } else {
                let capRow: Row<Column> = this.getRowByUid(uid);
                if (capRow.isCaptionRow && !capRow.isExpand) {
                    let capEle: HTMLTableRowElement = this.getRowElementByUid(uid);
                    (this.parent as Grid).groupModule.expandCollapseRows(capEle.cells[capRow.indent]);
                }
            }
        }
    }

    private getRowByUid(uid: string): Row<Column> {
        return this.rowsByUid[this.parent.pageSettings.currentPage][uid] as Row<Column>;
    }

    private actionBegin(args: NotifyArgs): void {
        if (!args.cancel) {
            if (!this.requestType.some((value: string) => value === args.requestType)) {
                this.groupCache = {};
                this.resetRowMaintenance();
            }
            if (args.requestType === 'reorder' && this.parent.groupSettings.columns.length) {
                let keys: string[] = Object.keys(this.groupCache);
                for (let j: number = 0; j < keys.length; j++) {
                    let cache: Row<Column>[] = this.groupCache[keys[j]];
                    for (let i: number = 0; i < cache.length; i++) {
                        if (cache[i].isCaptionRow && !this.captionModelGen.isEmpty()) {
                            this.changeCaptionRow(cache[i], null, keys[j]);
                        }
                        if (cache[i].isDataRow) {
                            let from: number = (<{ fromIndex?: number }>args).fromIndex + cache[i].indent;
                            let to: number = (<{ toIndex?: number }>args).toIndex + cache[i].indent;
                            this.moveCells(cache[i].cells, from, to);
                        }
                    }
                }
            }
            if (args.requestType === 'delete'
                || ((<{ action?: string }>args).action === 'add' && args.requestType === 'save')) {
                this.groupCache = {};
                this.resetRowMaintenance();
            }
        }
    }

    private actionComplete(args: NotifyArgs): void {
        if (!args.cancel && args.requestType !== 'columnstate' && args.requestType !== 'beginEdit'
            && args.requestType !== 'delete' && args.requestType !== 'save' && args.requestType !== 'reorder') {
            this.scrollReset();
        }
    }

    private resetRowMaintenance(): void {
        this.startIndexes = {};
        this.captionCounts = {};
        this.rowsByUid = {};
        this.objIdxByUid = {};
        this.initialGroupCaptions = {};
    }

    private moveCells(arr: Cell<Column>[], from: number, to: number): void {
        if (from >= arr.length) {
            let k: number = from - arr.length;
            while ((k--) + 1) {
                arr.push(undefined);
            }
        }
        arr.splice(from, 0, arr.splice(to, 1)[0]);
    }

    private removeRows(idx: number, trIdx: number): void {
        let page: number = this.parent.pageSettings.currentPage;
        let rows: Row<Column>[] = this.groupCache[page];
        let trs: Element[] = [].slice.call(this.parent.getContent().querySelectorAll('tr'));
        let aggUid: string;
        if (this.parent.aggregates.length) {
            let agg: Row<Column>[] = this.getAggregateByCaptionIndex(idx);
            aggUid = agg.length ? agg[agg.length - 1].uid : undefined;
        }
        let indent: number = rows[idx].indent;
        this.addClass(this.getNextChilds(idx));
        rows[idx].isExpand = this.rowsByUid[page][rows[idx].uid].isExpand = false;
        let capUid: string;
        for (let i: number = idx + 1; i < rows.length; i++) {
            if (rows[i].indent === indent || rows[i].indent < indent) {
                capUid = rows[i].uid;
                break;
            }
            if (rows[i].isCaptionRow && rows[i].isExpand) {
                this.addClass(this.getNextChilds(i));
            }
        }
        for (let i: number = trIdx + 1; i < trs.length; i++) {
            if (trs[i].getAttribute('data-uid') === capUid) {
                break;
            } else if (trs[i].getAttribute('data-uid') === aggUid) {
                remove(trs[i]);
                break;
            } else {
                remove(trs[i]);
            }
        }
    }

    private addClass(rows: Row<Column>[]): void {
        let last: Row<Column> = rows[this.blockSize];
        if (last) {
            last.lazyLoadCssClass = 'e-lazyload-middle-down';
        }
    }

    private getNextChilds(index: number, rowObjects?: Row<Column>[]): Row<Column>[] {
        let group: Row<Column>[] = this.groupCache[this.parent.pageSettings.currentPage];
        let rows: Row<Column>[] = rowObjects ? rowObjects : group;
        let indent: number = group[index].indent + 1;
        let childRows: Row<Column>[] = [];
        for (let i: number = rowObjects ? 0 : index + 1; i < rows.length; i++) {
            if (rows[i].indent < indent) {
                break;
            }
            if (rows[i].indent === indent) {
                childRows.push(rows[i]);
            }
        }
        return childRows;
    }

    private lazyLoadHandler(args:
        {
            data: Object[], count: number, level: number, index: number, isRowExist: boolean,
            isScroll: boolean, up?: boolean, rowIndex?: number
        }
    ): void {
        this.setStartIndexes();
        let tr: HTMLElement = this.parent.getContent().querySelectorAll('tr')[args.index];
        let uid: string = tr.getAttribute('data-uid');
        let captionIndex: number = this.getRowObjectIndexByUid(uid);
        let captionRow: IRow<Column> = this.groupCache[this.parent.pageSettings.currentPage][captionIndex];
        let rows: Row<Column>[] = args.isRowExist ? args.isScroll ? this.scrollData
            : this.getChildRowsByParentIndex(captionIndex, true, true, null, true) : [];
        this.scrollData = [];
        if (!args.isRowExist) {
            this.setRowIndexes(captionIndex, captionRow);
            this.refreshCaptionRowCount(this.groupCache[this.parent.pageSettings.currentPage][captionIndex], args.count);
            if (Object.keys(args.data).indexOf('GroupGuid') !== -1) {
                for (let i: number = 0; i < args.data.length; i++) {
                    let data: Row<Column> = this.groupGenerator.generateCaptionRow(
                        args.data[i] as GroupedData, args.level, captionRow.parentGid, undefined, 0, captionRow.uid
                    );
                    rows.push(data);
                    if (this.parent.aggregates.length) {
                        rows = rows.concat(<Row<Column>[]>
                            (this.summaryModelGen.generateRows(args.data[i], { level: args.level + 1, parentUid: data.uid }))
                        );
                    }
                }
            } else {
                this.groupGenerator.index = this.getStartIndex(captionIndex, args.isScroll);
                rows = this.groupGenerator.generateDataRows(args.data, args.level, captionRow.parentGid, 0, captionRow.uid);
            }
        }
        let trIdx: number = args.isScroll ? this.rowIndex : args.index;
        let nxtChild: Row<Column>[] = this.getNextChilds(captionIndex, rows);
        let lastRow: boolean = !args.up ? this.hasLastChildRow(args.isScroll, args.count, nxtChild.length) : true;
        if (!args.isRowExist && !lastRow) {
            nxtChild[this.blockSize].lazyLoadCssClass = 'e-lazyload-middle-down';
        }
        if (!lastRow) {
            nxtChild[nxtChild.length - 1].lazyLoadCssClass = 'e-not-lazyload-end';
        }
        let aggregates: Row<Column>[] = !args.isScroll && !args.isRowExist ? this.getAggregateByCaptionIndex(captionIndex) : [];
        if (!args.up) {
            if (!args.isRowExist) {
                this.refreshRowObjects(rows, args.isScroll ? this.rowObjectIndex : captionIndex);
            }
        }
        this.render(trIdx, rows, lastRow, aggregates);
        if (this.isFirstChildRow && !args.up) {
            this.parent.getContent().firstElementChild.scrollTop = rows.length * this.parent.getRowHeight();
        }
        this.isFirstChildRow = false;
        this.rowIndex = undefined;
        this.rowObjectIndex = undefined;
        this.childCount = 0;
    }

    private setRowIndexes(capIdx: number, row: IRow<Column>): void {
        if (!this.captionCounts[this.parent.pageSettings.currentPage]) {
            this.captionCounts[this.parent.pageSettings.currentPage] = {} as number[];
        }
        if (row.isCaptionRow) {
            this.captionCounts[this.parent.pageSettings.currentPage][row.uid] = (row.data as GroupedData).count;
        }
    }

    private getStartIndex(capIdx: number, isScroll: boolean): number {
        let page: number = this.parent.pageSettings.currentPage;
        let cache: Row<Column>[] = this.groupCache[page];
        if (isScroll) {
            return cache[this.rowObjectIndex].index + 1;
        }
        let count: number = 0;
        let idx: number = 0;
        let prevCapRow: Row<Column> = this.getRowByUid(cache[capIdx].parentUid);
        if (prevCapRow) {
            idx = this.prevCaptionCount(prevCapRow);
        }
        if (cache[capIdx].indent > 0) {
            for (let i: number = capIdx - 1; i >= 0; i--) {
                if (cache[i].indent < cache[capIdx].indent) {
                    break;
                }
                if (cache[i].isCaptionRow && cache[i].indent === cache[capIdx].indent) {
                    count = count + (cache[i].data as GroupedData).count;
                }
            }
        }
        let index: number = count + idx + this.startIndexes[page][(cache[capIdx] as IRow<Column>).parentGid];
        return index;
    }

    private prevCaptionCount(prevCapRow: Row<Column>): number {
        let page: number = this.parent.pageSettings.currentPage;
        let cache: Row<Column>[] = this.groupCache[page];
        let idx: number = 0;
        for (let i: number = cache.indexOf(prevCapRow) - 1; i >= 0; i--) {
            if (cache[i].indent === 0) {
                break;
            }
            if (cache[i].indent < prevCapRow.indent) {
                break;
            }
            if (cache[i].isCaptionRow && cache[i].indent === prevCapRow.indent) {
                let count: number = this.captionCounts[page][cache[i].uid];
                idx = idx + (count ? count : (cache[i].data as GroupedData).count);
            }
        }
        let capRow: Row<Column> = this.getRowByUid(prevCapRow.parentUid);
        if (capRow) {
            idx = idx + this.prevCaptionCount(capRow);
        }
        return idx;
    }

    private setStartIndexes(): void {
        let cache: Row<Column>[] = this.groupCache[this.parent.pageSettings.currentPage];
        if (!this.startIndexes[this.parent.pageSettings.currentPage]) {
            let indexes: number[] = [];
            let idx: number;
            for (let i: number = 0; i < cache.length; i++) {
                if (cache[i].isCaptionRow) {
                    !indexes.length ? indexes.push(0)
                        : indexes.push((cache[idx].data as GroupedData).count + indexes[indexes.length - 1]);
                    idx = i;
                }
            }
            this.startIndexes[this.parent.pageSettings.currentPage] = indexes;
        }
    }

    private hasLastChildRow(isScroll: boolean, captionCount: number, rowCount: number): boolean {
        return isScroll ? captionCount === this.childCount + rowCount : captionCount === rowCount;
    }

    private refreshCaptionRowCount(row: Row<Column>, count: number): void {
        (row.data as GroupedData).count = count;
    }

    private render(trIdx: number, rows: Row<Column>[], hasLastChildRow: boolean, aggregates: Row<Column>[]): void {
        let tr: HTMLElement = this.parent.getContent().querySelectorAll('tr')[trIdx];
        let isLastRow: boolean = true;
        if (tr && aggregates.length) {
            for (let i: number = aggregates.length - 1; i >= 0; i--) {
                tr.insertAdjacentElement('afterend', this.rowRenderer.render(aggregates[i], this.parent.getColumns()));
            }
        }
        if (tr && rows.length) {
            for (let i: number = rows.length - 1; i >= 0; i--) {
                if (this.confirmRowRendering(rows[i])) {
                    tr.insertAdjacentElement('afterend', this.rowRenderer.render(rows[i], this.parent.getColumns()));
                }
            }
        }
    }

    /** @hidden */
    public maintainRows(row: Row<Column>, index?: number): void {
        let page: number = this.parent.pageSettings.currentPage;
        if (!this.rowsByUid[page]) {
            this.rowsByUid[page] = {} as Row<Column>[];
            this.objIdxByUid[page] = {} as Row<Column>[];
        }
        if (row.uid) {
            this.rowsByUid[page][row.uid] = row;
        }
        this.objIdxByUid[page][row.uid] = index;
    }

    private confirmRowRendering(row: Row<Column>): boolean {
        let check: boolean = true;
        if (isNullOrUndefined(row.indent) && !row.isDataRow && !row.isCaptionRow) {
            let cap: Row<Column> = this.getRowByUid(row.parentUid);
            if (cap.isCaptionRow && !cap.isExpand) {
                check = false;
            }
        }
        return check;
    }

    private refreshRowObjects(newRows: Row<Column>[], index: number): void {
        let page: number = this.parent.pageSettings.currentPage;
        let rowsObject: Row<Column>[] = this.groupCache[page];
        this.rowsByUid[page] = {} as Row<Column>[];
        this.objIdxByUid[page] = {} as Row<Column>[];
        let newRowsObject: Row<Column>[] = [];
        let k: number = 0;
        for (let i: number = 0; i < rowsObject.length; i++) {
            if (i === index) {
                this.maintainRows(rowsObject[i], k);
                newRowsObject.push(rowsObject[i]);
                k++;
                for (let j: number = 0; j < newRows.length; j++) {
                    this.maintainRows(newRows[j], k);
                    newRowsObject.push(newRows[j]);
                    k++;
                }
            } else {
                this.maintainRows(rowsObject[i], k);
                newRowsObject.push(rowsObject[i]);
                k++;
            }
        }
        this.groupCache[this.parent.pageSettings.currentPage] = extend([], newRowsObject) as Row<Column>[];
        this.updateCurrentViewData();
    }

    private getAggregateByCaptionIndex(index: number): Row<Column>[] {
        let cache: Row<Column>[] = this.groupCache[this.parent.pageSettings.currentPage];
        let parent: Row<Column> = cache[index];
        let indent: number = parent.indent;
        let uid: string = parent.uid;
        let agg: Row<Column>[] = [];
        for (let i: number = index + 1; i < cache.length; i++) {
            if (cache[i].indent === indent) {
                break;
            }
            if (isNullOrUndefined(cache[i].indent) && cache[i].parentUid === uid) {
                agg.push(cache[i]);
            }
        }
        return agg;
    }

    private getChildRowsByParentIndex(
        index: number, deep?: boolean, block?: boolean, data?: Row<Column>[],
        includeAgg?: boolean, includeCollapseAgg?: boolean
    ): Row<Column>[] {
        let cache: Row<Column>[] = data ? data : this.groupCache[this.parent.pageSettings.currentPage];
        let parentRow: Row<Column> = cache[index];
        let agg: Row<Column>[] = [];
        if (!parentRow.isCaptionRow || (parentRow.isCaptionRow && !parentRow.isExpand && !includeCollapseAgg)) {
            return [];
        }
        if (includeAgg && this.parent.aggregates.length) {
            agg = this.getAggregateByCaptionIndex(index);
        }
        let indent: number = parentRow.indent;
        let uid: string = parentRow.uid;
        let rows: Row<Column>[] = [];
        let count: number = 0;
        for (let i: number = index + 1; i < cache.length; i++) {
            if (cache[i].parentUid === uid) {
                if (isNullOrUndefined(cache[i].indent)) {
                    continue;
                }
                count++;
                rows.push(cache[i]);
                if (deep && cache[i].isCaptionRow) {
                    rows = rows.concat(this.getChildRowsByParentIndex(i, deep, block, data, includeAgg));
                }
                if (block && count === this.pageSize) {
                    break;
                }
            }
            if (cache[i].indent === indent) {
                break;
            }
        }
        return rows.concat(agg);
    }

    /** @hidden */
    public initialGroupRows(isReorder?: boolean): Row<Column>[] {
        let rows: Row<Column>[] = [];
        let cache: Row<Column>[] = this.groupCache[this.parent.pageSettings.currentPage];
        if (isReorder) {
            return this.getRenderedRowsObject();
        }
        for (let i: number = 0; i < cache.length; i++) {
            if (cache[i].indent === 0) {
                rows.push(cache[i]);
                rows = rows.concat(this.getChildRowsByParentIndex(i, true, true, cache, true));
            }
        }
        return rows;
    }

    /** @hidden */
    public getRenderedRowsObject(): Row<Column>[] {
        let rows: Row<Column>[] = [];
        let trs: HTMLTableRowElement[] = [].slice.call(this.parent.getContent().querySelectorAll('tr'));
        for (let i: number = 0; i < trs.length; i++) {
            rows.push(this.getRowByUid(trs[i].getAttribute('data-uid')));
        }
        return rows;
    }

    private getCacheRowsOnDownScroll(index: number): Row<Column>[] {
        let rows: Row<Column>[] = [];
        let rowsObject: Row<Column>[] = this.groupCache[this.parent.pageSettings.currentPage];
        let k: number = index;
        for (let i: number = 0; i < this.pageSize; i++) {
            if (!rowsObject[k] || rowsObject[k].indent < rowsObject[index].indent) {
                break;
            }
            if (rowsObject[k].indent === rowsObject[index].indent) {
                rows.push(rowsObject[k]);
                if (rowsObject[k].isCaptionRow && rowsObject[k].isExpand) {
                    rows = rows.concat(this.getChildRowsByParentIndex(k, true, true, null, true));
                }
            }
            if (rowsObject[k].indent > rowsObject[index].indent || isNullOrUndefined(rowsObject[k].indent)) {
                i--;
            }
            k++;
        }
        return rows;
    }

    private getCacheRowsOnUpScroll(start: string, end: string, index: number): Row<Column>[] {
        let rows: Row<Column>[] = [];
        let rowsObject: Row<Column>[] = this.groupCache[this.parent.pageSettings.currentPage];
        let str: boolean = false;
        for (let i: number = 0; i < rowsObject.length; i++) {
            if (str && (!rowsObject[i] || rowsObject[i].indent < rowsObject[index].indent || rowsObject[i].uid === end)) {
                break;
            }
            if (!str && rowsObject[i].uid === start) {
                str = true;
            }
            if (str && rowsObject[i].indent === rowsObject[index].indent) {
                rows.push(rowsObject[i]);
                if (rowsObject[i].isCaptionRow && rowsObject[i].isExpand) {
                    rows = rows.concat(this.getChildRowsByParentIndex(i, true, true, null, true));
                }
            }
        }
        return rows;
    }

    private scrollHandler(e: { scrollDown: boolean }): void {
        if (this.parent.isDestroyed || this.childCount) { return; }
        let downTrs: Element[] = [].slice.call(this.parent.getContent().querySelectorAll('.e-lazyload-middle-down'));
        let upTrs: Element[] = [].slice.call(this.parent.getContent().querySelectorAll('.e-lazyload-middle-up'));
        let endTrs: Element[] = [].slice.call(this.parent.getContent().querySelectorAll('.e-not-lazyload-end'));
        let tr: Element;
        let lazyLoadDown: boolean = false; let lazyLoadUp: boolean = false; let lazyLoadEnd: boolean = false;
        if (e.scrollDown && downTrs.length) {
            let result: { entered: boolean, tr: Element } = this.findRowElements(downTrs);
            tr = result.tr;
            lazyLoadDown = result.entered;
        }
        if (!e.scrollDown && endTrs) {
            for (let i: number = 0; i < endTrs.length; i++) {
                let top: number = endTrs[i].getBoundingClientRect().top;
                let scrollHeight: number = this.parent.getContent().scrollHeight;
                if (top > 0 && top < scrollHeight) {
                    tr = endTrs[i];
                    lazyLoadEnd = true;
                    this.rowIndex = (tr as HTMLTableRowElement).rowIndex;
                    break;
                }
            }
        }
        if (!e.scrollDown && upTrs.length && !lazyLoadEnd) {
            let result: { entered: boolean, tr: Element } = this.findRowElements(upTrs);
            tr = result.tr;
            lazyLoadUp = result.entered;
        }

        if (tr) {
            if (lazyLoadDown && e.scrollDown && lazyLoadDown && tr) {
                this.scrollDownHandler(tr);
            }
            if (!e.scrollDown && lazyLoadEnd && tr) {
                this.scrollUpEndRowHandler(tr);
            }
            if (this.cacheMode && !e.scrollDown && !lazyLoadEnd && lazyLoadUp && tr) {
                this.scrollUpHandler(tr);
            }
        }
    }

    private scrollUpEndRowHandler(tr: Element): void {
        let page: number = this.parent.pageSettings.currentPage;
        let rows: Row<Column>[] = this.groupCache[page];
        let uid: string = tr.getAttribute('data-uid');
        let index: number = this.rowObjectIndex = this.getRowObjectIndexByUid(uid);
        let idx: number = index;
        let childRow: Row<Column> = rows[index];
        let parentCapRow: Row<Column> = this.getRowByUid(childRow.parentUid);
        let capRowObjIdx: number = this.getRowObjectIndexByUid(parentCapRow.uid);
        let captionRowEle: Element = this.parent.getContent().querySelector('tr[data-uid=' + parentCapRow.uid + ']');
        let capRowEleIndex: number = (captionRowEle as HTMLTableRowElement).rowIndex;
        let child: Row<Column>[] = this.getChildRowsByParentIndex(capRowObjIdx);
        let childIdx: number = child.indexOf(childRow);
        let currentPage: number = Math.ceil(childIdx / this.pageSize);
        if (currentPage === 1) {
            return;
        }
        this.childCount = currentPage * this.pageSize;
        index = this.getCurrentBlockEndIndex(childRow, index);
        if (this.childCount < (parentCapRow.data as GroupedData).count) {
            tr.classList.remove('e-not-lazyload-end');
            childRow.lazyLoadCssClass = '';
            let isRowExist: boolean = rows[index + 1] ? childRow.indent === rows[index + 1].indent : false;
            this.scrollData = isRowExist ? this.getCacheRowsOnDownScroll(index + 1) : [];
            let key: { fields: string[], keys: string[] } = this.getGroupKeysAndFields(capRowObjIdx, rows);
            let args: LazyLoadGroupArgs = {
                rowIndex: capRowEleIndex, makeRequest: !isRowExist, groupInfo: parentCapRow, fields: key.fields,
                keys: key.keys, skip: this.childCount, take: this.pageSize, isScroll: true
            };
            if (this.cacheMode && this.childCount >= (this.pageSize * this.cacheBlockSize)) {
                let child: Row<Column>[] = this.getChildRowsByParentIndex(capRowObjIdx);
                let currenBlock: number = Math.ceil((child.indexOf(rows[idx]) / this.pageSize));
                let removeBlock: number = currenBlock - (this.cacheBlockSize - 1);
                this.removeBlock(uid, isRowExist, removeBlock, child);
                args.cachedRowIndex = (removeBlock * this.pageSize);
            }
            this.captionRowExpand(args);
        } else {
            this.childCount = 0;
        }
    }

    private scrollDownHandler(tr: Element): void {
        let page: number = this.parent.pageSettings.currentPage;
        let rows: Row<Column>[] = this.groupCache[page];
        let uid: string = tr.getAttribute('data-uid');
        let index: number = this.getRowObjectIndexByUid(uid);
        let idx: number = index;
        let childRow: Row<Column> = rows[index];
        let parentCapRow: Row<Column> = this.getRowByUid(childRow.parentUid);
        let capRowObjIdx: number = this.getRowObjectIndexByUid(parentCapRow.uid);
        let captionRowEle: Element = this.getRowElementByUid(parentCapRow.uid);
        let capRowEleIndex: number = (captionRowEle as HTMLTableRowElement).rowIndex;
        let child: Row<Column>[] = this.getChildRowsByParentIndex(capRowObjIdx);
        let childIdx: number = child.indexOf(childRow);
        let currentPage: number = Math.ceil(childIdx / this.pageSize);
        this.childCount = currentPage * this.pageSize;
        index = this.rowObjectIndex = this.getRowObjectIndexByUid(child[this.childCount - 1].uid);
        let lastchild: Row<Column> = rows[index];
        let lastRow: HTMLTableRowElement = this.getRowElementByUid(lastchild.uid);
        this.rowIndex = lastRow.rowIndex;
        index = this.getCurrentBlockEndIndex(lastchild, index);
        if (this.childCount < (parentCapRow.data as GroupedData).count) {
            let isRowExist: boolean = rows[index + 1] ? childRow.indent === rows[index + 1].indent : false;
            if (isRowExist && !isNullOrUndefined(this.getRowElementByUid(rows[index + 1].uid))) {
                this.childCount = 0;
                return;
            }
            if (currentPage > 1 || !this.cacheMode) {
                tr.classList.remove('e-lazyload-middle-down');
                lastRow.classList.remove('e-not-lazyload-end');
                lastchild.lazyLoadCssClass = '';
            }
            this.scrollData = isRowExist ? this.getCacheRowsOnDownScroll(this.rowObjectIndex + 1) : [];
            let query: { fields: string[], keys: string[] } = this.getGroupKeysAndFields(capRowObjIdx, rows);
            let args: LazyLoadGroupArgs = {
                rowIndex: capRowEleIndex, makeRequest: !isRowExist, groupInfo: parentCapRow, fields: query.fields,
                keys: query.keys, skip: this.childCount, take: this.pageSize, isScroll: true
            };
            if (this.cacheMode && (this.childCount - this.pageSize) >= (this.pageSize * this.cacheBlockSize)) {
                let child: Row<Column>[] = this.getChildRowsByParentIndex(capRowObjIdx);
                let currenBlock: number = Math.ceil((child.indexOf(rows[idx]) / this.pageSize)) - 1;
                let removeBlock: number = (currenBlock - (this.cacheBlockSize - 1)) + 1;
                this.removeBlock(uid, isRowExist, removeBlock, child, lastchild);
                args.cachedRowIndex = (removeBlock * this.pageSize);
            }
            this.captionRowExpand(args);
        } else {
            this.childCount = 0;
        }
    }

    private getCurrentBlockEndIndex(row: Row<Column>, index: number): number {
        let page: number = this.parent.pageSettings.currentPage;
        let rows: Row<Column>[] = this.groupCache[page];
        if (row.isCaptionRow) {
            if (row.isExpand) {
                let childCount: number = this.getChildRowsByParentIndex(index, true).length;
                this.rowIndex = this.rowIndex + childCount;
            }
            let agg: Row<Column>[] = this.getAggregateByCaptionIndex(index);
            this.rowObjectIndex = this.rowObjectIndex + agg.length;
            let idx: number = index;
            for (let i: number = idx + 1; i < rows.length; i++) {
                if (rows[i].indent === rows[index].indent || rows[i].indent < rows[index].indent) {
                    index = idx;
                    break;
                } else {
                    idx++;
                }
            }
        }
        return index;
    }

    private removeBlock(uid: string, isRowExist: boolean, removeBlock: number, child: Row<Column>[], lastchild?: Row<Column>): void {
        let page: number = this.parent.pageSettings.currentPage;
        let rows: Row<Column>[] = this.groupCache[page];
        let uid1: string = child[(((removeBlock + 1) * this.pageSize) - 1) - this.blockSize].uid;
        let uid2: string = child[(removeBlock * this.pageSize) - this.pageSize].uid;
        let uid3: string = child[(removeBlock * this.pageSize)].uid;
        let firstIdx: number = this.getRowObjectIndexByUid(uid1);
        rows[firstIdx].lazyLoadCssClass = 'e-lazyload-middle-up';
        this.getRowElementByUid(uid1).classList.add('e-lazyload-middle-up');
        if (lastchild) {
            this.getRowElementByUid(uid3).classList.add('e-not-lazyload-first');
            this.getRowByUid(uid3).lazyLoadCssClass = 'e-not-lazyload-first';
            this.getRowByUid(uid2).lazyLoadCssClass = '';
        }
        if (isRowExist) {
            this.removeTopRows(lastchild ? lastchild.uid : uid, uid2, uid3);
        } else {
            this.uid1 = uid2;
            this.uid2 = uid3;
            this.uid3 = lastchild ? lastchild.uid : uid;
        }
    }

    private scrollUpHandler(tr: Element): void {
        let page: number = this.parent.pageSettings.currentPage;
        let rows: Row<Column>[] = this.groupCache[page];
        let uid: string = tr.getAttribute('data-uid');
        let row: IRow<Column> = this.getRowByUid(uid);
        let index: number = this.rowObjectIndex = this.getRowObjectIndexByUid(uid);
        let parentCapRow: Row<Column> = this.getRowByUid(row.parentUid);
        let capRowObjIdx: number = this.rowIndex = this.getRowObjectIndexByUid(parentCapRow.uid);
        let captionRowEle: Element = this.parent.getRowElementByUID(parentCapRow.uid) as HTMLTableRowElement;
        let capRowEleIndex: number = (captionRowEle as HTMLTableRowElement).rowIndex;
        let child: Row<Column>[] = this.getChildRowsByParentIndex(capRowObjIdx);
        let childIdx: number = child.indexOf(rows[index]);
        let currenBlock: number = Math.floor((childIdx / this.pageSize));
        let idx: number = this.blockSize;
        if ((this.blockSize * 2) > this.pageSize) {
            idx = (this.blockSize * 2) - this.pageSize;
            idx = this.blockSize - idx;
        }
        let start: string = child[(childIdx - (idx - 1)) - this.pageSize].uid;
        let end: string = child[childIdx - (idx - 1)].uid;
        this.scrollData = this.getCacheRowsOnUpScroll(start, end, index - (idx - 1));
        this.isFirstChildRow = currenBlock > 1;
        if (this.isFirstChildRow) {
            this.scrollData[0].lazyLoadCssClass = 'e-not-lazyload-first';
        }
        this.getRowByUid(end).lazyLoadCssClass = '';
        this.getRowElementByUid(end).classList.remove('e-not-lazyload-first');
        let removeBlock: number = currenBlock + this.cacheBlockSize;
        if (child.length !== (parentCapRow.data as GroupedData).count && (removeBlock * this.pageSize > child.length)) {
            this.isFirstChildRow = false;
            this.scrollData[0].lazyLoadCssClass = '';
            this.getRowElementByUid(end).classList.add('e-not-lazyload-first');
            return;
        }
        let count: number = removeBlock * this.pageSize > (parentCapRow.data as GroupedData).count
            ? (parentCapRow.data as GroupedData).count : removeBlock * this.pageSize;
        let size: number = removeBlock * this.pageSize > (parentCapRow.data as GroupedData).count
            ? (this.pageSize - ((this.pageSize * removeBlock) - (parentCapRow.data as GroupedData).count)) : this.pageSize;
        let childRows: Row<Column>[] = this.getChildRowsByParentIndex(rows.indexOf(child[count - 1]), true, false, null, true);
        let uid1: string = childRows.length ? childRows[childRows.length - 1].uid : child[(count - 1)].uid;
        let uid2: string = child[count - size].uid;
        let uid3: string = child[(count - size) - 1].uid;
        let lastIdx: number = this.objIdxByUid[page][uid2] - idx;
        if (rows[lastIdx].lazyLoadCssClass === 'e-lazyload-middle-down') {
            let trEle: Element = this.getRowElementByUid(rows[lastIdx].uid);
            if (trEle) {
                trEle.classList.add('e-lazyload-middle-down');
            }
        }
        this.getRowByUid(uid1).lazyLoadCssClass = '';
        this.getRowByUid(uid3).lazyLoadCssClass = 'e-not-lazyload-end';
        this.getRowElementByUid(uid3).classList.add('e-not-lazyload-end');
        this.removeBottomRows(uid1, uid2, uid3);
        this.rowIndex = (tr as HTMLTableRowElement).rowIndex - idx;
        tr.classList.length > 1 ? tr.classList.remove('e-lazyload-middle-up') : tr.removeAttribute('class');
        if (!isNullOrUndefined(this.getRowElementByUid(start))) {
            this.childCount = 0;
            this.scrollData = [];
            return;
        }
        let key: { fields: string[], keys: string[] } = this.getGroupKeysAndFields(this.getRowObjectIndexByUid(parentCapRow.uid), rows);
        let args: LazyLoadGroupArgs = {
            rowIndex: capRowEleIndex, makeRequest: false, groupInfo: parentCapRow, fields: key.fields,
            keys: key.keys, skip: this.childCount, take: this.pageSize, isScroll: true, scrollUp: true
        };
        this.captionRowExpand(args);
    }

    private findRowElements(rows: Element[]): { entered: boolean, tr: Element } {
        let entered: boolean = false; let tr: Element;
        for (let i: number = 0; i < rows.length; i++) {
            let rowIdx: number = (rows[i] as HTMLTableRowElement).rowIndex;
            if (isRowEnteredInGrid(rowIdx, this.parent)) {
                entered = true;
                this.rowIndex = rowIdx;
                tr = rows[i];
                break;
            }
        }
        return { entered, tr };
    }

    private getRowElementByUid(uid: string): HTMLTableRowElement {
        return this.parent.getContent().querySelector('tr[data-uid=' + uid + ']');
    }

    private removeTopRows(uid1: string, uid2: string, uid3: string): void {
        let trs: Element[] = [].slice.call(this.parent.getContent().querySelectorAll('tr'));
        let page: number = this.parent.pageSettings.currentPage;
        let start: boolean = false;
        for (let i: number = 0; i < trs.length; i++) {
            if (trs[i].getAttribute('data-uid') === uid3) {
                let tr: HTMLTableRowElement = this.parent.getContent().querySelector('tr[data-uid=' + uid1 + ']') as HTMLTableRowElement;
                if (tr) {
                    this.rowIndex = tr.rowIndex;
                }
                break;
            }
            if (trs[i].getAttribute('data-uid') === uid2) {
                start = true;
            }
            if (start) {
                remove(trs[i]);
            }
        }
    }

    private removeBottomRows(uid1: string, uid2: string, uid3: string): void {
        let trs: Element[] = [].slice.call(this.parent.getContent().querySelectorAll('tr'));
        let start: boolean = false;
        for (let i: number = 0; i < trs.length; i++) {
            if (trs[i].getAttribute('data-uid') === uid2) {
                start = true;
            }
            if (start) {
                remove(trs[i]);
                if (trs[i].getAttribute('data-uid') === uid1) {
                    break;
                }
            }
        }
    }

    private setCache(e?: { args: NotifyArgs, data: Row<Column>[] }): void {
        let page: number = this.parent.pageSettings.currentPage;
        this.groupCache[page] = this.initialGroupCaptions[page] = extend([], e.data) as Row<Column>[];
    }

    private getGroupKeysAndFields(index: number, rowsObject: Row<Column>[]): { fields: string[], keys: string[] } {
        let fields: string[] = [];
        let keys: string[] = [];
        for (let i: number = index; i >= 0; i--) {
            if (rowsObject[i].isCaptionRow && fields.indexOf((rowsObject[i].data as GroupedData).field) === -1
                && (rowsObject[i].indent < rowsObject[index].indent || i === index)) {
                fields.push((rowsObject[i].data as GroupedData).field);
                keys.push((rowsObject[i].data as GroupedData).key);
                if (rowsObject[i].indent === 0) {
                    break;
                }
            }
        }
        return { fields: fields, keys: keys };
    }

    private generateExpandPredicates(fields: string[], values: string[]): Predicate {
        let filterCols: PredicateModel[] = [];
        for (let i: number = 0; i < fields.length; i++) {
            let column: Column = this.parent.getColumnByField(fields[i]);
            let value: string = values[i] === 'null' ? null : values[i];
            let pred: {
                predicate?: string, field?: string, type?: string, uid?: string
                operator?: string, matchCase?: boolean, ignoreAccent?: boolean
            } = {
                field: fields[i], predicate: 'or', uid: column.uid, operator: 'equal', type: column.type,
                matchCase: this.allowCaseSensitive, ignoreAccent: this.ignoreAccent
            };
            if (value === '' || isNullOrUndefined(value)) {
                filterCols = filterCols.concat(CheckBoxFilterBase.generateNullValuePredicates(pred));
            } else {
                filterCols.push(extend({}, { value: value }, pred));
            }
        }
        return CheckBoxFilterBase.getPredicate(filterCols);
    }

    private getPredicates(pred: Predicate): Predicate[] {
        let predicateList: Predicate[] = [];
        for (let prop of Object.keys(pred)) {
            predicateList.push(<Predicate>pred[prop]);
        }
        return predicateList;
    }

    private captionRowExpand(args: LazyLoadGroupArgs): void {
        let captionRow: Row<Column> = args.groupInfo;
        let level: number = this.parent.groupSettings.columns.indexOf((captionRow.data as GroupedData).field) + 1;
        let pred: Predicate = this.generateExpandPredicates(args.fields, args.keys);
        let predicateList: Predicate[] = this.getPredicates(pred);
        let lazyLoad: Object = { level: level, skip: args.skip, take: args.take, where: predicateList };
        if (args.makeRequest) {
            let query: Query = this.parent.renderModule.data.generateQuery(true);
            if (!query.isCountRequired) {
                query.isCountRequired = true;
            }
            query.lazyLoad.push({ key: 'onDemandGroupInfo', value: lazyLoad });
            this.parent.showSpinner();
            this.parent.renderModule.data.getData({}, query).then((e: ReturnType) => {
                this.parent.hideSpinner();
                if (e.result.length === 0) {
                    return;
                }
                if (this.cacheMode && this.uid1 && this.uid2) {
                    this.removeTopRows(this.uid3, this.uid1, this.uid2);
                    this.uid1 = this.uid2 = this.uid3 = undefined;
                }
                this.lazyLoadHandler(
                    {
                        data: e.result, count: e.count, level: level, index: args.rowIndex,
                        isRowExist: false, isScroll: args.isScroll, up: false, rowIndex: args.cachedRowIndex
                    });
            })
                .catch((e: ReturnType) => this.parent.renderModule.dataManagerFailure(e, { requestType: 'grouping' }));
        } else {
            this.lazyLoadHandler(
                {
                    data: null, count: (args.groupInfo.data as GroupedData).count, level: level, index: args.rowIndex,
                    isRowExist: true, isScroll: args.isScroll, up: args.scrollUp, rowIndex: args.cachedRowIndex
                });
        }
    }

    private scrollReset(top?: number): void {
        this.parent.getContent().firstElementChild.scrollTop = top ? this.parent.getContent().firstElementChild.scrollTop + top : 0;
    }

    private updateCurrentViewData(): void {
        let records: Object[] = [];
        this.getRows().filter((row: Row<Column>) => {
            if (row.isDataRow) {
                records[row.index] = row.data;
            }
        });
        this.parent.currentViewData = records.length ? records : this.parent.currentViewData;
    }

    /** @hidden */
    public getGroupCache(): { [x: number]: Row<Column>[] } {
        return this.groupCache;
    }

    /** @hidden */
    public getRows(): Row<Column>[] {
        return this.groupCache[this.parent.pageSettings.currentPage] || [];
    }

    /** @hidden */
    public getRowElements(): Element[] {
        return [].slice.call(this.parent.getContent().querySelectorAll('.e-row'));
    }

    /** @hidden */
    public getRowByIndex(index: number): Element {
        let tr: Element[] = [].slice.call(this.parent.getContent().querySelectorAll('.e-row'));
        let row: Element;
        for (let i: number = 0; !isNullOrUndefined(index) && i < tr.length; i++) {
            if (tr[i].getAttribute('aria-rowindex') === index.toString()) {
                row = tr[i];
                break;
            }
        }
        return row;
    }

    /** @hidden */
    public setVisible(columns?: Column[]): void {
        let gObj: IGrid = this.parent;
        let rows: Row<Column>[] = this.getRows();
        let testRow: Row<Column>;
        rows.some((r: Row<Column>) => { if (r.isDataRow) { testRow = r; } return r.isDataRow; });
        let contentrows: Row<Column>[] = this.getRows().filter((row: Row<Column>) => !row.isDetailRow);
        for (let i: number = 0; i < columns.length; i++) {
            let column: Column = columns[i];
            let idx: number = this.parent.getNormalizedColumnIndex(column.uid);
            let colIdx: number = this.parent.getColumnIndexByUid(column.uid);
            let displayVal: string = column.visible === true ? '' : 'none';
            if (idx !== -1 && testRow && idx < testRow.cells.length) {
                setStyleAttribute(<HTMLElement>this.getColGroup().childNodes[idx], { 'display': displayVal });
            }
            this.setDisplayNone(gObj.getDataRows(), colIdx, displayVal, contentrows, idx);
            if (!this.parent.invokedFromMedia && column.hideAtMedia) {
                this.parent.updateMediaColumns(column);
            }
            this.parent.invokedFromMedia = false;
        }
    }

    /** @hidden */
    public setDisplayNone(tr: Object, idx: number, displayVal: string, rows: Row<Column>[], oriIdx?: number): void {
        let trs: string[] = Object.keys(tr);
        if (!this.parent.groupSettings.columns.length) {
            for (let i: number = 0; i < trs.length; i++) {
                let td: HTMLElement = tr[trs[i]].querySelectorAll('td.e-rowcell')[idx];
                if (tr[trs[i]].querySelectorAll('td.e-rowcell').length && td) {
                    setStyleAttribute(<HTMLElement>tr[trs[i]].querySelectorAll('td.e-rowcell')[idx], { 'display': displayVal });
                    if (tr[trs[i]].querySelectorAll('td.e-rowcell')[idx].classList.contains('e-hide')) {
                        removeClass([tr[trs[i]].querySelectorAll('td.e-rowcell')[idx]], ['e-hide']);
                    }
                    rows[trs[i]].cells[idx].visible = displayVal === '' ? true : false;
                }
            }
        } else {
            let keys: string[] = Object.keys(this.groupCache);
            for (let j: number = 0; j < keys.length; j++) {
                let uids: Row<Column>[] = this.rowsByUid[keys[j]] as Row<Column>[];
                let idxs: string[] = Object.keys(uids);
                for (let i: number = 0; i < idxs.length; i++) {
                    let tr: HTMLTableRowElement = this.parent.getContent().querySelector('tr[data-uid=' + idxs[i] + ']');
                    let row: Row<Column> = uids[idxs[i]];
                    if (row.isCaptionRow) {
                        if (!this.captionModelGen.isEmpty()) {
                            this.changeCaptionRow(row, tr, keys[j]);
                        } else {
                            row.cells[row.indent + 1].colSpan = displayVal === '' ? row.cells[row.indent + 1].colSpan + 1
                                : row.cells[row.indent + 1].colSpan - 1;
                            if (tr) {
                                tr.cells[row.indent + 1].colSpan = row.cells[row.indent + 1].colSpan;
                            }
                        }
                    }
                    if (row.isDataRow) {
                        this.showAndHideCells(tr, idx, displayVal, false);
                        row.cells[oriIdx].visible = displayVal === '' ? true : false;
                    }
                    if (!row.isCaptionRow && !row.isDataRow && isNullOrUndefined(row.indent)) {
                        row.cells[oriIdx].visible = displayVal === '' ? true : false;
                        row.visible = row.cells.some((cell: Cell<AggregateColumnModel>) => cell.isDataCell && cell.visible);
                        this.showAndHideCells(tr, idx, displayVal, true, row);
                    }
                }
            }
        }
    }

    private changeCaptionRow(row: Row<Column>, tr: HTMLTableRowElement, index: string): void {
        let capRow: IRow<Column> = row;
        let captionData: GroupedData = row.data as GroupedData;
        let data: Row<Column> = this.groupGenerator.generateCaptionRow(
            captionData, capRow.indent, capRow.parentGid, undefined, capRow.tIndex, capRow.parentUid
        );
        data.uid = row.uid;
        data.isExpand = row.isExpand;
        data.lazyLoadCssClass = row.lazyLoadCssClass;
        this.rowsByUid[index][row.uid] = data;
        this.groupCache[index][this.objIdxByUid[index][row.uid]] = data;
        if (tr) {
            let tbody: Element = this.parent.getContentTable().querySelector('tbody');
            tbody.replaceChild(this.rowRenderer.render(data, this.parent.getColumns()), tr);
        }
    }

    private showAndHideCells(tr: HTMLTableRowElement, idx: number, displayVal: string, isSummary: boolean, row?: Row<Column>): void {
        if (tr) {
            let cls: string = isSummary ? 'td.e-summarycell' : 'td.e-rowcell';
            setStyleAttribute(tr.querySelectorAll(cls)[idx] as HTMLElement, { 'display': displayVal });
            if (tr.querySelectorAll(cls)[idx].classList.contains('e-hide')) {
                removeClass([tr.querySelectorAll(cls)[idx]], ['e-hide']);
            }
            if (isSummary) {
                if (row.visible && tr.classList.contains('e-hide')) {
                    removeClass([tr], ['e-hide']);
                } else if (!row.visible) {
                    addClass([tr], ['e-hide']);
                }
            }
        }
    }
}