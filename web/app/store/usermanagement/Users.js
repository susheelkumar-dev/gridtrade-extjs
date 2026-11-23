Ext.define('GT.store.usermanagement.Users', {
    extend: 'GT.core.BaseStore',
    alias: 'store.gt-users',
    model: 'GT.model.usermanagement.User',
    sorters: ['username']
});
