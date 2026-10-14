import type { NavigationPort } from "../core";
import type { ReadSession } from "./read-session";

/** A citation never retains authority to open a note after a policy change. */
export function guardNavigation(navigation: NavigationPort, session: () => ReadSession | null): NavigationPort {
  return { async openAt(target) {
    const access = session();
    if (access?.current() && access.allows(target.path)) await navigation.openAt(target);
  } };
}
