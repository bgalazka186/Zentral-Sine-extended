# Zentral-dependent extension

This tree adds behavior to the adapted Zentral base. It is loaded by the catalog, not by independent Sine registrations.

| Part               | Ownership                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `panels/`          | Coordinator, containers/real-tab hosts, geometry integration, hover/input/audio, toolbars, Essential panels and secondary views.            |
| `panels/floating/` | New persistent placement, docking and optional 1.1.0 controls; uses the compatibility bridge.                                               |
| `appearance/`      | Existing Extended Look themes, palette and density styling.                                                                                 |
| `settings/`        | Shared settings UI and backup helpers. These can remain available when Apps fails or is disabled; they do not activate the base themselves. |

Each part's README and source headers describe dependencies and teardown. New private-state access belongs in the documented bridge/base contract. Keep one browser owner and one geometry writer. The original upstream snapshot is documentation only.
