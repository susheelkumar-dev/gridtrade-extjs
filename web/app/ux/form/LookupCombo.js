/** Combo bound to a cached lookup list: type-ahead, matches anywhere, value must come from the list. */
Ext.define('GT.ux.form.LookupCombo', {
    extend: 'Ext.form.field.ComboBox',
    xtype: 'gt-lookup',
    mixins: ['GT.ux.form.LookupMixin'],

    queryMode: 'local',
    displayField: 'name',
    valueField: 'id',
    forceSelection: true,
    anyMatch: true,
    typeAhead: false,
    editable: true,
    autoSelect: true,

    constructor: function (config) {
        this.callParent([this.withEditTrigger(config)]);
    },

    initComponent: function () {
        this.initLookup();
        this.callParent(arguments);
    }
});
