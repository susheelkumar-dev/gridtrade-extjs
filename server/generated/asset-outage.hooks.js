'use strict';
/**
 * Business rules for Asset Outage (routes in asset-outage.routes.generated.js). UI Forge created this file once and
 * never changes it: it is yours. Every function is optional.
 *
 *   view(record)                   add computed values to what the API returns
 *   beforeSave(data, info)         adjust or refuse data before it is validated and saved (throw to refuse)
 *   validate(record, info)         extra rules: return { field: message }
 *   afterSave(record, info)        follow-up work after a save
 *   canDelete(record, info)        return a reason to refuse a delete (409), or null
 *   actions.<name>(record, body)   custom actions (POST /api/asset-outages/:id/<name>); return field changes
 *
 * info = { isNew, existing, ctx (user, permissions), api (route helpers, store, D) }
 */
module.exports = {
  // view: (record) => record,
  // beforeSave: async (data, info) => data,
  validate: (record) => (record.startAt && record.endAt && record.endAt <= record.startAt ? { endAt: 'Must be after the start' } : {}),
  // afterSave: async (record, info) => {},
  // canDelete: (record, info) => null,
  actions: {
  },
};
