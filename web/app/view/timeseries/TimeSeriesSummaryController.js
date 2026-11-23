Ext.define('GT.view.timeseries.TimeSeriesSummaryController', {
    extend: 'GT.core.BaseController',
    alias: 'controller.timeseriessummary',
    requires: ['GT.model.TimeSeries', 'GT.util.Lookups'],

    onLink: function (grid, rec, column) {
        if (column.linkText === 'View') {
            this.openScreen('tsdata', rec.getId());
        } else {
            this.openWindow(rec);
        }
    },

    onNew: function () {
        this.openWindow(Ext.create('GT.model.TimeSeries', { type: 'Input - Simple', granularity: 'Hourly', unit: 'MWh', timeZone: 'IST' }));
    },

    onEdit: function () {
        var rec = this.getView().getSelectedRecord();
        if (rec) { this.openWindow(rec); }
    },

    openWindow: function (rec) {
        var grid = this.getView();
        Ext.create('GT.view.timeseries.TimeSeriesWindow', {
            record: rec,
            listeners: { saved: function () { grid.getStore().load(); GT.util.Lookups.reload('timeseries'); } }
        }).show();
    }
});
