/** Consistent notifications: success/info fade away, errors stay a little longer. */
Ext.define('GT.util.Toast', {
    singleton: true,
    requires: ['Ext.window.Toast'],

    show: function (message, type, title) {
        var icons = { success: 'fa-check-circle', info: 'fa-info-circle', warning: 'fa-exclamation-triangle', error: 'fa-times-circle' };
        Ext.toast({
            html: '<div class="gt-toast-body"><i class="fa ' + (icons[type] || icons.info) + '"></i><span>' + Ext.String.htmlEncode(message) + '</span></div>',
            title: title,
            cls: 'gt-toast gt-toast-' + (type || 'info'),
            align: 'tr',
            width: 360,
            autoCloseDelay: type === 'error' ? 6000 : 2800,
            slideInDuration: 250
        });
    },

    success: function (m, t) { this.show(m, 'success', t); },
    info: function (m, t) { this.show(m, 'info', t); },
    warning: function (m, t) { this.show(m, 'warning', t); },
    error: function (m, t) { this.show(m, 'error', t); }
});
