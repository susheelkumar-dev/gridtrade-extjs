/** One date format across the app; still accepts ISO input and always submits ISO. */
Ext.define('GT.overrides.form.field.Date', {
    override: 'Ext.form.field.Date',

    format: 'd-M-Y',
    altFormats: 'Y-m-d|d/m/Y|d-m-Y|d M Y|j-M-Y|Ymd',
    submitFormat: 'Y-m-d',
    startDay: 1
});
