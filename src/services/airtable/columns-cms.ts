// The CmsEmbeds and Dashboards half of the column registry.
//
// Split out of tables.ts when that file crossed the size limit, and this is the seam
// that costs nothing: these columns belong to two tables that no other mapper touches,
// and the CMS slice of the DAL is already split the same way (mapping-cms.ts,
// to-fields-cms.ts, tags-cms.ts). Every rule from tables.ts still applies, because
// `COL` is one object built by spreading this into it: one name for one concept, and
// Airtable's own spelling appears nowhere outside this directory.

export const COL_CMS = {
  // CmsEmbeds. `format` is the locked-at-creation embed format and `view` is the
  // switchable layout inside it, which is the shape ref 33 captures: one Styled HTML
  // embed serves five views.
  view: 'view',

  // CmsEmbeds, Style Options. Both screenshots have this section COLLAPSED; the
  // changelog screenshot linked from docs/parity/external-references.md has it
  // expanded, which is where these four come from. `colorTheme` rather than reusing
  // `theme`: Events already has a `theme` column and it is a longText holding a theme
  // object, so one name would mean one concept spelled two ways at two types.
  colorTheme: 'colorTheme',
  primaryColor: 'primaryColor',
  dateTimeFormat: 'dateTimeFormat',
  extraCss: 'extraCss',

  // CmsEmbeds, Filters and Field Options. `...Json` per the blob convention, and
  // plural `filtersJson` so it is not confused with SavedViews' `filterJson`, which
  // holds a different shape for a different surface.
  filtersJson: 'filtersJson',
  fieldOptionsJson: 'fieldOptionsJson',

  // Dashboards and DashboardWidgets. A dashboard is a named tab with a dot colour and
  // an ordered set of widgets; a widget is a type plus the metric it reads. `metric` is
  // a closed vocabulary rather than a query, because a stored query would be an
  // injection surface into the DAL and the captured widgets are all fixed aggregates.
  dashboard: 'dashboard',
  widgetType: 'widgetType',
  metric: 'metric',
  templateKey: 'templateKey',
} as const
