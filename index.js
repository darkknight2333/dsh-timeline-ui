/**
 * Host half of dsh-timeline-ui.
 *
 * The bundle exists so the Loader can own one row for the plugin; every behaviour is
 * browser-side. Nothing is registered here, so the Host never touches sessions, settings,
 * credentials, or the filesystem.
 */
export function apply() {}
