Ext.define('GT.model.Commodity', {
    extend: 'GT.core.BaseModel',
    fields: [
        { name: 'name', type: 'string' },
        { name: 'enabled', type: 'boolean', defaultValue: true },
        { name: 'isSystem', type: 'boolean', persist: false },
        { name: 'contractTypes', type: 'auto', defaultValue: [] },
        { name: 'contractTypeList', persist: false, depends: ['contractTypes'], calculate: function (d) { return (d.contractTypes || []).join(', '); } }
    ],
    proxy: { type: 'gt-rest', url: 'api/commodities' }
});
