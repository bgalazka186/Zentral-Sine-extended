# Adaptive chrome contrast

`ZentralThemeService.js` is an independent catalog feature. `ZentralThemePolicy.js` is a pure policy helper used by tests and the service; neither imports the Zentral base. CSS and the settings descriptor are beside them.

Choose browser interface, website appearance, operating system, always light or always dark. Choose adaptive readable tooltips, high-contrast tooltips and controls, or all custom Extended appearance. Website and browser appearance can deliberately differ; the default follows browser UI.

Core lifecycle owns preference/topic/media-query subscriptions and a coalesced refresh. Existing attributes are restored on teardown. New popup content inherits the root policy without another popup polling loop. Extended appearance remains a separate owner.
