import { EventHandler, getValue, KeyboardEventArgs, closest, isNullOrUndefined } from '@syncfusion/ej2-base';
import { addClass, removeClass, extend, Browser } from '@syncfusion/ej2-base';
import { IGrid, IFocus, FocusInfo, FocusedContainer, IIndex, CellFocusArgs, SwapInfo } from '../base/interface';
import { CellType } from '../base/enum';
import * as event from '../base/constant';
import { Row } from '../models/row';
import { Cell } from '../models/cell';
import { Column } from '../models/column';
import { NotifyArgs } from '../base/interface';
import { RowModelGenerator } from './row-model-generator';
import { parentsUntil } from '../base/util';

/**
 * FocusStrategy class
 * @hidden
 */
export class FocusStrategy {
    public parent: IGrid;
    public currentInfo: FocusInfo = {};
    public oneTime: boolean = true;
    public swap: SwapInfo = {};
    public content: IFocus; public header: IFocus; public active: IFocus;
    public fContent: IFocus; public fHeader: IFocus;
    private forget: boolean = false;
    private skipFocus: boolean = true;
    private focusByClick: boolean = false;
    private passiveHandler: EventListener;
    private prevIndexes: IIndex = {};
    private focusedColumnUid: string;
    private refMatrix: Function = this.refreshMatrix(true);
    private rowModelGen: RowModelGenerator;
    private activeKey: string;
    private empty: string;
    private actions: string[] = ['downArrow', 'upArrow'];
    constructor(parent: IGrid) {
        this.parent = parent;
        this.rowModelGen = new RowModelGenerator(this.parent);
        this.addEventListener();
    }

    protected focusCheck(e: Event): void {
        let target: HTMLElement = <HTMLElement>e.target;
        this.focusByClick = true;
        this.skipFocus = target.classList.contains('e-grid');
    }

    protected onFocus(): void {
        if (this.parent.isDestroyed || Browser.isDevice || this.parent.enableVirtualization) { return; }
        this.setActive(!this.parent.enableHeaderFocus && this.parent.frozenRows === 0, this.parent.frozenColumns !== 0);
        let added: string = 'addedRecords';
        if (!this.parent.enableHeaderFocus && !this.parent.getCurrentViewRecords().length && ((this.parent.editSettings.mode !== 'Batch')
            || (this.parent.editSettings.mode === 'Batch' && !this.parent.editModule.getBatchChanges()[added].length))) {
            this.getContent().matrix.
                generate(
                    this.rowModelGen.generateRows({ rows: [new Row<Column>({ isDataRow: true })] }),
                    this.getContent().selector, false);
        }
        let current: number[] = this.getContent().matrix.get(0, -1, [0, 1], null, this.getContent().validator());
        this.getContent().matrix.select(current[0], current[1]);
        if (this.skipFocus) {
            this.focus();
            this.skipFocus = false;
        }
    }

    protected passiveFocus(e: FocusEvent): void {
        if (this.parent.isDestroyed) { return; }
        if (e.target && (<HTMLElement>e.target).classList.contains('e-detailcell')) {
            this.currentInfo.skipAction = false;
            addClass([this.currentInfo.element], ['e-focused', 'e-focus']);
        }
    }

    protected onBlur(e?: FocusEvent): void {
        if ((this.parent.isEdit || e && (!e.relatedTarget || closest(<HTMLElement>e.relatedTarget, '.e-grid')))) { return; }
        this.removeFocus(); this.skipFocus = false; this.currentInfo.skipAction = false;
        if (this.getContent().getFocusInfo().elementToFocus) {
            this.getContent().getFocusInfo().elementToFocus.tabIndex = 0;
        }
    }

    public onClick(e: Event | { target: Element }, force?: boolean): void {
        if (parentsUntil(e.target as HTMLElement, 'e-filterbarcell') &&
            (e.target as HTMLElement).classList.contains('e-input-group-icon')) {
            return;
        }
        let isContent: boolean = !isNullOrUndefined(closest(<HTMLElement>e.target, '.e-gridcontent'));
        let isHeader: boolean = !isNullOrUndefined(closest(<HTMLElement>e.target, '.e-gridheader'));
        isContent = isContent && isHeader ? !isContent : isContent;
        let isFrozen: boolean = !isNullOrUndefined(closest(<HTMLElement>e.target, '.e-frozencontent')) ||
            !isNullOrUndefined(closest(<HTMLElement>e.target, '.e-frozenheader'));
        if (!isContent && isNullOrUndefined(closest(<HTMLElement>e.target, '.e-gridheader')) ||
            (<Element>e.target).classList.contains('e-content') ||
            !isNullOrUndefined(closest(<HTMLElement>e.target, '.e-unboundcell'))) { return; }
        this.setActive(isContent, isFrozen);
        if (!isContent && isNullOrUndefined(closest(<HTMLElement>e.target, '.e-gridheader'))) { this.clearOutline(); return; }
        let beforeArgs: CellFocusArgs = { cancel: false, byKey: false, byClick: !isNullOrUndefined(e.target), clickArgs: <Event>e };
        this.parent.notify(event.beforeCellFocused, beforeArgs);
        if (beforeArgs.cancel || closest(<Element>e.target, '.e-inline-edit')) { return; }
        this.setActive(isContent, isFrozen);
        if (this.getContent()) {
            let returnVal: boolean = this.getContent().onClick(e, force);
            if (returnVal === false) { return; }
            this.focus();
        }
    }

    protected onKeyPress(e: KeyboardEventArgs): void {
        if (this.skipOn(e)) {
            return;
        }
        this.activeKey = e.action;
        let beforeArgs: CellFocusArgs = { cancel: false, byKey: true, byClick: false, keyArgs: e };
        this.parent.notify(event.beforeCellFocused, beforeArgs);
        if (beforeArgs.cancel) { return; }
        let bValue: number[] = this.getContent().matrix.current;
        this.currentInfo.outline = true;
        let swapInfo: SwapInfo = this.getContent().jump(e.action, bValue);
        this.swap = swapInfo;
        if (swapInfo.swap) {
            this.setActive(!swapInfo.toHeader, swapInfo.toFrozen);
            this.getContent().matrix.current = this.getContent().getNextCurrent(bValue, swapInfo, this.active, e.action);
            this.prevIndexes = {};
        }
        this.setActiveByKey(e.action, this.getContent());
        let returnVal: boolean = this.getContent().onKeyPress(e);
        if (returnVal === false) { this.clearIndicator(); return; }
        e.preventDefault();
        this.focus(e);
    }

