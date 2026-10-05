/**
 * Channel types an anonymous visitor can talk to without signing in.
 *
 * Workspace memory is not injected passively into their prompt.
 */
const PUBLIC_CHANNEL_TYPES = new Set(["widget", "web"]);

export function allowsPassiveMemoryRecall(channelType: string): boolean {
  return !PUBLIC_CHANNEL_TYPES.has(channelType);
}
