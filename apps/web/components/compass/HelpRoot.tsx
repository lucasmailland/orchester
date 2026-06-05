"use client";

/**
 * HelpRoot — client wrapper that mounts the Compass help surface
 * (floating "?" button + slide-in drawer) inside a server-component
 * layout.
 *
 * HelpButton is self-contained: it owns the open/close state and
 * renders HelpDrawer internally. HelpRoot exists so the shell layout
 * (a server component) imports a single client entry point and the
 * server/client boundary stays clean. Mounted once per shell layout
 * so the help UI follows the user across every authenticated page
 * without remounting on in-app navigation.
 */

import * as React from "react";
import { HelpButton } from "./HelpButton";

export function HelpRoot(): React.JSX.Element {
  return <HelpButton />;
}

export default HelpRoot;