    private skipOn(e: KeyboardEventArgs): boolean {
        let target: HTMLElement = <HTMLElement>e.target; if (!target) { return false; }
        if (this.currentInfo.skipAction) { this.clearIndicator(); return true; }
        if (['pageUp', 'pageDown', 'altDownArrow'].indexOf(e.action) > -1) { this.clearIndicator(); return true; }
        let th: boolean = closest(target, 'th') && !(closest(target, 'th') as HTMLElement).tabIndex;
        if ((e.target as HTMLElement).classList.contains('e-filterbaroperator') && (e.keyCode === 13 || e.keyCode === 27)) {
            let inputTarget: Element = closest(e.target as HTMLElement, '.e-filterbarcell');
            inputTarget.querySelector('input').focus();
        }
        if (th && closest(document.activeElement, '.e-filterbarcell') !== null) {
            this.removeFocus();
        }
        let filterCell: boolean = closest(document.activeElement, '.e-filterbarcell') !== null;
        if (this.parent.enableHeaderFocus && filterCell) {
            let matrix: Matrix = this.active.matrix;
            let current: number[] = matrix.current;
            filterCell = matrix.matrix[current[0]].lastIndexOf(1) !== current[1];
        }
        return (e.action === 'delete'
            || (this.parent.editSettings.mode !== 'Batch' && (this.parent.isEdit || ['insert', 'f2'].indexOf(e.action) > -1))
            || (filterCell ||
                closest(document.activeElement, '#' + this.parent.element.id + '_searchbar') !== null
                && ['enter', 'leftArrow', 'rightArrow',
                    'shiftLeft', 'shiftRight', 'ctrlPlusA'].indexOf(e.action) > -1)
            || (closest(target, '.e-gridcontent') === null && closest(target, '.e-gridheader') === null)
            || (e.action === 'space' && (!target.classList.contains('e-gridchkbox') && closest(target, '.e-gridchkbox') === null
                && closest(target, '.e-headerchkcelldiv') === null))) || closest(target, '.e-filter-popup') !== null;
    }

    private focusVirtualElement(e?: KeyboardEventArgs): void {
        if (this.parent.enableVirtualization || this.parent.enableInfiniteScrolling) {
            let data: { virtualData: Object, isAdd: boolean, isCancel: boolean } = { virtualData: {}, isAdd: false, isCancel: false };
            this.parent.notify(event.getVirtualData, data);
            let isKeyFocus: boolean = this.actions.some((value: string) => value === this.activeKey);
            let isSelected: boolean = this.parent.contentModule ?
                (<{ selectedRowIndex?: number }>this.parent.contentModule).selectedRowIndex > -1 : false;
            if (data.isAdd || Object.keys(data.virtualData).length || isKeyFocus || data.isCancel || isSelected) {
                data.isCancel = false;
                (<{ selectedRowIndex?: number }>this.parent.contentModule).selectedRowIndex = -1;
                if (isKeyFocus) {
                    this.activeKey = this.empty;
                    this.parent.notify('virtaul-key-handler', e);
                }
                // tslint:disable-next-line:no-any
                (this.currentInfo.elementToFocus as any).focus({ preventScroll: true });
            } else {
                this.currentInfo.elementToFocus.focus();
            }
        }
    }

    public getFocusedElement(): HTMLElement {
        return this.currentInfo.elementToFocus;
    }

    public getContent(): IFocus {
        return this.active || this.content;
    }

    public setActive(content: boolean, isFrozen?: boolean): void {
        this.active = content ? isFrozen ? this.fContent : this.content :
            isFrozen ? this.fHeader : this.header;
    }

    public setFocusedElement(element: HTMLElement, e?: KeyboardEventArgs): void {
        this.currentInfo.elementToFocus = element;
        setTimeout(
            () => {
                if (!isNullOrUndefined(this.currentInfo.elementToFocus)) {
                    if (this.parent.enableVirtualization || this.parent.enableInfiniteScrolling) {
                        this.focusVirtualElement(e);
                    } else {
                        this.currentInfo.elementToFocus.focus();
                    }
                }
            },
            0);
    }

    public focus(e?: KeyboardEventArgs): void {
        this.parent.notify(event.virtaulCellFocus, e);
        this.removeFocus();
        this.addFocus(this.getContent().getFocusInfo(), e);
    }

    protected removeFocus(e?: FocusEvent): void {
        if (!this.currentInfo.element) { return; }
        removeClass([this.currentInfo.element, this.currentInfo.elementToFocus], ['e-focused', 'e-focus']);
        this.currentInfo.element.tabIndex = -1;
    }

    /** @hidden */
    public addOutline(): void {
        let info: FocusInfo = this.getContent().getFocusInfo();
        if (info.element) {
            addClass([info.element], ['e-focused']);
            addClass([info.elementToFocus], ['e-focus']);
        }
    }

    /** @hidden */
    public focusHeader(): void {
        this.setActive(false, this.parent.frozenColumns !== 0);
        this.resetFocus();
    }
    /** @hidden */
    public focusContent(): void {
        this.setActive(true, this.parent.frozenColumns !== 0);
        this.resetFocus();
    }

    private resetFocus(): void {
        let current: number[] = this.getContent().matrix.get(0, -1, [0, 1], null, this.getContent().validator());
        this.getContent().matrix.select(current[0], current[1]);
        this.focus();
    }

