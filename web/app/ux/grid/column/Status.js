/** Renders a status value as a coloured chip and offers a list filter of the values present. */
Ext.define('GT.ux.grid.column.Status', {
    extend: 'Ext.grid.column.Column',
    xtype: 'gt-statuscolumn',
    requires: ['GT.util.Format'],

    align: 'center',
    width: 120,
    filter: { type: 'list' },

    defaultRenderer: function (value) {
        return GT.util.Format.chip(value);
    },

    exportRenderer: function (value) {
        return value;
    }
});
