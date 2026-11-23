Ext.define('GT.model.Counterparty', {
    extend: 'GT.core.BaseModel',
    fields: [
        { name: 'code', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'type', type: 'string' },
        { name: 'region', type: 'string' },
        { name: 'creditLimit', type: 'number', allowNull: true },
        { name: 'enabled', type: 'boolean', defaultValue: true },
        { name: 'isSystem', type: 'boolean', persist: false }
    ],
    proxy: { type: 'gt-rest', url: 'api/counterparties' }
});