    protected addFocus(info: FocusInfo, e?: KeyboardEventArgs): void {
        this.currentInfo = info; this.currentInfo.outline = info.outline && !isNullOrUndefined(e);
        if (!info.element) { return; }
        let isFocused: boolean = info.elementToFocus.classList.contains('e-focus');
        if (isFocused) { return; }
        if (this.currentInfo.outline) {
            addClass([info.element], ['e-focused']);
        }
        addClass([info.elementToFocus], ['e-focus']);
        info.element.tabIndex = 0;
        if (!isFocused) {
            this.setFocusedElement(info.elementToFocus, e);
        }
        this.parent.notify(event.cellFocused, {
            element: info.elementToFocus,
            parent: info.element,
            indexes: this.getContent().matrix.current,
            byKey: !isNullOrUndefined(e),
            byClick: isNullOrUndefined(e),
            keyArgs: e,
            isJump: this.swap.swap,
            container: this.getContent().getInfo(e),
            outline: !isNullOrUndefined(e),
            swapInfo: this.swap
        });
        let [rowIndex, cellIndex]: number[] = this.getContent().matrix.current;
        this.prevIndexes = { rowIndex, cellIndex };
        this.focusedColumnUid = this.parent.getColumnByIndex(cellIndex).uid;
        this.focusByClick = false;
    }

    protected refreshMatrix(content?: boolean): Function {
        return (e: { rows: Row<Column>[], args?: NotifyArgs, name?: string }) => {
            if (content && (e.args && e.args.isFrozen) && !this.fContent) {
                this.fContent = new FixedContentFocus(this.parent);
            } else if (content && !this.content) {
                this.content = new ContentFocus(this.parent);
            }
            if (!content && (e.args && e.args.isFrozen) && !this.fHeader) {
                this.fHeader = new FixedHeaderFocus(this.parent);
            } else if (!content && !this.header) {
                this.header = new HeaderFocus(this.parent);
            }
            let cFocus: IFocus = content ? (e.args && e.args.isFrozen) ? this.fContent : this.content :
                (e.args && e.args.isFrozen) ? this.fHeader : this.header;
            let rows: Row<Column>[] = content ? e.rows.slice(this.parent.frozenRows) : e.rows;
            let updateRow: Row<Column>[] = content ? e.rows.slice(0, this.parent.frozenRows) : e.rows;
            if (this.parent.isCollapseStateEnabled() && content) {
                rows = rows.filter((x: Row<Column>) => x.visible !== false);
            }
            let isRowTemplate: boolean = !isNullOrUndefined(this.parent.rowTemplate);
            let matrix: number[][] = cFocus.matrix.generate(updateRow, cFocus.selector, isRowTemplate);
            let frozenColumnsCount: number = this.parent.getFrozenColumns();
            if (e.name === 'batchAdd' && frozenColumnsCount) {
                let mRows: Row<Column>[] = this.parent.getMovableRowsObject();
                let newMovableRows: Row<Column>[] = mRows.map((row: Row<Column>) => { return row.clone(); });
                let newFrozenRows: Row<Column>[] = rows.map((row: Row<Column>) => { return row.clone(); });
                this.fContent.matrix.generate(newFrozenRows, this.fContent.selector, isRowTemplate);
                this.content.matrix.generate(newMovableRows, this.content.selector, isRowTemplate);
            } else {
                cFocus.matrix.generate(rows, cFocus.selector, isRowTemplate);
            }
            cFocus.generateRows(updateRow, { matrix, handlerInstance: (e.args && e.args.isFrozen) ? this.fHeader : this.header });
            if (!Browser.isDevice && e && e.args) {
                if (!this.focusByClick && e.args.requestType === 'paging') {
                    this.skipFocus = false; this.parent.element.focus();
                }
                if (e.args.requestType === 'grouping') {
                    this.skipFocus = true;
                }
            }
            if (e && e.args && e.args.requestType === 'virtualscroll') {
                if (this.currentInfo.uid) {
                    let index: number;
                    let bool: boolean = e.rows.some((row: Row<Column>, i: number) => {
                        index = i;
                        return row.uid === this.currentInfo.uid;
                    });
                    if (bool) {
                        this.content.matrix.current[0] = index;
                        this.content.matrix.current[1] = this.parent.getColumnIndexByUid(this.focusedColumnUid) || 0;
                        let focusElement: HTMLElement = this.getContent().getFocusInfo().elementToFocus;
                        if (focusElement) {
                            let cellPosition: ClientRect = focusElement.getBoundingClientRect();
                            let gridPosition: ClientRect = this.parent.element.getBoundingClientRect();
                            if (cellPosition.top >= 0 && cellPosition.left >= 0 &&
                                cellPosition.right <= Math.min(gridPosition.right, window.innerWidth ||
                                    document.documentElement.clientWidth) &&
                                cellPosition.bottom <= Math.min(gridPosition.bottom, window.innerHeight ||
                                    document.documentElement.clientHeight)) {
                                this.focus();
                            }
                        }
                    }
                } else if (e.args.focusElement && e.args.focusElement.classList.contains('e-filtertext')) {
                    let focusElement: HTMLElement = <HTMLElement>this.parent.element.querySelector('#' + e.args.focusElement.id);
                    if (focusElement) {
                        focusElement.focus();
                    }
                }
            }
        };
    }

    public addEventListener(): void {
        if (this.parent.isDestroyed) { return; }
        EventHandler.add(this.parent.element, 'mousedown', this.focusCheck, this);
        EventHandler.add(this.parent.element, 'focus', this.onFocus, this);
        this.parent.element.addEventListener('focus', this.passiveHandler = (e: FocusEvent) => this.passiveFocus(e), true);
        EventHandler.add(this.parent.element, 'focusout', this.onBlur, this);
        this.parent.on(event.keyPressed, this.onKeyPress, this);
        this.parent.on(event.click, this.onClick, this);
        this.parent.on(event.contentReady, this.refMatrix, this);
        this.parent.on(event.partialRefresh, this.refMatrix, this);
        this.parent.on(event.headerRefreshed, this.refreshMatrix(), this);
        this.parent.on('close-edit', this.restoreFocus, this);
        this.parent.on('restore-Focus', this.restoreFocus, this);
        let evts: string[] = ['start-edit', 'start-add'];
        for (let i: number = 0; i < evts.length; i++) {
            this.parent.on(evts[i], this.clearIndicator, this);
        }
        this.parent.on('sorting-complete', this.restoreFocus, this);
        this.parent.on('filtering-complete', this.filterfocus, this);
        let actionsG: string[] = ['grouping', 'ungrouping'];
        for (let k: number = 0; k < actionsG.length; k++) {
            this.parent.on(`${actionsG[k]}-complete`, this.restoreFocusWithAction, this);
        }
        this.parent.on(event.batchAdd, this.refMatrix, this);
        this.parent.on(event.batchCancel, this.refMatrix, this);
        this.parent.on(event.batchDelete, this.refMatrix, this);
        this.parent.on(event.detailDataBound, this.refMatrix, this);
        this.parent.on(event.onEmpty, this.refMatrix, this);
        this.parent.on(event.cellFocused, this.internalCellFocus, this);
    }

