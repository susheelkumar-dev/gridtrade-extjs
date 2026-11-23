/** Base for every entity: integer ids, negative temporary ids for new records, audit stamp fields. */
Ext.define('GT.core.BaseModel', {
    extend: 'Ext.data.Model',
    requires: ['GT.core.RestProxy', 'Ext.data.identifier.Negative'],

    schema: { namespace: 'GT.model' },
    identifier: 'negative',

    fields: [
        { name: 'id', type: 'int' }
    ],

    /** Save and return a promise; rejects with the server message and any field errors. */
    savePromise: function (options) {
        var me = this;
        return new Ext.Promise(function (resolve, reject) {
            me.save(Ext.apply({
                success: function (rec) { resolve(rec); },
                failure: function (rec, operation) {
                    var err = new Error(operation.gtMessage || 'Save failed');
                    err.fieldErrors = operation.gtFieldErrors;
                    reject(err);
                }
            }, options));
        });
    },

    erasePromise: function () {
        var me = this;
        return new Ext.Promise(function (resolve, reject) {
            me.erase({
                success: function () { resolve(me); },
                failure: function (rec, operation) {
                    me.reject();
                    reject(new Error(operation.gtMessage || 'Delete failed'));
                }
            });
        });
    }
});
