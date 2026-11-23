Ext.define('GT.model.TimeSeries', {
    extend: 'GT.core.BaseModel',
    fields: [
        { name: 'name', type: 'string' },
        { name: 'formula', type: 'string' },
        { name: 'type', type: 'string', defaultValue: 'Input - Simple' },
        { name: 'profileType', type: 'string', persist: false },
        { name: 'granularity', type: 'string', defaultValue: 'Hourly' },
        { name: 'dataType', type: 'string', persist: false },
        { name: 'unit', type: 'string', defaultValue: 'MWh' },
        { name: 'timeZone', type: 'string', defaultValue: 'IST' },
        { name: 'usage', type: 'string' },
        { name: 'description', type: 'string' },
        { name: 'enabled', type: 'boolean', defaultValue: true },
        { name: 'manual', type: 'boolean', defaultValue: true },
        { name: 'isSystem', type: 'boolean', persist: false }
    ],
    proxy: { type: 'gt-rest', url: 'api/timeseries' }
});
