import { LinearClient } from "@linear/sdk";

export function makeClient(config) {
  return new LinearClient({ apiKey: config.apiKey });
}
