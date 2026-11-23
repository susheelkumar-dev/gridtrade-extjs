Ext.define('GT.store.usermanagement.Roles', {
    extend: 'GT.core.BaseStore',
    alias: 'store.gt-roles',
    model: 'GT.model.usermanagement.Role',
    sorters: ['name']
});
