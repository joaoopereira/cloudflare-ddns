import { useState } from "react";

export function InstallCommands() {
  const origin = location.origin;
  const commands = [
    { label: "Linux / macOS", cmd: `curl -fsSL ${origin}/install.sh | sudo sh` },
    { label: "Windows (PowerShell as Administrator)", cmd: `irm ${origin}/install.ps1 | iex` },
  ];
  return (
    <div className="install">
      {commands.map((c) => (
        <CopyLine key={c.label} label={c.label} text={c.cmd} />
      ))}
    </div>
  );
}

function CopyLine({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copyline">
      <div className="muted small">{label}</div>
      <div className="copyrow">
        <code>{text}</code>
        <button
          className="ghost"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