    public filterfocus(): void {
        if (this.parent.filterSettings.type !== 'FilterBar') {
            this.restoreFocus();
        }
    }

    public removeEventListener(): void {
        if (this.parent.isDestroyed) { return; }
        EventHandler.remove(this.parent.element, 'mousedown', this.focusCheck);
        EventHandler.remove(this.parent.element, 'focus', this.onFocus);
        EventHandler.remove(this.parent.element, 'focusout', this.onBlur);
        this.parent.element.removeEventListener('focus', this.passiveHandler, true);
        this.parent.off(event.keyPressed, this.onKeyPress);
        this.parent.off(event.click, this.onClick);
        this.parent.off(event.contentReady, this.refMatrix);
        this.parent.off(event.partialRefresh, this.refMatrix);
        this.parent.off(event.headerRefreshed, this.refreshMatrix());
        this.parent.off('close-edit', this.restoreFocus);
        this.parent.off('restore-focus', this.restoreFocus);
        let evts: string[] = ['start-edit', 'start-add'];
        for (let i: number = 0; i < evts.length; i++) {
            this.parent.off(evts[i], this.clearOutline);
        }
        this.parent.off('sorting-complete', this.restoreFocus);
        this.parent.off('filtering-complete', this.filterfocus);
        let actionsG: string[] = ['grouping', 'ungrouping'];
        for (let k: number = 0; k < actionsG.length; k++) {
            this.parent.on(`${actionsG[k]}-complete`, this.restoreFocusWithAction);
        }
        this.parent.off(event.batchAdd, this.refMatrix);
        this.parent.off(event.batchDelete, this.refMatrix);
        this.parent.off(event.batchCancel, this.refMatrix);
        this.parent.off(event.detailDataBound, this.refMatrix);
        this.parent.off(event.onEmpty, this.refMatrix);
        this.parent.off(event.cellFocused, this.internalCellFocus);
    }

    public destroy(): void {
        this.removeEventListener();
    }

    public restoreFocus(): void {
        this.addFocus(this.getContent().getFocusInfo());
    }

    public restoreFocusWithAction(e: NotifyArgs): void {
        if (!this.parent.enableInfiniteScrolling) {
            let matrix: Matrix = this.getContent().matrix;
            let current: number[] = matrix.current;
            switch (e.requestType) {
                case 'grouping':
                case 'ungrouping':
                    current[1] = current.length &&
                        !this.parent.groupSettings.showGroupedColumn && !isNullOrUndefined(matrix.matrix[current[0]]) ?
                        matrix.matrix[current[0]].indexOf(1) : e.requestType === 'grouping' ? current[1] + 1 : current[1] - 1;
                    break;
            }
            this.getContent().matrix.current = current;
            this.addFocus(this.getContent().getFocusInfo());
        }
    }

    public clearOutline(): void {
        this.getContent().matrix.current = this.getContent().matrix.get(0, -1, [0, 1], 'downArrow', this.getContent().validator());
        this.clearIndicator();
    }

    public clearIndicator(): void {
        if (!this.currentInfo.element || !this.currentInfo.elementToFocus) { return; }
        removeClass([this.currentInfo.element, this.currentInfo.elementToFocus], ['e-focus', 'e-focused']);
    }

    public getPrevIndexes(): IIndex {
        let forget: boolean = this.forget; this.forget = false;
        return forget || !Object.keys(this.prevIndexes).length ? { rowIndex: null, cellIndex: null } : this.prevIndexes;
    }

    public forgetPrevious(): void {
        this.forget = true;
    }

    public setActiveByKey(action: string, active: IFocus): void {
        if (this.parent.frozenColumns === 0 && this.parent.frozenRows === 0) {
            return;
        }
        let info: FocusedContainer;
        let actions: { [x: string]: Function } = {
            'home': () => ({ toHeader: !info.isContent, toFrozen: true }),
            'end': () => ({ toHeader: !info.isContent, toFrozen: false }),
            'ctrlHome': () => ({ toHeader: true, toFrozen: this.parent.frozenColumns !== 0 }),
            'ctrlEnd': () => ({ toHeader: false, toFrozen: false })
        };
        if (!(action in actions)) { return; }
        info = active.getInfo();
        let swap: SwapInfo = actions[action]();
        this.setActive(!swap.toHeader, swap.toFrozen);
        this.getContent().matrix.current = active.matrix.current;
    }

    public internalCellFocus(e: CellFocusArgs): void {
        if (!(e.byKey && e.container.isContent && e.keyArgs.action === 'enter'
            && (e.parent.classList.contains('e-detailcell') ||
                e.parent.classList.contains('e-unboundcell') || e.parent.classList.contains('e-templatecell')))) {
            return;
        }
        this.clearIndicator();
        let focusEle: HTMLElement = this.getContent().getFocusable(this.getFocusedElement());
        this.setFocusedElement(focusEle);
        this.currentInfo.skipAction = true;
    }
}

/**
 * Create matrix from row collection which act as mental model for cell navigation
 * @hidden
 */
export class Matrix {
    public matrix: number[][] = [];
    public current: number[] = [];
    public columns: number;
    public rows: number;

    public set(rowIndex: number, columnIndex: number, allow?: boolean): void {
        rowIndex = Math.max(0, Math.min(rowIndex, this.rows));
        columnIndex = Math.max(0, Math.min(columnIndex, this.columns));
        this.matrix[rowIndex] = this.matrix[rowIndex] || [];
        this.matrix[rowIndex][columnIndex] = allow ? 1 : 0;
    }

