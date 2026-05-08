import "phoenix_html";
import { Socket, Presence } from "phoenix";
import { LiveSocket } from "phoenix_live_view";

// ---------------------------------------------------------------------------
// LiveView socket (for future LiveView pages)
// ---------------------------------------------------------------------------
const csrfToken = document
  .querySelector("meta[name='csrf-token']")
  ?.getAttribute("content");

const liveSocket = new LiveSocket("/live", Socket, {
  longPollFallbackMs: 2500,
  params: { _csrf_token: csrfToken }
});

liveSocket.connect();
window.liveSocket = liveSocket;

// ---------------------------------------------------------------------------
// Nexus real-time socket
// Connects with JWT token if present (stored in memory by the frontend app)
// ---------------------------------------------------------------------------
const NexusSocket = {
  socket: null,
  channels: {},
  presence: null,

  connect(token) {
    const params = token ? { token } : {};
    this.socket = new Socket("/socket", { params });
    this.socket.connect();
    window.NexusSocket = this;
    return this;
  },

  // Join a post channel for live replies and reactions
  joinPost(postId, callbacks = {}) {
    const channel = this.socket.channel(`post:${postId}`, {});

    channel.on("new_reply", payload => callbacks.onReply?.(payload));
    channel.on("reaction_added", payload => callbacks.onReaction?.(payload));
    channel.on("typing", payload => callbacks.onTyping?.(payload));
    channel.on("presence_state", state => callbacks.onPresence?.(state));
    channel.on("presence_diff", diff => callbacks.onPresenceDiff?.(diff));

    channel.join()
      .receive("ok", resp => console.log(`Joined post:${postId}`, resp))
      .receive("error", resp => console.error(`Failed to join post:${postId}`, resp));

    this.channels[`post:${postId}`] = channel;
    return channel;
  },

  // Join the global feed for live new post notifications
  joinFeed(topic = "global", callbacks = {}) {
    const channel = this.socket.channel(`feed:${topic}`, {});

    channel.on("new_post", payload => callbacks.onNewPost?.(payload));

    channel.join()
      .receive("ok", () => console.log(`Joined feed:${topic}`))
      .receive("error", resp => console.error(`Failed to join feed:${topic}`, resp));

    this.channels[`feed:${topic}`] = channel;
    return channel;
  },

  // Join global presence
  joinPresence(callbacks = {}) {
    const channel = this.socket.channel("presence:global", {});
    const presence = new Presence(channel);

    presence.onSync(() => callbacks.onSync?.(presence.list()));

    channel.join()
      .receive("ok", () => console.log("Joined presence:global"))
      .receive("error", resp => console.error("Failed to join presence", resp));

    this.channels["presence:global"] = channel;
    this.presence = presence;
    return { channel, presence };
  },

  leave(topic) {
    if (this.channels[topic]) {
      this.channels[topic].leave();
      delete this.channels[topic];
    }
  }
};

window.NexusSocket = NexusSocket;
export default NexusSocket;

// ---------------------------------------------------------------------------
// PWA install prompt
// Capture the browser's beforeinstallprompt event so we can trigger it
// from the React app at a moment of our choosing instead of the default
// browser timing. Stored on window so nexus.jsx can read it.
// ---------------------------------------------------------------------------
window._installPrompt = null;
window._installPromptListeners = [];

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  window._installPrompt = e;
  window._installPromptListeners.forEach(fn => fn(e));
});

window.addEventListener("appinstalled", () => {
  window._installPrompt = null;
  window._installPromptListeners.forEach(fn => fn(null));
});

window.onInstallPromptChange = function(fn) {
  window._installPromptListeners.push(fn);
  return () => {
    window._installPromptListeners =
      window._installPromptListeners.filter(f => f !== fn);
  };
};
