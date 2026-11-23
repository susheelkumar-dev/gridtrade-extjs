Ext.define('GT.model.IngestionError', {
    extend: 'Ext.data.Model',
    requires: ['GT.core.RestProxy'],
    fields: [
        { name: 'id', type: 'int' },
        { name: 'jobId', type: 'int' },
        { name: 'row', type: 'int' },
        { name: 'column', type: 'string' },
        { name: 'severity', type: 'string' },
        { name: 'message', type: 'string' }
    ],
    proxy: { type: 'gt-rest', url: 'api/ingestion/jobs/{jobId}/errors' }
});
