/* eslint-disable */
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("./src/server");
    durableNamespaces: "CoachAgent";
  }
  interface Env {
    AI: Ai;
    KV: KVNamespace;
    CoachAgent: DurableObjectNamespace<import("./src/server").CoachAgent>;
    CF_ACCOUNT_ID: string;
    CF_API_TOKEN: string;
    ELEVENLABS_API_KEY: string;
    ELEVENLABS_AGENT_ID: string;
  }
}
interface Env extends Cloudflare.Env {}
