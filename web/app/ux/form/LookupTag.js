/** Multi-select variant of the lookup combo (tag field). */
Ext.define('GT.ux.form.LookupTag', {
    extend: 'Ext.form.field.Tag',
    xtype: 'gt-lookuptag',
    mixins: ['GT.ux.form.LookupMixin'],

    queryMode: 'local',
    displayField: 'name',
    valueField: 'id',
    forceSelection: true,
    anyMatch: true,
    filterPickList: true,
    stacked: false,

    constructor: function (config) {
        this.callParent([this.withEditTrigger(config)]);
    },

    initComponent: function () {
        this.initLookup();
        this.callParent(arguments);
    }
});
