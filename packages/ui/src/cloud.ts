import { api } from "./api";
export function cloud<T = any>(
  action: string,
  payload: unknown = {},
): Promise<T> {
  return window.lens
    ? api("cloud.request", { action, payload })
    : api(action, payload);
}
