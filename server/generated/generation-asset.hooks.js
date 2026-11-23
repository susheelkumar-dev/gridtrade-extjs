'use strict';
/**
 * Business rules for Generation Asset (routes in generation-asset.routes.generated.js). UI Forge created this file once and
 * never changes it: it is yours. Every function is optional.
 *
 *   view(record)                   add computed values to what the API returns
 *   beforeSave(data, info)         adjust or refuse data before it is validated and saved (throw to refuse)
 *   validate(record, info)         extra rules: return { field: message }
 *   afterSave(record, info)        follow-up work after a save
 *   canDelete(record, info)        return a reason to refuse a delete (409), or null
 *   actions.<name>(record, body)   custom actions (POST /api/generation-assets/:id/<name>); return field changes
 *
 * info = { isNew, existing, ctx (user, permissions), api (route helpers, store, D) }
 */
module.exports = {
  // view: (record) => record,
  // beforeSave: async (data, info) => data,
  // validate: (record, info) => ({}),
  // afterSave: async (record, info) => {},
  canDelete: (record) => (record.status === 'Operational' ? 'Retire an operational asset before deleting it' : null),
  actions: {
    // POST /api/generation-assets/:id/retire: return field changes to save (or nothing)
    retire: async (record) => {
      if (record.status === 'Retired') return {};
      return { status: 'Retired', gridConnected: false };
    },
  },
};
