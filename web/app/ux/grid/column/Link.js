/**
 * A column whose values render as links. Clicking fires 'linkclick' on the grid with (grid, record, column),
 * which is how summaries drill into entry screens and pop-ups.
 */
Ext.define('GT.ux.grid.column.Link', {
    extend: 'Ext.grid.column.Column',
    xtype: 'gt-linkcolumn',

    /** Fixed link text (e.g. "View"); defaults to the cell value. */
    linkText: null,
    tdCls: 'gt-link-cell',

    defaultRenderer: function (value) {
        var text = this.linkText || value;
        if (text === null || text === undefined || text === '') {
            return '';
        }
        return '<a href="#" class="gt-link" role="button">' + Ext.String.htmlEncode(String(text)) + '</a>';
    },

    exportRenderer: function (value) {
        return this.linkText ? '' : value;
    },

    processEvent: function (type, view, cell, recordIndex, cellIndex, e, record) {
        if (type === 'click' && e.getTarget('.gt-link')) {
            e.preventDefault();
            var grid = view.ownerGrid || view.grid;
            grid.fireEvent('linkclick', grid, record, this, e);
            return false;
        }
        return this.callParent(arguments);
    }
});
