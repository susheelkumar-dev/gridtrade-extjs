Ext.define('GT.view.main.MainModel', {
    extend: 'Ext.app.ViewModel',
    alias: 'viewmodel.main',

    data: {
        userName: '',
        userRole: '',
        clock: '',
        apiOk: true
    },

    formulas: {
        apiStatusHtml: function (get) {
            return get('apiOk')
                ? '<i class="fa fa-circle gt-dot-ok"></i> API connected'
                : '<i class="fa fa-circle gt-dot-down"></i> API unreachable';
        }
    }
});
