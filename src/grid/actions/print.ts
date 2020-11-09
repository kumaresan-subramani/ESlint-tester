import { print as printWindow, createElement, detach, classList } from '@syncfusion/ej2-base';
import { IGrid, PrintEventArgs } from '../base/interface';
import { getPrintGridModel } from '../base/util';
import { Scroll } from '../actions/scroll';
import { Grid } from '../base/grid';
import * as events from '../base/constant';
import { Deferred } from '@syncfusion/ej2-data';

/**
 * @hidden
 */
export function getCloneProperties(): string[] {
    return ['aggregates', 'allowGrouping', 'allowFiltering', 'allowMultiSorting', 'allowReordering', 'allowSorting',
        'allowTextWrap', 'childGrid', 'columns', 'currentViewData', 'dataSource', 'detailTemplate', 'enableAltRow',
        'enableColumnVirtualization', 'filterSettings', 'gridLines',
        'groupSettings', 'height', 'locale', 'pageSettings', 'printMode', 'query', 'queryString', 'enableRtl',
        'rowHeight', 'rowTemplate', 'sortSettings', 'textWrapSettings', 'allowPaging', 'hierarchyPrintMode', 'searchSettings',
        'queryCellInfo', 'beforeDataBound'];
}

/**
 * 
 * The `Print` module is used to handle print action.
 */
export class Print {

    //Module declarations
    private parent: IGrid;
    private printWind: Window;
    private scrollModule: Scroll;
    private isAsyncPrint: boolean = false;
    public static printGridProp: string[] = [...getCloneProperties(), events.beforePrint, events.printComplete, events.load];

    private defered: Deferred = new Deferred();

    /**
     * Constructor for the Grid print module
     * @hidden
     */
    constructor(parent?: IGrid, scrollModule?: Scroll) {
        this.parent = parent;
        if (this.parent.isDestroyed) { return; }
        this.parent.on(events.contentReady, this.isContentReady(), this);
        this.parent.addEventListener(events.actionBegin, this.actionBegin.bind(this));
        this.parent.on(events.onEmpty, this.onEmpty.bind(this));
        this.parent.on(events.hierarchyPrint, this.hierarchyPrint, this);
        this.scrollModule = scrollModule;
    }

    private isContentReady(): Function {
        if (this.isPrintGrid() && (this.parent.hierarchyPrintMode === 'None' || !this.parent.childGrid) ) {
            return this.contentReady;
        }
        return () => {
            this.defered.promise.then(() => {
                this.contentReady();
            });
            if (this.isPrintGrid()) {
                this.hierarchyPrint();
            }
        };
    }

    private hierarchyPrint(): void {
        this.removeColGroup(this.parent);
        let printGridObj: IGrid = (<{printGridObj?: IGrid}>window).printGridObj;
        if (printGridObj && !printGridObj.element.querySelector('[aria-busy=true')) {
            printGridObj.printModule.defered.resolve();
        }
    }

    /**
     * By default, prints all the Grid pages and hides the pager. 
     * > You can customize print options using the 
     * [`printMode`](grid/#printmode-string/). 
     * @return {void}
     */
    public print(): void {
        this.renderPrintGrid();
        this.printWind = window.open('', 'print', 'height=' + window.outerHeight + ',width=' + window.outerWidth + ',tabbar=no');
        this.printWind.moveTo(0, 0);
        this.printWind.resizeTo(screen.availWidth, screen.availHeight);
    }

    private onEmpty(): void {
        if (this.isPrintGrid()) {
            this.contentReady();
        }
    }
    private actionBegin(): void {
        if (this.isPrintGrid()) {
            this.isAsyncPrint = true;
        }
    }
    private renderPrintGrid(): void {
        let gObj: IGrid = this.parent;
        let element: HTMLElement = createElement('div', {
            id: this.parent.element.id + '_print', className: gObj.element.className + ' e-print-grid'
        });
        document.body.appendChild(element);
        let printGrid: IGrid = new Grid(getPrintGridModel(gObj, gObj.hierarchyPrintMode) as Object);
        /* tslint:disable-next-line:no-any */
        if ((this.parent as any).isAngular ) {
            /* tslint:disable-next-line:no-any */
            (printGrid as any).viewContainerRef = (this.parent as any).viewContainerRef;
        }
        /* tslint:disable:no-empty */
        (printGrid as Grid).load = () => {};
        printGrid.query = gObj.getQuery().clone();
        (<{printGridObj?: IGrid}>window).printGridObj = printGrid;
        printGrid.isPrinting = true;
        let modules: Function[] = printGrid.getInjectedModules();
        let injectedModues: Function[] = gObj.getInjectedModules();
        if (!modules || modules.length !== injectedModues.length) {
            (printGrid as Grid).setInjectedModules(injectedModues);
        }
        gObj.notify(events.printGridInit, { element: element, printgrid: printGrid });
        this.parent.log('exporting_begin', this.getModuleName());
        printGrid.registeredTemplate = this.parent.registeredTemplate;
        printGrid.appendTo(element as HTMLElement);
        printGrid.trigger = gObj.trigger;
    }

