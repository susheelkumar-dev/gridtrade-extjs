/** Charts in this app never post images to Sencha's public export server. */
Ext.define('GT.overrides.draw.Container', {
    override: 'Ext.draw.Container',
    config: {
        downloadServerUrl: 'about:blank'
    }
});