    public get(rowIndex: number, columnIndex: number, navigator: number[], action?: string, validator?: Function): number[] {
        let tmp: number = columnIndex; if (rowIndex + navigator[0] < 0) { return [rowIndex, columnIndex]; }
        rowIndex = Math.max(0, Math.min(rowIndex + navigator[0], this.rows));
        let emptyTable: boolean = true;
        if (isNullOrUndefined(this.matrix[rowIndex])) { return null; }
        columnIndex = Math.max(0, Math.min(columnIndex + navigator[1], this.matrix[rowIndex].length - 1));
        if (tmp + navigator[1] > this.matrix[rowIndex].length - 1 && validator(rowIndex, columnIndex, action)) { return [rowIndex, tmp]; }
        let first: number = this.first(this.matrix[rowIndex], columnIndex, navigator, true, action);
        columnIndex = first === null ? tmp : first;
        let val: number = getValue(`${rowIndex}.${columnIndex}`, this.matrix);
        if (rowIndex === this.rows && (action === 'downArrow' || action === 'enter')) {
            navigator[0] = -1;
        }
        if (first === null) {
            rowIndex = this.current[0];
            for (let i: number = 0; i < this.rows; i++) {
                if (this.matrix[i].some((v: number) => { return v === 1; })) {
                    emptyTable = false;
                    break;
                }
            }
            if (emptyTable) {
                return [rowIndex, columnIndex];
            }
        }
        return this.inValid(val) || !validator(rowIndex, columnIndex, action) ?
            this.get(rowIndex, tmp, navigator, action, validator) : [rowIndex, columnIndex];
    }

    public first(vector: number[], index: number, navigator: number[], moveTo?: boolean, action?: string): number {
        if (((index < 0 || index === vector.length) && this.inValid(vector[index])
            && (action !== 'upArrow' && action !== 'downArrow')) || !vector.some((v: number) => v === 1)) {
            return null;
        }
        return !this.inValid(vector[index]) ? index :
            this.first(
                vector,
                (['upArrow', 'downArrow', 'shiftUp', 'shiftDown'].indexOf(action) !== -1) ? moveTo ? 0 : ++index : index + navigator[1],
                navigator, false, action);
    }

    public select(rowIndex: number, columnIndex: number): void {
        rowIndex = Math.max(0, Math.min(rowIndex, this.rows));
        columnIndex = Math.max(0, Math.min(columnIndex, this.matrix[rowIndex].length - 1));
        this.current = [rowIndex, columnIndex];
    }

    public generate(rows: Row<Column>[], selector: Function, isRowTemplate?: boolean): number[][] {
        this.rows = rows.length - 1; this.matrix = [];
        for (let i: number = 0; i < rows.length; i++) {
            let cells: Cell<Column>[] = rows[i].cells.filter((c: Cell<Column>) => c.isSpanned !== true);
            this.columns = Math.max(cells.length - 1, this.columns | 0);
            for (let j: number = 0; j < cells.length; j++) {
                this.set(i, j, selector(rows[i], cells[j], isRowTemplate));
            }
        }
        return this.matrix;
    }

    public inValid(value: number): boolean {
        return value === 0 || value === undefined;
    }
}
/**
 * @hidden
 */
export class ContentFocus implements IFocus {
    public matrix: Matrix = new Matrix();
    public parent: IGrid;
    public keyActions: { [x: string]: number[] };
    public indexesByKey: (action: string) => number[];
    constructor(parent: IGrid) {
        this.parent = parent;
        this.keyActions = {
            'rightArrow': [0, 1],
            'tab': [0, 1],
            'leftArrow': [0, -1],
            'shiftTab': [0, -1],
            'upArrow': [-1, 0],
            'downArrow': [1, 0],
            'shiftUp': [-1, 0],
            'shiftDown': [1, 0],
            'shiftRight': [0, 1],
            'shiftLeft': [0, -1],
            'enter': [1, 0],
            'shiftEnter': [-1, 0]
        };
        this.indexesByKey = (action: string) => {
            let opt: Object = {
                'home': [this.matrix.current[0], -1, 0, 1],
                'end': [this.matrix.current[0], this.matrix.columns + 1, 0, -1],
                'ctrlHome': [0, -1, 0, 1],
                'ctrlEnd': [this.matrix.rows, this.matrix.columns + 1, 0, -1]
            };
            return opt[action] || null;
        };
    }

    public getTable(): HTMLTableElement {
        return <HTMLTableElement>(this.parent.getFrozenColumns() ?
            this.parent.getContent().querySelector('.e-movablecontent .e-table') :
            this.parent.getContentTable());
    }

    public onKeyPress(e: KeyboardEventArgs): void | boolean {
        let navigator: number[] = this.keyActions[e.action];
        let current: number[] = this.getCurrentFromAction(e.action, navigator, e.action in this.keyActions, e);
        if (!current) { return; }
        if ((['tab', 'shiftTab'].indexOf(e.action) > -1 && this.matrix.current || []).toString() === current.toString()) {
            if (current.toString() === [this.matrix.rows, this.matrix.columns].toString() ||
                current.toString() === [0, 0].toString() || (this.matrix.current[0] === this.matrix.rows &&
                    this.matrix.current.toString() === current.toString())) {
                return false;
            } else {
                current = this.editNextRow(current[0], current[1], e.action);
            }
        }
        this.matrix.select(current[0], current[1]);
    }

    private editNextRow(rowIndex: number, cellIndex: number, action: string): number[] {
        let gObj: IGrid = this.parent;
        let editNextRow: boolean = gObj.editSettings.allowNextRowEdit && (gObj.isEdit || gObj.isLastCellPrimaryKey);
        let visibleIndex: number = gObj.getColumnIndexByField(gObj.getVisibleColumns()[0].field);
        let cell: HTMLElement = this.getTable().rows[rowIndex].cells[cellIndex];
        if (action === 'tab' && editNextRow) {
            rowIndex++;
            let index: number = (this.getTable().rows[rowIndex].querySelectorAll('.e-indentcell').length +
                this.getTable().rows[rowIndex].querySelectorAll('.e-detailrowcollapse').length);
            cellIndex = visibleIndex + index;
        }
        if (action === 'shiftTab' && editNextRow) {
            rowIndex--;
            cellIndex = gObj.getColumnIndexByField(gObj.getVisibleColumns()[gObj.getVisibleColumns().length - 1].field);
        }
        return !cell.classList.contains('e-rowcell') && !cell.classList.contains('e-headercell') &&
        !cell.classList.contains('e-groupcaption') ?
            this.editNextRow(rowIndex, cellIndex, action) : [rowIndex, cellIndex];
    }

