/** Base store: client-side sorting/filtering over server-filtered lists, plus a promise-based load. */
Ext.define('GT.core.BaseStore', {
    extend: 'Ext.data.Store',

    // Lists are filtered on the server and small enough to load whole; 0 = no paging parameters.
    pageSize: 0,
    remoteSort: false,
    remoteFilter: false,
    autoLoad: false,

    /** Replace the server-side filter parameters and reload. */
    loadWith: function (params) {
        var proxy = this.getProxy();
        proxy.setExtraParams(Ext.apply({}, params));
        return this.loadPromise();
    },

    loadPromise: function (options) {
        var me = this;
        return new Ext.Promise(function (resolve, reject) {
            me.load(Ext.apply({
                callback: function (records, operation, success) {
                    if (success) { resolve(records); } else { reject(new Error(operation.gtMessage || 'Load failed')); }
                }
            }, options));
        });
    }
});
