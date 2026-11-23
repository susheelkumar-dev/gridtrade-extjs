/**
 * The application's standard grid: GT.ux.grid.BaseGrid (the reference full-featured grid) with the app's
 * defaults: tool icons in the title bar, column filters, CSV/Excel export, record count footer and link
 * columns (gt-linkcolumn) that fire 'linkclick'. Every feature switch of BaseGrid is available here too.
 *
 *   { xtype: 'gt-genericgrid', title: 'Trades', store: { type: 'gt-trades' },
 *     toolbarActions: [{ text: 'New', handler: 'onNew' }], filterPanel: { items: [...] },
 *     columns: [...], listeners: { linkclick: 'onLink' } }
 */
Ext.define('GT.ux.grid.GenericGrid', {
    extend: 'GT.ux.grid.BaseGrid',
    xtype: 'gt-genericgrid',
    requires: ['GT.ux.grid.column.Link', 'GT.ux.grid.column.Status'],

    cls: 'gt-basegrid gt-genericgrid',
    enableColumnFilters: true,
    enableExport: true,
    toolsPosition: 'auto'
});