    public getCurrentFromAction(action: string, navigator: number[] = [0, 0], isPresent?: boolean, e?: KeyboardEventArgs): number[] {
        if (!isPresent && !this.indexesByKey(action) || (this.matrix.current.length === 0)) { return null; }
        if (!this.shouldFocusChange(e)) { return this.matrix.current; }
        let [rowIndex, cellIndex, rN, cN]: number[] = this.indexesByKey(action) || [...this.matrix.current, ...navigator];
        let current: number[] = this.matrix.get(rowIndex, cellIndex, [rN, cN], action, this.validator());
        return current;
    }

    public onClick(e: Event, force?: boolean): void | boolean {
        let target: HTMLTableCellElement = <HTMLTableCellElement>e.target;
        target = <HTMLTableCellElement>(target.classList.contains('e-rowcell') ? target : closest(target, 'td'));
        target = target ? target : <HTMLTableCellElement>closest(<Element>e.target, 'td.e-detailrowcollapse')
            || <HTMLTableCellElement>closest(<Element>e.target, 'td.e-detailrowexpand');
        target = <HTMLTableCellElement>closest(<Element>e.target, 'td.e-detailcell') ?
            isNullOrUndefined(closest(closest(<Element>e.target, '.e-grid'), 'td.e-detailcell')) ? null : target : target;
        target = target && closest(target, 'table').classList.contains('e-table') ? target : null;
        if (!target) { return false; }
        let [rowIndex, cellIndex]: number[] = [(<HTMLTableRowElement>target.parentElement).rowIndex, target.cellIndex];
        let [oRowIndex, oCellIndex]: number[] = this.matrix.current;
        let val: number = getValue(`${rowIndex}.${cellIndex}`, this.matrix.matrix);
        if (this.matrix.inValid(val) || (!force && oRowIndex === rowIndex && oCellIndex === cellIndex) ||
            (!parentsUntil(e.target as Element, 'e-rowcell') && !parentsUntil(e.target as Element, 'e-groupcaption'))) { return false; }
        this.matrix.select(rowIndex, cellIndex);
    }

    public getFocusInfo(): FocusInfo {
        let info: FocusInfo = {}; let [rowIndex = 0, cellIndex = 0]: number[] = this.matrix.current;
        this.matrix.current = [rowIndex, cellIndex];
        info.element = !isNullOrUndefined(this.getTable().rows[rowIndex]) ? this.getTable().rows[rowIndex].cells[cellIndex] : null;
        if (!info.element) {
            return info;
        }
        info.elementToFocus = !info.element.classList.contains('e-unboundcell') && !info.element.classList.contains('e-detailcell')
            ? this.getFocusable(info.element) : info.element;
        info.outline = true;
        info.uid = info.element.parentElement.getAttribute('data-uid');
        return info;
    }

    public getFocusable(element: HTMLElement): HTMLElement {
        let query: string = 'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';
        if (this.parent.isEdit) {
            query = 'input:not([type="hidden"]), select:not([aria-hidden="true"]), textarea';
        }
        let child: HTMLElement[] = [].slice.call(element.querySelectorAll(query));

        /* Select the first focusable child element
         * if no child found then select the cell itself.
         * if Grid is in editable state, check for editable control inside child.
         */
        return child.length ? child[0] : element;
    }

    public selector(row: Row<Column>, cell: Cell<Column>, isRowTemplate?: boolean): boolean {
        let types: CellType[] = [CellType.Expand, CellType.GroupCaption, CellType.CaptionSummary, CellType.GroupSummary];
        return ((row.isDataRow && cell.visible && (cell.isDataCell || cell.isTemplate))
            || (row.isDataRow && cell.cellType === CellType.DetailExpand && isNullOrUndefined(cell.visible))
            || (!row.isDataRow && types.indexOf(cell.cellType) > -1)
            || (cell.column && cell.column.type === 'checkbox')
            || (cell.cellType === CellType.CommandColumn)
            || (row.isDataRow && isRowTemplate))
            && !(row.edit === 'delete' && row.isDirty);
    }

    public jump(action: string, current: number[]): SwapInfo {
        let frozenSwap: boolean = this.parent.frozenColumns > 0 &&
            ((action === 'leftArrow' || action === 'shiftTab') && current[1] === 0);
        let enterFrozen: boolean = this.parent.frozenRows !== 0 && action === 'shiftEnter';
        if (action === 'tab' && !this.parent.isEdit &&
            current[1] === this.matrix.matrix[current[0]].lastIndexOf(1) && this.matrix.matrix.length - 1 !== current[0]) {
            this.matrix.current[0] = this.matrix.current[0] + 1;
            this.matrix.current[1] = -1;
            frozenSwap = this.parent.frozenColumns > 0;
        }
        if (action === 'shiftTab' && !this.parent.isEdit &&
            current[0] !== 0 && this.matrix.matrix[current[0]].indexOf(1) === current[1]) {
            this.matrix.current[0] = this.matrix.current[0] - 1;
            this.matrix.current[1] = this.matrix.matrix[current[0]].length;
        }
        let isHeaderFocus: boolean = false;
        let row: Element = document.activeElement.parentElement;
        if ((this.parent.enableVirtualization || this.parent.infiniteScrollSettings.enableCache)
            && row.classList.contains('e-row')) {
            let rowIndex: number = parseInt(row.getAttribute('aria-rowindex'), 10);
            isHeaderFocus = rowIndex > 0;
        }
        let info: SwapInfo = {
            swap: !isHeaderFocus ? ((action === 'upArrow' || enterFrozen) && current[0] === 0) || frozenSwap : false,
            toHeader: (action === 'upArrow' || enterFrozen) && current[0] === 0,
            toFrozen: frozenSwap
        };
        return info;
    }

    public getNextCurrent(previous: number[] = [], swap?: SwapInfo, active?: IFocus, action?: string): number[] {
        let current: number[] = [];
        if (action === 'rightArrow' || action === 'tab') {
            current[0] = previous[0];
            current[1] = -1;
        } else if (action === 'downArrow' || action === 'enter') {
            current[0] = -1;
            current[1] = previous[1];
        }
        return current;
    }

