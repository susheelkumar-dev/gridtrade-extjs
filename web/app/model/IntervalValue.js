/** One interval of a series for a day. Read through the nested REST URL; saved in bulk by the controller. */
Ext.define('GT.model.IntervalValue', {
    extend: 'Ext.data.Model',
    requires: ['GT.core.RestProxy'],
    fields: [
        { name: 'id', type: 'int' },
        { name: 'seriesId', type: 'int' },
        { name: 'date', type: 'date', dateFormat: 'Y-m-d' },
        { name: 'interval', type: 'int' },
        { name: 'label', type: 'string' },
        { name: 'value', type: 'number', allowNull: true },
        { name: 'quality', type: 'string' }
    ],
    proxy: { type: 'gt-rest', url: 'api/timeseries/{seriesId}/data' }
});
