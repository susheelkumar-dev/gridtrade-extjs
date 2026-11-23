/** Every field with allowBlank: false shows a red asterisk after its label, app-wide. */
Ext.define('GT.overrides.form.field.Base', {
    override: 'Ext.form.field.Base',

    initComponent: function () {
        if (this.allowBlank === false && this.fieldLabel && !this.afterLabelTextTpl) {
            this.afterLabelTextTpl = '<span class="gt-required" data-qtip="Required">*</span>';
        }
        this.callParent(arguments);
    }
});