    public generateRows(rows?: Row<Column>[], optionals?: Object): void {
        let { matrix, handlerInstance }: { matrix?: number[][], handlerInstance?: IFocus } = optionals;
        let len: number = handlerInstance.matrix.matrix.length;
        let defaultLen: number = this.parent.allowFiltering && this.parent.filterSettings.type === 'FilterBar' ? len + 1 : len;
        handlerInstance.matrix.matrix = handlerInstance.matrix.matrix.slice(0, defaultLen); //Header matrix update.
        handlerInstance.matrix.rows = defaultLen;
        handlerInstance.matrix.matrix.push(...matrix);
        handlerInstance.matrix.rows += matrix.length;
    }

    public getInfo(e?: KeyboardEventArgs): FocusedContainer {
        let info: FocusInfo = this.getFocusInfo(); let [rIndex, cIndex]: number[] = this.matrix.current;
        let isData: boolean = info.element.classList.contains('e-rowcell');
        let isSelectable: boolean = isData || (e && e.action !== 'enter' && (info.element.classList.contains('e-detailrowcollapse')
            || info.element.classList.contains('e-detailrowexpand')));
        let [rowIndex, cellIndex]: number[] = [Math.min(parseInt(info.element.parentElement.getAttribute('aria-rowindex'), 10), rIndex),
        Math.min(parseInt(info.element.getAttribute('aria-colindex'), 10), cIndex)];
        return { isContent: true, isDataCell: isData, indexes: [rowIndex, cellIndex], isSelectable: isSelectable };
    }

    public validator(): Function {
        let table: HTMLTableElement = this.getTable();
        return (rowIndex: number, cellIndex: number, action?: string) => {
            if (!isNullOrUndefined(table.rows[rowIndex])) {
                let cell: HTMLElement;
                cellIndex = table.querySelector('.e-emptyrow') ? 0 : cellIndex;
                if (table.rows[rowIndex].cells[0].classList.contains('e-editcell')) {
                    cell = table.rows[rowIndex].cells[0].querySelectorAll('td')[cellIndex];
                } else {
                    cell = table.rows[rowIndex].cells[cellIndex];
                }
                let isCellWidth: boolean = cell.getBoundingClientRect().width !== 0;
                if (action === 'enter' || action === 'shiftEnter') {
                    return isCellWidth && cell.classList.contains('e-rowcell');
                }
                if ((action === 'shiftUp' || action === 'shiftDown') && cell.classList.contains('e-rowcell')) {
                    return isCellWidth;
                } else if (action !== 'shiftUp' && action !== 'shiftDown') {
                    return isCellWidth;
                }
            }
            return false;
        };
    }

    protected shouldFocusChange(e: KeyboardEventArgs): boolean {
        let [rIndex = -1, cIndex = -1]: number[] = this.matrix.current;
        if (rIndex < 0 || cIndex < 0) { return true; }
        let cell: Element = getValue(`${rIndex}.cells.${cIndex}`, this.getTable().rows);
        if (!cell) { return true; }
        return e.action === 'enter' || e.action === 'shiftEnter' ?
            cell.classList.contains('e-rowcell') && !cell.classList.contains('e-unboundcell')
            && (!cell.classList.contains('e-templatecell') || cell.classList.contains('e-editedbatchcell'))
            && !cell.classList.contains('e-detailcell') : true;
    }
}
/**
 * @hidden
 */
export class HeaderFocus extends ContentFocus implements IFocus {
    constructor(parent: IGrid) {
        super(parent);
    }

    public getTable(): HTMLTableElement {
        return <HTMLTableElement>(this.parent.getFrozenColumns() ?
            this.parent.getHeaderContent().querySelector('.e-movableheader .e-table') :
            this.parent.getHeaderTable());
    }

    public onClick(e: Event): void | boolean {
        let target: HTMLTableCellElement = <HTMLTableCellElement>e.target;
        target = <HTMLTableCellElement>(target.classList.contains('e-headercell') ? target : closest(target, 'th'));
        if (!target && this.parent.frozenRows !== 0) {
            target = <HTMLTableCellElement>((<HTMLElement>e.target).classList.contains('e-rowcell') ? e.target :
                closest(<Element>e.target, 'td'));
        }
        if ((e.target as HTMLElement).classList.contains('e-columnheader') ||
            (e.target as HTMLElement).querySelector('.e-stackedheadercell')) {
            return false;
        }
        if (!target) { return; }
        let [rowIndex, cellIndex]: number[] = [(<HTMLTableRowElement>target.parentElement).rowIndex, target.cellIndex];
        let val: number = getValue(`${rowIndex}.${cellIndex}`, this.matrix.matrix);
        if (this.matrix.inValid(val)) { return false; }
        this.matrix.select((<HTMLTableRowElement>target.parentElement).rowIndex, target.cellIndex);
    }

    public getFocusInfo(): FocusInfo {
        let info: FocusInfo = {}; let [rowIndex = 0, cellIndex = 0]: number[] = this.matrix.current;
        info.element = this.getTable().rows[rowIndex].cells[cellIndex];
        if (!isNullOrUndefined(info.element)) {
            info.elementToFocus = this.getFocusable(info.element);
            info.outline = !info.element.classList.contains('e-filterbarcell');
        }
        return info;
    }

    public selector(row: Row<Column>, cell: Cell<Column>): boolean {
        return (cell.visible && (cell.column.field !== undefined || cell.isTemplate || !isNullOrUndefined(cell.column.template))) ||
            cell.column.type === 'checkbox' || cell.cellType === CellType.StackedHeader;
    }

