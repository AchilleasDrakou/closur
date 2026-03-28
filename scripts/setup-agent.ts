/**
 * Create an ElevenLabs Conversational AI agent for Closur.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=your_key npx tsx scripts/setup-agent.ts
 *
 * This creates the agent and outputs the agent ID to add to .dev.vars
 */

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  console.error("Set ELEVENLABS_API_KEY env var");
  process.exit(1);
}

const AGENT_CONFIG = {
  conversation_config: {
    agent: {
      prompt: {
        prompt: `You are a realistic conversation partner for practicing hard conversations.
You play the role described in your system prompt with full authenticity.
Push back, ask tough questions, show real emotions.
Never break character. Never acknowledge you're an AI.
Adapt your tone based on how the conversation is going.`,
      },
      first_message: "Hi there. What did you want to talk about?",
      language: "en",
    },
    tts: {
      voice_id: "JBFqnCBsd6RMkjVDRZzb", // George - professional male voice
    },
  },
  name: "Closur Coach",
  platform_settings: {
    widget: {
      variant: "full",
    },
  },
};

async function createAgent() {
  console.log("Creating ElevenLabs agent...");

  const res = await fetch("https://api.elevenlabs.io/v1/convai/agents/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": API_KEY!,
    },
    body: JSON.stringify(AGENT_CONFIG),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Failed: ${res.status} ${err}`);
    process.exit(1);
  }

  const data = await res.json() as { agent_id: string };
  console.log(`\nAgent created successfully!`);
  console.log(`Agent ID: ${data.agent_id}`);
  console.log(`\nAdd to .dev.vars:`);
  console.log(`ELEVENLABS_API_KEY=${API_KEY}`);
  console.log(`ELEVENLABS_AGENT_ID=${data.agent_id}`);

  // Write .dev.vars
  const fs = await import("fs");
  const vars = `ELEVENLABS_API_KEY=${API_KEY}\nELEVENLABS_AGENT_ID=${data.agent_id}\n`;
  fs.writeFileSync(".dev.vars", vars);
  console.log(`\n.dev.vars written!`);
}

createAgent().catch(console.error);
