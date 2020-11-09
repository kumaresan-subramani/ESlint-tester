/**
 * 
 * `Logger` class
 */

import { IGrid } from '../base/interface';
import { ModuleDeclaration, isNullOrUndefined, L10n, Ajax, isUndefined } from '@syncfusion/ej2-base';
import { Column } from '../models/column';
import { DataUtil, DataManager, AdaptorOptions } from '@syncfusion/ej2-data';
export interface ILogger {
    log: (type: string | string[], args: Object) => void;
}

export interface CheckOptions {
    success: boolean;
    options?: Object;
}

export interface ItemDetails {
    type: string;
    logType: string;
    message?: string;
    check: (args: Object, parent: IGrid) => CheckOptions;
    generateMessage: (args: Object, parent: IGrid, checkOptions?: Object) => string;
}
const BASE_DOC_URL: string = 'https://ej2.syncfusion.com/documentation/grid';
const DOC_URL: string = 'https://ej2.syncfusion.com/documentation/';
const WARNING: string = '[EJ2Grid.Warning]';
const ERROR: string = '[EJ2Grid.Error]';
const INFO: string = '[EJ2Grid.Info]';
export class Logger implements ILogger {
    public parent: IGrid;
    constructor(parent: IGrid) {
        this.parent = parent;
        this.parent.on('initial-end', this.patchadaptor, this);
    }
    public getModuleName(): string {
        return 'logger';
    }

    public log(types: string | string[], args: Object): void {
        if (!(types instanceof Array)) { types = [types]; }
        let type: string[] = (<string[]>types);
        for (let i: number = 0; i < type.length; i++) {
            let item: ItemDetails = detailLists[type[i]];
            let cOp: CheckOptions = item.check(args, this.parent);
            if (cOp.success) {
                console[item.logType](item.generateMessage(args, this.parent, cOp.options));
            }
        }
    }
    public patchadaptor(): void {
        let adaptor: AdaptorOptions = this.parent.getDataModule().dataManager.adaptor;
        let original: Function = adaptor.beforeSend;
        if (original) {
            adaptor.beforeSend = (dm: DataManager, request: XMLHttpRequest, settings?: Ajax) => {
                original.call(adaptor, dm, request, settings);
            };
        }
    }
    public destroy(): void {
        if (this.parent.isDestroyed) { return; }
        this.parent.off('initial-end', this.patchadaptor);
    }
}

