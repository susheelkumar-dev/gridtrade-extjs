/**
 * Permission-aware components: any component (button, menu item, field...) configured with
 * permission: 'module.action' starts hidden when the current user lacks that permission.
 * GT.view.main.MainController re-applies this to everything on screen when the user changes.
 */
Ext.define('GT.overrides.Component', {
    override: 'Ext.Component',

    initComponent: function () {
        if (this.permission && window.GT && GT.util && GT.util.Session && !GT.util.Session.can(this.permission)) {
            this.hidden = true;
        }
        this.callParent(arguments);
    }
});
