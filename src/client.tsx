import "./styles.css";
import { createRoot } from "react-dom/client";
import { ConversationProvider } from "@elevenlabs/react";
import App from "./app";

const root = createRoot(document.getElementById("root")!);
root.render(
  <ConversationProvider>
    <App />
  </ConversationProvider>
);