    public jump(action: string, current: number[]): SwapInfo {
        let frozenSwap: boolean = this.parent.frozenColumns > 0 &&
            (action === 'leftArrow' || action === 'shiftTab') && current[1] === 0;
        let enterFrozen: boolean = this.parent.frozenRows !== 0 && action === 'enter';
        let isLastCell: boolean;
        let lastRow: boolean;
        let headerSwap: boolean = frozenSwap;
        let fMatrix: number[][] = this.parent.focusModule.fHeader && this.parent.focusModule.fHeader.matrix.matrix;
        let isPresent: boolean = fMatrix && !isNullOrUndefined(fMatrix[current[0]]);
        if (this.parent.enableHeaderFocus && action === 'tab') {
            lastRow = this.matrix.matrix.length - 1 === current[0];
            isLastCell = current[1] === this.matrix.matrix[current[0]].lastIndexOf(1);
            if (isLastCell) {
                if (!lastRow) {
                    this.matrix.current[0] = this.matrix.current[0] + 1;
                } else {
                    this.matrix.current[0] = 0;
                }
                this.matrix.current[1] = -1;
            }

            if (this.parent.frozenColumns > 0 && lastRow && isLastCell) {
                frozenSwap = true;
                headerSwap = false;
            }
        }
        return {
            swap: ((action === 'downArrow' || enterFrozen) && current[0] === this.matrix.matrix.length - 1) ||
                (isPresent && frozenSwap) || (action === 'tab' && lastRow && isLastCell),
            toHeader: headerSwap,
            toFrozen: frozenSwap
        };
    }

    public getNextCurrent(previous: number[] = [], swap?: SwapInfo, active?: IFocus, action?: string): number[] {
        let current1: number[] = [];
        if (action === 'upArrow' || action === 'shiftEnter') {
            current1[0] = this.matrix.matrix.length;
            current1[1] = previous[1];
        } else if (action === 'rightArrow' || action === 'tab') {
            current1[0] = previous[0];
            current1[1] = -1;
        }
        return current1;
    }

    public generateRows(rows?: Row<Column>[]): void {
        let length: number = this.matrix.matrix.length;
        if (this.parent.allowFiltering && this.parent.filterSettings.type === 'FilterBar') {
            this.matrix.rows = ++this.matrix.rows;
            let cells: Cell<Column>[] = rows[0].cells;
            for (let i: number = 0; i < cells.length; i++) {
                this.matrix.set(length, i, cells[i].visible && cells[i].column.allowFiltering !== false);
            }
        }
    }

    public getInfo(e?: KeyboardEventArgs): FocusedContainer {
        return extend(super.getInfo(e), { isContent: false, isHeader: true });
    }

    public validator(): Function {
        return () => true;
    }
    protected shouldFocusChange(e: KeyboardEventArgs): boolean {
        let [rowIndex, columnIndex]: number[] = this.matrix.current;
        if (rowIndex < 0 || columnIndex < 0) { return true; }
        let cell: Element = getValue(`${rowIndex}.cells.${columnIndex}`, this.getTable().rows);
        if (!cell) {
            return true;
        }
        return e.action === 'enter' || e.action === 'altDownArrow' ? !cell.classList.contains('e-headercell') : true;
    }
}

export class FixedContentFocus extends ContentFocus {

    public getTable(): HTMLTableElement {
        return <HTMLTableElement>this.parent.getContent().querySelector('.e-frozencontent .e-table');
    }

    public jump(action: string, current: number[]): SwapInfo {
        let enterFrozen: boolean = this.parent.frozenRows !== 0 && action === 'shiftEnter';
        return {
            swap: (action === 'upArrow' || enterFrozen) && current[0] === 0
                || ((action === 'tab' || action === 'rightArrow') && current[1] === this.matrix.columns),
            toHeader: (action === 'upArrow' || enterFrozen) && current[0] === 0,
            toFrozen: (action === 'upArrow' || enterFrozen) && current[0] === 0
        };
    }

    public getNextCurrent(previous: number[] = [], swap?: SwapInfo, active?: IFocus, action?: string): number[] {
        let current2: number[] = [];
        if (action === 'tab' && this.parent.enableHeaderFocus) {
            current2[0] = previous[0];
            current2[1] = -1;
        }
        if (action === 'leftArrow' || action === 'shiftTab') {
            current2[0] = previous[0];
            current2[1] = active.matrix.columns + 1;
        } else if (action === 'downArrow' || action === 'enter') {
            current2[0] = -1;
            current2[1] = previous[1];
        }
        return current2;
    }
}

export class FixedHeaderFocus extends HeaderFocus {
    public jump(action: string, current: number[]): SwapInfo {
        let enterFrozen: boolean = this.parent.frozenRows !== 0 && action === 'enter';
        let hMatrix: number[][] = this.parent.focusModule.header && this.parent.focusModule.header.matrix.matrix;
        let isPresent: boolean = hMatrix && !isNullOrUndefined(hMatrix[current[0]]);
        return {
            swap: (action === 'downArrow' || enterFrozen) && current[0] === this.matrix.matrix.length - 1
            || ((action === 'rightArrow' || action === 'tab') && current[1] === this.matrix.columns && isPresent),
            toHeader: (action === 'rightArrow' || action === 'tab') && current[1] === this.matrix.columns,
            toFrozen: (action === 'downArrow' || enterFrozen) && current[0] === this.matrix.matrix.length - 1
        };
    }
    public getTable(): HTMLTableElement {
        return <HTMLTableElement>(this.parent.getHeaderContent().querySelector('.e-frozenheader .e-table'));
    }

    public getNextCurrent(previous: number[] = [], swap?: SwapInfo, active?: IFocus, action?: string): number[] {
        let current3: number[] = [];
        if (action === 'leftArrow' || action === 'shiftTab') {
            current3[0] = previous[0];
            current3[1] = active.matrix.columns + 1;
        } else if (action === 'upArrow' || action === 'shiftEnter') {
            current3[0] = this.matrix.matrix.length;
            current3[1] = previous[1];
        }
        return current3;
    }
}

/** @hidden */
export class SearchBox {
    public searchBox: HTMLElement;

    constructor(searchBox: HTMLElement) {
        this.searchBox = searchBox;
    }

    protected searchFocus(args: Event): void {
        (<HTMLInputElement>args.target).parentElement.classList.add('e-input-focus');
    }

    protected searchBlur(args: Event): void {
        (<HTMLInputElement>args.target).parentElement.classList.remove('e-input-focus');
    }

    public wireEvent(): void {
        if (this.searchBox) {
            EventHandler.add(this.searchBox, 'focus', this.searchFocus, this);
            EventHandler.add(this.searchBox, 'blur', this.searchBlur, this);
        }
    }

    public unWireEvent(): void {
        if (this.searchBox) {
            EventHandler.remove(this.searchBox, 'focus', this.searchFocus);
            EventHandler.remove(this.searchBox, 'blur', this.searchBlur);
        }
    }
}
