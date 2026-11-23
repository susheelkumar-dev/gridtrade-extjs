Ext.define('GT.model.LegalEntity', {
    extend: 'GT.core.BaseModel',
    fields: [
        { name: 'code', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'country', type: 'string', defaultValue: 'India' },
        { name: 'taxId', type: 'string' },
        { name: 'enabled', type: 'boolean', defaultValue: true },
        { name: 'isSystem', type: 'boolean', persist: false }
    ],
    proxy: { type: 'gt-rest', url: 'api/legal-entities' }
});