    private contentReady(): void {
        if (this.isPrintGrid()) {
            let gObj: IGrid = this.parent;
            if (this.isAsyncPrint) {
                this.printGrid();
                return;
            }
            let args: PrintEventArgs = {
                requestType: 'print',
                element: gObj.element,
                selectedRows: gObj.getContentTable().querySelectorAll('tr[aria-selected="true"]'),
                cancel: false,
                hierarchyPrintMode: gObj.hierarchyPrintMode
            };
            if (!this.isAsyncPrint) {
                gObj.trigger(events.beforePrint, args);
            }
            if (args.cancel) {
                detach(gObj.element);
                return;
            }
            if (!this.isAsyncPrint) {
                this.printGrid();
            }
        }
    }

    private printGrid(): void {
        let gObj: IGrid = this.parent;
        // Height adjustment on print grid
        if (gObj.height !== 'auto') { // if scroller enabled
            let cssProps: {
                padding?: string,
                border?: string
            } = this.scrollModule.getCssProperties();
            let contentDiv: HTMLElement = (gObj.element.querySelector('.e-content') as HTMLElement);
            let headerDiv: HTMLElement = (<HTMLElement>gObj.element.querySelector('.e-gridheader'));
            contentDiv.style.height = 'auto';
            contentDiv.style.overflowY = 'auto';
            headerDiv.style[cssProps.padding] = '';
            (headerDiv.firstElementChild as HTMLElement).style[cssProps.border] = '';
        }
        // Grid alignment adjustment on grouping
        if (gObj.allowGrouping) {
            if (!gObj.groupSettings.columns.length) {
                (gObj.element.querySelector('.e-groupdroparea') as HTMLElement).style.display = 'none';
            } else {
                this.removeColGroup(gObj);
            }
        }
        // hide horizontal scroll
        for (let element of [].slice.call(gObj.element.querySelectorAll('.e-content'))) {
            element.style.overflowX = 'hidden';
        }
        // Hide the waiting popup
        let waitingPop: NodeListOf<Element> = gObj.element.querySelectorAll('.e-spin-show');
        for (let element of [].slice.call(waitingPop)) {
            classList(element, ['e-spin-hide'], ['e-spin-show']);
        }
        this.printGridElement(gObj);
        gObj.isPrinting = false;
        delete (<{printGridObj?: IGrid}>window).printGridObj;
        let args: PrintEventArgs = {
            element: gObj.element
        };
        gObj.trigger(events.printComplete, args);
        this.parent.log('exporting_complete', this.getModuleName());
    }

    private printGridElement(gObj: IGrid): void {
        classList(gObj.element, ['e-print-grid-layout'], ['e-print-grid']);
        if (gObj.isPrinting) {
            detach(gObj.element);
        }
        this.printWind = printWindow(gObj.element, this.printWind);
    }

    private removeColGroup(gObj: IGrid) : void {
        let depth: number = gObj.groupSettings.columns.length;
        let element: HTMLElement = gObj.element;
        let id: string = '#' + gObj.element.id;
        if (!depth) {
            return;
        }
        let groupCaption: NodeList = element.querySelectorAll(`${id}captioncell.e-groupcaption`);
        let colSpan: string = (<HTMLElement>groupCaption[depth - 1]).getAttribute('colspan');
        for (let i: number = 0; i < groupCaption.length; i++) {
            (<HTMLElement>groupCaption[i]).setAttribute('colspan', colSpan);
        }
        let colGroups: NodeList = element.querySelectorAll(`colgroup${id}colGroup`);
        let contentColGroups: NodeList = element.querySelector('.e-content').querySelectorAll('colgroup');
        this.hideColGroup(colGroups, depth);
        this.hideColGroup(contentColGroups, depth);
    }

    private hideColGroup(colGroups: NodeList, depth: number): void {
        for (let i: number = 0; i < colGroups.length; i++) {
            for (let j: number = 0; j < depth; j++) {
                (<HTMLElement>(<HTMLElement>colGroups[i]).children[j]).style.display = 'none';
            }
        }
    }

    /**
     * To destroy the print
     * @hidden
     */
    public isPrintGrid(): boolean {
        return this.parent.element.id.indexOf('_print') > 0 && this.parent.isPrinting;
    }

    /**
     * To destroy the print 
     * @return {void}
     * @hidden
     */
    public destroy(): void {
        if (this.parent.isDestroyed) { return; }
        this.parent.off(events.contentReady, this.contentReady.bind(this));
        this.parent.removeEventListener(events.actionBegin, this.actionBegin.bind(this));
        this.parent.off(events.onEmpty, this.onEmpty.bind(this));
        this.parent.off(events.hierarchyPrint, this.hierarchyPrint);
    }

    /**
     * For internal use only - Get the module name.
     * @private
     */
    protected getModuleName(): string {
        return 'print';
    }

}