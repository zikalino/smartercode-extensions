import mermaid from 'mermaid';

declare global {
  interface Window {
    mermaid: typeof mermaid;
  }
}

// Expose Mermaid as a global consumed by the shared Mermaid webview renderer.
window.mermaid = mermaid;

export {};