export const detailLists: {[key: string]: ItemDetails} = {
    module_missing: {
        type: 'module_missing',
        logType: 'warn',
        check(args: Object, parent: IGrid): CheckOptions {
            let injected: string[] = parent.getInjectedModules().map((m: Function) => m.prototype.getModuleName());
            /* tslint:disable-next-line:no-any */
            let modules: string[] = (<any>parent).requiredModules().map((m: ModuleDeclaration) => m.member)
                .filter((name: string) => injected.indexOf(name) === -1);
            return { success: modules.filter((m: string) => m !== 'resize').length > 0, options: modules };
        },
        generateMessage(args: Object, parent: IGrid, modules: Object): string {
            modules = (<string[]>modules).filter((m: string) => m !== 'resize')
            .reduce((prev: string, cur: string) => prev + `* ${cur}\n`, '');
            return WARNING + ': MODULES MISSING\n' + 'The following modules are not injected:.\n' +
            `${modules}` +
            `Refer to ${BASE_DOC_URL}/module.html for documentation on importing feature modules.`;
        }
    },
    promise_enabled: {
        type: 'promise_enabled',
        logType: 'error',
        check(args: Object, parent: IGrid): CheckOptions {
            return { success: typeof Promise === 'undefined' };
        },
        generateMessage(args: Object, parent: IGrid): string {
            return ERROR + ': PROMISE UNDEFINED\n' +
            'Promise object is not present in the global environment,' +
            'please use polyfil to support Promise object in your environment.\n' +
            `Refer to ${DOC_URL}/base/browser.html?#required-polyfills for more information.`;
        }
    },
    primary_column_missing: {
        type: 'primary_column_missing',
        logType: 'warn',
        check(args: Object, parent: IGrid): CheckOptions {
            return { success: parent.getColumns().filter((column: Column) => column.isPrimaryKey).length === 0 };
        },
        generateMessage(args: Object, parent: IGrid): string {
            return WARNING + ': PRIMARY KEY MISSING\n' + 'Editing is enabled but primary key column is not specified.\n' +
             `Refer to ${BASE_DOC_URL}/api-column.html?#isprimarykey for documentation on providing primary key columns.`;
        }
    },
    selection_key_missing: {
        type: 'selection_key_missing',
        logType: 'warn',
        check(args: Object, parent: IGrid): CheckOptions {
            return { success: parent.selectionSettings.persistSelection &&
                parent.getColumns().filter((column: Column) => column.isPrimaryKey).length === 0 };
        },
        generateMessage(args: Object, parent: IGrid): string {
            return WARNING + ': PRIMARY KEY MISSING\n' +
            'selectionSettings.persistSelection property is enabled. It requires one primary key column to persist selection.\n' +
             `Refer to ${BASE_DOC_URL}/api-column.html?#isprimarykey for documentation on providing primary key columns.`;
        }
    },
    actionfailure: {
        type: 'actionfailure',
        logType: 'error',
        check(args: Object, parent: IGrid): CheckOptions {
            return { success: true };
        },
        generateMessage(args: Object, parent: IGrid): string {
            let message: string = '';
            let formatError: string = formatErrorHandler(args, parent);
            let ajaxError: string = ajaxErrorHandler(args, parent);
            if (ajaxError !== '') {
                message = ajaxError;
            } else if (formatError !== '') {
                message = formatError;
            } else {
                message = (<{ error: string}>args).error;
            }
            return WARNING + ': ' + message;
        }
    },
    locale_missing: {
        type: 'locale_missing',
        logType: 'warn',
        check(args: Object, parent: IGrid): CheckOptions {
            let lObj: Object = DataUtil.getObject(`locale.${parent.locale}.grid`, L10n);
            return { success: parent.locale !== 'en-US' && isNullOrUndefined(lObj) };
        },
        generateMessage(args: Object, parent: IGrid): string {
            return WARNING + ': LOCALE CONFIG MISSING\n' + `Locale configuration for '${parent.locale}' is not provided.\n` +
             `Refer to ${BASE_DOC_URL}/globalization-and-localization.html?#localization 
             for documentation on setting locale configuration.`;
        }
    },
    limitation: {
        type: 'limitation',
        logType: 'warn',
        check(args: Object, parent: IGrid): CheckOptions {
            let name: string = <string>args;
            let opt: CheckOptions;
            switch (name) {
                case 'freeze':
                opt = {
                    success: parent.allowGrouping || !isUndefined(parent.detailTemplate) || !isUndefined(parent.childGrid)
                    || !isUndefined(parent.rowTemplate) || parent.enableVirtualization,
                    options: { name: 'freeze' }
                };
                break;
                case 'virtualization':
                opt = {
                    success: !isUndefined(parent.detailTemplate) || !isUndefined(parent.childGrid) || parent.frozenRows !== 0
                    || parent.frozenColumns !== 0,
                    options: { name: 'virtualization' }
                };
                break;
                default:
                opt = { success: false };
                break;
            }
            return opt;
        },
        generateMessage(args: Object, parent: IGrid, options: Object): string {
            let name: string = (<{ name: string }>options).name;
            let opt: string;
            switch (name) {
                case 'freeze':
                opt = 'Frozen rows and columns do not support the following features:\n' +
                '* Virtualization\n' +
                '* Row Template\n' +
                '* Details Template\n' +
                '* Hierarchy Grid\n' +
                '* Grouping';
                break;
                case 'virtualization':
                opt = 'Virtualization does not support the following features.\n' +
                '* Freeze rows and columns.\n' +
                '* Details Template.\n' +
                '* Hierarchy Grid.\n';
                break;
                default:
                opt = '';
                break;
            }
            return WARNING + `: ${name.toUpperCase()} LIMITATIONS\n` + opt;
        }
    },
    check_datasource_columns: {
        type: 'check_datasource_columns',
        logType: 'warn',
        check(args: Object, parent: IGrid): CheckOptions {
            return { success: !(parent.columns.length ||
                (parent.dataSource instanceof DataManager) || (<object[]>parent.dataSource).length) };
        },
        generateMessage(args: Object, parent: IGrid): string {
            return WARNING + ': GRID CONFIG MISSING\n' + 'dataSource and columns are not provided in the grid. ' +
            'At least one of either must be provided for grid configuration.\n' +
            `Refer to ${BASE_DOC_URL}/columns.html for documentation on configuring the grid data and columns.`;
        }
    },
    virtual_height: {
        type: 'virtual_height',
        logType: 'error',
        check(args: Object, parent: IGrid): CheckOptions {
            return { success: isNullOrUndefined(parent.height) || parent.height === 'auto' };
        },
        generateMessage(args: Object, parent: IGrid): string {
            return ERROR + ': GRID HEIGHT MISSING \n' + 'height property is required to use virtualization.\n' +
            `Refer to ${BASE_DOC_URL}/virtual.html for documentation on configuring the virtual grid.`;
        }
    },
    grid_remote_edit: {
        type: 'grid_remote_edit',
        logType: 'error',
        check(args: {result: object, count: number}, parent: IGrid): CheckOptions {
            return { success: Array.isArray(args) ||  Array.isArray(args.result) };
        },
        generateMessage(args: Object, parent: IGrid): string {
            return ERROR + ': RETRUN VALUE MISSING  \n' +
            'Remote service returns invalid data. \n' +
            `Refer to ${BASE_DOC_URL}/edit.html for documentation on configuring editing with remote data.`;
        }
    },
    grid_sort_comparer: {
        type: 'grid_sort_comparer',
        logType: 'warn',
        check(args: object, parent: IGrid): CheckOptions {
            return { success: parent.getDataModule().isRemote()};
        },
        generateMessage(args: Object, parent: IGrid): string {
            return WARNING + ': SORT COMPARER NOT WORKING  \n' + 'Sort comparer will not work with remote data.' +
            `Refer to ${BASE_DOC_URL}/sorting/#custom-sort-comparer for documentation on using the sort comparer.`;
        }
    },
    resize_min_max: {
        type: 'resize_min_max',
        logType: 'info',
        check(args: {column: Column, width: number }, parent: IGrid): CheckOptions {
            return { success: (args.column.minWidth && args.column.minWidth >= args.width) ||
                (args.column.maxWidth && args.column.maxWidth <= args.width) };
        },
        generateMessage(args: Object, parent: IGrid): string {
            return INFO + ': RESIZING COLUMN REACHED MIN OR MAX  \n' + 'The column resizing width is at its min or max.';
        }
    },
    action_disabled_column: {
        type: 'action_disabled_column',
        logType: 'info',
        check(args: {moduleName: string, columnName: string, column: Column, destColumn: Column}, parent: IGrid): CheckOptions {
            let success: boolean = true;
            let fn: string;
            switch (args.moduleName) {
                case 'reorder':
                    if (isNullOrUndefined(args.destColumn)) {
                        fn = `reordering action is disabled for the ${args.column.headerText} column`;
                    } else {
                        fn = `reordering action is disabled for the ${args.column.allowReordering ?
                            args.destColumn.headerText : args.column.headerText } column`;
                    }
                break;
                case 'group':
                    fn = `grouping action is disabled for the ${args.columnName} column.`;
                break;
                case 'filter':
                    fn = `filtering action is disabled for the ${args.columnName} column.`;
                break;
                case 'sort':
                    fn = `sorting action is disabled for the ${args.columnName} column.`;
                break;
            }
            return { success: success, options: {fn} };
        },
        generateMessage(args: Object, parent: IGrid, options: {fn: string}): string {
            return INFO + `: ACTION DISABLED \n ${options.fn}`;
        }
    },
    exporting_begin: {
        type: 'exporting_begin',
        logType: 'info',
        check(args: string, parent: IGrid): CheckOptions {
            return { success: true, options: {args} };
        },
        generateMessage(args: Object, parent: IGrid, options: {args: string}): string {
            return INFO + `: EXPORTNIG INPROGRESS \n Grid ${options.args}ing is in progress`;
        }
    },
    exporting_complete: {
        type: 'exporting_complete',
        logType: 'info',
        check(args: string, parent: IGrid): CheckOptions {
            return { success: true, options: {args} };
        },
        generateMessage(args: Object, parent: IGrid, options: {args: string}): string {
            return INFO + `: EXPORTNIG COMPLETED \n Grid ${options.args}ing is complete`;
        }
    },
    foreign_key_failure: {
        type: 'foreign_key_failure',
        logType: 'error',
        check(args: string, parent: IGrid): CheckOptions {
            return { success: true };
        },
        generateMessage(args: Object, parent: IGrid): string {
            return ERROR + ': FOREIGNKEY CONFIG \n  Grid foreign key column needs a valid data source/service.' +
            `Refer to ${BASE_DOC_URL}/columns/#foreign-key-column for documentation on configuring foreign key columns.`;
        }
    },
    initial_action: {
        type: 'initial_action',
        logType: 'error',
        check(args: {moduleName: string, columnName: string}, parent: IGrid): CheckOptions {
            let success: boolean = true;
            let fn: string;
            switch (args.moduleName) {
                case 'group':
                    fn = `The ${args.columnName} column is not available in the grid's column model.` +
                    'Please provide a valid field name to group the column';
                break;
                case 'filter':
                    fn = `The ${args.columnName} column is not available in the grid's column model.` +
                    'Please provide a valid field name to filter the column.';
                break;
                case 'sort':
                    fn = `The ${args.columnName} column is not available in the grid's column model.` +
                    'Please provide a valid field name to sort the column.';
                break;
            }
            return { success: success, options: {fn} };
        },
        generateMessage(args: Object, parent: IGrid,  options: {fn: string}): string {
            return ERROR + `: INITIAL ACTION FAILURE \n ${options.fn}`;
        }
    },
    frozen_rows_columns: {
        type: 'frozen_rows_columns',
        logType: 'error',
        check(args: string, parent: IGrid): CheckOptions {
            return { success: parent.getColumns().length <= parent.frozenColumns || parent.frozenRows >= parent.currentViewData.length};
        },
        generateMessage(args: Object, parent: IGrid,  options: {fn: string}): string {
            return ERROR + `: OUT OF RANGE ERROR-\n ${parent.getColumns().length <= parent.frozenColumns ? 'FROZEN COLUMNS,' : ''}` +
            `${parent.frozenRows >= parent.currentViewData.length ? 'FROZEN ROWS' : '' } invalid`;
        }
    },
    column_type_missing: {
        type: 'column_type_missing',
        logType: 'error',
        check(args: {column: Column}, parent: IGrid): CheckOptions {
            return { success: isNullOrUndefined(args.column.type), options: args.column.headerText};
        },
        generateMessage(args: Object, parent: IGrid,  options: string): string {
            return ERROR + `: COLUMN TYPE MISSING-\n  ${options} column type was invalid or not defined.` +
            `Please go through below help link: ${DOC_URL}/grid/columns/#column-type`;
        }
    },
    datasource_syntax_mismatch: {
        type: 'datasource_syntax_mismatch',
        logType: 'warn',
        check(args: {dataState: IGrid}, parent: IGrid): CheckOptions {
            return { success: (args.dataState.dataSource instanceof DataManager || args.dataState.dataSource instanceof Array ) &&
            !(isNullOrUndefined(args.dataState.dataStateChange))};
        },
        generateMessage(args: Object, parent: IGrid,  options: {fn: string}): string {
            return WARNING + ': DATASOURCE SYNTAX WARNING\n' +
            'DataSource should be in the form of {result: Object[], count: number}' +
            'when dataStateChangeEvent used';
        }
    }
};

let formatErrorHandler: Function = (args: Object, parent: IGrid): string  => {
    let error: string =  (<{ error: string}>args).error;
    if (error.indexOf && error.indexOf('Format options') !== 0) { return ''; }
    return 'INVALID FORMAT\n' +
    'For more information, refer to the following documentation links:\n' +
    `Number format: ${DOC_URL}/base/intl.html?#supported-format-string.\n` +
    `Date format: ${DOC_URL}/base/intl.html?#manipulating-datetime.\n` +
    `Message: ${error}`;
};

let ajaxErrorHandler: Function = (args: Object, parent: IGrid): string  => {
    let error: XMLHttpRequest = <XMLHttpRequest>DataUtil.getObject('error.error', args);
    if (isNullOrUndefined(error)) { return ''; }
    let jsonResult: Object = '';
    try {
        jsonResult = JSON.parse(error.responseText);
    } catch {
        jsonResult = '';
    }
    return 'XMLHTTPREQUEST FAILED\n' +
    `Url: ${error.responseURL}\n` +
    `Status: ${error.status} - ${error.statusText}\n` +
    `${jsonResult !== '' ? 'Message: ' + jsonResult : '' }`;
};
