/** Trades grouped by product for the blotter's subtotal rows. */
Ext.define('GT.store.Trades', {
    extend: 'GT.core.BaseStore',
    alias: 'store.gt-trades',
    model: 'GT.model.Trade',
    groupField: 'product',
    sorters: [{ property: 'tradeDate', direction: 'DESC' }]
});
