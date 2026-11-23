Ext.define('GT.model.AuditEntry', {
    extend: 'GT.core.BaseModel',
    fields: [
        { name: 'entityType', type: 'string' },
        { name: 'entityId', type: 'int' },
        { name: 'entityName', type: 'string' },
        { name: 'action', type: 'string' },
        { name: 'user', type: 'string' },
        { name: 'ip', type: 'string' },
        { name: 'reason', type: 'string' },
        { name: 'at', type: 'date', dateFormat: 'c' },
        { name: 'changed', type: 'string' }
    ],
    proxy: { type: 'gt-rest', url: 'api/audit' }
});
